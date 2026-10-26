// El paquete que se distribuye: versión en lockstep, mapa de `exports` y la
// guarda `scripts/sync-version.ts`.
//
// LO QUE SE PROTEGE:
//  1. VERSION (src/version.ts generado) === package.json.version, y CLIENT_NAME.
//  2. Que cada subpath de `exports` resuelva al JS compilado y a sus tipos.
//  3. El contrato de `sync-version --check` con un app-meta.env temporal (no
//     depende del checkout hermano de Apipos ni escribe en el repo): acuerdo,
//     desacuerdo, archivo inexistente y APP_VERSION inválida, con los mensajes exactos.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import * as library from '../dist/index.js';
import { CLIENT_NAME, VERSION } from '../dist/index.js';
import { isRecord } from './helpers.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SYNC_VERSION = join(ROOT, 'scripts', 'sync-version.ts');

function readPackageJson(): Record<string, unknown> {
    const pkg: unknown = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    assert.ok(isRecord(pkg));
    return pkg;
}

function packageVersion(): string {
    const version = readPackageJson().version;
    assert.equal(typeof version, 'string');
    return String(version);
}

const tempDir = mkdtempSync(join(tmpdir(), 'apipos-js-'));
after(() => rmSync(tempDir, { recursive: true, force: true }));

function appMeta(name: string, text: string): string {
    const file = join(tempDir, name);
    writeFileSync(file, text);
    return file;
}

function checkVersion(...args: string[]): { status: number | null; stdout: string; stderr: string } {
    const run = spawnSync(process.execPath, [SYNC_VERSION, '--check', ...args], { encoding: 'utf8' });
    return { status: run.status, stdout: run.stdout.trim(), stderr: run.stderr.trim() };
}

test('VERSION === package.json.version y CLIENT_NAME === "apipos-js"', () => {
    assert.equal(VERSION, packageVersion());
    assert.equal(CLIENT_NAME, 'apipos-js');
});

test('cada subpath de exports apunta a dist/ con su .d.ts y resuelve por el nombre del paquete', async () => {
    const pkg = readPackageJson();
    const exportsMap = pkg.exports;
    assert.ok(isRecord(exportsMap));
    assert.deepEqual(Object.keys(exportsMap), ['.', './strip-accents', './ticket-preview', './version', './types']);
    for (const target of Object.values(exportsMap)) {
        assert.ok(isRecord(target));
        assert.deepEqual(Object.keys(target), ['types', 'default']);
        for (const file of Object.values(target)) {
            assert.equal(typeof file, 'string');
            assert.ok(existsSync(join(ROOT, String(file))), `falta ${String(file)}`);
        }
    }
    assert.deepEqual(pkg.files, ['dist', 'README.md']);

    // Auto-referencia por nombre: así lo importa quien instala el paquete.
    const root = await import('@tecsom/apipos-js');
    const version = await import('@tecsom/apipos-js/version');
    const strip = await import('@tecsom/apipos-js/strip-accents');
    const preview = await import('@tecsom/apipos-js/ticket-preview');
    const types = await import('@tecsom/apipos-js/types');
    assert.equal(root.Apipos, library.Apipos);
    assert.equal(version.VERSION, VERSION);
    assert.equal(strip.stripAccents, library.stripAccents);
    assert.equal(preview.renderTicketHtml, library.renderTicketHtml);
    assert.deepEqual(Object.keys(types), []);
});

test('sync-version --check con la misma versión → "✅ versiones en lockstep" y exit 0', () => {
    const version = packageVersion();
    // Mismo parser que Apipos: comentarios, líneas vacías y espacios alrededor de "=".
    const file = appMeta('same.env', `# Metadatos\n\nAPP_NAME=Apipos\nAPP_VERSION = ${version}\nAPP_NOTE=a=b\n`);

    const run = checkVersion('--from', file);

    assert.equal(run.status, 0);
    assert.equal(run.stdout, `[apipos-js] ✅ versiones en lockstep: ${version}`);
});

test('sync-version --check con otra versión → mensaje exacto y exit 1', () => {
    const version = packageVersion();
    const file = appMeta('other.env', 'APP_VERSION=0.0.1\n');

    const run = checkVersion('--from', file);

    assert.equal(run.status, 1);
    assert.equal(
        run.stderr,
        `[apipos-js] ❌ versiones distintas: app-meta.env=0.0.1 package.json=${version} src/version.ts=${version} — corre: npm run sync-version`
    );
});

test('sync-version con un app-meta.env inexistente o una APP_VERSION inválida → mensaje exacto y exit 1', () => {
    const missing = join(tempDir, 'no-existe', 'app-meta.env');
    const invalid = appMeta('invalid.env', 'APP_VERSION=1.0\n');

    const notFound = checkVersion('--from', missing);
    const badVersion = checkVersion('--from', invalid);

    assert.equal(notFound.status, 1);
    assert.equal(notFound.stderr, `[apipos-js] ❌ no se encontró app-meta.env de Apipos en '${missing}'; usa --from <ruta>`);
    assert.equal(badVersion.status, 1);
    assert.equal(badVersion.stderr, "[apipos-js] ❌ APP_VERSION inválida en app-meta.env: '1.0'");
});
