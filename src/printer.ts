/*
 * Impresora de Apipos: manda trabajos RAW (ticket ESC/POS o renderizado a PDF
 * en Apipos) y PDF a UNA impresora por su nombre exacto, abre su cajón y pide
 * la vista previa con sus settings. Se crea con `apipos.createPrinter(name, settings)`.
 *
 * No depende de la app que la usa: lo que haya que hacerle al texto antes de
 * imprimir lo decide el `transformContent` del `Apipos` que la creó.
 */

import type { Apipos } from './apipos.js';
import { isRecord, isUnknownArray, unexpectedResponse } from './http.js';
import type {
    OpenDrawerResult,
    PrinterRenderOptions,
    PrintOptions,
    PrintPdfOptions,
    PrintResult,
    PrintSettings,
    PrintSettingsOverrides,
    RenderResult,
    TicketContent
} from './types.js';

// Settings sin los que no se puede armar un ticket, con el tipo que exige Apipos.
const REQUIRED_SETTINGS: ReadonlyArray<readonly ['paper_size', 'number']> = [['paper_size', 'number']];

function isOptional(value: unknown, type: 'string' | 'number' | 'boolean'): boolean {
    return value === undefined || typeof value === type;
}

// La forma de `data` cambia con el tipo de trabajo (ver PrintResult); se exige lo
// común (`printer`) y que lo demás, si viene, tenga el tipo del contrato.
function isPrintResult(value: unknown): value is PrintResult {
    return (
        isRecord(value) &&
        typeof value.printer === 'string' &&
        isOptional(value.type, 'string') &&
        isOptional(value.char_width, 'number') &&
        isOptional(value.strategy, 'string') &&
        isOptional(value.width_dots, 'number') &&
        isOptional(value.cut, 'boolean') &&
        (value.media === undefined || value.media === null || typeof value.media === 'string') &&
        isOptional(value.renderer, 'string') &&
        (value.page_mm === undefined || isRecord(value.page_mm)) &&
        (value.fonts === undefined || isUnknownArray(value.fonts)) &&
        (value.warnings === undefined || isUnknownArray(value.warnings)) &&
        isOptional(value.drawer_opened, 'boolean')
    );
}

function isOpenDrawerResult(value: unknown): value is OpenDrawerResult {
    return isRecord(value) && typeof value.printer === 'string';
}

/**
 * Única fuente de verdad del mapeo `options` (camelCase, de la librería) →
 * claves de `settings` (snake_case, del cable). La usan `print()` y `render()`.
 * Solo se copian las opciones definidas (`undefined` no viaja; `false` y `0`
 * sí) y `options.settings` va al final: gana sobre las de arriba.
 */
function settingsFromOptions(options: PrintOptions): PrintSettingsOverrides {
    const { renderer, pdfMode, font, marginsMm, widthMm, maxHeightMm, cut, settings } = options;
    const mapped: PrintSettingsOverrides = {};
    if (renderer !== undefined) mapped.renderer = renderer;
    if (pdfMode !== undefined) mapped.pdf_mode = pdfMode;
    if (font !== undefined) mapped.font = font;
    if (marginsMm !== undefined) mapped.margins_mm = marginsMm;
    if (widthMm !== undefined) mapped.width_mm = widthMm;
    if (maxHeightMm !== undefined) mapped.max_height_mm = maxHeightMm;
    if (cut !== undefined) mapped.cut = cut;
    if (settings !== undefined) {
        for (const [key, value] of Object.entries(settings)) {
            if (value !== undefined) mapped[key] = value;
        }
    }
    return mapped;
}

/** Payload de POST /print sin la impresora (la pone `#send`). */
type PrintPayload =
    | { type: 'RAW'; settings: PrintSettings; content: TicketContent }
    | { type: 'PDF'; settings: PrintSettings; data: string };

export class ApiPosPrinter {
    #name: string;
    #apipos: Apipos;
    settings: PrintSettings;

    /**
     * Valida `settings.paper_size` (number, obligatorio): lanza
     * `Missing required setting: paper_size` o
     * `Invalid type for setting paper_size: expected number, got <tipo>`.
     */
    constructor(name: string, settings: PrintSettings = {}, apipos: Apipos) {
        this.#name = name;
        this.settings = settings;
        this.#apipos = apipos;

        this.validateSettings();
    }

    validateSettings(): void {
        for (const [key, type] of REQUIRED_SETTINGS) {
            const value: unknown = this.settings[key];
            if (value === undefined) {
                throw new Error(`Missing required setting: ${key}`);
            }
            if (typeof value !== type) {
                throw new Error(`Invalid type for setting ${key}: expected ${type}, got ${typeof value}`);
            }
        }
    }

    get name(): string {
        return this.#name;
    }

    get apiUrl(): string {
        return this.#apipos.apiUrl;
    }

