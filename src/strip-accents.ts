/*
 * Texto de impresión sin acentos ni ñ, para las tiqueteras que no traen la
 * tabla Latin-1.
 *
 * Apipos manda cada carácter como su byte Latin-1 y nunca elige página de
 * códigos; una impresora que arranca en otra página (las genéricas suelen
 * arrancar en CP437) pinta otro glifo por cada byte ≥ 0x80: la `ñ` sale `±`,
 * la `í` sale `φ`, la `á` sale `ß`. Con el texto reducido a letras base no queda
 * byte que la impresora pueda malinterpretar.
 *
 * Módulo puro (sin DOM ni imports en runtime: solo un tipo) para poder probarlo
 * directamente desde mocha. Quién decide si se aplica es el `transformContent`
 * del cliente.
 */

import type { TicketContent } from './types.js';

// Marcas combinantes que deja `normalize('NFD')` al separar la letra base de su
// acento, diéresis, virgulilla o cedilla. Quitarlas cubre cualquier letra con
// diacrítico sin tener que listarlas una por una.
const COMBINING_MARKS = /[\u0300-\u036f]/g;

// Lo que NFD no descompone. Los signos de apertura se quitan (la tiquetera
// tampoco los tiene y el de cierre basta para leer la frase) y los ordinales
// se vuelven su letra.
const EXPLICIT_REPLACEMENTS: Readonly<Record<string, string>> = { '¿': '', '¡': '', ª: 'a', º: 'o' };
const EXPLICIT_PATTERN = /[¿¡ªº]/g;

/**
 * Devuelve `text` sin acentos ni ñ. Cada vocal acentuada y cada ñ cambian un
 * carácter por otro, así que el ancho de las líneas y la alineación de las
 * columnas del ticket no se mueven; sólo `¿` y `¡` acortan la línea en uno.
 * Lo que no es string se devuelve tal cual.
 */
export function stripAccents(text: string): string;
export function stripAccents<T>(text: T): T;
export function stripAccents(text: unknown): unknown {
    if (typeof text !== 'string') return text;
    return text
        .normalize('NFD')
        .replace(COMBINING_MARKS, '')
        .replace(EXPLICIT_PATTERN, char => EXPLICIT_REPLACEMENTS[char] ?? char);
}

/**
 * Aplica `stripAccents` a todo el texto de un trabajo RAW de Apipos.
 *
 * Devuelve un arreglo NUEVO y no toca la entrada: quien imprime puede reusar
 * su contenido (otra copia, o el reintento sin logo). Recorre los strings a
 * cualquier profundidad (`text.data`, `special_text.data.text1/text2`,
 * `table.data.rows`), pero deja intactos los elementos `image`: su `data` es
 * base64, no puede llevar acentos, y normalizar cientos de KB en cada ticket
 * sería trabajo tirado.
 */
export function stripAccentsFromContent(content: TicketContent): TicketContent;
export function stripAccentsFromContent<T>(content: T): T;
export function stripAccentsFromContent(content: unknown): unknown {
    if (!isUnknownArray(content)) return stripStrings(content);
    return content.map(item => (isRecord(item) && item.type === 'image' ? item : stripStrings(item)));
}

function stripStrings(value: unknown): unknown {
    if (typeof value === 'string') return stripAccents(value);

    if (isUnknownArray(value)) return value.map(stripStrings);

    if (isRecord(value)) {
        const stripped: Record<string, unknown> = {};
        for (const key in value) {
            stripped[key] = stripStrings(value[key]);
        }
        return stripped;
    }

    return value;
}

// Guardas locales (el módulo se mantiene sin imports de código).
function isUnknownArray(value: unknown): value is readonly unknown[] {
    return Array.isArray(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}
