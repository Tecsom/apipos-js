// request(): el único punto de red. Se prueba a través de `apipos.request()`,
// que es como lo usa la impresora, contra dobles de `fetch` (sin red real).
//
// LO QUE SE PROTEGE:
//  1. El header `X-Apipos-Client: apipos-js/<VERSION>` en TODA petición y
//     `Content-Type` solo cuando hay body.
//  2. La query: `true` → `1`, `null`/`undefined` no viajan.
//  3. El sobre `{ status, data, message }`: error → `ApiposError` con el
//     `message` del backend y su `data` (p. ej. `available`); éxito → `data`.
//  4. Los mensajes que ve el cajero: sin conexión, HTTP sin cuerpo.
//  5. Que un `fetch` nativo funcione tal cual (sin "Illegal invocation").
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Apipos, ApiposError, VERSION } from '../dist/index.js';
import type { FetchLike } from '../dist/index.js';
import { BASE_URL, fakeFetch, jsonResponse, noJsonResponse, onlyRequest, success } from './helpers.ts';

function client(fetch: FetchLike): Apipos {
    return new Apipos({ baseUrl: BASE_URL, fetch });
}

// Un `Response` real trae `headers`, así que pasa por el handshake: se le pone el
// header de un Apipos en la misma versión para que no avise (eso se prueba en
// handshake.test.ts).
const SAME_VERSION_HEADER = { 'X-Apipos-Version': VERSION };

test('toda petición manda X-Apipos-Client: apipos-js/<VERSION>; sin body no hay Content-Type ni body', async () => {
    const fake = fakeFetch(() => success(['POS80']));

    await client(fake.fetch).request('GET', '/printers');

    const { url, init } = onlyRequest(fake);
    assert.match(VERSION, /^\d+\.\d+\.\d+$/);
    assert.equal(url, 'http://127.0.0.1:1/printers');
    assert.equal(init.method, 'GET');
    assert.deepEqual(init.headers, { 'X-Apipos-Client': `apipos-js/${VERSION}` });
    assert.equal(init.body, undefined);
});

test('con body: Content-Type application/json y el body serializado con JSON.stringify', async () => {
    const fake = fakeFetch();
    const body = { printer: 'X', type: 'RAW', content: [{ type: 'separator' }] };

    await client(fake.fetch).request('POST', '/print', { body });

    const { init } = onlyRequest(fake);
    assert.equal(init.method, 'POST');
    assert.deepEqual(init.headers, {
        'X-Apipos-Client': `apipos-js/${VERSION}`,
        'Content-Type': 'application/json'
    });
    assert.equal(init.body, JSON.stringify(body));
});

test('query: refresh=true → ?refresh=1; null y undefined no viajan; false → 0', async () => {
    const fake = fakeFetch();
    const apipos = client(fake.fetch);

    await apipos.request('GET', '/fonts', { query: { refresh: true } });
    await apipos.request('GET', '/fonts', { query: { refresh: false, skip: null, gone: undefined, page: 2 } });
    await apipos.request('GET', '/fonts', { query: { skip: null } });

    assert.deepEqual(
        fake.requests.map(request => request.url),
        ['http://127.0.0.1:1/fonts?refresh=1', 'http://127.0.0.1:1/fonts?refresh=0&page=2', 'http://127.0.0.1:1/fonts']
    );
});

test('sobre de error → ApiposError (instanceof Error) con el message y el data del backend', async () => {
    const fake = fakeFetch(() =>
        jsonResponse(
            { status: 'error', data: { available: ['POS80', 'AiYin_AS240_BT'] }, message: "Printer 'X' not found." },
            { ok: false, status: 400, statusText: 'BAD REQUEST' }
        )
    );

    await assert.rejects(client(fake.fetch).request('POST', '/print', { body: {} }), (error: unknown) => {
        assert.ok(error instanceof ApiposError);
        assert.ok(error instanceof Error);
        assert.equal(error.name, 'ApiposError');
        assert.equal(error.message, "Printer 'X' not found.");
        assert.deepEqual(error.data, { available: ['POS80', 'AiYin_AS240_BT'] });
        return true;
    });
});

