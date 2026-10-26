// API v2 de Apipos: listFonts(), renderTicket(), base64ToBlob() y
// renderTicketPreviewPng(), contra dobles de `fetch` (sin red real).
//
// LO QUE SE PROTEGE:
//  1. GET /fonts sin query por defecto y `?refresh=1` con `refresh: true`;
//     `scanned_at` del cable → `scannedAt`; forma inválida → error claro.
//  2. POST /render con `{ settings, content: transform(content), format, dpi }`
//     y el resultado en camelCase con un `Blob` del mime correcto; `dpi: null`
//     con `pdf` (así lo responde Apipos).
//  3. base64ToBlob: base64 puro y data URI → los MISMOS bytes.
//  4. renderTicketPreviewPng: data URL PNG listo para un <img>.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';

import { Apipos, ApiposError, base64ToBlob, renderTicketPreviewPng } from '../dist/index.js';
import type { ContentTransform, FetchLike, TicketContent } from '../dist/index.js';
import { BASE_URL, fakeFetch, jsonResponse, onlyRequest, parsedBody, success } from './helpers.ts';

// La firma de un PNG y la cabecera de un PDF: lo que traen al inicio los base64 reales.
const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_BASE64 = Buffer.from(PNG_BYTES).toString('base64'); // iVBORw0KGgo=
const PDF_BASE64 = Buffer.from('%PDF-1.4').toString('base64'); // JVBERi0xLjQ=

const FONTS_DATA = {
    families: [
        {
            family: 'Arial',
            monospace: false,
            faces: [
                {
                    style: 'Regular',
                    bold: false,
                    italic: false,
                    weight: 400,
                    full_name: 'Arial',
                    postscript_name: 'ArialMT',
                    path: '/System/Library/Fonts/Supplemental/Arial.ttf',
                    index: 0,
                    format: 'ttf'
                },
                {
                    style: 'Bold',
                    bold: true,
                    italic: false,
                    weight: 700,
                    full_name: 'Arial Bold',
                    postscript_name: null,
                    path: '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
                    index: 0,
                    format: 'ttf'
                }
            ]
        },
        { family: 'Menlo', monospace: true, faces: [] }
    ],
    count: 2,
    builtin: ['sans-serif', 'serif', 'monospace'],
    dirs: ['/System/Library/Fonts', '/Library/Fonts'],
    scanned_at: '2026-10-26T18:04:11'
};

function renderData(format: 'png' | 'pdf') {
    return {
        format,
        dpi: format === 'png' ? 203 : null,
        base64: format === 'png' ? PNG_BASE64 : PDF_BASE64,
        page_mm: { width: 72, height: 19.9 },
        pages: 1,
        fonts: [{ family: 'Comic Sans', resolved: 'Helvetica', source: 'fallback', bold: false, italic: false }],
        warnings: ["Font family 'Comic Sans' is not installed; using sans-serif."]
    };
}

function client(fetch: FetchLike, transformContent?: ContentTransform): Apipos {
    return new Apipos(transformContent ? { baseUrl: BASE_URL, fetch, transformContent } : { baseUrl: BASE_URL, fetch });
}

async function bytesOf(blob: Blob): Promise<number[]> {
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
}

test('listFonts() → GET /fonts sin query y { families, builtin, count, dirs, scannedAt }', async () => {
    const fake = fakeFetch(() => success(FONTS_DATA, 'Fonts listed.'));

    const catalog = await client(fake.fetch).listFonts();

    const { url, init } = onlyRequest(fake);
    assert.equal(url, 'http://127.0.0.1:1/fonts');
    assert.equal(init.method, 'GET');
    assert.equal(init.body, undefined);
    assert.deepEqual(catalog, {
        families: FONTS_DATA.families,
        builtin: ['sans-serif', 'serif', 'monospace'],
        count: 2,
        dirs: ['/System/Library/Fonts', '/Library/Fonts'],
        scannedAt: '2026-10-26T18:04:11'
    });
});

test('listFonts({ refresh: true }) → /fonts?refresh=1; refresh: false → sin query', async () => {
    const fake = fakeFetch(() => success(FONTS_DATA));
    const apipos = client(fake.fetch);

    const refreshed = await apipos.listFonts({ refresh: true });
    await apipos.listFonts({ refresh: false });

    const [first, second] = fake.requests.map(request => request.url);
    assert.ok(first?.endsWith('/fonts?refresh=1'), first);
    assert.equal(second, 'http://127.0.0.1:1/fonts');
    assert.equal(refreshed.scannedAt, '2026-10-26T18:04:11');
});

test('listFonts con una forma inválida → "Respuesta inesperada de Apipos en /fonts"', async () => {
    const [arialFamily] = FONTS_DATA.families;
    assert.ok(arialFamily);
    const invalid: unknown[] = [
        null,
        ['Arial'],
        { ...FONTS_DATA, scanned_at: undefined },
        { ...FONTS_DATA, families: 'Arial' },
        { ...FONTS_DATA, builtin: [1] },
        { ...FONTS_DATA, families: [{ ...arialFamily, faces: [{ ...arialFamily.faces[0], format: 'woff' }] }] }
    ];

    for (const data of invalid) {
        await assert.rejects(client(fakeFetch(() => success(data)).fetch).listFonts(), {
            message: 'Respuesta inesperada de Apipos en /fonts'
        });
    }
});

test('listFonts lanza ApiposError si Apipos responde error (no devuelve [] como listPrinters)', async () => {
    const fake = fakeFetch(() => jsonResponse({ status: 'error', data: null, message: 'boom' }, { ok: false, status: 500 }));

    await assert.rejects(client(fake.fetch).listFonts(), (error: unknown) => {
        assert.ok(error instanceof ApiposError);
        assert.equal(error.message, 'boom');
        return true;
    });
});

