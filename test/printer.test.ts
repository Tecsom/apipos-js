// ApiPosPrinter: el punto de envío de los trabajos a POST /print.
//
// LO QUE SE PROTEGE:
//  1. El payload de v1 BYTE A BYTE: { printer, type: 'RAW', settings, content },
//     en ese orden de claves; los fronts y Apipos dependen de él.
//  2. La validación de `paper_size` con los MISMOS mensajes de v1.
//  3. El hook `transformContent`: se aplica en CADA trabajo y nunca muta lo que
//     recibe (quien imprime reusa su contenido: copias, reintento sin logo).
//  4. printPDF: el mismo base64 que daba FileReader, ahora sin FileReader.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';

import { Apipos, ApiPosPrinter, ApiposError } from '../dist/index.js';
import type { ContentTransform, FetchLike, PrintSettings, TicketContent } from '../dist/index.js';
import { BASE_URL, fakeFetch, isRecord, isUnknownArray, jsonResponse, onlyRequest, parsedBody, success } from './helpers.ts';

function printerWith(fetch: FetchLike, transformContent?: ContentTransform): ApiPosPrinter {
    const apipos = new Apipos(transformContent ? { baseUrl: BASE_URL, fetch, transformContent } : { baseUrl: BASE_URL, fetch });
    const printer = apipos.createPrinter('X', { paper_size: 80 });
    assert.ok(printer);
    return printer;
}

function sampleTicket(): TicketContent {
    return [
        { type: 'text', data: 'Sucursal Piñón', align: 'center', font_size: 'md' },
        { type: 'special_text', data: { text1: 'TOTAL', text2: '$81.50' } },
        { type: 'table', data: { rows: [[2, 'Café', '$18.00', '$36.00']] } },
        { type: 'separator' },
        { type: 'open_withdrawer' }
    ];
}

test('print(content) sin opciones manda el payload de v1 byte a byte a POST /print', async () => {
    const fake = fakeFetch(() => success({ printer: 'X', char_width: 48 }, 'Print job completed.'));

    const result = await printerWith(fake.fetch).print(sampleTicket());

    const { url, init } = onlyRequest(fake);
    assert.equal(url, 'http://127.0.0.1:1/print');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['Content-Type'], 'application/json');
    assert.equal(
        init.body,
        '{"printer":"X","type":"RAW","settings":{"paper_size":80},"content":[' +
            '{"type":"text","data":"Sucursal Piñón","align":"center","font_size":"md"},' +
            '{"type":"special_text","data":{"text1":"TOTAL","text2":"$81.50"}},' +
            '{"type":"table","data":{"rows":[[2,"Café","$18.00","$36.00"]]}},' +
            '{"type":"separator"},' +
            '{"type":"open_withdrawer"}]}'
    );
    assert.deepEqual(result, { printer: 'X', char_width: 48 });
});

test('paper_size faltante → "Missing required setting: paper_size" (también sin settings)', () => {
    const apipos = new Apipos({ baseUrl: BASE_URL, fetch: fakeFetch().fetch });

    assert.throws(() => new ApiPosPrinter('X', {}, apipos), { message: 'Missing required setting: paper_size' });
    assert.throws(() => apipos.createPrinter('X'), { message: 'Missing required setting: paper_size' });
});

test('paper_size no numérico → "Invalid type for setting paper_size: expected number, got string"', () => {
    const apipos = new Apipos({ baseUrl: BASE_URL, fetch: fakeFetch().fetch });
    // Simula a un llamador JS cuyo código no pasa por el compilador.
    const settings: PrintSettings = {};
    Reflect.set(settings, 'paper_size', '80');

    assert.throws(() => apipos.createPrinter('X', settings), {
        message: 'Invalid type for setting paper_size: expected number, got string'
    });
});

test('transformContent se aplica al content y la entrada no se muta', async () => {
    const fake = fakeFetch();
    const received: TicketContent[] = [];
    const upperCase: ContentTransform = content => {
        received.push(content);
        return content.map(item => (item.type === 'text' ? { ...item, data: item.data.toUpperCase() } : item));
    };
    const content = sampleTicket();
    const before = structuredClone(content);

    await printerWith(fake.fetch, upperCase).print(content);

    const body = parsedBody(onlyRequest(fake));
    assert.ok(isRecord(body));
    assert.ok(isUnknownArray(body.content));
    assert.deepEqual(body.content[0], { type: 'text', data: 'SUCURSAL PIÑÓN', align: 'center', font_size: 'md' });
    assert.deepEqual(body.content.slice(1), before.slice(1));
    assert.equal(received[0], content);
    assert.deepEqual(content, before);
});

