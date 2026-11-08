// "Study on your phone" (#/phone, only on the computer): switch the read-only phone copy of the app on and off, show its address and a QR code.
// The phone copy itself is the same app served by server/phone.js; progress on the phone stays in the phone's browser.
import { h, mount } from './util.js';
import { icon } from './icons.js';
import { FX } from './fx.js';
import { loadQr, qrSvg } from './qr.js';

async function call(path, body) {
  const res = await fetch(path, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const step = (n, title, ...body) => h('li', { class: 'phone-step' }, h('span', { class: 'phone-n' }, String(n)), h('div', null, h('h3', null, title), ...body));

export async function renderPhone(root) {
  const box = h('div', { class: 'phone-status' });
  const msg = h('p', { class: 'fine', role: 'status', style: { marginTop: '12px' } });
  let st = await call('/api/phone/status').catch(() => null);
  let picked = 0;

  async function toggle(on) {
    msg.textContent = on ? 'Starting. If Windows asks about the network, allow it for private networks.' : '';
    try { st = await call(on ? '/api/phone/start' : '/api/phone/stop', {}); msg.textContent = ''; } catch (e) { msg.textContent = e.message; }
    draw();
  }

  async function newCode() {
    try { st = await call('/api/phone/rotate', {}); msg.textContent = 'Done. Phones paired before have to scan the new code to share progress again.'; } catch (e) { msg.textContent = e.message; }
    draw();
  }

  function draw() {
    if (!st) { box.replaceChildren(h('p', null, 'The app could not tell whether phone access is on. Reload the page.')); return; }
    if (!st.on) {
      const startBtn = h('button', { class: 'btn yellow xl', type: 'button', onclick: () => toggle(true) }, icon('smartphone', 22), 'Turn on phone access');
      box.replaceChildren(
        h('p', { class: 'phone-state off' }, 'Phone access is off'),
        h('p', null, 'Nothing on this computer can be reached from the network right now.'),
        st.forcedOff ? h('p', { class: 'fine' }, 'The app was started with LIVE_LAN=off, so the network stays closed. Start it without that setting to use your phone.') : FX.obj(startBtn, { cls: 'o-btn' }));
      return;
    }
    const urls = st.addresses;
    const target = urls[Math.min(picked, urls.length - 1)];
    const qrBox = h('div', { class: 'qr-tile' + (target ? '' : ' empty') }, target ? '' : 'No network address');
    if (target) loadQr().then(() => qrBox.replaceChildren(qrSvg(target.pairUrl || target.url, 'QR code that opens the study app on your phone and pairs it'))).catch(() => { qrBox.className = 'qr-tile empty'; qrBox.textContent = 'QR failed to load'; });
    const stopBtn = h('button', { class: 'btn', type: 'button', onclick: () => toggle(false) }, 'Turn off phone access');
    box.replaceChildren(
      h('p', { class: 'phone-state on' }, st.lan ? 'Phone access is on' : 'Phone access is on (this computer only)'),
      h('div', { class: 'phone-open' },
        qrBox,
        h('div', null,
          target ? h('p', { class: 'phone-url' }, target.url.replace(/^http:\/\//, '')) : h('p', null, 'This computer has no Wi-Fi or cable address. Connect it to your network and press Turn off, then on.'),
          urls.length > 1 ? h('div', { class: 'phone-pick' }, h('p', { class: 'fine' }, 'More than one network found. Use the one your phone is on:'),
            ...urls.map((a, i) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(i === picked), onclick: () => { picked = i; draw(); } }, `${a.name}: ${a.address}`))) : null,
          h('p', { class: 'fine' }, `Scan the code with the phone camera. The code also pairs the phone with this computer, so your progress is shared. Typing the address works too, but then the phone is not paired. It switches itself off after ${st.idleHours} hours without use, and when you stop the app.`),
          h('div', { class: 'tools-row' }, FX.obj(stopBtn, { cls: 'o-btn' }), FX.obj(h('button', { class: 'btn alt', type: 'button', onclick: newCode }, 'New pairing code'), { cls: 'o-btn' })))));
  }
  draw();

  mount(root,
    h('a', { class: 'back', href: '#/' }, icon('arrow-left', 16), ' Home'),
    h('h1', { class: 'pagetitle' }, 'Study on your phone'),
    h('p', { class: 'lead' }, 'Open the whole app on your phone, for example to learn in bed. It is the same app: lessons, quiz, flashcards, simulation, cheat sheet.'),
    h('section', { class: 'card phone-card', 'aria-label': 'Phone access' }, box, msg),
    h('h2', { class: 'phone-h' }, 'How to get it on your phone'),
    h('ol', { class: 'phone-steps' },
      step(1, 'Same Wi-Fi', h('p', null, 'The phone and this computer must be on the same Wi-Fi network (not a guest network), and this computer must stay on and awake.')),
      step(2, 'Turn on phone access above', h('p', null, 'The first time, Windows asks if the app may use the network. Choose Private networks and press Allow.')),
      step(3, 'Open it on the phone', h('p', null, 'Scan the QR code with the phone camera (Chrome or Safari). The code opens the app and pairs the phone, so your progress is shared.')),
      step(4, 'Put it on the home screen', h('p', null, 'Do this from the page you opened with the QR code. iPhone: Share button, then Add to Home Screen. Android: the three dots, then Add to Home screen (or Install app). You get an icon that opens the app full screen.'))),
    h('h2', { class: 'phone-h' }, 'Good to know'),
    h('ul', { class: 'phone-notes' },
      h('li', null, 'Your progress is the same on the phone and on the computer. Each device sends what you did to this computer and shows the sum of all your devices, so nothing is counted twice and one device never overwrites the other. It syncs a few seconds after you answer, when you open the app, and with Sync now at the bottom of an exam page. Reset and Import progress apply to all your devices.'),
      h('li', null, 'The progress of all devices is kept in the file .lah-sync.json in the app folder (it is not uploaded anywhere and not part of the repository). Sync needs this computer: without it each device keeps its own part and they join again later.'),
      h('li', null, 'While phone access is on, anyone on the same Wi-Fi who knows the address can open the app. They can only read the study material, not change anything or see your progress. Turn it off when you are done.'),
      h('li', null, 'If the computer restarts, or the Wi-Fi gives it another address, scan the new code and add the home screen icon again.'),
      h('li', null, 'The Live Quiz host screen stays on the computer. On the phone you study alone.')));
  FX.enter([...root.querySelectorAll('.phone-card, .phone-steps li')], { delay: FX.base(), stagger: 0.05 });
}
