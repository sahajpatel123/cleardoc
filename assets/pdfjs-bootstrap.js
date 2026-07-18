/* assets/pdfjs-bootstrap.js — configures the PDF.js web worker.
 *
 * Extracted from analyze.html so the page can ship a strict
 * `script-src 'self' https://cdnjs.cloudflare.com https://unpkg.com` CSP
 * without `'unsafe-inline'`. Runs after the PDF.js CDN script tag.
 */
(function () {
  if (window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }
})();