    // Único punto de envío a POST /print. Maneja la respuesta estandarizada
    // de Apipos: { status, data, message }. Devuelve `data` o lanza con `message`.
    async #send(payload: PrintPayload): Promise<PrintResult | null> {
        const data = await this.#apipos.request('POST', '/print', { body: { printer: this.#name, ...payload } });
        if (data !== null && !isPrintResult(data)) throw unexpectedResponse('/print');
        return data;
    }

    /**
     * Trabajo RAW: `content` es la lista de elementos del ticket.
     *
     * Lo que haya que hacerle al texto (p. ej. una limpieza base o un
     * interruptor por dispositivo "sin acentos ni ñ") lo aplica el
     * `transformContent` del cliente en CADA trabajo, no al crear la impresora:
     * así un cambio de ajustes vale desde el siguiente ticket sin recargar.
     *
     * SIN `options` (o con `{}`) el payload es el de v1, byte a byte:
     * `{ printer, type: 'RAW', settings: this.settings, content }`.
     *
     * Con `options` se agregan claves SOLO dentro de `settings` (nunca al nivel
     * raíz) y `this.settings` no se modifica:
     *   renderer → renderer ('escpos' | 'pdf'; con 'pdf' Apipos maqueta el ticket
     *     como PDF con fuentes del sistema y lo imprime por la ruta PDF)
     *   pdfMode → pdf_mode ; font → font ({ family, size, line_height })
     *   marginsMm → margins_mm ; widthMm → width_mm ; maxHeightMm → max_height_mm
     *   cut → cut ; settings → se mezcla al final y gana (claves nuevas del backend)
     * Las opciones `undefined` no viajan.
     */
    async print(content: TicketContent, options: PrintOptions = {}): Promise<PrintResult | null> {
        const printable = this.#apipos.applyTransform(content);
        const overrides = settingsFromOptions(options);
        // Sin opciones definidas viaja `this.settings` MISMO (no una copia): el
        // payload de v1 sale byte a byte igual. Con opciones, un objeto nuevo.
        const settings: PrintSettings =
            Object.keys(overrides).length === 0 ? this.settings : { ...this.settings, ...overrides };
        return this.#send({ type: 'RAW', settings, content: printable });
    }

    /**
     * Abre el cajón de dinero conectado a ESTA impresora, sin imprimir nada.
     * POST /open-withdrawer con `{ printer }` → `{ printer }`. Lanza
     * `ApiposError` si Apipos responde error (p. ej. `Printer 'X' not found.`).
     */
    async openDrawer(): Promise<OpenDrawerResult> {
        const data = await this.#apipos.request('POST', '/open-withdrawer', { body: { printer: this.#name } });
        if (!isOpenDrawerResult(data)) throw unexpectedResponse('/open-withdrawer');
        return data;
    }

    /**
     * Vista previa con los settings de ESTA impresora y las mismas `options` que
     * `print()`, con el mismo mapeo a `settings`:
     * `apipos.renderTicket(content, { settings: { ...this.settings, ...mapeo(options) }, format, dpi })`.
     * No imprime ni valida la impresora; `this.settings` no se modifica. Default
     * `png` a 203 dpi (la resolución de una tiquetera: 72 mm → 576 px de ancho).
     */
    async render(
        content: TicketContent,
        { format = 'png', dpi = 203, ...options }: PrinterRenderOptions = {}
    ): Promise<RenderResult> {
        const settings = { ...this.settings, ...settingsFromOptions(options) };
        return this.#apipos.renderTicket(content, { settings, format, dpi });
    }

    /**
     * Trabajo PDF: en el navegador el PDF es un Blob; se envía en base64.
     * Opciones:
     *   pdfMode: 'driver' (el driver de la impresora renderiza el PDF — el modo
     *     correcto para etiquetas, ej. AiYin) | 'raw' (rasteriza a ESC/POS, para
     *     tiqueteras de recibos). Default del servidor: 'driver' si se mandan
     *     labelSettings, 'raw' si no.
     *   labelSettings: { width, height, unit: 'mm'|'inch' } — tamaño de la
     *     etiqueta; la página del PDF debe medir lo mismo.
     */
    async printPDF(blob: Blob, { pdfMode, labelSettings }: PrintPdfOptions = {}): Promise<PrintResult | null> {
        const data = await blobToBase64(blob);
        const settings: PrintSettings = { ...this.settings };
        if (pdfMode) settings.pdf_mode = pdfMode;
        if (labelSettings) settings.label_settings = labelSettings;
        return this.#send({ type: 'PDF', settings, data });
    }
}

// Bytes por llamada a `String.fromCharCode`: pasarle un PDF entero como
// argumentos revienta la pila; 32 KiB está muy por debajo del límite de los motores.
const BASE64_CHUNK = 0x8000;

// Mismo base64 que daba `FileReader.readAsDataURL` (sin el prefijo
// "data:<mime>;base64,"), pero sin FileReader: `arrayBuffer()` + `btoa` existen
// en el navegador y en Node, así que se puede probar fuera del navegador.
async function blobToBase64(blob: Blob): Promise<string> {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK));
    }
    return btoa(binary);
}
