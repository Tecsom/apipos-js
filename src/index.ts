// API pública de @tecsom/apipos-js. Lo que no se exporta aquí (ni en los
// subpaths de package.json) es interno y puede cambiar sin aviso.
export { Apipos } from './apipos.js';
export { ApiPosPrinter } from './printer.js';
export { VERSION, CLIENT_NAME } from './version.js';
export { parseVersion, compareVersions, describeVersions } from './version-check.js';
export { ApiposError, base64ToBlob } from './http.js';
export { stripAccents, stripAccentsFromContent } from './strip-accents.js';
export {
    ticketColumns,
    TICKET_PREVIEW_CSS,
    renderTicketHtml,
    printTicketHtml,
    renderTicketPreviewPng
} from './ticket-preview.js';
export type * from './types.js';
