// API v2 de ApiPosPrinter: print(content, options), openDrawer() y render().
//
// LO QUE SE PROTEGE:
//  1. El mapeo EXACTO options (camelCase) → settings (snake_case del cable),
//     siempre DENTRO de `settings` (nunca al nivel raíz del payload).
//  2. Que `undefined` no viaje y que `options.settings` gane sobre lo demás.
//  3. Que sin opciones (o con `{}`, o con todas `undefined`) el payload siga
//     siendo el de v1 byte a byte.
//  4. Que `this.settings` nunca se mute: la misma impresora imprime después
//     con sus settings de siempre.
//  5. openDrawer → POST /open-withdrawer { printer }; render → POST /render con
//     los settings de la impresora y el MISMO mapeo de opciones que print.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Apipos, ApiposError } from '../dist/index.js';
import type { ApiPosPrinter, ContentTransform, FetchLike, PrintSettings, TicketContent } from '../dist/index.js';
import { BASE_URL, fakeFetch, isRecord, jsonResponse, onlyRequest, parsedBody, success } from './helpers.ts';
import type { RecordedRequest } from './helpers.ts';

const V1_BODY = '{"printer":"X","type":"RAW","settings":{"paper_size":80},"content":[{"type":"text","data":"Hola"}]}';

// PNG mínimo (la firma de 8 bytes) en base64, como lo devuelve POST /render.
const PNG_BASE64 = 'iVBORw0KGgo=';

function printerWith(fetch: FetchLike, settings: PrintSettings = { paper_size: 80 }, transformContent?: ContentTransform): ApiPosPrinter {
    const apipos = new Apipos(transformContent ? { baseUrl: BASE_URL, fetch, transformContent } : { baseUrl: BASE_URL, fetch });
    const printer = apipos.createPrinter('X', settings);
    assert.ok(printer);
    return printer;
}

function ticket(): TicketContent {
    return [{ type: 'text', data: 'Hola' }];
}

/** `settings` del body de la única petición grabada. */
function sentSettings(request: RecordedRequest): Record<string, unknown> {
    const body = parsedBody(request);
    assert.ok(isRecord(body));
    // Las opciones nunca agregan claves al nivel raíz del payload.
    assert.deepEqual(Object.keys(body), ['printer', 'type', 'settings', 'content']);
    assert.ok(isRecord(body.settings));
    return body.settings;
}

function renderData(format: 'png' | 'pdf' = 'png') {
    return {
        format,
        dpi: format === 'png' ? 203 : null,
        base64: format === 'png' ? PNG_BASE64 : 'JVBERi0xLjQ=',
        page_mm: { width: 72, height: 19.9 },
        pages: 1,
        fonts: [{ family: 'sans-serif', resolved: 'Helvetica', source: 'builtin', bold: false, italic: false }],
        warnings: []
    };
}

test('print(content) y print(content, {}) siguen mandando el payload de v1 byte a byte', async () => {
    const fake = fakeFetch();
    const printer = printerWith(fake.fetch);

    await printer.print(ticket());
    await printer.print(ticket(), {});

    assert.deepEqual(
        fake.requests.map(request => request.init.body),
        [V1_BODY, V1_BODY]
    );
});

test('opciones todas undefined (y settings: {}) → payload de v1 byte a byte', async () => {
    const fake = fakeFetch();

    await printerWith(fake.fetch).print(ticket(), {
        renderer: undefined,
        pdfMode: undefined,
        font: undefined,
        marginsMm: undefined,
        widthMm: undefined,
        maxHeightMm: undefined,
        cut: undefined,
        settings: {}
    });

    assert.equal(onlyRequest(fake).init.body, V1_BODY);
});

