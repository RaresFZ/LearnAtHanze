// A QR code drawn as inline SVG (black on white, whatever the theme). Used by the Live Quiz lobby and "Study on your phone".
let qrLoad = null;
export const loadQr = () => (qrLoad ||= new Promise((resolve, reject) => {
  if (window.qrcode) return resolve();
  const s = document.createElement('script');
  s.src = 'vendor/qrcode.js'; s.onload = resolve; s.onerror = () => reject(new Error('QR code library failed to load'));
  document.head.append(s);
}));

/** The QR code for `text` as an SVG element, drawn from the module matrix. Call loadQr() first. */
export function qrSvg(text, label = 'QR code') {
  const qr = window.qrcode(0, 'M'); qr.addData(text); qr.make();
  const n = qr.getModuleCount(), pad = 2, size = n + pad * 2;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', label);
  const bg = document.createElementNS(ns, 'rect'); bg.setAttribute('width', size); bg.setAttribute('height', size); bg.setAttribute('fill', '#ffffff');
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + pad} ${r + pad}h1v1h-1z`;
  const path = document.createElementNS(ns, 'path'); path.setAttribute('d', d); path.setAttribute('fill', '#141414');
  svg.append(bg, path);
  return svg;
}
