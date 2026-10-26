/*
 * Tipos públicos de @tecsom/apipos-js.
 *
 * Reflejan el contrato HTTP de Apipos (APIPOS_API.md del repo de Apipos): los
 * items del ticket, los `settings` y las respuestas viajan en el formato del
 * cable (snake_case), tal cual los lee y los escribe el backend. Lo que es de la
 * librería (opciones de métodos, resultados ya adaptados) va en camelCase.
 *
 * Regla de la casa: nada de comodines. Lo que llega de la red entra como
 * `unknown` y se valida con guardas antes de convertirse en uno de estos tipos.
 *
 * Este módulo solo declara tipos: compilado queda vacío.
 */

/* ------------------------------------------------------------------ *
 * Items del ticket (`content` de POST /print y POST /render)
 * ------------------------------------------------------------------ */

/** Alineación horizontal de un renglón o de una imagen. */
export type Align = 'left' | 'center' | 'right';

/** Tamaños con nombre: `normal` = ×1, `md` = ×2 (doble), `lg` = ×3 (triple). */
export type FontSizeKeyword = 'normal' | 'md' | 'lg';

/**
 * Tamaño de letra: un tamaño con nombre o un número en puntos. El número solo
 * lo honra el renderizador PDF (se acota a 4–72); en ESC/POS imprime `normal`.
 */
export type FontSize = FontSizeKeyword | number;

/** Peso de la letra. En PDF, una familia sin cara bold usa negrita sintética. */
export type FontWeight = 'normal' | 'bold';

/** Estilo de la letra (solo renderizador PDF). */
export type FontStyle = 'normal' | 'italic';

/**
 * Tipografía interna de la impresora (comando `ESC M`; solo ESC/POS): `a`
 * 12×24 (universal), `b` 9×17, `c` 8×16 (soporte limitado de firmware). Cambia
 * las columnas del renglón: 48 / 64 / 72 en papel de 80 mm.
 */
export type PrinterTypeface = 'a' | 'b' | 'c';

/** Trazo de un `separator` (solo renderizador PDF; ESC/POS siempre usa guiones). */
export type SeparatorStyle = 'dashed' | 'solid' | 'dotted' | 'double';

/** Campos de estilo que comparten `text` y `special_text`. */
export interface TextStyle {
    /** Default `normal`. Número = puntos (solo PDF). */
    font_size?: FontSize;
    /** Default `normal`. */
    font_weight?: FontWeight;
    /** Fondo negro y texto blanco (default `false`). En PDF es un bloque de ancho completo. */
    high_contrast?: boolean;
    /** Tipografía de la impresora (solo ESC/POS; default `a`). */
    font?: PrinterTypeface;
    /** Familia de `GET /fonts` o de `builtin` (solo PDF; default la de `settings.font`). */
    font_family?: string;
    /** Solo PDF. */
    font_style?: FontStyle;
    /** Solo PDF. */
    underline?: boolean;
    /** Multiplicador de interlineado 0.8–3.0 (solo PDF; sobrescribe el de `settings.font`). */
    line_height?: number;
}

/** Renglón de texto. */
export interface TextItem extends TextStyle {
    type: 'text';
    data: string;
    /** Default `left`. */
    align?: Align;
}

/** Los dos lados de un `special_text`. */
export interface SpecialTextData {
    /** Va a la izquierda (p. ej. `TOTAL`). */
    text1: string;
    /** Va a la derecha (p. ej. `$81.50`). */
    text2: string;
}

/** Renglón con texto a la izquierda y a la derecha (TOTAL, CAMBIO, Folio...). */
export interface SpecialTextItem extends TextStyle {
    type: 'special_text';
    data: SpecialTextData;
}

/** Celda de una fila de tabla; se imprime como texto. */
export type TableCell = string | number;

/** Columna de una tabla (solo renderizador PDF; ESC/POS siempre usa las 4 clásicas). */
export interface TableColumn {
    /** Encabezado. Si todas las columnas lo traen vacío no se dibuja encabezado. */
    label?: string;
    /** Porcentaje del ancho. Si no suman 100 se escalan; las faltantes se reparten el resto. */
    width?: number;
    align?: Align;
}

/** Contenido de una tabla. */
export interface TableData {
    /**
     * Filas de celdas. En ESC/POS cada fila son 4 celdas: cantidad, producto,
     * precio e importe. En PDF las faltantes quedan vacías y las sobrantes se ignoran.
     */
    rows: TableCell[][];
    /** Default (PDF): `Cant./Producto/Precio/Importe` con `15/45/20/20`. */
    columns?: TableColumn[];
}

