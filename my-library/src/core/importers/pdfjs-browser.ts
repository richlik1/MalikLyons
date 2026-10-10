// Browser loader for PDF.js. The "legacy" build supports older Safari
// versions (iOS 15/16) that the modern build does not.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import type { PdfjsLike } from './pdf';

let configured = false;

export async function loadPdfjs(): Promise<PdfjsLike> {
  if (!configured) {
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    configured = true;
  }
  return pdfjs as unknown as PdfjsLike;
}

/** Asset locations served from the app itself (never a CDN), so it works offline. */
export function pdfDocOptions(): Record<string, unknown> {
  const base = new URL('pdfjs/', document.baseURI).href;
  return { cMapUrl: `${base}cmaps/`, cMapPacked: true, standardFontDataUrl: `${base}standard_fonts/` };
}
