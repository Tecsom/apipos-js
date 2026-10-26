/*
 * Cliente de Apipos, el agente local de impresión que corre en la caja
 * (por defecto en http://127.0.0.1:50432). Envuelve los endpoints de
 * APIPOS_API.md y crea las impresoras (`ApiPosPrinter`) que mandan los trabajos.
 *
 * La librería no sabe nada del POS que la usa: lo que cada app quiera hacerle al
 * texto antes de imprimir (limpieza, quitar acentos) entra por el hook
 * `transformContent`.
 *
 * Handshake de versión: cada respuesta trae `X-Apipos-Version`; si no coincide
 * con la versión de la librería, avisa UNA vez por versión de Apipos: por
 * defecto con `console.warn`, una vez por página; con `onVersionMismatch`, una
 * vez por cliente.
 */
import { base64ToBlob, isRecord, isUnknownArray, request as sendRequest, unexpectedResponse } from './http.js';
import { ApiPosPrinter } from './printer.js';
import { VERSION } from './version.js';
import { describeVersions } from './version-check.js';
import type {
    ApiposOptions,
    ContentTransform,
    FetchLike,
    FontCatalog,
    FontCatalogData,
    FontFace,
    FontFamily,
    FontFormat,
    FontSource,
    HealthData,
    HealthResult,
    HttpMethod,
    ListFontsOptions,
    PageSizeMm,
    PrintSettings,
    RenderData,
    RenderedFont,
    RenderFormat,
    RenderResult,
    RenderTicketOptions,
    RequestOptions,
    ServerClientStatus,
    TicketContent,
    VersionInfo,
    VersionStatus
} from './types.js';

const DEFAULT_BASE_URL = 'http://127.0.0.1:50432';

// El `fetch` global se busca en CADA petición, como en v1 (que llamaba a `fetch`
// directo): si alguien lo reemplaza después de crear el cliente (dobles de
// prueba, instrumentación), se usa el vigente. Se invoca como método de
// `globalThis`, así el navegador no lanza "Illegal invocation".
const globalFetch: FetchLike = (url, init) => globalThis.fetch(url, init);

// Default de `transformContent`: copia superficial. Quien imprime puede reusar su
// arreglo (otra copia, el reintento sin logo) y la librería nunca lo muta.
const copyContent: ContentTransform = content => content.slice();

// Default de `onVersionMismatch`: el aviso a la consola del navegador. Busca
// `console.warn` al avisar (no al crear el cliente), así se puede interceptar.
const warnInConsole = (info: VersionInfo): void => {
    console.warn(info.message);
};

// Versiones de Apipos (`String(info.backend)`; `'null'` = no la reporta) ya
// avisadas con el `console.warn` por defecto. Vive en el MÓDULO, no en cada
// cliente: una app puede crear un `new Apipos()` por impresión y el aviso debe
// salir una vez por página, no en cada ticket.
const warnedInConsole = new Set<string>();

function isVersionStatus(value: unknown): value is VersionStatus {
    return value === 'equal' || value === 'client_older' || value === 'client_newer' || value === 'unknown';
}

function isStringOrNull(value: unknown): value is string | null {
    return value === null || typeof value === 'string';
}

function isServerClientStatus(value: unknown): value is ServerClientStatus {
    return (
        isRecord(value) &&
        isStringOrNull(value.name) &&
        isStringOrNull(value.version) &&
        typeof value.server === 'string' &&
        isVersionStatus(value.status) &&
        typeof value.message === 'string'
    );
}

// `version` y `client` no existen en Apipos anteriores a 1.0.6: su ausencia no
// es un error (justo con esos backends importa que checkHealth siga funcionando).
function isHealthData(value: unknown): value is HealthData {
    return (
        isRecord(value) &&
        typeof value.status === 'string' &&
        typeof value.os === 'string' &&
        typeof value.platform === 'string' &&
        typeof value.backend === 'string' &&
        typeof value.port === 'number' &&
        (value.version === undefined || typeof value.version === 'string') &&
        (value.client === undefined || value.client === null || isServerClientStatus(value.client))
    );
}

function isStringArray(value: unknown): value is string[] {
    return isUnknownArray(value) && value.every(item => typeof item === 'string');
}

function isFontFormat(value: unknown): value is FontFormat {
    return value === 'ttf' || value === 'otf' || value === 'ttc' || value === 'otc';
}

function isFontFace(value: unknown): value is FontFace {
    return (
        isRecord(value) &&
        typeof value.style === 'string' &&
        typeof value.bold === 'boolean' &&
        typeof value.italic === 'boolean' &&
        typeof value.weight === 'number' &&
        typeof value.full_name === 'string' &&
        isStringOrNull(value.postscript_name) &&
        typeof value.path === 'string' &&
        typeof value.index === 'number' &&
        isFontFormat(value.format)
    );
}