test('mapeo exacto de las 7 opciones a settings (en snake_case, dentro de settings)', async () => {
    const fake = fakeFetch();

    await printerWith(fake.fetch).print(ticket(), {
        renderer: 'pdf',
        pdfMode: 'raw',
        font: { family: 'Courier New', size: 10, line_height: 1.4 },
        marginsMm: { top: 2, right: 1, bottom: 4, left: 1 },
        widthMm: 70,
        maxHeightMm: 500,
        cut: false
    });

    const request = onlyRequest(fake);
    assert.equal(request.url, 'http://127.0.0.1:1/print');
    assert.deepEqual(parsedBody(request), {
        printer: 'X',
        type: 'RAW',
        settings: {
            paper_size: 80,
            renderer: 'pdf',
            pdf_mode: 'raw',
            font: { family: 'Courier New', size: 10, line_height: 1.4 },
            margins_mm: { top: 2, right: 1, bottom: 4, left: 1 },
            width_mm: 70,
            max_height_mm: 500,
            cut: false
        },
        content: [{ type: 'text', data: 'Hola' }]
    });
    // Mismas claves en el orden del contrato: settings de la impresora y luego las opciones.
    assert.deepEqual(Object.keys(sentSettings(request)), [
        'paper_size',
        'renderer',
        'pdf_mode',
        'font',
        'margins_mm',
        'width_mm',
        'max_height_mm',
        'cut'
    ]);
});

test('undefined no viaja: ni en las opciones ni dentro de options.settings (tampoco borra); false y 0 sí', async () => {
    const fake = fakeFetch();

    await printerWith(fake.fetch).print(ticket(), {
        renderer: undefined,
        pdfMode: 'driver',
        font: undefined,
        widthMm: 0,
        cut: false,
        // `cut: undefined` aquí no pisa el `cut: false` de arriba: undefined = "no definido".
        settings: { width_dots: undefined, max_band_bytes: 512, cut: undefined }
    });

    const request = onlyRequest(fake);
    assert.deepEqual(sentSettings(request), {
        paper_size: 80,
        pdf_mode: 'driver',
        width_mm: 0,
        cut: false,
        max_band_bytes: 512
    });
    assert.doesNotMatch(request.init.body ?? '', /renderer|"font"|width_dots/);
});

test('options.settings se mezcla al final y gana; admite claves que la librería aún no tipa', async () => {
    const fake = fakeFetch();

    await printerWith(fake.fetch).print(ticket(), {
        renderer: 'escpos',
        cut: true,
        widthMm: 72,
        settings: { renderer: 'pdf', cut: false, paper_size: 58, future_backend_key: 'x' }
    });

    assert.deepEqual(sentSettings(onlyRequest(fake)), {
        paper_size: 58,
        renderer: 'pdf',
        width_mm: 72,
        cut: false,
        future_backend_key: 'x'
    });
});

test('renderer "pdf" + font + marginsMm: settings del renderizador PDF y su respuesta', async () => {
    const response = {
        printer: 'X',
        type: 'RAW',
        renderer: 'pdf',
        strategy: 'raw',
        width_dots: 576,
        cut: true,
        page_mm: { width: 72, height: 123.4 },
        fonts: [{ family: 'Arial', resolved: 'Arial', source: 'system', bold: false, italic: false }],
        warnings: [],
        drawer_opened: false
    };
    const fake = fakeFetch(() => success(response, 'Rendered ticket sent as PDF.'));

    const result = await printerWith(fake.fetch).print(ticket(), {
        renderer: 'pdf',
        font: { family: 'Arial', size: 9, line_height: 1.25 },
        marginsMm: { top: 1, right: 1, bottom: 3, left: 1 }
    });

    assert.equal(
        onlyRequest(fake).init.body,
        '{"printer":"X","type":"RAW","settings":{"paper_size":80,"renderer":"pdf",' +
            '"font":{"family":"Arial","size":9,"line_height":1.25},' +
            '"margins_mm":{"top":1,"right":1,"bottom":3,"left":1}},' +
            '"content":[{"type":"text","data":"Hola"}]}'
    );
    assert.deepEqual(result, response);
});