test('renderTicket png → body { settings, content transformado, format, dpi } y base64, pageMm, blob image/png', async () => {
    const fake = fakeFetch(() => success(renderData('png'), 'Ticket rendered.'));
    const shout: ContentTransform = content =>
        content.map(item => (item.type === 'text' ? { ...item, data: item.data.toUpperCase() } : item));
    const content: TicketContent = [
        { type: 'text', data: 'Hola', align: 'center', font_size: 'lg' },
        { type: 'spacer', lines: 1 },
        { type: 'html', data: '<p>Gracias</p>' }
    ];
    const before = structuredClone(content);

    const result = await client(fake.fetch, shout).renderTicket(content, {
        settings: { paper_size: 80, font: { family: 'Comic Sans', size: 9 } },
        format: 'png'
    });

    const request = onlyRequest(fake);
    assert.equal(request.url, 'http://127.0.0.1:1/render');
    assert.equal(request.init.method, 'POST');
    assert.equal(
        request.init.body,
        '{"settings":{"paper_size":80,"font":{"family":"Comic Sans","size":9}},' +
            '"content":[{"type":"text","data":"HOLA","align":"center","font_size":"lg"},' +
            '{"type":"spacer","lines":1},{"type":"html","data":"<p>Gracias</p>"}],' +
            '"format":"png","dpi":203}'
    );
    assert.deepEqual(content, before);

    const { blob, ...rest } = result;
    assert.deepEqual(rest, {
        format: 'png',
        dpi: 203,
        base64: PNG_BASE64,
        pageMm: { width: 72, height: 19.9 },
        pages: 1,
        fonts: [{ family: 'Comic Sans', resolved: 'Helvetica', source: 'fallback', bold: false, italic: false }],
        warnings: ["Font family 'Comic Sans' is not installed; using sans-serif."]
    });
    assert.ok(blob instanceof Blob);
    assert.equal(blob.type, 'image/png');
    assert.deepEqual(await bytesOf(blob), PNG_BYTES);
});

test('renderTicket por defecto → format "pdf", dpi 203 y settings {}; acepta dpi: null y da un blob application/pdf', async () => {
    const fake = fakeFetch(() => success(renderData('pdf')));

    const result = await client(fake.fetch).renderTicket([{ type: 'separator' }]);

    assert.deepEqual(parsedBody(onlyRequest(fake)), {
        settings: {},
        content: [{ type: 'separator' }],
        format: 'pdf',
        dpi: 203
    });
    assert.equal(result.format, 'pdf');
    assert.equal(result.dpi, null);
    assert.equal(result.blob.type, 'application/pdf');
    assert.equal(Buffer.from(await result.blob.arrayBuffer()).toString('latin1'), '%PDF-1.4');
});

test('renderTicket con una forma inválida → "Respuesta inesperada de Apipos en /render"', async () => {
    const png = renderData('png');
    const invalid: unknown[] = [
        null,
        { ...png, format: 'jpg' },
        { ...png, dpi: '203' },
        { ...png, page_mm: undefined },
        { ...png, fonts: [{ family: 'Arial', resolved: 'Arial', source: 'cloud', bold: false, italic: false }] },
        { ...png, warnings: 'none' }
    ];

    for (const data of invalid) {
        await assert.rejects(client(fakeFetch(() => success(data)).fetch).renderTicket([{ type: 'separator' }]), {
            message: 'Respuesta inesperada de Apipos en /render'
        });
    }
});

test('base64ToBlob con base64 puro → los bytes exactos y el mime dado', async () => {
    // Todos los valores 0–255: el decodificador no puede perder ni alterar ninguno.
    const bytes = Array.from({ length: 256 }, (_, index) => index);

    const blob = base64ToBlob(Buffer.from(bytes).toString('base64'), 'application/octet-stream');

    assert.equal(blob.type, 'application/octet-stream');
    assert.equal(blob.size, 256);
    assert.deepEqual(await bytesOf(blob), bytes);
});

test('base64ToBlob con data URI → quita el prefijo "data:<mime>;base64," y usa el mime dado', async () => {
    const png = base64ToBlob(`data:image/png;base64,${PNG_BASE64}`, 'image/png');
    const relabeled = base64ToBlob(`data:application/octet-stream;base64,${PDF_BASE64}`, 'application/pdf');

    assert.equal(png.type, 'image/png');
    assert.deepEqual(await bytesOf(png), PNG_BYTES);
    assert.equal(relabeled.type, 'application/pdf');
    assert.equal(Buffer.from(await relabeled.arrayBuffer()).toString('latin1'), '%PDF-1.4');
});

test('renderTicketPreviewPng → "data:image/png;base64,<...>" pidiendo png a 150 dpi por defecto', async () => {
    const fake = fakeFetch(() => success(renderData('png')));
    const apipos = client(fake.fetch);

    const preview = await renderTicketPreviewPng(apipos, [{ type: 'text', data: 'x' }]);
    await renderTicketPreviewPng(apipos, [{ type: 'text', data: 'x' }], { settings: { paper_size: 58 }, dpi: 300 });

    assert.ok(preview.startsWith('data:image/png;base64,'));
    assert.equal(preview, `data:image/png;base64,${PNG_BASE64}`);
    assert.deepEqual(fake.requests.map(parsedBody), [
        { settings: {}, content: [{ type: 'text', data: 'x' }], format: 'png', dpi: 150 },
        { settings: { paper_size: 58 }, content: [{ type: 'text', data: 'x' }], format: 'png', dpi: 300 }
    ]);
});