function isFontFamily(value: unknown): value is FontFamily {
    return (
        isRecord(value) &&
        typeof value.family === 'string' &&
        typeof value.monospace === 'boolean' &&
        isUnknownArray(value.faces) &&
        value.faces.every(isFontFace)
    );
}

/** Forma de `data` de GET /fonts (APIPOS_API.md, "Fuentes del sistema"). */
function isFontCatalogData(value: unknown): value is FontCatalogData {
    return (
        isRecord(value) &&
        isUnknownArray(value.families) &&
        value.families.every(isFontFamily) &&
        typeof value.count === 'number' &&
        isStringArray(value.builtin) &&
        isStringArray(value.dirs) &&
        typeof value.scanned_at === 'string'
    );
}

function isRenderFormat(value: unknown): value is RenderFormat {
    return value === 'pdf' || value === 'png';
}

function isFontSource(value: unknown): value is FontSource {
    return value === 'system' || value === 'builtin' || value === 'fallback';
}

function isRenderedFont(value: unknown): value is RenderedFont {
    return (
        isRecord(value) &&
        typeof value.family === 'string' &&
        typeof value.resolved === 'string' &&
        isFontSource(value.source) &&
        typeof value.bold === 'boolean' &&
        typeof value.italic === 'boolean'
    );
}

function isPageSizeMm(value: unknown): value is PageSizeMm {
    return isRecord(value) && typeof value.width === 'number' && typeof value.height === 'number';
}

/** Forma de `data` de POST /render (APIPOS_API.md, "Vista previa"). `dpi` es `null` con `pdf`. */
function isRenderData(value: unknown): value is RenderData {
    return (
        isRecord(value) &&
        isRenderFormat(value.format) &&
        (value.dpi === null || typeof value.dpi === 'number') &&
        typeof value.base64 === 'string' &&
        isPageSizeMm(value.page_mm) &&
        typeof value.pages === 'number' &&
        isUnknownArray(value.fonts) &&
        value.fonts.every(isRenderedFont) &&
        isStringArray(value.warnings)
    );
}

// Mime del `blob` de una vista previa según el formato que devolvió Apipos.
const RENDER_MIME: Readonly<Record<RenderFormat, string>> = { pdf: 'application/pdf', png: 'image/png' };

export class Apipos {
    #baseUrl: string;
    readonly #fetch: FetchLike;
    readonly #transformContent: ContentTransform;
    readonly #onVersionMismatch: ((info: VersionInfo) => void) | null;
    // Con `onVersionMismatch` inyectado, las versiones ya avisadas son de ESTE
    // cliente: quien inyecta el hook controla su propia política.
    readonly #warnedBackends = new Set<string>();

    constructor(options: ApiposOptions = {}) {
        this.#baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
        this.#fetch = options.fetch ?? globalFetch;
        this.#transformContent = options.transformContent ?? copyContent;
        this.#onVersionMismatch = options.onVersionMismatch ?? null;
    }

    /** URL base de Apipos (default `http://127.0.0.1:50432`). */
    get baseUrl(): string {
        return this.#baseUrl;
    }

    /** Alias de `baseUrl` (compatibilidad con v1). */
    get apiUrl(): string {
        return this.#baseUrl;
    }

    /** Compatibilidad con v1: cambia la URL base para las siguientes peticiones. */
    set apiUrl(url: string) {
        this.#baseUrl = url;
    }

    /**
     * Verifica que el servicio de impresión esté disponible.
     * GET /health → { data: { status, version, os, platform, backend, port, client }, message, status }
     *
     * Devuelve `{ ok, data, version }`: `ok` es `true` si el servicio responde
     * "ok" y `version` = `describeVersions(VERSION, data.version)`
     * (`{ client, backend, status, message }`).
     *
     * `data.version` pasa por el MISMO aviso deduplicado que el header: si el
     * header ya avisó esa versión no se repite, y si la respuesta no trajo
     * `headers` (dobles de `fetch`) el aviso sale de aquí.
     *
     * Nunca lanza: ante cualquier error devuelve `{ ok: false, data: null, version: null }`.
     */
    async checkHealth(): Promise<HealthResult> {
        try {
            const data = await this.request('GET', '/health');
            if (!isHealthData(data)) throw unexpectedResponse('/health');
            const version = describeVersions(VERSION, data.version ?? null);
            this.#notifyVersion(version);
            return { ok: data.status === 'ok', data, version };
        } catch (e) {
            console.error('Error checking Apipos health:', e);
            return { ok: false, data: null, version: null };
        }
    }

