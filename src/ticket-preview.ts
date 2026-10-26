/* =====================================================================
   Vista previa en pantalla de un ticket ESC/POS (Apipos).

   Pinta el MISMO arreglo de elementos que se manda a la impresora
   ({ type: 'text' | 'special_text' | 'separator' }), línea por línea, con el
   ancho de columnas del papel: 48 en 80 mm, 32 en 58 mm. No arma su propio
   resumen: si el ticket cambia, la vista previa cambia con él.

   renderTicketPreviewPng() es la vista previa REAL: la pinta Apipos con el
   mismo renderizador que imprime (POST /render).
   ===================================================================== */

import type { Apipos } from './apipos.js';
import type { RenderPreviewOptions, TicketContent, TicketItem } from './types.js';

const HTML_ESCAPES: Readonly<Record<string, string>> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
};

const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, c => HTML_ESCAPES[c] ?? c);

// Lee una propiedad de lo que sea sin fallar: los tickets llegan de código JS
// sin tipos, y un elemento raro debe pintarse vacío, no romper la vista previa.
function field(value: unknown, key: string): unknown {
    return isRecord(value) ? value[key] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

/** Columnas de texto del papel (fuente A de la impresora térmica). */
export function ticketColumns(paperSize: number = 80): number {
    return Number(paperSize) === 58 ? 32 : 48;
}

/** Estilos del ticket. Papel blanco y tinta negra también en modo oscuro. */
export const TICKET_PREVIEW_CSS = `
.tkt { --tkt-cols: 48; box-sizing: content-box; width: calc(var(--tkt-cols) * 1ch); max-width: 100%;
    margin: 0 auto; padding: 14px 12px 18px; background: #fff; color: #111;
    font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18); border-radius: 2px; }
.tkt__text { white-space: pre-wrap; overflow-wrap: anywhere; }
.tkt__text--big { font-size: 1.2em; font-weight: 700; }
.tkt__row { display: flex; justify-content: space-between; gap: 1ch; }
.tkt__row > span:first-child { flex: 1 1 auto; white-space: pre-wrap; overflow-wrap: anywhere; }
.tkt__row > span:last-child { flex: 0 0 auto; white-space: nowrap; text-align: right; }
.tkt__sep { white-space: nowrap; overflow: hidden; color: #444; }
@media print { .tkt { box-shadow: none; padding: 0; } }
`;

/**
 * HTML del ticket a partir del contenido de Apipos.
 * @param content  Lo que recibe `printer.print(content)`.
 */
export function renderTicketHtml(
    content: readonly TicketItem[] | null | undefined,
    { paperSize = 80 }: { paperSize?: number } = {}
): string {
    const cols = ticketColumns(paperSize);
    const items: readonly TicketItem[] = content || [];
    const lines = items.map((item: unknown) => {
        const type = field(item, 'type');
        if (type === 'separator') return `<div class="tkt__sep">${'-'.repeat(cols)}</div>`;
        if (type === 'special_text') {
            const data = field(item, 'data');
            return `<div class="tkt__row"><span>${esc(field(data, 'text1'))}</span><span>${esc(field(data, 'text2'))}</span></div>`;
        }
        const align = field(item, 'align');
        const textAlign = align === 'center' || align === 'right' ? align : 'left';
        const fontSize = field(item, 'font_size');
        const big = fontSize === 'md' || fontSize === 'lg' ? ' tkt__text--big' : '';
        return `<div class="tkt__text${big}" style="text-align: ${textAlign}">${esc(field(item, 'data'))}</div>`;
    });
    return `<div class="tkt" style="--tkt-cols: ${cols}">${lines.join('')}</div>`;
}

/**
 * Imprime el ticket desde el navegador (PDF o impresora del sistema) sin sacar
 * el resto de la página: lo pinta en un iframe oculto y lo imprime solo.
 */
export function printTicketHtml(html: string, { title = 'Ticket' }: { title?: string } = {}): void {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position: fixed; right: 0; bottom: 0; width: 0; height: 0; border: 0;';
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    if (doc === null) {
        frame.remove();
        throw new Error('No se pudo preparar el iframe para imprimir el ticket.');
    }
    doc.open();
    doc.write(
        `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>` +
            `<style>@page { margin: 8mm; } body { margin: 0; } ${TICKET_PREVIEW_CSS}</style></head>` +
            `<body>${html}</body></html>`
    );
    doc.close();
    const win = frame.contentWindow;
    if (win === null) {
        frame.remove();
        throw new Error('No se pudo preparar el iframe para imprimir el ticket.');
    }
    const cleanup = () => setTimeout(() => frame.remove(), 500);
    win.addEventListener('afterprint', cleanup);
    win.focus();
    win.print();
    // Safari no siempre dispara afterprint: el iframe se retira igual.
    setTimeout(cleanup, 60000);
}

/**
 * Vista previa REAL (la pinta Apipos con el mismo motor que imprime). Devuelve un
 * data URL `data:image/png;base64,...` listo para un <img>. Para el camino ESC/POS
 * sigue existiendo renderTicketHtml (aproximación en pantalla).
 *
 * Usa `apipos.renderTicket(content, { settings, format: 'png', dpi })`, así que
 * `content` pasa por el `transformContent` del cliente, como al imprimir. Lanza
 * lo mismo que `renderTicket` (sin conexión, `ApiposError`, respuesta inesperada).
 *
 * @param apipos  El cliente (basta con algo que tenga `renderTicket`).
 * @param options `settings` del ticket (default `{}`) y `dpi` (default 150).
 */
export async function renderTicketPreviewPng(
    apipos: Pick<Apipos, 'renderTicket'>,
    content: TicketContent,
    { settings = {}, dpi = 150 }: RenderPreviewOptions = {}
): Promise<string> {
    const { base64 } = await apipos.renderTicket(content, { settings, format: 'png', dpi });
    return `data:image/png;base64,${base64}`;
}
