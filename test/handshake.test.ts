// Handshake de versión en el cliente: cada respuesta trae `X-Apipos-Version` y
// `Apipos` avisa UNA vez por versión distinta de Apipos: por página con el
// `console.warn` por defecto (aunque haya varios `new Apipos()`), por cliente
// con `onVersionMismatch`.
//
// LO QUE SE PROTEGE:
//  1. Dos peticiones (o dos clientes) con la misma versión distinta → UN solo
//     `console.warn`, con el mensaje exacto; una versión distinta nueva → otro aviso.
//  2. Misma versión → cero avisos. `Headers` sin el header → aviso `unknown`.
//  3. Respuesta sin `headers` (dobles de `fetch`) → no se evalúa: cero avisos.
//  4. También avisan las respuestas de error (antes de lanzar `ApiposError`).
//  5. `onVersionMismatch` reemplaza a `console.warn`; si lanza, no rompe la petición.
//  6. `checkHealth().version`: sale de `data.version`, no repite el aviso del
//     header y avisa por la misma vía cuando no hubo headers; `null` si falla.
//
// `console.warn` se intercepta con `t.mock.method`, que lo restaura al terminar
// cada prueba. El registro del aviso por defecto vive en el módulo durante todo
// este archivo (cada archivo de prueba corre en su propio proceso): por eso cada
// prueba del aviso por defecto usa su PROPIA versión de backend (9.9.1, 9.9.2...).
// El caso `unknown` (clave 'null') solo se usa en una prueba con aviso por defecto.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Apipos, ApiposError, VERSION } from '../dist/index.js';
import type { FetchLike, VersionInfo } from '../dist/index.js';
import { BASE_URL, fakeFetch, jsonResponse, success } from './helpers.ts';

const olderLibrary = (backend: string): string =>
    `[apipos-js] Apipos ${backend} es más nuevo que la librería apipos-js ${VERSION}. Actualiza la librería en el front: ambas deben ir en la misma versión.`;
const newerLibrary = (backend: string): string =>
    `[apipos-js] La librería apipos-js ${VERSION} es más nueva que Apipos ${backend} instalado en esta máquina. Actualiza Apipos (menú de bandeja → Buscar actualizaciones): ambas deben ir en la misma versión.`;
const NO_VERSION = `[apipos-js] Apipos no reporta su versión (falta el header X-Apipos-Version): es anterior a la librería apipos-js ${VERSION}. Actualiza Apipos en esta máquina.`;

/** Headers como los de un Apipos en la versión dada (sin versión → sin el header). */
function apiposHeaders(version?: string): Headers {
    return new Headers(version === undefined ? {} : { 'X-Apipos-Version': version });
}

function health(version?: string): Record<string, unknown> {
    const data = { status: 'ok', os: 'Darwin', platform: 'darwin', backend: 'MacPrinterBackend', port: 50432 };
    return version === undefined ? data : { ...data, version };
}

/** `fetch` que responde éxito con `data` y el header de la versión que toque en cada llamada. */
function versionedFetch(versions: readonly string[], data: unknown = []): FetchLike {
    let call = 0;
    return fakeFetch(() => success(data, 'ok', { headers: apiposHeaders(versions[call++ % versions.length]) })).fetch;
}

test('X-Apipos-Version distinto en dos peticiones → UN console.warn con el mensaje exacto', async t => {
    const consoleWarn = t.mock.method(console, 'warn', () => {});
    const apipos = new Apipos({ baseUrl: BASE_URL, fetch: versionedFetch(['9.9.1']) });

    await apipos.listPrinters();
    await apipos.listPrinters();

    assert.equal(consoleWarn.mock.callCount(), 1);
    assert.deepEqual(consoleWarn.mock.calls[0]?.arguments, [olderLibrary('9.9.1')]);
});

test('una versión distinta nueva vuelve a avisar: un aviso por versión de Apipos, no por petición', async t => {
    const consoleWarn = t.mock.method(console, 'warn', () => {});
    const apipos = new Apipos({ baseUrl: BASE_URL, fetch: versionedFetch(['9.9.2', '0.0.2', VERSION]) });

    for (let index = 0; index < 6; index++) await apipos.listPrinters();

    assert.deepEqual(
        consoleWarn.mock.calls.map(call => call.arguments),
        [[olderLibrary('9.9.2')], [newerLibrary('0.0.2')]]
    );
});