/** Tabla de productos. */
export interface TableItem {
    type: 'table';
    data: TableData;
    /** Solo PDF. */
    font_family?: string;
    /** Solo PDF. */
    font_style?: FontStyle;
    /** Solo PDF. */
    line_height?: number;
}

/** Línea divisoria. */
export interface SeparatorItem {
    type: 'separator';
    /** Solo PDF; default `dashed` (valor desconocido → `dashed`). */
    style?: SeparatorStyle;
    /** Grosor en pt (solo PDF; default 0.6, se acota a 0.2–3). */
    thickness?: number;
}

/** Imagen (logo, QR...). Se convierte a blanco y negro. */
export interface ImageItem {
    type: 'image';
    /** Imagen PNG/JPG en base64 (puro o data URI). */
    data: string;
    /** Ancho en dots (default 384). */
    width?: number;
    /** Alias de `width`. */
    width_dots?: number;
    /** Ancho en mm (solo PDF; prioridad sobre `width`). */
    width_mm?: number;
    /** Solo PDF (default `center`); ESC/POS siempre la centra. */
    align?: Align;
}

/** Espacio vertical en blanco. */
export interface SpacerItem {
    type: 'spacer';
    /** Entero ≥ 1 (default 1). ESC/POS: saltos de línea, tope 50. */
    lines?: number;
    /** Alto en mm. PDF: prioridad sobre `lines` (0–200). ESC/POS: solo si falta `lines` (~4 mm por línea). */
    height_mm?: number;
}

/** Fragmento HTML (solo renderizador PDF; ESC/POS lo ignora). `<img>` no está soportado. */
export interface HtmlItem {
    type: 'html';
    data: string;
}

/** Abre el cajón de dinero al final del ticket. */
export interface OpenWithdrawerItem {
    type: 'open_withdrawer';
}

/** Un elemento del ticket, discriminado por `type`. */
export type TicketItem =
    | TextItem
    | SpecialTextItem
    | TableItem
    | SeparatorItem
    | ImageItem
    | SpacerItem
    | HtmlItem
    | OpenWithdrawerItem;

/** El ticket completo: lo que recibe `printer.print(content)`. */
export type TicketContent = TicketItem[];

/* ------------------------------------------------------------------ *
 * Settings (formato del cable, snake_case)
 * ------------------------------------------------------------------ */

/** Motor del ticket: `escpos` (default, bytes de siempre) o `pdf` (Apipos maqueta un PDF). */
export type Renderer = 'escpos' | 'pdf';

/**
 * Cómo llega un PDF a la impresora: `driver` (lo renderiza el driver del SO;
 * etiqueteras como AiYin) o `raw` (se rasteriza a ESC/POS; tiqueteras).
 * `document` y `raster` son alias aceptados por compatibilidad.
 */
export type PdfMode = 'raw' | 'driver' | 'raster' | 'document';

/** Unidad de `label_settings` (default `mm`). */
export type LabelUnit = 'mm' | 'inch';

/** Tamaño de la etiqueta; la página del PDF debe medir lo mismo. */
export interface LabelSettings {
    width: number;
    height?: number;
    unit?: LabelUnit;
}

/** Fuente base del renderizador PDF (default `{ family: 'sans-serif', size: 9, line_height: 1.25 }`). */
export interface FontSettings {
    /** Familia de `GET /fonts` o de `builtin`. */
    family?: string;
    /** Puntos, 4–72 (fuera de rango es error del backend). */
    size?: number;
    /** Multiplicador 0.8–3.0 (fuera de rango → 1.25 en silencio). */
    line_height?: number;
}

/** Márgenes en mm del renderizador PDF (default `{ top: 1, right: 1, bottom: 3, left: 1 }`). */
export interface MarginsMm {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
}

/** `settings` de un trabajo de impresión, tal cual viajan a Apipos. */
export interface PrintSettings {
    /** Papel en mm: 80 (48 columnas) o 58 (32). `ApiPosPrinter` lo exige numérico. */
    paper_size?: number;
    /** Columnas explícitas; prioridad sobre `paper_size`. */
    char_width?: number;
    /** Default `escpos`. */
    renderer?: Renderer;
    /** Default `driver` con `label_settings`, si no `raw`. */
    pdf_mode?: PdfMode;
    /** Solo renderizador PDF. */
    font?: FontSettings;
    /** Solo renderizador PDF. */
    margins_mm?: MarginsMm;
    /** Ancho de la página en mm (solo renderizador PDF). */
    width_mm?: number;
    /** Alto máximo del ticket renderizado (default 1000; solo renderizador PDF). */
    max_height_mm?: number;
    /** Corte de papel; default corta en recibos y no en etiquetas. */
    cut?: boolean;
    /** Ancho de raster explícito (p. ej. 512 en cabezales de 180 DPI). */
    width_dots?: number;
    label_settings?: LabelSettings;
    /** Alto máximo de una imagen en dots (default 600); lo más alto se reduce. */
    max_image_height_dots?: number;
    /** Bytes por banda de imagen `GS v 0` (default 1024; 512 si la impresora se descarrila). */
    max_band_bytes?: number;
}

