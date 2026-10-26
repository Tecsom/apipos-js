/*
 * Versionado en lockstep: la versión de @tecsom/apipos-js SIEMPRE es la de
 * Apipos, el backend (`APP_VERSION` de su `app-meta.env`). La librería `X.Y.Z`
 * está hecha para Apipos `X.Y.Z`; este script es la guarda de esa regla.
 *
 *   node scripts/sync-version.ts                 escribe package.json y src/version.ts
 *   node scripts/sync-version.ts --check         solo compara: exit 1 si alguna difiere
 *   node scripts/sync-version.ts --from <ruta>   otro app-meta.env (por defecto, el del
 *                                                checkout hermano: ../Apipos/app-meta.env)
 *
 * La versión NUNCA se edita aquí a mano: la sube el usuario en `app-meta.env`
 * de Apipos y este script la propaga. Sin dependencias (solo módulos de Node);
 * Node lo corre directo por type stripping, sin compilar.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_APP_META = resolve(REPO_ROOT, '..', 'Apipos', 'app-meta.env');
const PACKAGE_JSON = resolve(REPO_ROOT, 'package.json');
const VERSION_TS = resolve(REPO_ROOT, 'src', 'version.ts');

// Lo mismo que acepta Apipos al compararse con el cliente: major.minor.patch.
const VERSION_RE = /^\d+\.\d+\.\d+$/;
const VERSION_TS_RE = /export const VERSION = '([^']*)';/;

interface Args {
    check: boolean;
    from: string;
}

function fail(message: string): never {
    console.error(message);
    process.exit(1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseArgs(argv: readonly string[]): Args {
    const args: Args = { check: false, from: DEFAULT_APP_META };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i] ?? '';
        if (arg === '--check') {
            args.check = true;
        } else if (arg === '--from') {
            const value = argv[i + 1];
            if (value === undefined || value.startsWith('--')) fail('[apipos-js] ❌ falta la ruta después de --from');
            args.from = resolve(value);
            i += 1;
        } else if (arg.startsWith('--from=')) {
            args.from = resolve(arg.slice('--from='.length));
        } else {
            fail(`[apipos-js] ❌ argumento desconocido: '${arg}'. Uso: node scripts/sync-version.ts [--check] [--from <ruta>]`);
        }
    }
    return args;
}

/**
 * Mismo parser que `src/config.py::_read_app_meta` de Apipos: ignora líneas
 * vacías, comentarios `#` y líneas sin `=`; `KEY=VALUE` se parte en el PRIMER
 * `=` y ambos lados se recortan.
 */
function readAppMeta(file: string): Record<string, string> {
    const meta: Record<string, string> = {};
    for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#') || !line.includes('=')) continue;
        const separator = line.indexOf('=');
        meta[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
    }
    return meta;
}

function readPackageJson(): Record<string, unknown> {
    const pkg: unknown = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8'));
    if (!isRecord(pkg)) fail(`[apipos-js] ❌ package.json no es un objeto JSON: '${PACKAGE_JSON}'`);
    return pkg;
}

function readVersionTs(): string | null {
    if (!existsSync(VERSION_TS)) return null;
    return VERSION_TS_RE.exec(readFileSync(VERSION_TS, 'utf8'))?.[1] ?? null;
}

function versionModule(version: string): string {
    return [
        '// Generado por scripts/sync-version.ts a partir del app-meta.env de Apipos. NO editar a mano:',
        '// la versión de la librería SIEMPRE es la del backend (versionado en lockstep).',
        `export const VERSION = '${version}';`,
        "export const CLIENT_NAME = 'apipos-js';",
        ''
    ].join('\n');
}

const { check, from } = parseArgs(process.argv.slice(2));

if (!existsSync(from)) {
    fail(`[apipos-js] ❌ no se encontró app-meta.env de Apipos en '${from}'; usa --from <ruta>`);
}

const appVersion = readAppMeta(from)['APP_VERSION'] ?? '';
if (!VERSION_RE.test(appVersion)) {
    fail(`[apipos-js] ❌ APP_VERSION inválida en app-meta.env: '${appVersion}'`);
}

const pkg = readPackageJson();

if (check) {
    const packageVersion = typeof pkg['version'] === 'string' ? pkg['version'] : '(sin versión)';
    const moduleVersion = readVersionTs() ?? '(sin versión)';
    if (packageVersion !== appVersion || moduleVersion !== appVersion) {
        fail(
            `[apipos-js] ❌ versiones distintas: app-meta.env=${appVersion} package.json=${packageVersion} ` +
                `src/version.ts=${moduleVersion} — corre: npm run sync-version`
        );
    }
    console.log(`[apipos-js] ✅ versiones en lockstep: ${appVersion}`);
} else {
    pkg['version'] = appVersion;
    writeFileSync(PACKAGE_JSON, JSON.stringify(pkg, null, 2) + '\n');
    writeFileSync(VERSION_TS, versionModule(appVersion));
    // Con --from el origen puede no ser el checkout hermano: se muestra el real.
    const source = from === DEFAULT_APP_META ? 'Apipos/app-meta.env' : from;
    console.log(`[apipos-js] versión ${appVersion} (${source}) → package.json, src/version.ts`);
}