test('Apipos en la misma versión (VERSION) → cero avisos', async t => {
    const consoleWarn = t.mock.method(console, 'warn', () => {});
    const sameVersion = fakeFetch(request =>
        success(request.url.endsWith('/health') ? health(VERSION) : null, 'ok', { headers: apiposHeaders(VERSION) })
    );
    const apipos = new Apipos({ baseUrl: BASE_URL, fetch: sameVersion.fetch });
    const printer = apipos.createPrinter('POS80', { paper_size: 80 });
    assert.ok(printer);

    await printer.print([{ type: 'text', data: 'HOLA' }]);
    await apipos.request('GET', '/printers/selected');
    const { version } = await apipos.checkHealth();

    assert.equal(version?.status, 'equal');
    assert.equal(consoleWarn.mock.callCount(), 0);
});

test('Headers sin X-Apipos-Version (Apipos anterior a 1.0.6) → un aviso unknown, una sola vez', async t => {
    const consoleWarn = t.mock.method(console, 'warn', () => {});
    const legacy = fakeFetch(() => success([], 'ok', { headers: apiposHeaders() }));
    const apipos = new Apipos({ baseUrl: BASE_URL, fetch: legacy.fetch });

    await apipos.listPrinters();
    await apipos.listPrinters();

    assert.equal(consoleWarn.mock.callCount(), 1);
    assert.deepEqual(consoleWarn.mock.calls[0]?.arguments, [NO_VERSION]);
});

test('respuesta sin headers (doble de fetch) → no se evalúa: cero avisos', async t => {
    const consoleWarn = t.mock.method(console, 'warn', () => {});
    const seen: VersionInfo[] = [];
    const bare = fakeFetch(() => success(['POS80']));
    const apipos = new Apipos({ baseUrl: BASE_URL, fetch: bare.fetch });
    const quiet = new Apipos({ baseUrl: BASE_URL, fetch: bare.fetch, onVersionMismatch: info => seen.push(info) });

    assert.deepEqual(await apipos.listPrinters(), ['POS80']);
    await apipos.request('POST', '/print', { body: {} });
    await quiet.listPrinters();

    assert.equal(consoleWarn.mock.callCount(), 0);
    assert.deepEqual(seen, []);
});

test('una respuesta de error (400) con otra versión también avisa, y la petición sigue lanzando ApiposError', async t => {
    const consoleWarn = t.mock.method(console, 'warn', () => {});
    const failing = fakeFetch(() =>
        jsonResponse(
            { status: 'error', data: { available: ['POS80'] }, message: "Printer 'X' not found." },
            { ok: false, status: 400, statusText: 'BAD REQUEST', headers: apiposHeaders('9.9.3') }
        )
    );
    const printer = new Apipos({ baseUrl: BASE_URL, fetch: failing.fetch }).createPrinter('X', { paper_size: 80 });
    assert.ok(printer);

    await assert.rejects(printer.print([{ type: 'text', data: 'HOLA' }]), (error: unknown) => {
        assert.ok(error instanceof ApiposError);
        assert.equal(error.message, "Printer 'X' not found.");
        return true;
    });

    assert.equal(consoleWarn.mock.callCount(), 1);
    assert.deepEqual(consoleWarn.mock.calls[0]?.arguments, [olderLibrary('9.9.3')]);
});

test('onVersionMismatch reemplaza a console.warn y recibe { client, backend, status, message } una vez', async t => {
    const consoleWarn = t.mock.method(console, 'warn', () => {});
    const seen: VersionInfo[] = [];
    const apipos = new Apipos({
        baseUrl: BASE_URL,
        fetch: versionedFetch(['0.0.1']),
        onVersionMismatch: info => seen.push(info)
    });

    await apipos.listPrinters();
    await apipos.listPrinters();

    assert.equal(consoleWarn.mock.callCount(), 0);
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.status, 'client_newer');
    assert.deepEqual(seen[0], { client: VERSION, backend: '0.0.1', status: 'client_newer', message: newerLibrary('0.0.1') });
});

test('si onVersionMismatch lanza, la petición devuelve su data y el error va a console.error', async t => {
    const consoleError = t.mock.method(console, 'error', () => {});
    const apipos = new Apipos({
        baseUrl: BASE_URL,
        fetch: versionedFetch(['9.9.9'], ['POS80']),
        onVersionMismatch: () => {
            throw new Error('hook roto');
        }
    });

    assert.deepEqual(await apipos.listPrinters(), ['POS80']);

    assert.equal(consoleError.mock.callCount(), 1);
    assert.equal(consoleError.mock.calls[0]?.arguments[0], 'Error in Apipos onVersionMismatch:');
});