    /** GET /printers → nombres exactos de las impresoras instaladas; `[]` si falla. */
    async listPrinters(): Promise<string[]> {
        try {
            const data = await this.request('GET', '/printers');
            if (!isStringArray(data)) throw unexpectedResponse('/printers');
            return data;
        } catch (e) {
            console.error('Error fetching printers:', e);
            return [];
        }
    }

    /**
     * Fuentes instaladas en la máquina de Apipos, para elegir `settings.font.family`
     * o `font_family` del renderizador PDF.
     * GET /fonts (con `refresh: true` → GET /fonts?refresh=1, que vuelve a
     * escanear; útil tras instalar una fuente).
     *
     * Devuelve `{ families, builtin, count, dirs, scannedAt }`: `builtin`
     * (`sans-serif`, `serif`, `monospace`) existe siempre, aunque la máquina no
     * tenga fuentes. A diferencia de `listPrinters`, LANZA ante cualquier error
     * (`ApiposError`, sin conexión o `Respuesta inesperada de Apipos en /fonts`).
     */
    async listFonts({ refresh = false }: ListFontsOptions = {}): Promise<FontCatalog> {
        const data = await this.request('GET', '/fonts', refresh ? { query: { refresh: true } } : {});
        if (!isFontCatalogData(data)) throw unexpectedResponse('/fonts');
        return {
            families: data.families,
            builtin: data.builtin,
            count: data.count,
            dirs: data.dirs,
            scannedAt: data.scanned_at
        };
    }

    /**
     * Vista previa REAL de un ticket: Apipos lo maqueta con el mismo renderizador
     * PDF que imprime (`settings.renderer: 'pdf'`), sin validar ni tocar ninguna
     * impresora. POST /render con `{ settings, content, format, dpi }`.
     *
     * `content` pasa por `transformContent`, igual que al imprimir: lo que se ve
     * es lo que saldría en papel. `dpi` solo aplica con `png` (72–600).
     *
     * Devuelve `{ format, dpi, base64, pageMm, pages, fonts, warnings, blob }`;
     * `blob` es un `Blob` `application/pdf` o `image/png` listo para
     * `URL.createObjectURL`, y `dpi` es `null` con `pdf`. Lanza ante cualquier error.
     */
    async renderTicket(
        content: TicketContent,
        { settings = {}, format = 'pdf', dpi = 203 }: RenderTicketOptions = {}
    ): Promise<RenderResult> {
        const data = await this.request('POST', '/render', {
            body: { settings, content: this.applyTransform(content), format, dpi }
        });
        if (!isRenderData(data)) throw unexpectedResponse('/render');
        return {
            format: data.format,
            dpi: data.dpi,
            base64: data.base64,
            pageMm: data.page_mm,
            pages: data.pages,
            fonts: data.fonts,
            warnings: data.warnings,
            blob: base64ToBlob(data.base64, RENDER_MIME[data.format])
        };
    }

    /**
     * Impresora con nombre exacto (de `listPrinters()`) y sus `settings`
     * (`paper_size` numérico obligatorio). Sin nombre devuelve `null` y lo
     * reporta en consola, como v1.
     */
    createPrinter(name: string, settings: PrintSettings = {}): ApiPosPrinter | null {
        if (!name) {
            console.error('Printer name is required');
            return null;
        }
        return new ApiPosPrinter(name, settings, this);
    }

    /**
     * Acceso a la red para `ApiPosPrinter` (y para endpoints que la librería aún
     * no envuelve): devuelve el `data` del sobre o lanza `ApiposError`.
     */
    request(method: HttpMethod, path: string, options?: RequestOptions): Promise<unknown> {
        return sendRequest(
            { baseUrl: this.#baseUrl, fetch: this.#fetch, onVersion: info => this.#notifyVersion(info) },
            method,
            path,
            options
        );
    }

    /** Pasa el `content` de un trabajo por `transformContent`. */
    applyTransform(content: TicketContent): TicketContent {
        return this.#transformContent(content);
    }

    // Aviso de versión: solo si difieren y una vez por versión de Apipos (por
    // página con el aviso por defecto; por cliente con `onVersionMismatch`). Es
    // informativo: si `onVersionMismatch` lanza, se reporta y la petición (la
    // impresión) sigue su curso.
    #notifyVersion(info: VersionInfo): void {
        if (info.status === 'equal') return;
        const key = String(info.backend);
        const warned = this.#onVersionMismatch ? this.#warnedBackends : warnedInConsole;
        if (warned.has(key)) return;
        warned.add(key);
        try {
            (this.#onVersionMismatch ?? warnInConsole)(info);
        } catch (e) {
            console.error('Error in Apipos onVersionMismatch:', e);
        }
    }
}
