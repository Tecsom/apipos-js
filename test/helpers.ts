// Ayudas de las pruebas: dobles de `fetch` tipados como `FetchLike` (graban cada
// petición y responden lo que diga la prueba; nunca hay red real) y guardas para
// leer JSON sin tipos.
import assert from 'node:assert/strict';

import type { FetchLike, HeadersLike, RequestInitLike, ResponseLike } from '../dist/index.js';

export const BASE_URL = 'http://127.0.0.1:1';

export interface RecordedRequest {
    url: string;
    init: RequestInitLike;
}

export interface FakeFetch {
    fetch: FetchLike;
    requests: RecordedRequest[];
}

type Responder = (request: RecordedRequest) => ResponseLike | Promise<ResponseLike>;

export interface ResponseInitLike {
    ok?: boolean;
    status?: number;
    statusText?: string;
    /** Sin `headers` la respuesta no trae la propiedad (como los dobles de `fetch` de pruebas). */
    headers?: HeadersLike;
}

/** Sobre de éxito de Apipos con el `data` dado. */
export function success(data: unknown, message = 'ok', init: ResponseInitLike = {}): ResponseLike {
    return jsonResponse({ status: 'success', data, message }, init);
}

/** Respuesta con cuerpo JSON; sin `init.headers` no trae `headers` (como los dobles de `fetch` de pruebas). */
export function jsonResponse(
    body: unknown,
    { ok = true, status = 200, statusText = 'OK', headers }: ResponseInitLike = {}
): ResponseLike {
    const json = async (): Promise<unknown> => body;
    return headers ? { ok, status, statusText, headers, json } : { ok, status, statusText, json };
}

/** Respuesta cuyo cuerpo no es JSON: `json()` rechaza como lo hace un `Response` vacío. */
export function noJsonResponse({ ok = true, status = 200, statusText = 'OK' } = {}): ResponseLike {
    return {
        ok,
        status,
        statusText,
        json: async () => {
            throw new SyntaxError('Unexpected end of JSON input');
        }
    };
}

export function fakeFetch(respond: Responder = () => success(null)): FakeFetch {
    const requests: RecordedRequest[] = [];
    const fetch: FetchLike = async (url, init) => {
        const request = { url, init };
        requests.push(request);
        return respond(request);
    };
    return { fetch, requests };
}

/** La única petición grabada (falla si hubo cero o más de una). */
export function onlyRequest(fake: FakeFetch): RecordedRequest {
    assert.equal(fake.requests.length, 1);
    const [request] = fake.requests;
    assert.ok(request);
    return request;
}

/** El body JSON de una petición, sin tipos (se lee con `isRecord`). */
export function parsedBody(request: RecordedRequest): unknown {
    assert.equal(typeof request.init.body, 'string');
    const parsed: unknown = JSON.parse(request.init.body ?? '');
    return parsed;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `Array.isArray` sin dejar escapar elementos sin tipo. */
export function isUnknownArray(value: unknown): value is readonly unknown[] {
    return Array.isArray(value);
}
