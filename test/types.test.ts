// Los tipos públicos (dist/*.d.ts) aceptan el contrato de Apipos y rechazan lo
// demás. La parte positiva la comprueba `tsc -p tsconfig.test.json` al compilar
// este archivo; la negativa, compilando test/fixtures/invalid-usage.ts.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { Apipos, parseVersion, renderTicketPreviewPng } from '../dist/index.js';
import type {
    FetchLike,
    FontCatalog,
    HealthResult,
    ListFontsOptions,
    OpenDrawerResult,
    PrinterRenderOptions,
    PrintOptions,
    PrintSettings,
    RenderPreviewOptions,
    RenderResult,
    RenderTicketOptions,
    TicketContent,
    VersionInfo,
    VersionTuple
} from '../dist/index.js';

const TSC = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));
const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/', import.meta.url));
const FIXTURE = fileURLToPath(new URL('./fixtures/invalid-usage.ts', import.meta.url));

/** Línea (desde 1) del fixture que contiene `marker`. */
function fixtureLine(marker: string): number {
    const index = readFileSync(FIXTURE, 'utf8')
        .split('\n')
        .findIndex(line => line.includes(marker) && !line.trimStart().startsWith('//'));
    assert.ok(index >= 0, `el fixture no contiene ${marker}`);
    return index + 1;
}

test('un ticket con todos los items y settings del renderizador PDF compila y se envía tal cual', async () => {
    const settings: PrintSettings = {
        paper_size: 80,
        renderer: 'pdf',
        pdf_mode: 'raw',
        font: { family: 'Arial', size: 9, line_height: 1.25 },
        margins_mm: { top: 1, right: 1, bottom: 3, left: 1 },
        max_height_mm: 1000,
        cut: true
    };
    const content: TicketContent = [
        { type: 'image', data: 'iVBORw0KGgo=', width_mm: 30, align: 'center' },
        { type: 'text', data: 'MI TIENDA', align: 'center', font_size: 18, font_weight: 'bold', font: 'b' },
        { type: 'text', data: 'PEDIDO #42', align: 'center', high_contrast: true },
        { type: 'separator', style: 'dashed', thickness: 0.6 },
        {
            type: 'table',
            data: {
                columns: [
                    { label: 'Cant.', width: 15, align: 'left' },
                    { label: 'Producto', width: 45 },
                    { label: 'Importe', width: 40, align: 'right' }
                ],
                rows: [[2, 'Coca Cola 600ml', '$36.00']]
            },
            font_family: 'Courier New'
        },
        { type: 'special_text', data: { text1: 'TOTAL', text2: '$81.50' }, font_size: 'md', underline: true },
        { type: 'text', data: 'Términos', font_size: 7, font_style: 'italic', line_height: 1.1 },
        { type: 'spacer', lines: 1 },
        { type: 'spacer', height_mm: 5 },
        { type: 'html', data: '<p style="text-align:center">Gracias por su <b>compra</b></p>' },
        { type: 'open_withdrawer' }
    ];
    const sent: string[] = [];
    const fetch: FetchLike = async (_url, init) => {
        sent.push(init.body ?? '');
        return { ok: true, status: 200, statusText: 'OK', json: async () => ({ status: 'success', data: null }) };
    };
    const printer = new Apipos({ fetch }).createPrinter('POS80', settings);
    assert.ok(printer);

    await printer.print(content);

    assert.deepEqual(sent, [JSON.stringify({ printer: 'POS80', type: 'RAW', settings, content })]);
});

