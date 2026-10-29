// Live Quiz, host side: the "Phones can't connect?" panel in the lobby. Plain steps in the order to try them, copyable commands,
// and a field for the address of a tunnel (the last resort). Host page only: phones never load this file.
import { h } from './util.js';
import { icon } from './icons.js';
import { FX } from './fx.js';

const RULE_ADD = 'New-NetFirewallRule -DisplayName "LearnAtHanze live quiz" -Direction Inbound -Protocol TCP -LocalPort 3738 -Action Allow -Profile Private';
const RULE_REMOVE = 'Remove-NetFirewallRule -DisplayName "LearnAtHanze live quiz"';
const TUNNEL = 'cloudflared tunnel --url http://localhost:3738';

/** A command in a box with a copy button (the host page is on localhost, so the clipboard is available). */
function cmd(text) {
  const copy = h('button', { class: 'btn copy', type: 'button', 'aria-label': `Copy: ${text}` }, icon('copy', 14), 'Copy');
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(text); copy.lastChild.textContent = 'Copied'; } catch { copy.lastChild.textContent = 'Select it by hand'; }
    setTimeout(() => { copy.lastChild.textContent = 'Copy'; }, 1800);
  });
  return h('div', { class: 'cmd' }, h('code', null, text), FX.obj(copy, { cls: 'o-btn' }));
}
const step = (n, title, ...body) => h('li', { class: 'hstep' }, h('span', { class: 'warn-badge' }, String(n)), h('div', null, h('strong', null, title), ...body));
const p = (...kids) => h('p', null, ...kids);

export function helpPanel({ act }) {
  // ---- the tunnel address field
  const input = h('input', { class: 'face', type: 'text', placeholder: 'https://something.trycloudflare.com', 'aria-label': 'Tunnel address', autocomplete: 'off', spellcheck: 'false' });
  const use = h('button', { class: 'btn', type: 'button' }, 'Use this address');
  const clear = h('button', { class: 'btn alt', type: 'button' }, 'Stop using it');
  const msg = h('p', { class: 'live-error', role: 'alert' });
  const using = h('p', { class: 'using', role: 'status' });
  const send = async (url) => { msg.textContent = ''; try { await act('public', { url }); if (!url) input.value = ''; } catch (ex) { msg.textContent = ex.message; } };
  use.addEventListener('click', () => send(input.value));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(input.value); } });
  clear.addEventListener('click', () => send(''));
  const clearObj = FX.obj(clear, { cls: 'o-btn' });
  const field = h('div', { class: 'tunnel-field' }, FX.obj(input, { cls: 'o-input', hover: false }), FX.obj(use, { cls: 'o-btn' }), clearObj);

  const panel = h('div', { class: 'notes', id: 'live-help', 'data-open': 'false' }, h('div', null, h('div', { class: 'note-card help' },
    h('h2', null, icon('wifi', 20), "If a phone can't connect"),
    p('Try these in order. Most of the time it is step 1 or 2.'),
    h('ol', { class: 'hsteps' },
      step(1, 'Same Wi-Fi',
        p('The phones and this computer must be on the same Wi-Fi network (not a guest network). Open the address shown above in the phone browser, or scan the QR code, then type the code.'),
        p('If the page will not open, turn mobile data off on the phone for a moment: some phones keep using mobile data when Wi-Fi has no internet.')),
      step(2, 'Windows Firewall',
        p('The first time a game is hosted, Windows asks whether Node.js may use the network. Tick ', h('strong', null, 'Private networks'), ' only (leave Public unticked) and click Allow access.'),
        p('If you clicked Cancel, or ticked Public only, run PowerShell ', h('strong', null, 'as administrator'), ' once. This opens only port 3738 (the phones\' page), never 3737:'),
        cmd(RULE_ADD),
        p('To remove that rule again later:'),
        cmd(RULE_REMOVE),
        p(h('strong', null, 'Private or Public network?'), ' That rule only applies when Windows has marked your Wi-Fi as Private (Settings, Network & internet, Wi-Fi, your network, Network profile type). Public blocks incoming connections, so phones cannot reach the game. Switch a network to Private only if you trust it (your home Wi-Fi). For school or other shared Wi-Fi, use step 3 instead.')),
      step(3, 'Phone hotspot',
        p('School Wi-Fi often blocks phone-to-laptop traffic. Turn on the hotspot on one phone, then connect this computer and the other phones to it. The address above updates by itself a few seconds after this computer joins the new network. If it does not appear, switch "Phones can join" off and on.')),
      step(4, 'Windows Mobile hotspot',
        p('Make this computer the hotspot: Settings, Network & internet, Mobile hotspot, switch it on. The phones join the Wi-Fi network named there. This computer is usually 192.168.137.1 on it, and that address shows up above as another choice. Windows needs a connection to share, so this may not work with every adapter.')),
      step(5, 'Last resort: a tunnel you start by hand',
        p('A tunnel gives the play page an internet address, through a free service you run yourself. This app never starts one. For example, with ', h('code', null, 'cloudflared'), ' installed from Cloudflare:'),
        cmd(TUNNEL),
        p('It prints an https address. Paste it here and the QR code and address above switch to it:'),
        field, msg, using,
        h('div', { class: 'privacy' }, icon('lock', 18), h('div', null,
          h('strong', null, 'What this means for privacy. '),
          'Everything the phones and this computer exchange (nicknames, questions, answers, scores) passes through the tunnel company\'s servers. Anyone who gets the web address can open the join page, so the 5 digit code is the only lock. Only port 3738 is exposed, never 3737, so your course files and your progress stay on this computer. Switching "Phones can join" off does not cut a tunnel: stop the tunnel itself (Ctrl+C in its window) when the game is over.')),
        p('Cloudflare\'s free quick tunnels do not carry live event streams. The phone page notices after a few seconds and switches to a compatible mode by itself, so it works, but answers and screens can arrive a little later.'))))));

  const btn = h('button', { class: 'chip', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'live-help' }, icon('wifi', 14), " Phones can't connect? ", h('span', { class: 'chev' }, icon('chevron-down', 14)));
  btn.addEventListener('click', () => {
    const open = btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', String(open)); panel.dataset.open = String(open);
  });

  return {
    btn, panel,
    update(m) {
      const url = m.net.publicUrl;
      using.textContent = url ? `Phones are told to use ${url.replace(/^https?:\/\//, '')} (QR code included).` : '';
      using.hidden = !url;
      clearObj.hidden = !url;
    },
  };
}