/**
 * `settings` que además admiten claves que la librería aún no tipa: escape para
 * claves nuevas del backend. Las conocidas conservan su tipo (`renderer: 'zpl'`
 * sigue sin compilar).
 */
export type PrintSettingsOverrides = PrintSettings & { [key: string]: unknown };

/* ------------------------------------------------------------------ *
 * Opciones de los métodos de la librería (camelCase)
 * ------------------------------------------------------------------ */

/**
 * Opciones de `printer.print(content, options)`. Cada una se copia a su clave
 * de `settings` (nunca al nivel raíz del payload); las no definidas no viajan.
 * La mezcla es superficial: `font` y `marginsMm` reemplazan completo el objeto
 * de la impresora, no se combinan clave por clave.
 */
export interface PrintOptions {
    /** → `settings.renderer`. */
    renderer?: Renderer;
    /** → `settings.pdf_mode`. */
    pdfMode?: PdfMode;
    /** → `settings.font`. */
    font?: FontSettings;
    /** → `settings.margins_mm`. */
    marginsMm?: MarginsMm;
    /** → `settings.width_mm`. */
    widthMm?: number;
    /** → `settings.max_height_mm`. */
    maxHeightMm?: number;
    /** → `settings.cut`. */
    cut?: boolean;
    /**
     * Se mezcla al final sobre `settings` y gana sobre las opciones de arriba:
     * escape para claves nuevas del backend. Sus claves `undefined` tampoco viajan.
     */
    settings?: PrintSettingsOverrides;
}

/** Opciones de `printer.printPDF(blob, options)`. */
export interface PrintPdfOptions {
    /** → `settings.pdf_mode`. */
    pdfMode?: PdfMode;
    /** → `settings.label_settings`. */
    labelSettings?: LabelSettings;
}

/** Formato de la vista previa de POST /render. */
export type RenderFormat = 'pdf' | 'png';

/** Opciones de `apipos.renderTicket(content, options)`. */
export interface RenderTicketOptions {
    /** `settings` del ticket, como en POST /print (default `{}`). */
    settings?: PrintSettingsOverrides;
    /** Default `pdf`. */
    format?: RenderFormat;
    /** Entero 72–600, solo con `png` (default 203). Con `pdf` Apipos lo ignora. */
    dpi?: number;
}

/** Opciones de `renderTicketPreviewPng(apipos, content, options)`. */
export interface RenderPreviewOptions {
    /** `settings` del ticket, como en POST /print (default `{}`). */
    settings?: PrintSettingsOverrides;
    /** Entero 72–600 (default 150). */
    dpi?: number;
}

/** Opciones de `printer.render(content, options)`: las de `print` más formato y dpi. */
export interface PrinterRenderOptions extends PrintOptions {
    /** Default `png`. */
    format?: RenderFormat;
    /** Default 203. */
    dpi?: number;
}

/** Opciones de `apipos.listFonts(options)`. */
export interface ListFontsOptions {
    /** `true` → `?refresh=1`: Apipos vuelve a escanear las fuentes. */
    refresh?: boolean;
}

/* ------------------------------------------------------------------ *
 * Respuestas de Apipos
 * ------------------------------------------------------------------ */

/** Valor de `status` del sobre de respuesta. */
export type EnvelopeStatus = 'success' | 'error';

/** Sobre de TODA respuesta de Apipos: `{ status, data, message }`. */
export interface ApiposEnvelope<T> {
    status: EnvelopeStatus;
    data: T;
    message: string;
}

/**
 * Resultado de comparar versiones cliente/backend: `equal`, `client_older` (la
 * librería es más vieja que Apipos), `client_newer` (la librería es más nueva) o
 * `unknown` (Apipos no reporta una versión comparable).
 */
export type VersionStatus = 'equal' | 'client_older' | 'client_newer' | 'unknown';

/** Versión numérica `[major, minor, patch]` (de `parseVersion`). */
export type VersionTuple = [major: number, minor: number, patch: number];

