// Uso INVÁLIDO a propósito: test/types.test.ts compila este archivo con tsc y
// exige que falle con exactamente estos tres errores. Demuestra que los tipos
// públicos no aceptan cualquier cosa. Está excluido de tsconfig.test.json.
import type { PrintSettings, TicketItem } from '../../dist/index.js';

// 1) El `data` de un `text` es string, no número.
export const numericText: TicketItem = { type: 'text', data: 1 };

// 2) `font_size` solo acepta normal | md | lg o un número en puntos.
export const unknownFontSize: TicketItem = { type: 'text', data: 'HOLA', font_size: 'xl' };

// 3) `renderer` solo acepta escpos | pdf.
export const unknownRenderer: PrintSettings = { paper_size: 80, renderer: 'zpl' };