test('las opciones no mutan this.settings: la mezcla es superficial y el siguiente print vuelve a v1', async () => {
    const fake = fakeFetch();
    const settings: PrintSettings = { paper_size: 80, font: { family: 'Courier New', size: 8 } };
    const before = structuredClone(settings);
    const printer = printerWith(fake.fetch, settings);

    await printer.print(ticket(), { renderer: 'pdf', font: { size: 12 }, settings: { cut: false } });
    await printer.print(ticket());

    const [withOptions, plain] = fake.requests;
    assert.ok(withOptions && plain);
    // `font` reemplaza completo el de la impresora (no se combina clave por clave).
    assert.deepEqual(sentSettings(withOptions), { paper_size: 80, font: { size: 12 }, renderer: 'pdf', cut: false });
    assert.equal(
        plain.init.body,
        '{"printer":"X","type":"RAW","settings":{"paper_size":80,"font":{"family":"Courier New","size":8}},' +
            '"content":[{"type":"text","data":"Hola"}]}'
    );
    assert.equal(printer.settings, settings);
    assert.deepEqual(settings, before);
});

test('openDrawer → POST /open-withdrawer con { printer } y devuelve el data', async () => {
    const fake = fakeFetch(() => success({ printer: 'X' }, 'Cash drawer opened.'));

    const result = await printerWith(fake.fetch).openDrawer();

    const { url, init } = onlyRequest(fake);
    assert.equal(url, 'http://127.0.0.1:1/open-withdrawer');
    assert.equal(init.method, 'POST');
    assert.equal(init.body, '{"printer":"X"}');
    assert.deepEqual(result, { printer: 'X' });
});

test('openDrawer: error de Apipos → ApiposError; data con otra forma → "Respuesta inesperada de Apipos en /open-withdrawer"', async () => {
    const failing = fakeFetch(() =>
        jsonResponse(
            { status: 'error', data: { available: ['POS80'] }, message: "Printer 'X' not found." },
            { ok: false, status: 400, statusText: 'BAD REQUEST' }
        )
    );
    const odd = fakeFetch(() => success(null));

    await assert.rejects(printerWith(failing.fetch).openDrawer(), (error: unknown) => {
        assert.ok(error instanceof ApiposError);
        assert.equal(error.message, "Printer 'X' not found.");
        assert.deepEqual(error.data, { available: ['POS80'] });
        return true;
    });
    await assert.rejects(printerWith(odd.fetch).openDrawer(), {
        message: 'Respuesta inesperada de Apipos en /open-withdrawer'
    });
});

test('printer.render() mezcla this.settings con las opciones (mismo mapeo) y manda format "png" a 203 dpi', async () => {
    const fake = fakeFetch(() => success(renderData('png'), 'Ticket rendered.'));
    const settings: PrintSettings = { paper_size: 58, font: { family: 'Arial', size: 9 } };
    const before = structuredClone(settings);
    const shout: ContentTransform = content =>
        content.map(item => (item.type === 'text' ? { ...item, data: item.data.toUpperCase() } : item));
    const printer = printerWith(fake.fetch, settings, shout);

    const result = await printer.render(ticket(), { marginsMm: { top: 0 }, widthMm: 48, settings: { future_key: 1 } });

    const request = onlyRequest(fake);
    assert.equal(request.url, 'http://127.0.0.1:1/render');
    assert.equal(request.init.method, 'POST');
    assert.deepEqual(parsedBody(request), {
        settings: { paper_size: 58, font: { family: 'Arial', size: 9 }, margins_mm: { top: 0 }, width_mm: 48, future_key: 1 },
        content: [{ type: 'text', data: 'HOLA' }],
        format: 'png',
        dpi: 203
    });
    assert.equal(result.format, 'png');
    assert.equal(result.blob.type, 'image/png');
    assert.deepEqual(settings, before);
});

test('printer.render() con format "pdf" y dpi propios; sin opciones manda solo los settings de la impresora', async () => {
    const fake = fakeFetch(() => success(renderData('pdf')));
    const printer = printerWith(fake.fetch);

    await printer.render(ticket(), { format: 'pdf', dpi: 300, renderer: 'pdf' });
    await printer.render(ticket());

    const bodies = fake.requests.map(parsedBody);
    assert.deepEqual(bodies, [
        { settings: { paper_size: 80, renderer: 'pdf' }, content: [{ type: 'text', data: 'Hola' }], format: 'pdf', dpi: 300 },
        { settings: { paper_size: 80 }, content: [{ type: 'text', data: 'Hola' }], format: 'png', dpi: 203 }
    ]);
});
