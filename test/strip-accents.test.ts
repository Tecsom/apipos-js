// Sanidad del módulo "sin acentos ni ñ".
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { stripAccents, stripAccentsFromContent } from '../dist/index.js';
import type { TicketContent } from '../dist/index.js';

test('quita acentos, diéresis y virgulilla (también mayúsculas) sin cambiar la longitud', () => {
    const line = 'Jamón serrano · Piñón · Ñandú · ÁÉÍÓÚ Ü ç';
    const stripped = stripAccents(line);

    assert.equal(stripped, 'Jamon serrano · Pinon · Nandu · AEIOU U c');
    assert.equal(stripped.length, line.length);
});

test('retira ¿ ¡ y convierte los ordinales ª º', () => {
    assert.equal(stripAccents('¿Cómo? ¡Sí! 1ª 2º'), 'Como? Si! 1a 2o');
});

test('lo que no es string sale intacto', () => {
    assert.equal(stripAccents(null), null);
    assert.equal(stripAccents(undefined), undefined);
    assert.equal(stripAccents(42), 42);
    assert.equal(stripAccents(true), true);
});

test('stripAccentsFromContent convierte el texto, se salta las imágenes y no muta la entrada', () => {
    // El `data` de la imagen lleva una ñ A PROPÓSITO (un base64 real no puede):
    // si el recorrido no se saltara las imágenes, la prueba lo notaría.
    const job: TicketContent = [
        { type: 'image', data: 'iVBORw0KGgoñAAAA', align: 'center' },
        { type: 'text', data: 'Sucursal Piñón', align: 'center', font_size: 'lg' },
        { type: 'special_text', data: { text1: 'Jamón', text2: '$45.00' } },
        { type: 'table', data: { rows: [['1', 'Ñoquis', '18.50', '18.50']] } },
        { type: 'separator' }
    ];
    const before = structuredClone(job);

    const out = stripAccentsFromContent(job);

    assert.notEqual(out, job);
    assert.deepEqual(out, [
        { type: 'image', data: 'iVBORw0KGgoñAAAA', align: 'center' },
        { type: 'text', data: 'Sucursal Pinon', align: 'center', font_size: 'lg' },
        { type: 'special_text', data: { text1: 'Jamon', text2: '$45.00' } },
        { type: 'table', data: { rows: [['1', 'Noquis', '18.50', '18.50']] } },
        { type: 'separator' }
    ]);
    assert.equal(out[0], job[0]);
    assert.deepEqual(job, before);
});
