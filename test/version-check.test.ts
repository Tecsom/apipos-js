// parseVersion / compareVersions / describeVersions: el corazón del handshake,
// puro (sin red). Los mensajes se comparan como cadenas LITERALES: son el
// contrato de TASK-006 §4.3 y lo que ve quien abre la consola del navegador.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareVersions, describeVersions, parseVersion } from '../dist/index.js';

test('parseVersion: "1.2.3" y "v1.2.3" → [1, 2, 3]; las partes faltantes valen 0', () => {
    assert.deepEqual(parseVersion('1.2.3'), [1, 2, 3]);
    assert.deepEqual(parseVersion('v1.2.3'), [1, 2, 3]);
    assert.deepEqual(parseVersion('V10.20.30'), [10, 20, 30]);
    assert.deepEqual(parseVersion('v1.2'), [1, 2, 0]);
    assert.deepEqual(parseVersion('7'), [7, 0, 0]);
    // Como el parser de Apipos: lo que sigue al patch se ignora.
    assert.deepEqual(parseVersion('1.0.6-beta.1'), [1, 0, 6]);
});

test('parseVersion: vacío, null, undefined o no numérico → null', () => {
    assert.equal(parseVersion(''), null);
    assert.equal(parseVersion(null), null);
    assert.equal(parseVersion(undefined), null);
    assert.equal(parseVersion('   '), null);
    assert.equal(parseVersion('abc'), null);
    assert.equal(parseVersion('v'), null);
});

test('compareVersions: equal (también con "v" y partes faltantes)', () => {
    assert.equal(compareVersions('1.0.6', '1.0.6'), 'equal');
    assert.equal(compareVersions('1.0.6', 'v1.0.6'), 'equal');
    assert.equal(compareVersions('1.2.0', '1.2'), 'equal');
});

test('compareVersions: client_older, numérico y no lexicográfico (1.0.9 < 1.0.10)', () => {
    assert.equal(compareVersions('1.0.5', '1.0.6'), 'client_older');
    assert.equal(compareVersions('1.0.9', '1.0.10'), 'client_older');
    assert.equal(compareVersions('1.9.9', '1.10.0'), 'client_older');
    assert.equal(compareVersions('1.0.6', '9.9.9'), 'client_older');
});

test('compareVersions: client_newer', () => {
    assert.equal(compareVersions('1.0.6', '1.0.5'), 'client_newer');
    assert.equal(compareVersions('1.1.0', '1.0.99'), 'client_newer');
    assert.equal(compareVersions('2.0.0', '1.99.99'), 'client_newer');
});

test('compareVersions: unknown cuando el backend es null, vacío o no parseable', () => {
    assert.equal(compareVersions('1.0.6', null), 'unknown');
    assert.equal(compareVersions('1.0.6', undefined), 'unknown');
    assert.equal(compareVersions('1.0.6', ''), 'unknown');
    assert.equal(compareVersions('1.0.6', 'desconocida'), 'unknown');
});

test('describeVersions equal → message null', () => {
    assert.deepEqual(describeVersions('1.0.6', '1.0.6'), {
        client: '1.0.6',
        backend: '1.0.6',
        status: 'equal',
        message: null
    });
});

test('describeVersions client_older → mensaje exacto (actualizar la librería)', () => {
    assert.deepEqual(describeVersions('1.0.5', '1.0.6'), {
        client: '1.0.5',
        backend: '1.0.6',
        status: 'client_older',
        message:
            '[apipos-js] Apipos 1.0.6 es más nuevo que la librería apipos-js 1.0.5. Actualiza la librería en el front: ambas deben ir en la misma versión.'
    });
});

test('describeVersions client_newer → mensaje exacto (actualizar Apipos)', () => {
    assert.deepEqual(describeVersions('1.0.6', '1.0.5'), {
        client: '1.0.6',
        backend: '1.0.5',
        status: 'client_newer',
        message:
            '[apipos-js] La librería apipos-js 1.0.6 es más nueva que Apipos 1.0.5 instalado en esta máquina. Actualiza Apipos (menú de bandeja → Buscar actualizaciones): ambas deben ir en la misma versión.'
    });
});

test('describeVersions unknown → mensaje exacto; backend undefined → null y un valor no parseable se conserva', () => {
    const message =
        '[apipos-js] Apipos no reporta su versión (falta el header X-Apipos-Version): es anterior a la librería apipos-js 1.0.6. Actualiza Apipos en esta máquina.';

    assert.deepEqual(describeVersions('1.0.6', null), { client: '1.0.6', backend: null, status: 'unknown', message });
    assert.deepEqual(describeVersions('1.0.6', undefined), { client: '1.0.6', backend: null, status: 'unknown', message });
    assert.deepEqual(describeVersions('1.0.6', 'abc'), { client: '1.0.6', backend: 'abc', status: 'unknown', message });
});
