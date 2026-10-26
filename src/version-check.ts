/*
 * Handshake de versión con Apipos (versionado en lockstep): la librería `X.Y.Z`
 * está hecha para Apipos `X.Y.Z`. Apipos responde SIEMPRE con el header
 * `X-Apipos-Version`; aquí se compara con `VERSION` y se arma el aviso que la
 * librería muestra en la consola cuando no coinciden.
 *
 * Módulo puro (sin DOM ni red): lo usan `request()` en cada respuesta y
 * `checkHealth()` con `data.version`, y se puede usar suelto.
 */

import type { VersionInfo, VersionStatus, VersionTuple } from './types.js';

// Mismo patrón que `src/services/version_service.py::_VERSION_RE` de Apipos:
// `v` opcional, major obligatorio, minor y patch opcionales; lo que siga al
// patch (`-beta`, `+build`) se ignora.
const VERSION_RE = /^\s*[vV]?(\d+)(?:\.(\d+))?(?:\.(\d+))?/;

/**
 * `'1.2.3'` | `'v1.2.3'` → `[1, 2, 3]`; las partes faltantes valen 0
 * (`'v1.2'` → `[1, 2, 0]`). Vacío, `null`, `undefined` o algo que no empiece
 * con un número → `null`.
 */
export function parseVersion(text: string | null | undefined): VersionTuple | null {
    if (!text) return null;
    const match = VERSION_RE.exec(text);
    if (!match) return null;
    const [, major = '0', minor = '0', patch = '0'] = match;
    return [Number(major), Number(minor), Number(patch)];
}

/**
 * Compara la versión de la librería (`client`) con la de Apipos (`backend`),
 * numéricamente por `major.minor.patch` (`1.0.10` es mayor que `1.0.9`):
 * `'equal'` | `'client_older'` | `'client_newer'`, o `'unknown'` cuando
 * `backend` es `null`/vacío/no parseable (Apipos anterior a 1.0.6, sin header).
 * Un `client` no parseable también da `'unknown'` (no pasa con `VERSION`, que
 * `sync-version` valida).
 */
export function compareVersions(client: string, backend: string | null | undefined): VersionStatus {
    const clientParts = parseVersion(client);
    const backendParts = parseVersion(backend);
    if (!clientParts || !backendParts) return 'unknown';
    for (let index = 0; index < clientParts.length; index++) {
        const mine = clientParts[index] ?? 0;
        const theirs = backendParts[index] ?? 0;
        if (mine < theirs) return 'client_older';
        if (mine > theirs) return 'client_newer';
    }
    return 'equal';
}

/**
 * `{ client, backend, status, message }` listo para avisar: `message` es el
 * texto EXACTO que la librería manda a la consola (`null` si `status` es
 * `'equal'`). `backend` se conserva tal cual llegó (`undefined` → `null`).
 */
export function describeVersions(client: string, backend: string | null | undefined): VersionInfo {
    const reported = backend ?? null;
    const status = compareVersions(client, reported);
    return { client, backend: reported, status, message: versionMessage(status, client, reported) };
}

function versionMessage(status: VersionStatus, client: string, backend: string | null): string | null {
    switch (status) {
        case 'equal':
            return null;
        case 'client_older':
            return `[apipos-js] Apipos ${String(backend)} es más nuevo que la librería apipos-js ${client}. Actualiza la librería en el front: ambas deben ir en la misma versión.`;
        case 'client_newer':
            return `[apipos-js] La librería apipos-js ${client} es más nueva que Apipos ${String(backend)} instalado en esta máquina. Actualiza Apipos (menú de bandeja → Buscar actualizaciones): ambas deben ir en la misma versión.`;
        case 'unknown':
            return `[apipos-js] Apipos no reporta su versión (falta el header X-Apipos-Version): es anterior a la librería apipos-js ${client}. Actualiza Apipos en esta máquina.`;
    }
}