test('status "error" con HTTP 200 también lanza; sin data → error.data es null', async () => {
    const fake = fakeFetch(() => jsonResponse({ status: 'error', message: 'No printer selected.' }));

    await assert.rejects(client(fake.fetch).request('GET', '/x'), (error: unknown) => {
        assert.ok(error instanceof ApiposError);
        assert.equal(error.message, 'No printer selected.');
        assert.equal(error.data, null);
        return true;
    });
});

test('HTTP no-ok sin JSON → statusText; sin statusText → "Error de impresión"', async () => {
    const withStatus = fakeFetch(() => noJsonResponse({ ok: false, status: 500, statusText: 'INTERNAL SERVER ERROR' }));
    const bare = fakeFetch(() => noJsonResponse({ ok: false, status: 500, statusText: '' }));

    await assert.rejects(client(withStatus.fetch).request('GET', '/health'), { message: 'INTERNAL SERVER ERROR' });
    await assert.rejects(client(bare.fetch).request('GET', '/health'), { message: 'Error de impresión' });
});

test('fallo de red → "No se pudo conectar con Apipos (<baseUrl>). ¿Está abierta la app de bandeja?"', async () => {
    const offline: FetchLike = async () => {
        throw new TypeError('fetch failed');
    };

    await assert.rejects(client(offline).request('GET', '/health'), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, 'No se pudo conectar con Apipos (http://127.0.0.1:1). ¿Está abierta la app de bandeja?');
        return true;
    });
});

test('éxito sin cuerpo JSON → null (también con un Response real vacío)', async () => {
    const fake = fakeFetch(() => noJsonResponse());
    const realEmpty: FetchLike = async () => new Response(null, { status: 200, headers: SAME_VERSION_HEADER });

    assert.equal(await client(fake.fetch).request('GET', '/x'), null);
    assert.equal(await client(realEmpty).request('GET', '/x'), null);
});

test('un Response real de Node sirve de respuesta y se devuelve su data', async () => {
    const realFetch: FetchLike = async () =>
        new Response(JSON.stringify({ status: 'success', data: { printer: 'POS80' }, message: 'Cash drawer opened.' }), {
            headers: { 'Content-Type': 'application/json', ...SAME_VERSION_HEADER }
        });

    assert.deepEqual(await client(realFetch).request('POST', '/open-withdrawer', { body: {} }), { printer: 'POS80' });
});

test('un fetch inyectado se invoca suelto: un fetch nativo pasado tal cual no recibe otro `this`', async () => {
    const receivers: unknown[] = [];
    // Como el `fetch` del navegador: lanza "Illegal invocation" si `this` no es el global.
    const picky: FetchLike = async function (this: unknown) {
        receivers.push(this);
        if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
        return success(['POS80']);
    };

    assert.deepEqual(await client(picky).request('GET', '/printers'), ['POS80']);
    assert.deepEqual(receivers, [undefined]);
});

test('sin fetch inyectado usa globalThis.fetch EN CADA petición y con globalThis como `this`', async t => {
    // Se crea ANTES de reemplazar el fetch global: debe usar el vigente al pedir, como v1.
    const apipos = new Apipos({ baseUrl: BASE_URL });
    const seen: Array<{ url: string; self: unknown }> = [];
    t.mock.method(globalThis, 'fetch', async function (this: unknown, url: string) {
        seen.push({ url, self: this });
        return new Response(JSON.stringify({ status: 'success', data: ['POS80'], message: '' }), {
            headers: SAME_VERSION_HEADER
        });
    });

    assert.deepEqual(await apipos.request('GET', '/printers'), ['POS80']);
    assert.deepEqual(seen, [{ url: 'http://127.0.0.1:1/printers', self: globalThis }]);
});