/** `data.client` de GET /health: cómo vio Apipos el header `X-Apipos-Client`. */
export interface ServerClientStatus {
    /** Nombre del cliente; `null` si el header no se reconoció (`unknown`). */
    name: string | null;
    /** Versión del cliente; `null` si el header no se reconoció (`unknown`). */
    version: string | null;
    /** Versión de Apipos. */
    server: string;
    status: VersionStatus;
    /** Mensaje en inglés del backend (p. ej. `Client and server versions match.`). */
    message: string;
}

/** `data` de GET /health. */
export interface HealthData {
    /** `ok` cuando el servicio está arriba. */
    status: string;
    /** Versión de Apipos (falta en Apipos anteriores a 1.0.6). */
    version?: string;
    /** `Windows` | `Darwin` | `Linux`. */
    os: string;
    /** `win32` | `darwin` | ... */
    platform: string;
    /** Backend de impresoras activo (p. ej. `MacPrinterBackend`). */
    backend: string;
    port: number;
    /** Handshake; `null` sin header `X-Apipos-Client`; falta en Apipos anteriores a 1.0.6. */
    client?: ServerClientStatus | null;
}

/**
 * Comparación de versiones hecha por la librería (`describeVersions`): su
 * `VERSION` contra la que reporta Apipos (header `X-Apipos-Version` o
 * `data.version` de GET /health).
 */
export interface VersionInfo {
    /** Versión de esta librería. */
    client: string;
    /** Versión que reporta Apipos, tal cual llegó; `null` si no la reporta. */
    backend: string | null;
    status: VersionStatus;
    /** Aviso EXACTO para la consola (empieza con `[apipos-js]`); `null` cuando las versiones coinciden. */
    message: string | null;
}

/** Resultado de `apipos.checkHealth()`: nunca lanza, `ok = false` ante cualquier error. */
export interface HealthResult {
    ok: boolean;
    data: HealthData | null;
    /**
     * `describeVersions(VERSION, data.version)`: la versión de esta librería
     * contra la de Apipos. `null` cuando no hubo respuesta válida (`ok: false`
     * por error de conexión, sobre de error o forma inesperada).
     */
    version: VersionInfo | null;
}

/** Formato de archivo de una cara de fuente. */
export type FontFormat = 'ttf' | 'otf' | 'ttc' | 'otc';

/** Una cara (estilo) de una familia instalada, tal cual la reporta GET /fonts. */
export interface FontFace {
    style: string;
    bold: boolean;
    italic: boolean;
    /** Peso OpenType: 400 normal, 700 negrita (`bold` desde 600). */
    weight: number;
    full_name: string;
    postscript_name: string | null;
    path: string;
    /** Posición de la cara dentro de un `.ttc`/`.otc` (0 en archivos de una cara). */
    index: number;
    format: FontFormat;
}

/** Familia de fuentes instalada. */
export interface FontFamily {
    family: string;
    /** `true` si todas sus caras son de ancho fijo. */
    monospace: boolean;
    faces: FontFace[];
}

/** `data` de GET /fonts tal cual llega del backend. */
export interface FontCatalogData {
    families: FontFamily[];
    count: number;
    /** Familias genéricas que el renderizador acepta siempre. */
    builtin: string[];
    dirs: string[];
    scanned_at: string;
}

/** Catálogo de fuentes que devuelve `apipos.listFonts()`. */
export interface FontCatalog {
    families: FontFamily[];
    /** Número de familias. */
    count: number;
    /** `sans-serif`, `serif`, `monospace`: existen aunque la máquina no tenga fuentes. */
    builtin: string[];
    /** Directorios escaneados que existen en la máquina. */
    dirs: string[];
    /** Fecha y hora local del último escaneo (ISO 8601). */
    scannedAt: string;
}

/** De dónde salió una fuente usada por el renderizador PDF. */
export type FontSource = 'system' | 'builtin' | 'fallback';

/** Fuente pedida por el ticket y lo que se usó realmente. */
export interface RenderedFont {
    family: string;
    resolved: string;
    source: FontSource;
    bold: boolean;
    italic: boolean;
}

/** Tamaño de la página renderizada en mm (el alto es el del contenido). */
export interface PageSizeMm {
    width: number;
    height: number;
}

/** `data` de POST /render tal cual llega del backend. */
export interface RenderData {
    format: RenderFormat;
    /** `null` con `pdf`. */
    dpi: number | null;
    base64: string;
    page_mm: PageSizeMm;
    pages: number;
    fonts: RenderedFont[];
    warnings: string[];
}

