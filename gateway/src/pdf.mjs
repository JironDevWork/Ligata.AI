import { getDocument, VerbosityLevel } from 'pdfjs-dist/legacy/build/pdf.mjs';

export class DocumentError extends Error {
  constructor(code, message) { super(message); this.code = code; this.status = 422; }
}

/**
 * Extracts plain text from a PDF held in memory. Nothing is written to disk.
 * Scripting, font evaluation and external resources are disabled.
 */
export async function pdfToText(bytes, { maxPages = 80 } = {}) {
  if (bytes.length < 5 || bytes.subarray(0, 5).toString('latin1') !== '%PDF-') throw new DocumentError('invalid_pdf', 'This file is not a PDF.');
  let pdf;
  const task = getDocument({
      data: new Uint8Array(bytes), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, enableXfa: false,
      stopAtErrors: false, verbosity: VerbosityLevel.ERRORS, isOffscreenCanvasSupported: false,
  });
  try {
    pdf = await task.promise;
  } catch (error) {
    await task.destroy();
    if (error?.name === 'PasswordException') throw new DocumentError('pdf_encrypted', 'This PDF is password-protected. Remove the password and upload it again.');
    throw new DocumentError('invalid_pdf', 'This PDF could not be read.');
  }
  try {
    const pages = Math.min(pdf.numPages, maxPages);
    const parts = [];
    for (let number = 1; number <= pages; number++) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if (!('str' in item)) continue;
        text += item.str + (item.hasEOL ? '\n' : item.str && !item.str.endsWith(' ') ? ' ' : '');
      }
      page.cleanup();
      text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
      if (text) parts.push(`--- Page ${number} ---\n${text}`);
    }
    const text = parts.join('\n\n');
    if (!text.replace(/--- Page \d+ ---/g, '').trim()) throw new DocumentError('pdf_no_text', 'This PDF contains no readable text (it may be scanned). Upload screenshots of the pages instead.');
    return { text, pages: pdf.numPages, pagesRead: pages, truncated: pdf.numPages > pages };
  } finally {
    await task.destroy();
  }
}
