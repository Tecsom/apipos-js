// Apipos: el cliente. Mismo comportamiento que v1 para las vistas que lo usan:
// createPrinter sin nombre → null; listPrinters y checkHealth NUNCA lanzan.
// checkHealth agrega `version` (el handshake completo está en handshake.test.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Apipos, ApiPosPrinter, VERSION } from '../dist/index.js';
import type { FetchLike } from '../dist/index.js';
import { BASE_URL, fakeFetch, jsonResponse, onlyRequest, success } from './helpers.ts';

const offline: FetchLike = async () => {
    throw new TypeError('fetch failed');
};

// Un Apipos en la MISMA versión que la librería (sigue a VERSION tras cada bump).
const HEALTH = {
    status: 'ok',
    version: VERSION,
    os: 'Darwin',
    platform: 'darwin',
    backend: 'MacPrinterBackend',
    port: 50432,
    client: {
        name: 'apipos-js',
        version: VERSION,
        server: VERSION,
        status: 'equal',
        message: 'Client and server versions match.'
    }
};

const SAME_VERSION = { client: VERSION, backend: VERSION, status: 'equal', message: null };

test('baseUrl por defecto http://127.0.0.1:50432; apiUrl es su alias y su setter cambia las peticiones', async () => {
    const fake = fakeFetch(() => success([]));
    const apipos = new Apipos({ fetch: fake.fetch });

    assert.equal(apipos.baseUrl, 'http://127.0.0.1:50432');
    assert.equal(apipos.apiUrl, 'http://127.0.0.1:50432');

    apipos.apiUrl = 'http://192.168.1.20:50432';
    await apipos.listPrinters();

    assert.equal(apipos.baseUrl, 'http://192.168.1.20:50432');
    assert.equal(onlyRequest(fake).url, 'http://192.168.1.20:50432/printers');
    assert.equal(new Apipos({ baseUrl: BASE_URL }).baseUrl, BASE_URL);
});

test('createPrinter sin nombre → null y console.error; con nombre → ApiPosPrinter', t => {
    const consoleError = t.mock.method(console, 'error', () => {});
    const apipos = new Apipos({ baseUrl: BASE_URL, fetch: fakeFetch().fetch });

    assert.equal(apipos.createPrinter('', { paper_size: 80 }), null);
    assert.equal(consoleError.mock.callCount(), 1);
    assert.deepEqual(consoleError.mock.calls[0]?.arguments, ['Printer name is required']);

    const printer = apipos.createPrinter('POS80', { paper_size: 80 });
    assert.ok(printer instanceof ApiPosPrinter);
    assert.equal(printer.name, 'POS80');
    assert.deepEqual(printer.settings, { paper_size: 80 });
});

test('listPrinters → los nombres que reporta Apipos', async () => {
    const fake = fakeFetch(() => success(['POS80_Kinwodon', 'AiYin_AS240_BT'], 'Printers listed.'));

    assert.deepEqual(await new Apipos({ baseUrl: BASE_URL, fetch: fake.fetch }).listPrinters(), [
        'POS80_Kinwodon',
        'AiYin_AS240_BT'
    ]);
    assert.equal(onlyRequest(fake).init.method, 'GET');
});

test('listPrinters devuelve [] si falla la red, si Apipos responde error o si la forma no cuadra', async t => {
    const consoleError = t.mock.method(console, 'error', () => {});
    const failing = fakeFetch(() => jsonResponse({ status: 'error', data: null, message: 'boom' }, { ok: false, status: 500 }));
    const odd = fakeFetch(() => success({ printers: ['POS80'] }));

    assert.deepEqual(await new Apipos({ baseUrl: BASE_URL, fetch: offline }).listPrinters(), []);
    assert.deepEqual(await new Apipos({ baseUrl: BASE_URL, fetch: failing.fetch }).listPrinters(), []);
    assert.deepEqual(await new Apipos({ baseUrl: BASE_URL, fetch: odd.fetch }).listPrinters(), []);

    assert.equal(consoleError.mock.callCount(), 3);
    const lastError: unknown = consoleError.mock.calls[2]?.arguments[1];
    assert.ok(lastError instanceof Error);
    assert.equal(lastError.message, 'Respuesta inesperada de Apipos en /printers');
});

test('checkHealth con el servicio arriba → { ok: true, data, version } con version equal', async () => {
    const fake = fakeFetch(() => success(HEALTH, 'Service is running.'));

    const health = await new Apipos({ baseUrl: BASE_URL, fetch: fake.fetch }).checkHealth();

    assert.deepEqual(health, { ok: true, data: HEALTH, version: SAME_VERSION });
    assert.equal(onlyRequest(fake).url, 'http://127.0.0.1:1/health');
});

test('checkHealth con un Apipos anterior a 1.0.6 (sin version ni client) sigue dando ok; version unknown', async t => {
    const consoleWarn = t.mock.method(console, 'warn', () => {});
    const legacy = { status: 'ok', os: 'Windows', platform: 'win32', backend: 'WindowsPrinterBackend', port: 50432 };
    const fake = fakeFetch(() => success(legacy));

    const health = await new Apipos({ baseUrl: BASE_URL, fetch: fake.fetch }).checkHealth();

    assert.equal(health.ok, true);
    assert.deepEqual(health.data, legacy);
    assert.equal(health.version?.status, 'unknown');
    assert.equal(health.version?.backend, null);
    // Sin headers en el doble, el aviso sale de data.version (ver handshake.test.ts).
    assert.equal(consoleWarn.mock.callCount(), 1);
});

test('checkHealth nunca lanza: sin red, con error o con otra forma → { ok: false, data: null, version: null }', async t => {
    const consoleError = t.mock.method(console, 'error', () => {});
    const failing = fakeFetch(() => jsonResponse({ status: 'error', data: null, message: 'down' }, { ok: false, status: 500 }));
    const odd = fakeFetch(() => success({ status: 'ok' }));

    for (const fetch of [offline, failing.fetch, odd.fetch]) {
        assert.deepEqual(await new Apipos({ baseUrl: BASE_URL, fetch }).checkHealth(), {
            ok: false,
            data: null,
            version: null
        });
    }
    assert.equal(consoleError.mock.callCount(), 3);
});

test('checkHealth con data.status distinto de "ok" → ok: false pero con el data y la version', async () => {
    const degraded = { ...HEALTH, status: 'degraded' };
    const fake = fakeFetch(() => success(degraded));

    assert.deepEqual(await new Apipos({ baseUrl: BASE_URL, fetch: fake.fetch }).checkHealth(), {
        ok: false,
        data: degraded,
        version: SAME_VERSION
    });
});