/** Vista previa que devuelve `apipos.renderTicket()`. */
export interface RenderResult {
    format: RenderFormat;
    dpi: number | null;
    /** PDF (`JVBERi...`) o PNG (`iVBORw0KGgo...`) en base64. */
    base64: string;
    pageMm: PageSizeMm;
    pages: number;
    fonts: RenderedFont[];
    warnings: string[];
    /** `application/pdf` o `image/png`. */
    blob: Blob;
}

/**
 * `data` de POST /print. Los campos dependen del tipo de trabajo: ESC/POS →
 * `char_width`; PDF `raw` → `strategy`, `width_dots`, `cut`; PDF `driver` →
 * `strategy`, `media`; `renderer: 'pdf'` agrega `renderer`, `page_mm`, `fonts`,
 * `warnings` y `drawer_opened`.
 */
export interface PrintResult {
    printer: string;
    type?: 'RAW' | 'PDF';
    char_width?: number;
    strategy?: 'raw' | 'driver';
    width_dots?: number;
    cut?: boolean;
    media?: string | null;
    renderer?: 'pdf';
    page_mm?: PageSizeMm;
    fonts?: RenderedFont[];
    warnings?: string[];
    drawer_opened?: boolean;
}

/** `data` de POST /open-withdrawer: la impresora a la que se mandó el pulso del cajón. */
export interface OpenDrawerResult {
    printer: string;
}

/* ------------------------------------------------------------------ *
 * Configuración del cliente y red
 * ------------------------------------------------------------------ */

/** Hook que recibe el `content` de cada trabajo y devuelve el que se envía (arreglo nuevo). */
export type ContentTransform = (content: TicketContent) => TicketContent;

/** Opciones de `new Apipos(options)`. */
export interface ApiposOptions {
    /** Default `http://127.0.0.1:50432`. */
    baseUrl?: string;
    /**
     * Se aplica al `content` en CADA trabajo; debe devolver un arreglo nuevo (la
     * librería no muta la entrada). Default: copia superficial. Aquí se
     * puede inyectar una limpieza de texto o el interruptor "sin acentos".
     */
    transformContent?: ContentTransform;
    /**
     * Reemplaza el aviso por defecto (`console.warn(info.message)`) cuando la
     * versión de Apipos difiere de la de la librería. El aviso por defecto sale
     * una vez por página por cada versión distinta de Apipos (aunque haya varios
     * clientes); este hook, una vez por versión distinta en ESTE cliente (no en
     * cada petición). Si lanza, el error va a `console.error` y la petición sigue.
     */
    onVersionMismatch?: (info: VersionInfo) => void;
    /** Inyectable para pruebas. Default: el `fetch` global. */
    fetch?: FetchLike;
}

/** Métodos HTTP que usa la librería. */
export type HttpMethod = 'GET' | 'POST';

/** Lo que la librería le pasa a `fetch` como segundo argumento. */
export interface RequestInitLike {
    method: HttpMethod;
    headers: Record<string, string>;
    body?: string;
}

/** Lo mínimo que se lee de los headers de una respuesta. */
export interface HeadersLike {
    get(name: string): string | null;
}

/** Lo mínimo que se lee de una respuesta de `fetch` (un `Response` real lo cumple). */
export interface ResponseLike {
    ok: boolean;
    status: number;
    statusText: string;
    /** Opcional: los dobles de `fetch` de las pruebas pueden no traerlos. */
    headers?: HeadersLike;
    json(): Promise<unknown>;
}

/** Firma de `fetch` que usa la librería; `globalThis.fetch` es asignable a ella. */
export type FetchLike = (url: string, init: RequestInitLike) => Promise<ResponseLike>;

/** Valor de un parámetro de query: `null`/`undefined` no viajan; `true` → `1`, `false` → `0`. */
export type QueryValue = string | number | boolean | null | undefined;

/** Tercer argumento de `apipos.request(method, path, options)`. */
export interface RequestOptions {
    /** Se serializa con `JSON.stringify` y agrega `Content-Type: application/json`. */
    body?: object;
    query?: Readonly<Record<string, QueryValue>>;
}

/** Contexto de red de `request()`: a dónde, con qué `fetch` y a quién avisarle la versión. */
export interface RequestContext {
    baseUrl: string;
    fetch: FetchLike;
    /**
     * Handshake: recibe `describeVersions(VERSION, X-Apipos-Version)` en cada
     * respuesta que trae `headers` (también las de error). El `Apipos` decide si
     * avisa; las respuestas sin `headers` (dobles de prueba) no lo llaman.
     */
    onVersion?: (info: VersionInfo) => void;
}