test('las opciones v2 (PrintOptions, RenderTicketOptions...) compilan y sus resultados quedan tipados', async () => {
    const printOptions: PrintOptions = {
        renderer: 'pdf',
        pdfMode: 'raw',
        font: { family: 'Arial', size: 9, line_height: 1.25 },
        marginsMm: { top: 1, right: 1, bottom: 3, left: 1 },
        widthMm: 72,
        maxHeightMm: 1000,
        cut: true,
        // Escape para claves nuevas del backend: se aceptan sin perder el tipo de las conocidas.
        settings: { width_dots: 576, future_backend_key: 'x' }
    };
    const renderOptions: RenderTicketOptions = {
        settings: { paper_size: 80, font: { family: 'monospace' } },
        format: 'png',
        dpi: 203
    };
    const printerRenderOptions: PrinterRenderOptions = { ...printOptions, format: 'pdf', dpi: 150 };
    const previewOptions: RenderPreviewOptions = { settings: { paper_size: 58 }, dpi: 150 };
    const fontsOptions: ListFontsOptions = { refresh: true };
    const fontsData = { families: [], count: 0, builtin: ['sans-serif'], dirs: [], scanned_at: '2026-10-26T18:04:11' };
    const renderData = {
        format: 'png',
        dpi: 203,
        base64: 'iVBORw0KGgo=',
        page_mm: { width: 72, height: 10 },
        pages: 1,
        fonts: [],
        warnings: []
    };
    const dataFor = (url: string): unknown => {
        if (url.includes('/fonts')) return fontsData;
        if (url.endsWith('/render')) return renderData;
        if (url.endsWith('/open-withdrawer')) return { printer: 'POS80' };
        return null;
    };
    const fetch: FetchLike = async url => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ status: 'success', data: dataFor(url), message: '' })
    });
    const apipos = new Apipos({ fetch });
    const printer = apipos.createPrinter('POS80', { paper_size: 80 });
    assert.ok(printer);

    const catalog: FontCatalog = await apipos.listFonts(fontsOptions);
    const rendered: RenderResult = await apipos.renderTicket([{ type: 'text', data: 'x' }], renderOptions);
    const previewed: RenderResult = await printer.render([{ type: 'text', data: 'x' }], printerRenderOptions);
    const drawer: OpenDrawerResult = await printer.openDrawer();
    const dataUrl: string = await renderTicketPreviewPng(apipos, [{ type: 'spacer', height_mm: 5 }], previewOptions);
    await printer.print([{ type: 'html', data: '<b>x</b>' }], printOptions);

    assert.equal(catalog.scannedAt, '2026-10-26T18:04:11');
    assert.equal(rendered.blob.type, 'image/png');
    assert.equal(previewed.pageMm.width, 72);
    assert.equal(drawer.printer, 'POS80');
    assert.ok(dataUrl.startsWith('data:image/png;base64,'));
});

test('globalThis.fetch es asignable a FetchLike y HealthResult exige version (VersionInfo | null)', () => {
    const nativeFetch: FetchLike = globalThis.fetch;
    const offline: HealthResult = { ok: false, data: null, version: null };
    const mismatch: VersionInfo = { client: '1.0.6', backend: null, status: 'unknown', message: '[apipos-js] ...' };
    const parts: VersionTuple | null = parseVersion('v1.2');

    assert.equal(typeof nativeFetch, 'function');
    assert.deepEqual(offline, { ok: false, data: null, version: null });
    assert.equal(mismatch.status, 'unknown');
    assert.deepEqual(parts, [1, 2, 0]);
});

test('prueba de tipos negativa: tsc rechaza data: 1 en text, font_size "xl" y renderer "zpl"', () => {
    const run = spawnSync(process.execPath, [TSC, '--noEmit', '--pretty', 'false', '-p', FIXTURE_DIR], {
        encoding: 'utf8'
    });
    const output = `${run.stdout}${run.stderr}`;
    const errors = output.split('\n').filter(line => line.includes('error TS'));

    assert.notEqual(run.status, 0);
    assert.equal(errors.length, 3, output);
    const [numericData, fontSize, renderer] = errors;
    assert.match(numericData ?? '', new RegExp(`invalid-usage\\.ts\\(${fixtureLine('data: 1 }')},\\d+\\): error TS2322: Type 'number' is not assignable to type 'string'`));
    assert.match(fontSize ?? '', new RegExp(`invalid-usage\\.ts\\(${fixtureLine("'xl'")},\\d+\\): error TS2322: Type '"xl"' is not assignable`));
    assert.match(renderer ?? '', new RegExp(`invalid-usage\\.ts\\(${fixtureLine("'zpl'")},\\d+\\): error TS2322: Type '"zpl"' is not assignable`));
});