test('transformContent se consulta en CADA trabajo: la misma impresora cambia sin recrearse', async () => {
    const fake = fakeFetch();
    let shout = false;
    const printer = printerWith(fake.fetch, content =>
        content.map(item => (shout && item.type === 'text' ? { ...item, data: item.data.toUpperCase() } : item))
    );

    await printer.print(sampleTicket());
    shout = true;
    await printer.print(sampleTicket());

    const texts = fake.requests.map(request => {
        const body = parsedBody(request);
        assert.ok(isRecord(body) && isUnknownArray(body.content));
        const first: unknown = body.content[0];
        assert.ok(isRecord(first));
        return first.data;
    });
    assert.deepEqual(texts, ['Sucursal Piñón', 'SUCURSAL PIÑÓN']);
});

test('sin transformContent se manda una copia: mismo contenido, arreglo distinto, entrada intacta', async () => {
    const content = sampleTicket();
    const before = structuredClone(content);
    const apipos = new Apipos({ baseUrl: BASE_URL, fetch: fakeFetch().fetch });

    const copy = apipos.applyTransform(content);

    assert.notEqual(copy, content);
    assert.deepEqual(copy, content);
    assert.deepEqual(content, before);
});

test('printPDF con un Blob real → { printer, type: "PDF", settings, data } con el base64 correcto', async () => {
    const fake = fakeFetch(() => success({ printer: 'X', type: 'PDF', strategy: 'driver', media: 'Custom.60x30mm' }));
    // 70 000 bytes con todos los valores 0–255: cruza dos veces el tamaño de bloque del codificador.
    const bytes = Uint8Array.from({ length: 70_000 }, (_, index) => (index * 7) % 256);
    const printer = printerWith(fake.fetch);

    const result = await printer.printPDF(new Blob([bytes], { type: 'application/pdf' }), {
        pdfMode: 'driver',
        labelSettings: { width: 60, height: 30, unit: 'mm' }
    });

    const { init } = onlyRequest(fake);
    assert.equal(
        init.body,
        '{"printer":"X","type":"PDF","settings":{"paper_size":80,"pdf_mode":"driver",' +
            '"label_settings":{"width":60,"height":30,"unit":"mm"}},' +
            `"data":"${Buffer.from(bytes).toString('base64')}"}`
    );
    assert.deepEqual(printer.settings, { paper_size: 80 });
    assert.deepEqual(result, { printer: 'X', type: 'PDF', strategy: 'driver', media: 'Custom.60x30mm' });
});

test('printPDF sin opciones manda solo los settings de la impresora', async () => {
    const fake = fakeFetch();

    await printerWith(fake.fetch).printPDF(new Blob(['%PDF-1.4']));

    assert.equal(onlyRequest(fake).init.body, '{"printer":"X","type":"PDF","settings":{"paper_size":80},"data":"JVBERi0xLjQ="}');
});

test('un error de Apipos rechaza print() con ApiposError y el data del backend', async () => {
    const fake = fakeFetch(() =>
        jsonResponse(
            { status: 'error', data: { available: ['POS80'] }, message: "Printer 'X' not found." },
            { ok: false, status: 400, statusText: 'BAD REQUEST' }
        )
    );

    await assert.rejects(printerWith(fake.fetch).print(sampleTicket()), (error: unknown) => {
        assert.ok(error instanceof ApiposError);
        assert.equal(error.message, "Printer 'X' not found.");
        assert.deepEqual(error.data, { available: ['POS80'] });
        return true;
    });
});

test('data null (dobles de `fetch`) → null; data con otra forma → "Respuesta inesperada de Apipos en /print"', async () => {
    const empty = fakeFetch(() => success(null));
    const odd = fakeFetch(() => success('ok'));

    assert.equal(await printerWith(empty.fetch).print(sampleTicket()), null);
    await assert.rejects(printerWith(odd.fetch).print(sampleTicket()), {
        message: 'Respuesta inesperada de Apipos en /print'
    });
});

test('name y apiUrl: apiUrl sigue al cliente (compat v1)', async () => {
    const fake = fakeFetch();
    const apipos = new Apipos({ baseUrl: BASE_URL, fetch: fake.fetch });
    const printer = apipos.createPrinter('POS80_Kinwodon', { paper_size: 58 });
    assert.ok(printer);

    apipos.apiUrl = 'http://127.0.0.1:2';
    await printer.print([{ type: 'separator' }]);

    assert.equal(printer.name, 'POS80_Kinwodon');
    assert.equal(printer.apiUrl, 'http://127.0.0.1:2');
    assert.equal(onlyRequest(fake).url, 'http://127.0.0.1:2/print');
});