test('un Response real de Node: el header se lee sin importar mayúsculas y avisa', async t => {
    const consoleWarn = t.mock.method(console, 'warn', () => {});
    const realFetch: FetchLike = async () =>
        new Response(JSON.stringify({ status: 'success', data: ['POS80'], message: 'Printers listed.' }), {
            headers: { 'Content-Type': 'application/json', 'x-apipos-version': '9.9.4' }
        });

    assert.deepEqual(await new Apipos({ baseUrl: BASE_URL, fetch: realFetch }).listPrinters(), ['POS80']);

    assert.deepEqual(
        consoleWarn.mock.calls.map(call => call.arguments),
        [[olderLibrary('9.9.4')]]
    );
});

test('checkHealth().version sale de data.version y no repite el aviso que ya dio el header', async t => {
    const consoleWarn = t.mock.method(console, 'warn', () => {});
    const newer = fakeFetch(() => success(health('9.9.5'), 'Service is running.', { headers: apiposHeaders('9.9.5') }));
    const apipos = new Apipos({ baseUrl: BASE_URL, fetch: newer.fetch });

    const first = await apipos.checkHealth();
    const second = await apipos.checkHealth();

    assert.equal(first.ok, true);
    assert.equal(first.version?.status, 'client_older');
    assert.deepEqual(first.version, {
        client: VERSION,
        backend: '9.9.5',
        status: 'client_older',
        message: olderLibrary('9.9.5')
    });
    assert.deepEqual(second.version, first.version);
    assert.equal(consoleWarn.mock.callCount(), 1);
});

test('checkHealth sin headers (doble) avisa por data.version, por la misma vía deduplicada', async t => {
    const consoleWarn = t.mock.method(console, 'warn', () => {});
    const bare = fakeFetch(() => success(health('0.0.3')));
    const apipos = new Apipos({ baseUrl: BASE_URL, fetch: bare.fetch });

    const { version } = await apipos.checkHealth();
    await apipos.checkHealth();

    assert.equal(version?.status, 'client_newer');
    assert.deepEqual(
        consoleWarn.mock.calls.map(call => call.arguments),
        [[newerLibrary('0.0.3')]]
    );
});

test('checkHealth sin conexión → { ok: false, data: null, version: null } y ningún aviso', async t => {
    const consoleWarn = t.mock.method(console, 'warn', () => {});
    t.mock.method(console, 'error', () => {});
    const offline: FetchLike = async () => {
        throw new TypeError('fetch failed');
    };

    const result = await new Apipos({ baseUrl: BASE_URL, fetch: offline }).checkHealth();

    assert.deepEqual(result, { ok: false, data: null, version: null });
    assert.equal(consoleWarn.mock.callCount(), 0);
});

test('aviso por defecto: dos new Apipos() contra el mismo backend distinto → UN solo console.warn en total', async t => {
    // Como una app que crea un cliente por impresión: el aviso es por página.
    const consoleWarn = t.mock.method(console, 'warn', () => {});
    const fetch = versionedFetch(['9.9.6']);

    await new Apipos({ baseUrl: BASE_URL, fetch }).listPrinters();
    await new Apipos({ baseUrl: BASE_URL, fetch }).listPrinters();

    assert.deepEqual(
        consoleWarn.mock.calls.map(call => call.arguments),
        [[olderLibrary('9.9.6')]]
    );
});

test('con onVersionMismatch el registro es de cada cliente: el callback se llama una vez por instancia', async t => {
    const consoleWarn = t.mock.method(console, 'warn', () => {});
    const seen: Array<{ client: string; status: string }> = [];
    const fetch = versionedFetch(['9.9.7']);
    const first = new Apipos({ baseUrl: BASE_URL, fetch, onVersionMismatch: info => seen.push({ client: 'A', status: info.status }) });
    const second = new Apipos({ baseUrl: BASE_URL, fetch, onVersionMismatch: info => seen.push({ client: 'B', status: info.status }) });

    await first.listPrinters();
    await first.listPrinters();
    await second.listPrinters();
    await second.listPrinters();

    assert.deepEqual(seen, [
        { client: 'A', status: 'client_older' },
        { client: 'B', status: 'client_older' }
    ]);
    assert.equal(consoleWarn.mock.callCount(), 0);
});
