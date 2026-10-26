# @tecsom/apipos-js

Cliente oficial para [Apipos](https://github.com/Tecsom/Apipos), el agente local
de impresión de Tecsom que corre en cada caja (`http://127.0.0.1:50432`) y
expone por HTTP las tiqueteras y etiqueteras de la máquina.

- Escrita en **TypeScript estricto**; se distribuye compilada a `dist/`
  (módulos ES + `.d.ts`). El navegador carga `dist/` tal cual, sin empaquetador.
- **Sin dependencias** en runtime (solo `fetch`, `Blob`, `btoa` y `atob`, que
  existen en el navegador y en Node ≥ 18).
- **Desacoplada** del POS que la usa: lo que cada app quiera hacerle al texto
  antes de imprimir entra por el hook `transformContent`.
- **Versionada en lockstep con Apipos**: la librería `X.Y.Z` está hecha para
  Apipos `X.Y.Z` (ver [Versionado](#versionado-en-lockstep-con-apipos)).

El contrato HTTP que envuelve está en `APIPOS_API.md` del repo de Apipos.

## Instalación

| Caso | Comando |
|---|---|
| Desarrollo local (repos hermanos en `REPOSITORIES/`) | `pnpm add -D "file:../apipos-js"` |
| Release, desde git | `pnpm add -D "github:Tecsom/apipos-js#vX.Y.Z"` |
| Release, tarball | `pnpm add -D "https://github.com/Tecsom/apipos-js/releases/download/vX.Y.Z/tecsom-apipos-js-X.Y.Z.tgz"` |

Desde git, el gestor de paquetes instala las devDependencies y corre `prepare`
(= `npm run build`), así que `dist/` se genera solo. El tarball ya trae `dist/`.

Usa siempre la versión **igual** a la del Apipos instalado en las cajas.

Para servirla al navegador sin empaquetador, copia
`node_modules/@tecsom/apipos-js/dist/` a una carpeta estática e impórtala desde
ahí (`.../apipos-js/index.js`).

## Uso

```ts
import { Apipos, ApiposError } from '@tecsom/apipos-js';
import type { TicketContent } from '@tecsom/apipos-js';

const apipos = new Apipos(); // baseUrl por defecto: http://127.0.0.1:50432

// ¿Está corriendo Apipos? Nunca lanza.
const { ok, data, version } = await apipos.checkHealth();
// data: { status, version, os, platform, backend, port, client }
// version: { client: '1.0.6', backend: '1.0.6', status: 'equal', message: null } (null si ok es false)

// Nombres EXACTOS de las impresoras instaladas ([] si Apipos no responde).
const printers = await apipos.listPrinters(); // ['POS80_Kinwodon', 'AiYin_AS240_BT']

// Impresora: nombre exacto + settings. `paper_size` numérico es obligatorio
// (lanza `Missing required setting: paper_size` /
// `Invalid type for setting paper_size: expected number, got <tipo>`).
// Sin nombre devuelve null (y lo reporta en consola).
const printer = apipos.createPrinter('POS80_Kinwodon', { paper_size: 80 });

// Ticket RAW (ESC/POS).
const ticket: TicketContent = [
    { type: 'text', data: 'MI TIENDA S.A.', align: 'center', font_size: 'md', font_weight: 'bold' },
    { type: 'separator' },
    { type: 'table', data: { rows: [[2, 'Coca Cola 600ml', '$18.00', '$36.00']] } },
    { type: 'special_text', data: { text1: 'TOTAL', text2: '$36.00' }, font_weight: 'bold' },
    { type: 'open_withdrawer' }
];

try {
    await printer?.print(ticket);
} catch (error) {
    if (error instanceof ApiposError) {
        // Mensaje de Apipos (p. ej. "Printer 'X' not found.") y su `data`
        // (p. ej. { available: [...] } con las impresoras válidas).
        console.error(error.message, error.data);
    } else {
        // Sin conexión: "No se pudo conectar con Apipos (<url>). ¿Está abierta la app de bandeja?"
        console.error(error);
    }
}

// PDF (Blob): 'driver' para etiqueteras con driver (AiYin), 'raw' para tiqueteras.
await printer?.printPDF(pdfBlob, { pdfMode: 'driver', labelSettings: { width: 60, height: 30, unit: 'mm' } });

// Abrir el cajón de dinero sin imprimir (POST /open-withdrawer { printer }).
await printer?.openDrawer(); // → { printer: 'POS80_Kinwodon' }
```

- `print(content)` manda exactamente `{ printer, type: 'RAW', settings, content }`
  a `POST /print`; `printPDF(blob, options)` manda `{ printer, type: 'PDF', settings, data }`
  con el PDF en base64. Ambos devuelven el `data` de la respuesta de Apipos.
- `print(content, options)` acepta opciones del renderizador PDF (siguiente
  sección); sin `options` (o con `{}`) el payload es el de siempre, byte a byte.
- `apipos.apiUrl` (get/set) se conserva como alias de `baseUrl` por compatibilidad.
- `new Apipos({ baseUrl, fetch, transformContent, onVersionMismatch })`: `fetch`
  es inyectable (pruebas); por defecto se usa el `fetch` global vigente en cada
  petición. `onVersionMismatch` reemplaza el aviso de versión en consola (ver
  [Versionado](#versionado-en-lockstep-con-apipos)).

Toda petición lleva el header `X-Apipos-Client: apipos-js/<versión>` y toda
respuesta de Apipos trae `X-Apipos-Version`: así cada lado sabe la versión del
otro (handshake). Si no coinciden, la librería avisa en la consola del navegador.

## `transformContent`: preparar el texto antes de imprimir

La librería no toca el texto del ticket. Si tu app necesita limpiarlo (comillas
tipográficas, quitar acentos para tiqueteras sin Latin-1...), pásalo como hook:

```ts
import { Apipos, stripAccentsFromContent } from '@tecsom/apipos-js';

const apipos = new Apipos({
    // Se llama en CADA trabajo (un ajuste cambiado vale desde el siguiente ticket)
    // y debe devolver un arreglo NUEVO: la librería nunca muta lo que recibe.
    transformContent: content => (deviceWantsNoAccents() ? stripAccentsFromContent(content) : content.slice())
});
```

El default es una copia superficial (`content.slice()`). `stripAccents` y
`stripAccentsFromContent` (también en `@tecsom/apipos-js/strip-accents`) quitan
acentos, `ñ`, `¿ ¡` y ordinales sin mover el ancho de las líneas, y no recorren
el base64 de las imágenes.

## Imprimir renderizando en Apipos (`renderer: 'pdf'`)

Con `renderer: 'pdf'` Apipos maqueta el MISMO `content` como un PDF de una sola
página (del alto exacto del ticket) con fuentes del sistema o integradas, y lo
imprime por la ruta PDF (`pdfMode: 'raw'` rasteriza a ESC/POS para tiqueteras;
`'driver'` lo entrega al driver del SO). Así hay tipografías proporcionales,
tamaños en puntos, cursiva, subrayado, columnas de tabla a medida, bloques
`html` y separadores con estilo. Sin `renderer` (o con `'escpos'`) el ticket
sale por ESC/POS como siempre y los campos del renderizador PDF se ignoran.

```ts
import { Apipos } from '@tecsom/apipos-js';
import type { PrintOptions, TicketContent } from '@tecsom/apipos-js';

const apipos = new Apipos();
const printer = apipos.createPrinter('POS80_Kinwodon', { paper_size: 80 });

const ticket: TicketContent = [
    { type: 'image', data: logoBase64, width_mm: 30, align: 'center' },
    { type: 'text', data: 'MI TIENDA S.A.', align: 'center', font_size: 18, font_weight: 'bold' },
    { type: 'text', data: 'PEDIDO #42', align: 'center', high_contrast: true },
    { type: 'separator', style: 'dashed' },
    {
        type: 'table',
        data: {
            columns: [
                { label: 'Cant.', width: 15, align: 'left' },
                { label: 'Producto', width: 45 },
                { label: 'Precio', width: 20, align: 'right' },
                { label: 'Importe', width: 20, align: 'right' }
            ],
            rows: [
                [2, 'Coca Cola 600ml', '$18.00', '$36.00'],
                [1, 'Pan Bimbo', '$45.50', '$45.50']
            ]
        }
    },
    { type: 'separator', style: 'solid', thickness: 1 },
    { type: 'special_text', data: { text1: 'TOTAL', text2: '$81.50' }, font_size: 12, font_weight: 'bold' },
    { type: 'special_text', data: { text1: 'Folio', text2: '000123' }, font_family: 'Courier New' },
    { type: 'spacer', lines: 1 },
    { type: 'text', data: 'Términos en www.mitienda.mx', font_size: 7, font_style: 'italic', underline: true },
    { type: 'spacer', height_mm: 4 },
    { type: 'html', data: '<p style="text-align:center">Gracias por su <b>compra</b></p>' },
    { type: 'open_withdrawer' }
];

const options: PrintOptions = {
    renderer: 'pdf',
    pdfMode: 'raw', // tiquetera; 'driver' para etiqueteras con driver
    font: { family: 'Arial', size: 9, line_height: 1.25 }, // una familia de listFonts() o 'sans-serif' | 'serif' | 'monospace'
    marginsMm: { top: 1, right: 1, bottom: 3, left: 1 },
    cut: true
};

const result = await printer?.print(ticket, options);
// result: { printer, type: 'RAW', renderer: 'pdf', strategy: 'raw', width_dots: 576, cut: true,
//           page_mm: { width: 72, height: 123.4 }, fonts: [...], warnings: [...], drawer_opened: true }
console.warn(result?.warnings); // p. ej. "Font family 'X' is not installed; using sans-serif."
```

Las opciones se copian a `settings` (nunca al nivel raíz del payload), encima de
los `settings` de la impresora, que no se modifican:

| Opción | Clave en `settings` |
|---|---|
| `renderer` | `renderer` (`'escpos'` \| `'pdf'`) |
| `pdfMode` | `pdf_mode` |
| `font` | `font` (`{ family, size, line_height }`) |
| `marginsMm` | `margins_mm` |
| `widthMm` | `width_mm` |
| `maxHeightMm` | `max_height_mm` |
| `cut` | `cut` |
| `settings` | se mezcla al final y gana (escape para claves nuevas del backend) |

- Solo viajan las opciones definidas: `undefined` no viaja (`false` y `0` sí).
- La mezcla es superficial: `font` o `marginsMm` reemplazan completo el objeto
  que traiga la impresora.
- `open_withdrawer` con `renderer: 'pdf'`: Apipos manda el pulso del cajón como
  un segundo trabajo raw tras imprimir el PDF (`drawer_opened: true`).

## Fuentes del sistema

`apipos.listFonts()` → `GET /fonts`: las familias instaladas en la máquina de
Apipos, para elegir `font.family` o el `font_family` de un item. Lanza si
Apipos no responde (a diferencia de `listPrinters`, que devuelve `[]`).

```ts
import { Apipos } from '@tecsom/apipos-js';
import type { FontCatalog } from '@tecsom/apipos-js';

const apipos = new Apipos();

async function fillFontSelect(select: HTMLSelectElement, { refresh = false } = {}): Promise<void> {
    // refresh: true → GET /fonts?refresh=1 (vuelve a escanear, p. ej. tras instalar una fuente).
    const { families, builtin, scannedAt }: FontCatalog = await apipos.listFonts({ refresh });
    // `builtin` (sans-serif, serif, monospace) existe siempre, aunque la máquina no tenga fuentes.
    const names = [...builtin, ...families.map(family => family.family)];
    select.replaceChildren(...names.map(name => new Option(name, name)));
    select.title = `Fuentes escaneadas: ${scannedAt}`;
}
```

`families` viene ordenada por nombre; cada familia trae `monospace` y sus caras
(`faces`: `style`, `bold`, `italic`, `weight`, `full_name`, `path`, `format`...).
También devuelve `count` (número de familias) y `dirs` (directorios escaneados).

## Vista previa

### Real (la pinta Apipos)

`POST /render` maqueta el ticket con el MISMO renderizador PDF que imprime y lo
devuelve sin imprimir (no valida ni toca impresoras). `content` pasa por
`transformContent`, igual que al imprimir.

```ts
import { Apipos, renderTicketPreviewPng } from '@tecsom/apipos-js';

const apipos = new Apipos();

// data URL listo para un <img> (png a 150 dpi por defecto).
const img = document.querySelector<HTMLImageElement>('#ticket-preview');
if (img) {
    img.src = await renderTicketPreviewPng(apipos, ticket, {
        settings: { paper_size: 80, font: { family: 'Arial', size: 9 } },
        dpi: 150
    });
}

// Con los settings de UNA impresora y las mismas opciones que print() (png a 203 dpi por defecto).
const preview = await printer?.render(ticket, { font: { family: 'Arial', size: 9 } });

// O el resultado completo: { format, dpi, base64, pageMm, pages, fonts, warnings, blob }.
const pdf = await apipos.renderTicket(ticket, { settings: { paper_size: 80 }, format: 'pdf' });
window.open(URL.createObjectURL(pdf.blob)); // blob: application/pdf (image/png con format: 'png')
```

- `renderTicket(content, { settings = {}, format = 'pdf', dpi = 203 })`; `dpi`
  (72–600) solo aplica con `png` y en `pdf` el resultado trae `dpi: null`.
- `base64ToBlob(base64, mime)` (base64 puro o data URI) es la misma conversión
  que arma `blob`, por si guardas el `base64` y lo necesitas como archivo.

### Aproximación en pantalla (ESC/POS, sin Apipos)

`@tecsom/apipos-js/ticket-preview` exporta `renderTicketHtml(content, { paperSize })`
(HTML monoespaciado con las columnas del papel: 48 en 80 mm, 32 en 58 mm),
`TICKET_PREVIEW_CSS`, `ticketColumns(paperSize)` y `printTicketHtml(html, { title })`
(imprime desde el navegador en un iframe oculto). No necesita a Apipos, pero es
una aproximación del camino ESC/POS; `renderTicketPreviewPng` (también en ese
subpath) es la vista previa real.

## Tipos

Todos los tipos públicos se exportan desde `@tecsom/apipos-js` (y desde
`@tecsom/apipos-js/types`). Los más usados:

- `TicketContent` / `TicketItem`: unión discriminada por `type` (`text`,
  `special_text`, `table`, `separator`, `image`, `spacer`, `html`,
  `open_withdrawer`) con todos los campos de `APIPOS_API.md`, incluidos los del
  renderizador PDF (`font_family`, `font_size` en puntos, `underline`, columnas
  de tabla...). Un `type` o un valor fuera del contrato no compila.
- `PrintSettings`: los `settings` en el formato del cable (`paper_size`,
  `char_width`, `renderer`, `pdf_mode`, `font`, `margins_mm`, `label_settings`...).
- `PrintOptions` (de `print`), `PrinterRenderOptions` (de `printer.render`),
  `RenderTicketOptions`, `RenderPreviewOptions`, `ListFontsOptions`.
- `FontCatalog` / `FontFamily` / `FontFace`, `RenderResult` / `RenderedFont`,
  `OpenDrawerResult`, `HealthResult`, `HealthData`, `PrintResult`,
  `VersionInfo` / `VersionStatus` / `VersionTuple`, `ApiposOptions`, `FetchLike`...

Los items y `settings` van en snake_case porque viajan tal cual a Apipos; las
opciones propias de la librería y los resultados ya adaptados van en camelCase
(`pdfMode`, `marginsMm`, `labelSettings`, `scannedAt`, `pageMm`).

## Versionado en lockstep con Apipos

La versión de esta librería **siempre** es el `APP_VERSION` de
`Apipos/app-meta.env`; nunca se edita a mano aquí. La sube el usuario en Apipos y
se propaga con:

```bash
npm run sync-version    # app-meta.env → package.json + src/version.ts
npm run check-version   # exit 1 si alguna difiere (antes de un release)
```

Por defecto leen `../Apipos/app-meta.env` (el checkout hermano); con otra ruta:
`node scripts/sync-version.ts --check --from <ruta>`.

Un release publica el mismo tag `vX.Y.Z` en ambos repos: Apipos con sus
instaladores y apipos-js con `release/tecsom-apipos-js-X.Y.Z.tgz` (`npm run pack`).
El checklist completo está en el README de Apipos ("Librería JS (`apipos-js`)").

### Handshake: el aviso en la consola

La librería manda `X-Apipos-Client: apipos-js/<VERSION>` en cada petición y lee
el header `X-Apipos-Version` de cada respuesta de Apipos (también de las de
error). Si las versiones no coinciden, avisa con `console.warn`. El aviso es
informativo: **nunca bloquea ni cancela la petición**, el ticket se imprime igual.

| Aviso en la consola | Qué pasa | Cómo se resuelve |
|---|---|---|
| `[apipos-js] Apipos X.Y.Z es más nuevo que la librería apipos-js A.B.C. Actualiza la librería en el front: ambas deben ir en la misma versión.` | El front trae una librería más vieja que el Apipos de la caja. | Actualiza la dependencia del front a `vX.Y.Z` (`pnpm add -D "github:Tecsom/apipos-js#vX.Y.Z"` o el tarball del release) y, si la sirves sin empaquetador, vuelve a copiar `dist/` a tu carpeta estática. |
| `[apipos-js] La librería apipos-js A.B.C es más nueva que Apipos X.Y.Z instalado en esta máquina. Actualiza Apipos (menú de bandeja → Buscar actualizaciones): ambas deben ir en la misma versión.` | La caja tiene un Apipos más viejo que la librería del front. | Actualiza Apipos en esa máquina: menú de bandeja → "Buscar actualizaciones", o el instalador del release `vA.B.C`. |
| `[apipos-js] Apipos no reporta su versión (falta el header X-Apipos-Version): es anterior a la librería apipos-js A.B.C. Actualiza Apipos en esta máquina.` | El Apipos de la caja es anterior a 1.0.6 (aún no tenía handshake). | Actualiza Apipos en esa máquina, igual que el caso anterior. |

- El aviso sale **una vez por página (por versión distinta de Apipos)**, no en
  cada petición, aunque la app cree varios `new Apipos()` (por ejemplo,
  uno por impresión). Con `onVersionMismatch`, una vez por cliente.
- Las respuestas sin `headers` (dobles de `fetch` en pruebas) no se evalúan.
- Con versiones iguales no hay ningún aviso.

`onVersionMismatch` reemplaza al `console.warn` (por ejemplo, para mostrarlo en
la UI o mandarlo a tu telemetría). Recibe `{ client, backend, status, message }`
una vez por versión distinta de Apipos **en ese cliente** (quien inyecta el hook
controla su propia política); si lanza, el error va a `console.error` y la
petición sigue:

```ts
import { Apipos } from '@tecsom/apipos-js';
import type { VersionInfo } from '@tecsom/apipos-js';

const apipos = new Apipos({
    onVersionMismatch: (info: VersionInfo) => {
        // info.status: 'client_older' | 'client_newer' | 'unknown'
        showBanner(info.message);
    }
});
```

`checkHealth()` devuelve la comparación en `version`, calculada con
`data.version` de `GET /health` (útil en una pantalla de diagnóstico):

```ts
const { ok, version } = await apipos.checkHealth();
if (ok && version?.status !== 'equal') {
    console.info(version?.message);
}
// version: { client, backend, status, message }; null cuando ok es false (sin conexión o error).
```

`checkHealth()` usa el mismo aviso deduplicado: si el header ya avisó esa
versión no se repite, y si la respuesta no trajo headers el aviso sale de
`data.version`.

Las funciones puras del handshake también se exportan:

```ts
import { compareVersions, describeVersions, parseVersion, VERSION } from '@tecsom/apipos-js';

parseVersion('v1.2');                  // [1, 2, 0] (vacío, null o no numérico → null)
compareVersions('1.0.9', '1.0.10');    // 'client_older' (numérico, no de texto)
compareVersions(VERSION, null);        // 'unknown'
describeVersions('1.0.6', '1.0.6');    // { client: '1.0.6', backend: '1.0.6', status: 'equal', message: null }
```

## Desarrollo

Requiere Node ≥ 22.18 (corre las pruebas y los scripts `.ts` directamente, por
type stripping).

```bash
npm install          # instala TypeScript y @types/node (versiones exactas) y compila (prepare)
npm run build        # tsc → dist/ (.js + .d.ts)
npm test             # build + typecheck de pruebas + node --test (las pruebas importan dist/)
npm run typecheck    # tsc sobre src/ y sobre test/ + scripts/
npm run pack         # release/tecsom-apipos-js-<versión>.tgz
```

Reglas del código (`src/`, `test/`, `scripts/`):

- **Sin `any`** en ninguna forma, sin `@ts-ignore` / `@ts-nocheck` /
  `@ts-expect-error`, sin dobles aserciones y sin el operador `!` de no-nulo.
  Lo que llega de la red entra como `unknown` y se valida con guardas de tipo;
  si la forma no cuadra se lanza `Respuesta inesperada de Apipos en <ruta>`.
- Los imports relativos llevan extensión `.js` (`import { request } from './http.js'`)
  para que el navegador cargue `dist/` sin empaquetador.
- `test/fixtures/invalid-usage.ts` es uso inválido a propósito: una prueba
  compila ese archivo y exige que `tsc` lo rechace.
