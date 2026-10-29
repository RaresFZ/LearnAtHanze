// Tiny DOM helpers. All text goes through textContent / text nodes, so content files can never inject HTML.
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') {
      for (const [prop, val] of Object.entries(v)) {
        if (prop.startsWith('--')) el.style.setProperty(prop, val); else el.style[prop] = val;
      }
    }
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function mount(parent, ...nodes) {
  parent.replaceChildren(...nodes.flat(Infinity).filter(Boolean));
}

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const pct = (num, den) => (den ? Math.round((num / den) * 100) : 0);

/** Today's local date as YYYY-MM-DD, for file names. */
export function dateStamp(d = new Date()) {
  const two = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

/** Saves text as a JSON file. The name always ends in .json. */
export function download(filename, text) {
  const name = /\.json$/i.test(filename) ? filename : `${filename}.json`;
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = h('a', { href: url, download: name, style: { display: 'none' } });
  document.body.append(a);
  a.click();
  a.remove();
  // Do not revoke at once: the browser starts the save a moment later, and a revoked address can end up saved under a random name with no extension.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
