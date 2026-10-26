/*
 * Único punto de red de la librería: todo lo que habla con Apipos pasa por
 * `request()`. Aquí viven el header del cliente, el handshake de versión, el
 * manejo del sobre `{ status, data, message }` y los mensajes de error que ve
 * el usuario del POS.
 */
import { CLIENT_NAME, VERSION } from './version.js';
import { describeVersions } from './version-check.js';
import type { HttpMethod, RequestContext, RequestInitLike, RequestOptions, ResponseLike } from './types.js';

export const CLIENT_HEADER = 'X-Apipos-Client';
export const VERSION_HEADER = 'X-Apipos-Version';
export const CONNECT_ERROR = (baseUrl: string): string =>
    `No se pudo conectar con Apipos (${baseUrl}). ¿Está abierta la app de bandeja?`;

/**
 * Error de negocio que respondió Apipos (`status: 'error'` o HTTP no-2xx).
 * `message` es el del backend (p. ej. `Printer 'X' not found.`) y `data` lo que
 * traiga el sobre (p. ej. `{ available: [...] }` con las impresoras válidas).
 * Sigue siendo `instanceof Error`.
 */
export class ApiposError extends Error {
    data: unknown;

    constructor(message: string, data: unknown = null) {
        super(message);
        this.name = 'ApiposError';
        this.data = data;
    }
}

/** Objeto JSON (no `null`). Los arreglos también pasan: se leen sus claves como `undefined`. */
export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

/** `Array.isArray` sin dejar escapar elementos sin tipo. */
export function isUnknownArray(value: unknown): value is readonly unknown[] {
    return Array.isArray(value);
}

/** Error para cuando Apipos respondió éxito pero con una forma que no es la del contrato. */
export function unexpectedResponse(path: string): Error {
    return new Error(`Respuesta inesperada de Apipos en ${path}`);
}

// Prefijo de un data URI en base64 (`data:image/png;base64,`), con o sin mime.
const DATA_URI_PREFIX = /^data:[^,]*;base64,/i;

/**
 * base64 (puro o data URI `data:<mime>;base64,...`) → `Blob` del `mime` dado
 * (el del data URI se descarta). Usa `atob`, que existe en el navegador y en
 * Node: así lo que devuelve `POST /render` se puede abrir, descargar o mostrar
 * con `URL.createObjectURL(blob)`. Un base64 inválido lanza el error de `atob`.
 */
export function base64ToBlob(base64: string, mime: string): Blob {
    const binary = atob(base64.replace(DATA_URI_PREFIX, ''));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
        bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: mime });
}

function queryString(query: RequestOptions['query']): string {
    if (!query) return '';
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
        if (value === null || value === undefined) continue;
        params.append(key, typeof value === 'boolean' ? (value ? '1' : '0') : String(value));
    }
    const text = params.toString();
    return text ? `?${text}` : '';
}

/**
 * Único punto de red de la librería. Manda `X-Apipos-Client: apipos-js/<VERSION>`,
 * evalúa `X-Apipos-Version` (handshake: `ctx.onVersion`), interpreta el sobre
 * `{ status, data, message }` y devuelve `data` (o `null`), o lanza
 * `ApiposError(message)` con `error.data` (p. ej. `available`).
 *
 * @param path  p. ej. `'/print'`
 */
export async function request(
    ctx: RequestContext,
    method: HttpMethod,
    path: string,
    { body, query }: RequestOptions = {}
): Promise<unknown> {
    const headers: Record<string, string> = { [CLIENT_HEADER]: `${CLIENT_NAME}/${VERSION}` };
    const init: RequestInitLike = { method, headers };
    if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
    }

    // Se llama suelta (no como `ctx.fetch(...)`): un `fetch` nativo inyectado tal
    // cual (`{ fetch: window.fetch }`) falla con "Illegal invocation" si recibe
    // otro objeto como `this`.
    const send = ctx.fetch;
    let response: ResponseLike;
    try {
        response = await send(ctx.baseUrl + path + queryString(query), init);
    } catch {
        throw new Error(CONNECT_ERROR(ctx.baseUrl));
    }

    let payload: unknown = null;
    try {
        payload = await response.json();
    } catch {
        // respuesta sin cuerpo JSON
    }

    // Handshake: TODA respuesta de Apipos ≥ 1.0.6 trae `X-Apipos-Version` (también
    // las de error, por eso va antes de lanzar). Sin el header → `unknown`: es un
    // Apipos anterior. Si la respuesta no trae `headers` (dobles de `fetch` de
    // pruebas) no hay nada que comparar y no se evalúa.
    if (response.headers) {
        ctx.onVersion?.(describeVersions(VERSION, response.headers.get(VERSION_HEADER)));
    }

    const envelope = isRecord(payload) ? payload : null;
    const data = envelope?.data ?? null;
    if (!response.ok || envelope?.status === 'error') {
        const message = envelope?.message;
        throw new ApiposError(
            (typeof message === 'string' && message) || response.statusText || 'Error de impresión',
            data
        );
    }

    return data;
}
