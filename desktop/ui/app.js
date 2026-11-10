/* Deckwell editor. Talks to the C# host over WebView2 postMessage; falls back to demo mode in a plain browser. */
'use strict';
const G = window.GLYPHS;
const svg = (n, sw) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw || 2}" stroke-linecap="round" stroke-linejoin="round">${G[n] || ''}</svg>`;
const gi = n => `<span data-g="${n}">${svg(n)}</span>`;
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);
const clone = o => JSON.parse(JSON.stringify(o));
function hydrate(root) { (root || document).querySelectorAll('[data-g]').forEach(el => { if (!el.firstChild) el.innerHTML = svg(el.dataset.g); }); }

/* ---------------- deck geometry (shared with the Android/iOS deck apps, 1920x1200 design units; 1200x1920 in portrait) ---------------- */
const DECK = { W: 1920, H: 1200, pad: 37, top: 132, bottomReserve: 178, gap: 28, stripGap: 60, sliderW: 92, sliderGap: 50, maxSliders: 6, PW: 1200, PH: 1920 };
/** Width of a slider strip with n sliders. 3 sliders = 376, the original fixed strip. */
const stripW = n => n * DECK.sliderW + Math.max(0, n - 1) * DECK.sliderGap;
const stripSide = p => p.sliders === 'left' || p.sliders === 'right' ? p.sliders : null;
/** Size of a key in grid cells. Now Playing is 2 wide; a panel is pw x ph. */
const sizeOf = k => k.type === 'nowplaying' ? { w: 2, h: 1 } : k.type === 'panel' ? { w: Math.max(1, Math.min(4, k.pw || 2)), h: Math.max(1, Math.min(3, k.ph || 2)) } : { w: 1, h: 1 };
const portraitView = () => S.view === 'portrait';
/** What the deck shows for a page in portrait: the grid from portrait.js (same steps as the deck app). */
function portraitOf(p) {
  const b = backPos(p);
  const keys = p.keys.filter(k => k.row < p.rows && k.col < p.cols && !coversBack(p, k)).map(k => { const z = sizeOf(k); return { id: k.id, row: k.row, col: k.col, w: Math.min(z.w, p.cols - k.col), h: Math.min(z.h, p.rows - k.row) }; });
  if (b) keys.unshift({ id: '__back', row: b.row, col: b.col, w: 1, h: 1 });
  return window.portraitGrid(keys, p.cols, p.rows, p.porder === 'mirror' ? 'mirror' : 'reading');
}
function geom(p) {
  if (portraitView()) return geomPortrait(p);
  const side = stripSide(p);
  const n = side ? Math.max(1, Math.min(DECK.maxSliders, p.strip.length)) : 0;
  const sw = side ? stripW(n) : 0;
  const availW = DECK.W - 2 * DECK.pad - (side ? sw + DECK.stripGap : 0);
  const availH = DECK.H - DECK.top - DECK.bottomReserve;
  const w = (availW - (p.cols - 1) * DECK.gap) / p.cols;
  let h = (availH - (p.rows - 1) * DECK.gap) / p.rows;
  h = Math.min(h, w);
  return { strip: !!side, side, n, sw, w, h, availW, gridH: p.rows * h + (p.rows - 1) * DECK.gap,
    gridX: side === 'left' ? sw + DECK.stripGap : 0, gridY: 0, stripX: side === 'left' ? 0 : availW + DECK.stripGap,
    totalW: availW + (side ? DECK.stripGap + sw : 0), totalH: p.rows * h + (p.rows - 1) * DECK.gap, cols: p.cols, rows: p.rows };
}
/** Portrait: rows and columns swap, and the sliders run across the top or bottom (each slider is one row). */
function geomPortrait(p) {
  const side = stripSide(p) ? (p.pside === 'top' ? 'top' : 'bottom') : null;
  const n = side ? Math.max(1, Math.min(DECK.maxSliders, p.strip.length)) : 0;
  const sh = side ? stripW(n) : 0;
  const pg = portraitOf(p);
  const availW = DECK.PW - 2 * DECK.pad;
  const availH = DECK.PH - DECK.top - DECK.bottomReserve - (side ? sh + DECK.stripGap : 0);
  const w = (availW - (pg.cols - 1) * DECK.gap) / pg.cols;
  const h = Math.min((availH - (pg.rows - 1) * DECK.gap) / pg.rows, w);
  const gridH = pg.rows * h + (pg.rows - 1) * DECK.gap;
  return { strip: !!side, side, n, sw: availW, sh, w, h, availW, gridH, gridX: 0, gridY: side === 'top' ? sh + DECK.stripGap : 0,
    stripX: 0, stripY: side === 'top' ? 0 : gridH + DECK.stripGap, totalW: availW, totalH: gridH + (side ? sh + DECK.stripGap : 0), cols: pg.cols, rows: pg.rows, pg };
}

/* ---------------- bridge ---------------- */
const HOST = !!(window.chrome && window.chrome.webview);
const listeners = {}; const pending = {}; let reqId = 0;
function on(ev, f) { (listeners[ev] = listeners[ev] || []).push(f); }
function emit(ev, d) { (listeners[ev] || []).forEach(f => { try { f(d); } catch (e) { console.error(e); } }); }
function call(cmd, args) {
  if (!HOST) return Demo.call(cmd, args || {});
  return new Promise((res, rej) => { const id = ++reqId; pending[id] = { res, rej }; window.chrome.webview.postMessage({ id, cmd, args: args || {} }); });
}
if (HOST) window.chrome.webview.addEventListener('message', e => {
  const m = e.data;
  if (m && m.id && pending[m.id]) { const p = pending[m.id]; delete pending[m.id]; m.error ? p.rej(new Error(m.error)) : p.res(m.result); }
  else if (m && m.event) emit(m.event, m.data);
});
const iconUrl = id => id ? (HOST ? `https://app.deckwell/icons/${id}.png` : (Demo.icons[id] || '')) : '';

/* ---------------- state ---------------- */
const S = {
  cfg: null, pageId: null, sel: null, // sel: {t:'key', id} | {t:'slider', i}
  dev: { connected: false, link: null, rtt: 0, ip: '', usb: false, name: '', model: '', adb: true, pairState: '', pairError: '', deckApproved: false },
  live: { np: null, status: {}, panel: {}, sliders: {} }, sessions: [], hist: [], fut: [], sync: 'ok', recording: false,
  view: 'landscape', monitors: [], wtProfiles: null,
};
const page = id => S.cfg.pages.find(p => p.id === (id || S.pageId));
const curPage = () => page(S.pageId);
const rootOf = p => { while (p && p.parentId) p = page(p.parentId); return p; };
const selKey = () => S.sel && S.sel.t === 'key' ? curPage().keys.find(k => k.id === S.sel.id) : null;
const hostById = id => S.cfg.hosts.find(h => h.id === id);

/* ---------------- default config ---------------- */
/** A fresh install starts empty: one page, no keys, no hosts. Nothing is preset. */
function defaultConfig() {
  return { version: 1, deckIp: '', orient: 'landscape', hosts: [], pages: [{ id: 'main', name: 'Main', parentId: null, cols: 5, rows: 3, sliders: 'off', strip: [null, null, null], keys: [] }] };
}

/* ---------------- key faces (what the deck draws) ---------------- */
const MEDIA = {
  playpause: { g: 'play-pause', n: 'Play', lab: 'Play / Pause' }, next: { g: 'skip-forward', n: 'Next', lab: 'Next' },
  prev: { g: 'skip-back', n: 'Prev', lab: 'Previous' }, stop: { g: 'stop', n: 'Stop', lab: 'Stop' },
  volup: { g: 'vol-up', n: 'Vol +', lab: 'Volume up' }, voldown: { g: 'vol-down', n: 'Vol −', lab: 'Volume down' },
  mute: { g: 'volume-x', n: 'Mute', lab: 'Mute' }, mic: { g: 'mic-off', n: 'Mic', lab: 'Mic' },
};
const CAPSYM = { Ctrl: 'Ctrl', Shift: '⇧', Alt: 'Alt', Win: '⊞' };
const KEYWORDS = [[/restart|reload/, 'rotate-cw'], [/reboot|shutdown|power/, 'power'], [/pull|update|upgrade|deploy/, 'arrow-down-up'],
  [/prune|clean|purge/, 'broom'], [/backup|sync/, 'cloud-upload'], [/wake|wol/, 'zap'], [/scrub|pool|zfs|storage|disk/, 'server'],
  [/gpu|cpu/, 'cpu'], [/log|tail/, 'file-terminal'], [/uptime|time/, 'clock'], [/docker|container/, 'container']];
function monogram(label) {
  const w = String(label || '?').trim().split(/\s+/);
  if (w.length > 1) return (w[0][0] + w[1][0]).toUpperCase();
  const s = w[0]; return s === s.toUpperCase() ? s.slice(0, 2) : s[0].toUpperCase() + (s[1] || '');
}
function faceOf(k, p) {
  const f = { glyph: null, caps: null, sub: null, mono: null };
  const isFolderPage = !!(p && p.parentId);
  switch (k.type) {
    case 'app': f.mono = monogram(k.label); break;
    case 'hotkey': f.caps = (k.keys || []).map(c => CAPSYM[c.n] || c.n); if (!f.caps.length) f.glyph = 'keyboard'; break;
    case 'media': f.glyph = (MEDIA[k.media] || MEDIA.playpause).g; break;
    case 'url': f.glyph = 'globe'; if (isFolderPage) f.sub = 'url'; break;
    case 'script': f.glyph = k.runtime === 'python' ? 'file-py' : 'terminal'; if (isFolderPage) f.sub = k.runtime === 'python' ? 'python' : 'powershell'; break;
    case 'ssh': {
      const l = (k.label + ' ' + (k.command || '')).toLowerCase();
      f.glyph = (KEYWORDS.find(([re]) => re.test(l)) || [0, 'square-terminal'])[1];
      if (isFolderPage) { const h = hostById(k.hostId); f.sub = h ? h.name : 'no host'; }
      break;
    }
    case 'folder': f.glyph = 'folder'; break;
    case 'goto': f.glyph = 'goto'; if (isFolderPage) { const t = page(k.target); f.sub = t ? t.name : ''; } break;
    case 'back': f.glyph = 'back'; f.sub = k.sub; break;
    case 'terminal': f.glyph = 'square-terminal'; if (isFolderPage) f.sub = (TERM_PROGRAMS.find(x => x[0] === k.program) || TERM_PROGRAMS[0])[2]; break;
    case 'termsend': f.glyph = 'code'; break;
    case 'snap': f.glyph = 'app-window'; if (isFolderPage) f.sub = spotName(k.spot, k.monitor); break;
    case 'winpick': f.glyph = 'grid'; break;
    case 'layout': f.glyph = 'monitor'; if (isFolderPage) f.sub = `${(k.windows || []).length} windows`; break;
  }
  if (k.glyph && !['app', 'hotkey', 'status', 'nowplaying'].includes(k.type)) f.glyph = k.glyph;
  return f;
}

/* ---------------- key face HTML at deck scale ---------------- */
function fmtTime(s) { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function keyFaceHTML(k, p) {
  if (k.type === 'nowplaying') {
    const np = S.live.np;
    const art = np && np.art ? `<img src="${esc(np.art)}">` : 'album art';
    const pct = np && np.dur ? Math.min(100, 100 * np.pos / np.dur) : 0;
    return `<div class="art">${art}</div><div class="np-meta"><div class="np-kicker">NOW PLAYING</div>
      <div class="np-title">${esc(np ? np.title : 'Nothing playing')}</div>
      <div class="np-artist">${esc(np ? [np.artist, np.source].filter(Boolean).join(' · ') : 'Windows media')}</div>
      <div class="np-bar"><i style="width:${pct}%"></i></div><div class="np-time">${np && np.dur ? fmtTime(np.pos) + ' / ' + fmtTime(np.dur) : '0:00 / 0:00'}</div></div>`;
  }
  if (k.type === 'panel') {
    const v = S.live.panel[k.id] || {};
    const lines = String(v.text || '').split('\n');
    return `<div class="st-title">${esc(k.title || k.label)}</div>${v.up === true || v.up === false ? `<div class="st-ud ${v.up ? 'up' : 'down'}"></div>` : ''}
      <pre class="pn-text">${v.text ? lines.map(esc).join('\n') : '—'}</pre>`;
  }
  if (k.type === 'status') {
    const v = S.live.status[k.id] || {};
    const val = v.value != null ? v.value : '—';
    let extra = '';
    if (k.show === 'valuebar') extra = `<div class="st-bar"><i style="width:${Math.round(100 * (v.bar || 0))}%"></i></div>`;
    if (k.show === 'updown') extra = `<div class="st-ud ${v.up === true ? 'up' : v.up === false ? 'down' : ''}"></div>`;
    return `<div class="st-title">${esc(k.title || k.label)}</div><div class="st-val">${esc(val)}</div>${v.sub ? `<div class="st-sub">${esc(v.sub)}</div>` : ''}${extra}`;
  }
  const f = faceOf(k, p);
  let icon = '';
  if (k.icon && k.icon.id) icon = `<div class="appic img"><img src="${iconUrl(k.icon.id)}"></div>`;
  else if (f.mono) icon = `<div class="appic">${esc(f.mono)}</div>`;
  else if (f.caps) icon = `<div class="caps">${f.caps.map(c => `<div class="cap">${esc(c)}</div>`).join('')}</div>`;
  else if (f.glyph) icon = `<div class="glyph">${svg(f.glyph, 1.75)}</div>`;
  const lab = k.labelPos === 'hidden' ? '' : `<div class="lab">${esc(k.label)}</div>`;
  const sub = f.sub ? `<div class="sub">${esc(f.sub)}</div>` : '';
  const n = (k.steps || []).length, go = k.goPage && page(k.goPage);
  const xtra = n || go ? `<div class="xtra" title="${n ? n + ' extra step' + (n > 1 ? 's' : '') : ''}${n && go ? ' · ' : ''}${go ? 'then shows ' + esc(go.name) : ''}">${n ? `${svg('list-plus')}<span>${n}</span>` : ''}${go ? svg('goto') : ''}</div>` : '';
  return icon + lab + sub + xtra;
}

/* ---------------- history / saving ---------------- */
let saveTimer = null;
function commit(opts) {
  opts = opts || {};
  if (!opts.silent) { S.hist.push(S.lastSnap); if (S.hist.length > 120) S.hist.shift(); S.fut = []; }
  S.lastSnap = JSON.stringify(S.cfg);
  S.sync = 'pending'; renderSync();
  clearTimeout(saveTimer); saveTimer = setTimeout(save, opts.now ? 0 : 280);
}
function withFaces(cfg) {
  const c = clone(cfg);
  c.pages.forEach(p => p.keys.forEach(k => { k.face = faceOf(k, p); }));
  return c;
}
async function save() {
  try { const r = await call('saveConfig', { config: withFaces(S.cfg) }); S.sync = r && r.deck ? 'ok' : 'off'; }
  catch (e) { S.sync = 'err'; toast('Save failed: ' + e.message); }
  renderSync();
}
function undo() { if (!S.hist.length) return; S.fut.push(JSON.stringify(S.cfg)); S.cfg = JSON.parse(S.hist.pop()); afterHistory(); }
function redo() { if (!S.fut.length) return; S.hist.push(JSON.stringify(S.cfg)); S.cfg = JSON.parse(S.fut.pop()); afterHistory(); }
function afterHistory() {
  if (!page(S.pageId)) S.pageId = S.cfg.pages[0].id;
  if (S.sel && S.sel.t === 'key' && !selKey()) S.sel = null;
  S.lastSnap = JSON.stringify(S.cfg); clearTimeout(saveTimer); saveTimer = setTimeout(save, 100); S.sync = 'pending';
  renderAll();
}

/* ---------------- rendering ---------------- */
function renderAll() { renderSidebar(); renderHeader(); renderBoard(); renderInspector(); renderSync(); }
function renderSync() {
  const el = $('#sync'), t = $('#syncText');
  el.className = 'tb-sync' + (S.sync === 'pending' ? ' pending' : S.sync === 'off' || S.sync === 'err' ? ' off' : '');
  t.textContent = S.sync === 'pending' ? 'Syncing…' : S.sync === 'err' ? 'Not saved' : S.sync === 'off' || !S.dev.connected ? 'Saved · deck offline' : 'Synced to deck';
}
function renderDevice() {
  const d = S.dev; const pills = [];
  if (d.connected) pills.push(`<span class="pill on">${d.link === 'usb' ? 'USB' : 'Wi-Fi'} · ${d.rtt} ms</span>`);
  else if (d.pairState === 'outdated') pills.push('<span class="pill warn">Update deck app</span>');
  else if (d.pairState) pills.push('<span class="pill warn">Not paired</span>');
  else pills.push('<span class="pill off">Offline</span>');
  const mode = (S.cfg && S.cfg.linkMode) || 'auto';
  if (mode === 'wifi') pills.push('<span class="pill">Wi-Fi only</span>');
  else if (mode === 'usb') pills.push('<span class="pill">USB only</span>');
  else if (d.link !== 'usb') pills.push(`<span class="pill${d.usb ? '' : ' off'}">${d.usb ? 'USB standby' : d.adb ? 'No USB' : 'No adb'}</span>`);
  else pills.push(`<span class="pill off">Wi-Fi off</span>`);
  $('#devPills').innerHTML = pills.join('');
  $('#devName').textContent = d.name || (d.pairState ? 'New deck' : 'No deck yet');
  $('#devAddr').textContent = d.ip ? `${d.ip} → :8765` : 'Looking for the deck on Wi-Fi and USB';
  renderPair();
  renderSync();
}

/* ---------------- pairing (docs/PROTOCOL.md) ---------------- */
let pairSig = '', pairLocalErr = '', pairBusy = false, pairNameDraft = '', pairCodeDraft = '';
function renderPair() {
  const d = S.dev, el = $('#devPair'), st = d.pairState || '';
  // Device events arrive every couple of seconds; only rebuild when something visible changed, so typing isn't lost.
  const sig = [st, d.pairError, d.deckApproved, d.name, pairLocalErr, pairBusy].join('|');
  if (sig === pairSig) return; pairSig = sig;
  el.hidden = !st;
  if (!st) { el.innerHTML = ''; return; }
  const name = esc(d.name || (d.model ? `the new deck (${d.model})` : 'the new deck'));
  const err = pairLocalErr || d.pairError;
  const errHtml = err ? `<div class="perr">${esc(err)}</div>` : '';
  if (st === 'outdated') {
    el.innerHTML = `<div class="pt">The Deckwell app on ${name} is out of date.</div><div class="ps">Install the latest version on the deck, then open it again.</div>`;
  } else if (st === 'unpaired') {
    el.innerHTML = `<div class="pt">${name} isn't paired with this computer.</div><div class="ps">Pairing makes sure only your deck can press your keys.</div>${errHtml}
      <div class="prow"><button class="btn accent" id="pairGo">${gi('link')}Pair this deck</button></div>`;
  } else if (st === 'starting') {
    el.innerHTML = `<div class="pt">Pairing with ${name}…</div><div class="ps">Setting up a secure link.</div>
      <div class="prow"><button class="btn" id="pairStop">Cancel</button></div>`;
  } else if (st === 'code') {
    el.innerHTML = `<div class="pt">Name this deck</div>
      <input class="pname" id="pairName" maxlength="40" autocomplete="off" spellcheck="false" placeholder="e.g. Desk tablet" value="${esc(pairNameDraft)}">
      <div class="pt" style="margin-top:10px">Type the code shown on ${name}.</div>
      <input class="pcode" id="pairCode" inputmode="numeric" autocomplete="off" maxlength="7" placeholder="000 000" value="${esc(pairCodeDraft)}">
      ${errHtml}${d.deckApproved ? '<div class="pok">Pair was tapped on the deck.</div>' : '<div class="ps">Then tap Pair on the deck.</div>'}
      <div class="prow"><button class="btn" id="pairStop">Cancel</button><button class="btn accent" id="pairSend"${pairBusy ? ' disabled' : ''}>Pair</button></div>`;
    const inp = el.querySelector('#pairCode'), nm = el.querySelector('#pairName');
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') submitPairCode(); e.stopPropagation(); });
    nm.addEventListener('keydown', e => { if (e.key === 'Enter') inp.focus(); e.stopPropagation(); });
    nm.addEventListener('input', () => { pairNameDraft = nm.value; });
    inp.addEventListener('input', () => { pairCodeDraft = inp.value; });
    el.querySelector('#pairSend').onclick = submitPairCode;
    setTimeout(() => (pairNameDraft.trim() ? inp : nm).focus(), 0);
  } else if (st === 'wait-deck') {
    el.innerHTML = `<div class="pt">Code matches.</div><div class="pok">Now tap Pair on ${name} to finish.</div>
      <div class="prow"><button class="btn" id="pairStop">Cancel</button></div>`;
  }
  const go = el.querySelector('#pairGo');
  if (go) go.onclick = async () => { pairLocalErr = ''; const r = await call('pairStart', {}); if (r && r.error) pairLocalErr = r.error; renderPair(); };
  const stop = el.querySelector('#pairStop');
  if (stop) stop.onclick = () => { pairLocalErr = ''; call('pairCancel', {}); };
}
async function submitPairCode() {
  const inp = $('#pairCode'); if (!inp || pairBusy) return;
  const code = inp.value.replace(/\D/g, '');
  const name = pairNameDraft.trim();
  if (!name) { pairLocalErr = 'Give the deck a name first.'; pairSig = ''; renderPair(); return; }
  if (code.length !== 6) { pairLocalErr = 'The code has 6 digits.'; pairSig = ''; renderPair(); return; }
  pairBusy = true; pairLocalErr = ''; renderPair();
  try { const r = await call('pairCode', { code, name }); pairLocalErr = r && r.error ? r.error : ''; pairCodeDraft = ''; if (!pairLocalErr) pairNameDraft = ''; }
  catch (e) { pairLocalErr = e.message; }
  pairBusy = false; pairSig = ''; renderPair();
}
function pageOrder() {
  const out = []; const walk = (pid, depth) => S.cfg.pages.filter(p => (p.parentId || null) === pid).forEach(p => { out.push([p, depth]); walk(p.id, depth + 1); });
  walk(null, 0); return out;
}
function renderSidebar() {
  $('#pages').innerHTML = pageOrder().map(([p, d]) => `<div class="pg${p.id === S.pageId ? ' sel' : ''}${d ? ' child' : ''}" data-page="${p.id}" style="${d > 1 ? 'padding-left:' + (9 + 20 * d) + 'px' : ''}">
    ${gi(p.parentId ? 'folder' : 'grid')}<span class="nm">${esc(p.name)}</span><span class="sz">${p.cols}×${p.rows}</span></div>`).join('');
  renderDevice();
}
function renderHeader() {
  const p = curPage();
  $('#pageTitle').textContent = p.name;
  $('#colStep .val').textContent = p.cols; $('#rowStep .val').textContent = p.rows;
  const side = stripSide(p) || 'off';
  const port = portraitView();
  document.querySelectorAll('#viewSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === S.view));
  document.querySelector('.lgrid').hidden = port; document.querySelector('.pgrid').hidden = !port;
  $('#sliderSeg').hidden = port; $('#pSliderSeg').hidden = !port;
  document.querySelectorAll('#sliderSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === side));
  const pside = side === 'off' ? 'off' : p.pside === 'top' ? 'top' : 'bottom';
  document.querySelectorAll('#pSliderSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === pside));
  document.querySelectorAll('#orderSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === (p.porder === 'mirror' ? 'mirror' : 'reading')));
  $('#sliderStep').hidden = side === 'off'; $('#sliderStepLabel').hidden = side === 'off';
  $('#sliderStep .val').textContent = p.strip.length;
}
/** Makes sure a page that shows sliders has between 1 and 6 slots. */
function ensureStrip(p) {
  if (!Array.isArray(p.strip)) p.strip = [];
  if (p.strip.length > DECK.maxSliders) p.strip.length = DECK.maxSliders;
  if (stripSide(p) && p.strip.length === 0) p.strip = [null, null, null];
}
function setSliderCount(p, n) {
  n = Math.max(1, Math.min(DECK.maxSliders, n));
  if (n === p.strip.length) return;
  const lost = p.strip.slice(n).filter(Boolean).length;
  while (p.strip.length < n) p.strip.push(null);
  p.strip.length = n;
  if (S.sel && S.sel.t === 'slider' && S.sel.i >= n) S.sel = null;
  commit(); renderAll();
  if (lost) toast(`Removed ${lost} slider${lost > 1 ? 's' : ''}. Ctrl+Z brings ${lost > 1 ? 'them' : 'it'} back.`);
}
/** Where a folder's Back key sits: top-left unless moved. Off the grid (after shrinking it) falls back to top-left. */
function backPos(p) {
  if (!p.parentId) return null;
  const b = p.back || { row: 0, col: 0 };
  return b.row < p.rows && b.col < p.cols ? { row: b.row, col: b.col } : { row: 0, col: 0 };
}
/** A key covering the Back key's spot is hidden on the deck, so the editor hides it too. */
function coversBack(p, k) { const b = backPos(p); if (!b) return false; const z = sizeOf(k); return b.row >= k.row && b.row < k.row + z.h && b.col >= k.col && b.col < k.col + z.w; }
function occupancy(p) {
  const occ = {};
  p.keys.forEach(k => {
    if (k.row >= p.rows || k.col >= p.cols || coversBack(p, k)) return;
    const z = sizeOf(k);
    for (let y = k.row; y < Math.min(p.rows, k.row + z.h); y++) for (let x = k.col; x < Math.min(p.cols, k.col + z.w); x++) occ[y + ',' + x] = k.id;
  });
  const b = backPos(p); if (b) occ[b.row + ',' + b.col] = '__back';
  return occ;
}
/** Panel text grows to fill the panel: never below 21, at most 64 (same rule as panelSize() in DeckView.kt).
    The board is in deck design units, so the key's own size is the deck's size. JetBrains Mono is 0.6 em per character. */
function fitPanel(el) {
  const pre = el.querySelector('.pn-text'); if (!pre) return;
  const lines = pre.textContent.split('\n');
  const longest = Math.max(1, ...lines.map(l => l.length));
  const w = el.clientWidth - 52 - 8, h = el.clientHeight - 84 - 18;
  const fs = Math.max(21, Math.min(64, w / (longest * 0.6), h / (lines.length * 30 / 21)));
  pre.style.fontSize = fs + 'px'; pre.style.lineHeight = (fs * 30 / 21) + 'px';
}
function backKey(p) { const par = page(p.parentId); const b = backPos(p) || { row: 0, col: 0 }; return { id: '__back', type: 'back', row: b.row, col: b.col, label: 'Back', labelPos: 'bottom', sub: par ? par.name : '' }; }
function renderBoard() {
  const p = curPage(); const g = geom(p); const inner = $('#boardInner');
  const port = portraitView();
  let html = '';
  const pos = (r, c, w, h) => `left:${g.gridX + c * (g.w + DECK.gap)}px;top:${g.gridY + r * (g.h + DECK.gap)}px;width:${w * g.w + (w - 1) * DECK.gap}px;height:${h * g.h + (h - 1) * DECK.gap}px`;
  // In portrait the keys sit where the deck puts them (portrait.js); the landscape grid is what you edit.
  const placed = port ? g.pg.keys : p.keys.filter(k => k.row < p.rows && k.col < p.cols && !coversBack(p, k)).map(k => { const z = sizeOf(k); return { id: k.id, row: k.row, col: k.col, w: Math.min(z.w, p.cols - k.col), h: Math.min(z.h, p.rows - k.row) }; });
  if (!port && p.parentId) { const b = backPos(p); placed.unshift({ id: '__back', row: b.row, col: b.col, w: 1, h: 1 }); }
  const occ = {};
  placed.forEach(q => { for (let y = q.row; y < q.row + q.h; y++) for (let x = q.col; x < q.col + q.w; x++) occ[y + ',' + x] = q.id; });
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) if (!occ[r + ',' + c]) html += `<div class="k empty${port ? ' locked' : ''}" data-r="${r}" data-c="${c}" style="${pos(r, c, 1, 1)}"></div>`;
  placed.forEach(q => {
    const k = q.id === '__back' ? backKey(p) : p.keys.find(x => x.id === q.id); if (!k) return;
    const cls = ['k', k.type === 'status' ? 'status' : k.type === 'nowplaying' ? 'np' : k.type === 'panel' ? 'panel' : '', k.type === 'back' ? 'back' + (port ? ' locked' : '') : '', k.labelPos === 'top' ? 'top' : '',
      S.sel && S.sel.t === 'key' && S.sel.id === k.id ? 'sel' : ''].filter(Boolean).join(' ');
    html += `<div class="${cls}" data-key="${k.id}" data-r="${k.row}" data-c="${k.col}" ${!port ? 'draggable="true"' : ''} style="${pos(q.row, q.col, q.w, q.h)}">${keyFaceHTML(k, p)}</div>`;
  });
  if (g.strip && port) {
    html += `<div class="strip h" style="left:0;top:${g.stripY}px;width:${g.sw}px;height:${g.sh}px">`;
    for (let i = 0; i < g.n; i++) {
      const s = p.strip[i];
      if (!s) { html += `<div class="slh empty" data-slot="${i}">+</div>`; continue; }
      const live = S.live.sliders[s.id] || { value: 50, enabled: true };
      const v = Math.max(0, Math.min(100, live.value));
      const ic = s.control === 'mic' ? (live.muted ? 'mic-off' : 'mic') : live.muted ? 'volume-x' : s.control === 'master' ? 'volume-2' : 'volume-1';
      html += `<div class="slh${live.enabled === false ? ' disabled' : ''}${S.sel && S.sel.t === 'slider' && S.sel.i === i ? ' sel' : ''}" data-slot="${i}">
        <div class="slh-lab"><span>${esc(sliderName(s))}</span><b>${Math.round(v)}</b></div>
        <div class="slh-track"><div class="slh-fill" style="width:${v}%"></div><div class="slh-thumb" style="left:${v}%"></div></div>
        ${s.button === 'none' ? '' : `<div class="sl-btn">${gi(ic)}</div>`}</div>`;
    }
    html += '</div>';
  } else if (g.strip) {
    html += `<div class="strip" style="left:${g.stripX}px;width:${g.sw}px;height:${g.gridH}px">`;
    for (let i = 0; i < g.n; i++) {
      const s = p.strip[i];
      if (!s) { html += `<div class="sl empty" data-slot="${i}">+</div>`; continue; }
      const live = S.live.sliders[s.id] || { value: 50, enabled: true };
      const v = Math.max(0, Math.min(100, live.value));
      const ic = s.control === 'mic' ? (live.muted ? 'mic-off' : 'mic') : live.muted ? 'volume-x' : s.control === 'master' ? 'volume-2' : 'volume-1';
      html += `<div class="sl${live.enabled === false ? ' disabled' : ''}${S.sel && S.sel.t === 'slider' && S.sel.i === i ? ' sel' : ''}" data-slot="${i}">
        <div class="sl-lab">${esc(sliderShort(s))}</div><div class="sl-val">${Math.round(v)}</div>
        <div class="sl-track"><div class="sl-fill" style="height:${v}%"></div><div class="sl-thumb" style="bottom:${v}%"></div></div>
        <div class="sl-btn">${gi(s.button === 'none' ? 'minus' : ic)}</div></div>`;
    }
    html += '</div>';
  }
  inner.innerHTML = html;
  inner.querySelectorAll('.k.panel').forEach(fitPanel);
  inner.style.width = g.totalW + 'px'; inner.style.height = g.totalH + 'px';
  inner.classList.toggle('portrait', port);
  fitBoard();
}
function sliderName(s) { return s.control === 'master' ? 'Master' : s.control === 'mic' ? 'Mic' : (s.appLabel || s.app || 'App'); }
function sliderShort(s) { return s.control === 'master' ? 'MST' : s.control === 'mic' ? 'MIC' : (s.appLabel || s.app || 'APP').replace(/[aeiou\s]/gi, '').slice(0, 3) || 'APP'; }
function fitBoard() {
  const p = curPage(); const g = geom(p); const wrap = $('#boardWrap'); const inner = $('#boardInner');
  const availW = wrap.clientWidth - 42;
  const availH = Math.max(160, window.innerHeight - 34 - 16 - 40 - 16 - 42 - 312);
  const z = Math.max(0.1, Math.min(availW / g.totalW, availH / g.totalH, 0.6));
  inner.style.zoom = z;
}

/* ---------------- palette ---------------- */
const PALETTE = [
  ['System', [['app', 'app-window', 'Launch app'], ['hotkey', 'keyboard', 'Hotkey'], ['media', 'media-chip', 'Media key'], ['url', 'globe', 'Open URL']]],
  ['Scripts', [['ps', 'terminal', 'PowerShell'], ['py', 'file-py', 'Python']]],
  ['Homelab', [['ssh', 'square-terminal', 'SSH command'], ['status', 'chart', 'Status tile'], ['panel', 'activity', 'Panel']]],
  ['Terminal', [['terminal', 'square-terminal', 'Open terminal'], ['termsend', 'code', 'Send to terminal']]],
  ['Windows', [['snap', 'app-window', 'Snap window'], ['winpick', 'grid', 'Window picker'], ['layout', 'monitor', 'Window layout']]],
  ['Deck', [['folder', 'folder', 'Folder'], ['goto', 'goto', 'Go to page'], ['nowplaying', 'music', 'Now Playing'], ['slider', 'sliders', 'Slider']]],
];
function renderPalette() {
  $('#palette').innerHTML = PALETTE.map(([cat, items]) => `<div class="pal-cat">${cat}</div><div class="pal-row">${items.map(([t, g, n]) =>
    `<button class="chip" draggable="true" data-add="${t}">${gi(g)}${n}</button>`).join('')}</div>`).join('');
}
function newKey(kind, row, col) {
  const base = { id: uid(), row, col, labelPos: 'bottom' };
  const firstHost = S.cfg.hosts[0] ? S.cfg.hosts[0].id : null;
  switch (kind) {
    case 'app': return Object.assign(base, { type: 'app', label: 'App', exe: '', args: '', ifRunning: 'focus' });
    case 'hotkey': return Object.assign(base, { type: 'hotkey', label: 'Hotkey', keys: [], sendAs: 'press' });
    case 'media': return Object.assign(base, { type: 'media', label: 'Play / Pause', media: 'playpause' });
    case 'url': return Object.assign(base, { type: 'url', label: 'Website', url: 'https://' });
    case 'ps': return Object.assign(base, { type: 'script', label: 'Script', runtime: 'powershell', file: '', window: 'hidden' });
    case 'py': return Object.assign(base, { type: 'script', label: 'Script', runtime: 'python', file: '', window: 'hidden' });
    case 'ssh': return Object.assign(base, { type: 'ssh', label: 'Command', hostId: firstHost, command: '', keyPath: '~/.ssh/id_ed25519', timeout: 10, after: 'ring' });
    case 'status': return Object.assign(base, { type: 'status', label: 'CPU', title: 'CPU', source: 'pc', metric: 'cpu', show: 'valuebar', refresh: 5, onTap: '' });
    case 'goto': { const t = S.cfg.pages.find(p => !p.parentId && p.id !== S.pageId); return Object.assign(base, { type: 'goto', label: t ? t.name : 'Go to page', target: t ? t.id : null }); }
    case 'nowplaying': return Object.assign(base, { type: 'nowplaying', label: 'Now Playing', labelPos: 'hidden' });
    case 'panel': return Object.assign(base, { type: 'panel', label: 'Top apps', title: 'Top apps', source: 'pc', metric: 'topcpu', refresh: 5, pw: 2, ph: 2, onTap: '' });
    case 'terminal': return Object.assign(base, { type: 'terminal', label: 'Terminal', program: 'wt', openIn: 'window', profile: '', folder: '', command: '', admin: false, hostId: firstHost, keyPath: '~/.ssh/id_ed25519' });
    case 'termsend': return Object.assign(base, { type: 'termsend', label: 'Send text', text: '', target: 'recent', title: '' });
    case 'snap': return Object.assign(base, { type: 'snap', label: 'Left half', target: 'active', exe: '', monitor: 'current', spot: 'left' });
    case 'winpick': return Object.assign(base, { type: 'winpick', label: 'Move window' });
    case 'layout': return Object.assign(base, { type: 'layout', label: 'Layout', windows: [] });
    case 'folder': {
      const fp = { id: uid(), name: 'Folder', parentId: S.pageId, cols: 5, rows: 3, sliders: 'off', strip: [null, null, null], keys: [] };
      S.cfg.pages.push(fp);
      return Object.assign(base, { type: 'folder', label: 'Folder', target: fp.id });
    }
  }
}
function cellFree(p, r, c, ignoreId) { const o = occupancy(p)[r + ',' + c]; return !o || o === ignoreId; }
/** True if a w x h key fits at r,c inside the grid without covering another key (ignoreId may be covered). */
function areaFree(p, r, c, w, h, ignoreId) {
  if (r + h > p.rows || c + w > p.cols) return false;
  const occ = occupancy(p);
  for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) { const o = occ[y + ',' + x]; if (o && o !== ignoreId) return false; }
  return true;
}
function firstFree(p, z) {
  z = typeof z === 'number' ? { w: z, h: 1 } : z || { w: 1, h: 1 };
  for (let r = 0; r < p.rows; r++) for (let c = 0; c < p.cols; c++) if (areaFree(p, r, c, z.w, z.h)) return [r, c];
  return null;
}
function removeKey(p, k) {
  p.keys = p.keys.filter(x => x.id !== k.id);
  if (k.type === 'folder') { deletePageTree(k.target); cleanGoPages(); }
}
function deletePageTree(pid) {
  const kids = S.cfg.pages.filter(p => p.parentId === pid).map(p => p.id);
  kids.forEach(deletePageTree);
  S.cfg.pages = S.cfg.pages.filter(p => p.id !== pid);
}
function placeNew(kind, r, c) {
  const p = curPage();
  if (kind === 'slider') return addSlider();
  const z = sizeOf({ type: kind === 'panel' ? 'panel' : kind === 'nowplaying' ? 'nowplaying' : 'x', pw: 2, ph: 2 });
  const what = kind === 'nowplaying' ? 'Now Playing needs two free keys side by side' : kind === 'panel' ? 'A panel needs 2 x 2 free keys' : 'No free keys on this page';
  if (r == null) { const f = firstFree(p, z); if (!f) return toast(what); [r, c] = f; }
  if (r + z.h > p.rows || c + z.w > p.cols) return toast(what.replace('free ', ''));
  // replace whatever is there
  const occ = occupancy(p); const hitIds = new Set();
  for (let y = r; y < r + z.h; y++) for (let x = c; x < c + z.w; x++) { const o = occ[y + ',' + x]; if (o === '__back') return toast('That spot is the Back key. Drag Back somewhere else first.'); if (o) hitIds.add(o); }
  p.keys.filter(k => hitIds.has(k.id)).forEach(k => removeKey(p, k));
  const k = newKey(kind, r, c); p.keys.push(k);
  S.sel = { t: 'key', id: k.id }; commit(); renderAll();
}
function addSlider(slot) {
  const p = curPage();
  if (!stripSide(p)) p.sliders = 'right';
  ensureStrip(p);
  if (slot == null) slot = p.strip.findIndex(s => !s);
  if (slot < 0 && p.strip.length < DECK.maxSliders) { p.strip.push(null); slot = p.strip.length - 1; }
  if (slot < 0) return toast(`The slider strip is full (${DECK.maxSliders} max)`);
  p.strip[slot] = { id: uid(), control: 'master', app: '', appLabel: '', step: 2, button: 'mute' };
  S.sel = { t: 'slider', i: slot }; commit(); renderAll();
}
/** Drag the Back key to another spot in its folder. Dropping it on a one-key-sized key swaps the two. */
function moveBack(p, r, c) {
  const b = backPos(p); if (!b || (b.row === r && b.col === c)) return;
  const other = occupancy(p)[r + ',' + c];
  if (other) {
    const o = p.keys.find(x => x.id === other); const z = sizeOf(o);
    if (z.w !== 1 || z.h !== 1 || o.row !== r || o.col !== c) return toast('Back can only swap with a one-key-sized key');
    o.row = b.row; o.col = b.col;
  }
  p.back = { row: r, col: c }; commit(); renderAll();
}
function moveKey(k, fromP, toP, r, c) {
  const z = sizeOf(k);
  const tb = backPos(toP);
  // Dropping a small key on Back swaps them (same folder only).
  if (tb && tb.row === r && tb.col === c && fromP === toP && z.w === 1 && z.h === 1) { toP.back = { row: k.row, col: k.col }; k.row = r; k.col = c; commit(); renderAll(); return; }
  if (c + z.w > toP.cols || r + z.h > toP.rows) return toast(`Not enough room for ${k.type === 'panel' ? 'the panel' : 'Now Playing'} there`);
  const occ = occupancy(toP); const targets = [];
  for (let y = r; y < r + z.h; y++) for (let x = c; x < c + z.w; x++) { const o = occ[y + ',' + x]; if (o && o !== k.id) targets.push(o); }
  if (targets.includes('__back')) return toast('The Back key is in the way. Drag Back somewhere else first.');
  const others = [...new Set(targets)].map(id => toP.keys.find(x => x.id === id));
  const same = o => { const oz = sizeOf(o); return oz.w === z.w && oz.h === z.h && o.row === r && o.col === c; };
  if (others.length > 1 || (others[0] && !same(others[0]))) return toast("Can't swap those two keys");
  if (others[0]) { others[0].row = k.row; others[0].col = k.col; if (fromP !== toP) { toP.keys = toP.keys.filter(x => x !== others[0]); fromP.keys.push(others[0]); } }
  if (fromP !== toP) { fromP.keys = fromP.keys.filter(x => x !== k); toP.keys.push(k); if (k.type === 'folder') { const fp = page(k.target); if (fp) fp.parentId = toP.id; } }
  k.row = r; k.col = c; commit(); renderAll();
}

/* ---------------- inspector ---------------- */
const TYPE_NAMES = { app: 'Launch app', hotkey: 'Hotkey', media: 'Media key', url: 'Open URL', script: 'Script', ssh: 'SSH command', status: 'Status tile', folder: 'Folder', goto: 'Go to page', nowplaying: 'Now Playing', back: 'Back',
  panel: 'Panel', terminal: 'Open terminal', termsend: 'Send to terminal', snap: 'Snap window', winpick: 'Window picker', layout: 'Window layout' };
const TERM_PROGRAMS = [['wt', 'Windows Terminal', 'terminal'], ['powershell', 'PowerShell', 'powershell'], ['pwsh', 'PowerShell 7', 'pwsh'], ['cmd', 'cmd', 'cmd'], ['wsl', 'WSL', 'wsl'], ['ssh', 'SSH', 'ssh']];
/** Snap spots. Same ids and fractions as desktop/SnapSpots.cs and the deck's window picker. */
const SPOTS = [['max', 'Maximize', 0, 0, 1, 1], ['left', 'Left half', 0, 0, .5, 1], ['right', 'Right half', .5, 0, .5, 1], ['top', 'Top half', 0, 0, 1, .5], ['bottom', 'Bottom half', 0, .5, 1, .5],
  ['third-l', 'Left third', 0, 0, 1 / 3, 1], ['third-c', 'Middle third', 1 / 3, 0, 1 / 3, 1], ['third-r', 'Right third', 2 / 3, 0, 1 / 3, 1], ['two-l', 'Left two-thirds', 0, 0, 2 / 3, 1], ['two-r', 'Right two-thirds', 1 / 3, 0, 2 / 3, 1],
  ['tl', 'Top left', 0, 0, .5, .5], ['tr', 'Top right', .5, 0, .5, .5], ['bl', 'Bottom left', 0, .5, .5, .5], ['br', 'Bottom right', .5, .5, .5, .5], ['center', 'Center', .15, .1, .7, .8]];
const mainMonitor = () => S.monitors.find(m => m.main) || S.monitors[0];
/** The monitor whose zones a key can use: a chosen monitor, or the main one. "Current" has no fixed zones. */
const zoneMonitor = mon => mon === 'current' || !mon ? null : mon === 'main' ? mainMonitor() : S.monitors.find(m => m.id === mon) || { id: mon, name: 'Unplugged display', w: 1920, h: 1080 };
const zonesOf = id => (S.cfg.zones && S.cfg.zones[id]) || [];
function spotName(spot, mon) {
  const b = SPOTS.find(x => x[0] === spot); if (b) return b[1];
  const m = zoneMonitor(mon); const z = m && zonesOf(m.id).find(x => 'zone:' + x.id === spot);
  return z ? z.name : 'Zone';
}
const seg = (field, opts, val, extra) => `<div class="seg${extra || ''}" data-seg="${field}">${opts.map(([v, n, g]) => `<button data-v="${v}" class="${String(val) === String(v) ? 'on' : ''}">${g ? gi(g) : ''}${n}</button>`).join('')}</div>`;
const field = (label, inner) => `<div class="field"><label>${label}</label>${inner}</div>`;
const input = (f, v, o) => `<input class="in${o && o.mono ? ' mono' : ''}" data-f="${f}" value="${esc(v)}" placeholder="${esc(o && o.ph || '')}" spellcheck="false">`;
function loc(p, k) { return p.parentId || S.sel.t === 'slider' ? `${p.name} · R${k.row + 1} C${k.col + 1}` : `Row ${k.row + 1} · Col ${k.col + 1}`; }
function iconSection(k) {
  let box, caption;
  if (k.icon && k.icon.id) { box = `<div class="appic img" style="width:52px;height:52px"><img src="${iconUrl(k.icon.id)}"></div>`; caption = k.icon.kind === 'exe' ? `Extracted from ${esc(exeName(k.exe))} · 256 px · re-pulls if the path changes` : 'Uploaded image · 256 px'; }
  else { const f = faceOf(k, curPage()); box = f.mono ? `<div class="appic">${esc(f.mono)}</div>` : `<div class="glyph">${svg(f.glyph || 'square', 1.75)}</div>`; caption = k.type === 'app' ? 'No icon yet. Pull it from the .exe or upload one.' : 'Click the tile to pick a glyph, or upload an image.'; }
  const b1 = k.type === 'app' ? `<button class="btn accent" data-act="fromExe">${gi('app-window')}From .exe</button>` : '';
  const b2 = `<button class="btn" data-act="upload">${gi('upload')}Upload image</button>`;
  const b3 = k.icon && k.icon.id && k.type !== 'app' ? `<button class="btn" data-act="resetIcon">${gi('x')}Use glyph</button>` : '';
  return `<div class="iconrow"><div class="iconbox" data-act="glyphs">${box}</div><div class="iconbtns">${b1}${b2}${b3}</div></div><div class="caption">${caption}</div>`;
}
const exeName = p => String(p || '').split(/[\\/]/).pop() || 'the .exe';
const labelFields = k => field('Label', input('label', k.label)) + field('Label position', seg('labelPos', [['bottom', 'Bottom'], ['top', 'Top'], ['hidden', 'Hidden']], k.labelPos));
const footer = (test) => `<div class="ins-foot">${test ? `<button class="btn" data-act="test">${gi('play')}Test</button>` : ''}<button class="btn" data-act="dup">${gi('copy')}Duplicate</button><span class="spacer"></span><button class="clear" data-act="clear">${gi('trash')}Clear</button></div>`;

/* ---------------- extra steps + "then show page" ---------------- */
const EXTRA_TYPES = ['app', 'hotkey', 'media', 'url', 'script', 'ssh', 'folder', 'goto', 'terminal', 'termsend', 'snap', 'layout'];
const STEP_TYPES = { app: ['Open app', 'app-window'], hotkey: ['Hotkey', 'keyboard'], media: ['Media key', 'play-pause'], url: ['Open URL', 'globe'], script: ['Run script', 'terminal'], ssh: ['SSH command', 'square-terminal'],
  snap: ['Snap window', 'app-window'], terminal: ['Open terminal', 'square-terminal'], termsend: ['Send to terminal', 'code'], wait: ['Wait', 'clock'] };
function newStep(t) {
  const host = S.cfg.hosts[0] ? S.cfg.hosts[0].id : null;
  return Object.assign({ id: uid(), type: t }, ({
    app: { exe: '', args: '', ifRunning: 'focus' }, hotkey: { keys: [] }, media: { media: 'playpause' }, url: { url: 'https://' },
    script: { runtime: 'powershell', file: '', window: 'hidden' }, ssh: { hostId: host, command: '' }, wait: { ms: 1000 },
    snap: { target: 'active', exe: '', monitor: 'current', spot: 'left' }, terminal: { program: 'wt', openIn: 'window', profile: '', folder: '', command: '', admin: false, hostId: host, keyPath: '~/.ssh/id_ed25519' },
    termsend: { text: '', target: 'recent', title: '' },
  })[t]);
}
const sIn = (i, f, v, o) => `<input class="in${o && o.mono ? ' mono' : ''}" data-si="${i}" data-sf="${f}"${o && o.num ? ' data-num="1"' : ''} value="${esc(v)}" placeholder="${esc(o && o.ph || '')}" spellcheck="false">`;
const sSeg = (i, f, opts, val) => `<div class="seg sm" data-sseg="${f}" data-si="${i}">${opts.map(([v, n]) => `<button data-v="${v}" class="${String(val) === String(v) ? 'on' : ''}">${n}</button>`).join('')}</div>`;
function stepBody(s, i) {
  switch (s.type) {
    case 'app': return `<div class="inrow">${sIn(i, 'exe', s.exe, { mono: 1, ph: 'C:\\path\\to\\app.exe' })}<button class="btnsq" data-act="stepExe" data-si="${i}">${gi('folder-open')}</button></div>`
      + sSeg(i, 'ifRunning', [['focus', 'Focus'], ['new', 'New'], ['minimize', 'Minimize'], ['toggle', 'Toggle']], s.ifRunning);
    case 'hotkey': {
      const rec = S.recording && S.recKey === s;
      const caps = ((rec ? S.recKeys : s.keys) || []).map(c => `<span class="cap">${esc(c.n)}</span>`).join('');
      return `<div class="recorder sm${rec ? ' rec' : ''}" data-act="stepRecord" data-si="${i}">${caps || `<span class="ph">${rec ? 'Press keys…' : 'Click to record a shortcut'}</span>`}</div>`;
    }
    case 'media': return `<select class="in" data-si="${i}" data-sf="media">${Object.entries(MEDIA).map(([v, m]) => `<option value="${v}"${v === s.media ? ' selected' : ''}>${esc(m.lab)}</option>`).join('')}</select>`;
    case 'url': return sIn(i, 'url', s.url, { mono: 1, ph: 'https://' });
    case 'script': return `<div class="inrow">${sIn(i, 'file', s.file, { mono: 1, ph: s.runtime === 'python' ? 'C:\\scripts\\job.py' : 'C:\\scripts\\job.ps1' })}<button class="btnsq" data-act="stepScript" data-si="${i}">${gi('folder-open')}</button></div>`
      + sSeg(i, 'runtime', [['powershell', 'PowerShell'], ['python', 'Python']], s.runtime);
    case 'ssh': return `<select class="in" data-si="${i}" data-sf="hostId">${S.cfg.hosts.map(h => `<option value="${h.id}"${h.id === s.hostId ? ' selected' : ''}>${esc(h.name)}</option>`).join('')}</select>`
      + sIn(i, 'command', s.command, { mono: 1, ph: 'uptime' });
    case 'snap': return sSeg(i, 'target', [['active', 'Active window'], ['app', 'An app']], s.target)
      + (s.target === 'app' ? `<div class="inrow">${sIn(i, 'exe', s.exe, { mono: 1, ph: 'C:\\path\\to\\app.exe' })}<button class="btnsq" data-act="stepExe" data-si="${i}">${gi('folder-open')}</button></div>` : '')
      + `<select class="in" data-si="${i}" data-sf="monitor">${monitorOptions(s.monitor)}</select><select class="in" data-si="${i}" data-sf="spot">${spotOptions(s.spot, s.monitor)}</select>`;
    case 'terminal': return `<select class="in" data-si="${i}" data-sf="program">${TERM_PROGRAMS.map(([v, n]) => `<option value="${v}"${v === s.program ? ' selected' : ''}>${n}</option>`).join('')}</select>`
      + (s.program === 'ssh' ? `<select class="in" data-si="${i}" data-sf="hostId">${S.cfg.hosts.map(h => `<option value="${h.id}"${h.id === s.hostId ? ' selected' : ''}>${esc(h.name)}</option>`).join('')}</select>` : sIn(i, 'folder', s.folder, { mono: 1, ph: 'Start folder (optional)' }))
      + (s.program === 'wt' ? '' : sIn(i, 'command', s.command, { mono: 1, ph: 'Command to run (optional)' }));
    case 'termsend': return sIn(i, 'text', s.text, { mono: 1, ph: 'Text to type' }) + sSeg(i, 'target', [['recent', 'Last terminal'], ['title', 'By title']], s.target)
      + (s.target === 'title' ? sIn(i, 'title', s.title, { ph: 'Window title has…' }) : '');
    case 'wait': return `<div class="waitrow">${sIn(i, 'sec', +((s.ms || 0) / 1000).toFixed(2), { num: 1 })}<span>seconds</span></div>`;
  }
  return '';
}
function extrasSection(k, p) {
  const steps = k.steps || [];
  const nav = k.type === 'folder' || k.type === 'goto';
  let h = `<div class="sect"><h4>Also do</h4>${steps.length ? `<span class="sect-n">${steps.length} step${steps.length > 1 ? 's' : ''}</span>` : ''}</div>`;
  h += `<div class="steps">${steps.map((s, i) => `<div class="step"><div class="step-h"><span class="num">${i + 1}</span>${gi(STEP_TYPES[s.type][1])}<span>${STEP_TYPES[s.type][0]}</span><span class="spacer"></span>
      <button class="mini" data-act="stepUp" data-si="${i}" title="Move up"${i === 0 ? ' disabled' : ''}>${gi('chevron-up')}</button>
      <button class="mini" data-act="stepDown" data-si="${i}" title="Move down"${i === steps.length - 1 ? ' disabled' : ''}>${gi('chevron-down')}</button>
      <button class="mini" data-act="stepDel" data-si="${i}" title="Remove">${gi('x')}</button></div>
      <div class="step-b">${stepBody(s, i)}</div></div>`).join('')}</div>`;
  h += `<button class="btn addstep" data-act="addStep">${gi('plus')}Add step</button>`;
  h += `<div class="help">${nav ? 'Runs when the key is pressed, as the deck opens the page.' : 'Runs top to bottom after the key\'s own action. If a step fails, the rest are skipped.'}${k.type === 'app' && steps.some(s => s.type === 'hotkey') && !steps.some(s => s.type === 'wait') ? ' Tip: add a Wait before hotkeys so the app has time to open.' : ''}</div>`;
  if (!nav) {
    const opts = pageOrder().filter(([x]) => x.id !== p.id).map(([x, d]) => `<option value="${x.id}"${x.id === k.goPage ? ' selected' : ''}>${'  '.repeat(d)}${d ? '└ ' : ''}${esc(x.name)}</option>`).join('');
    h += field('Then show page', `<div class="inrow"><select class="in" data-f="goPage"><option value=""${!k.goPage || !page(k.goPage) ? ' selected' : ''}>Stay on this page</option>${opts}</select>`
      + (k.goPage && page(k.goPage) ? `<button class="btn" data-act="openGoPage">${gi('folder-open')}Open</button>` : `<button class="btn" data-act="newGoPage">${gi('plus')}New page</button>`) + '</div>');
    h += `<div class="help">${k.goPage && page(k.goPage) ? `The deck switches to <b>${esc(page(k.goPage).name)}</b> after the press.${page(k.goPage).parentId ? ' It has a Back key to return.' : ''}` : 'New page makes a page just for this key, with a Back key to return here.'}</div>`;
  }
  return h;
}
function cleanGoPages() { S.cfg.pages.forEach(p => p.keys.forEach(k => { if (k.goPage && !page(k.goPage)) delete k.goPage; })); }
function stepMenu(k, anchor) {
  showPopover(`<div class="stepmenu">${Object.entries(STEP_TYPES).map(([t, [n, g]]) => `<button data-t="${t}">${gi(g)}${n}</button>`).join('')}</div>`, anchor, pop => {
    pop.querySelectorAll('[data-t]').forEach(b => b.onclick = () => {
      const s = newStep(b.dataset.t); (k.steps = k.steps || []).push(s); hidePopover(); commit(); renderBoard(); renderInspector();
      if (s.type === 'hotkey') startRecording(s, true);
    });
  });
}

function renderInspector() {
  const el = $('#inspector'); const p = curPage();
  if (S.sel && S.sel.t === 'slider') { el.innerHTML = sliderInspector(p, S.sel.i); hydrate(el); return; }
  const k = selKey();
  if (!k) { el.innerHTML = pageInspector(p); hydrate(el); return; }
  let h = `<div class="ins-head"><span class="badge">${TYPE_NAMES[k.type]}</span><span class="ins-loc">${loc(p, k)}</span></div>`;
  switch (k.type) {
    case 'app':
      h += iconSection(k) + labelFields(k)
        + field('Executable', `<div class="inrow">${input('exe', k.exe, { mono: 1, ph: 'C:\\path\\to\\app.exe' })}<button class="btnsq" data-act="browseExe">${gi('folder-open')}</button></div>`)
        + field('Arguments', input('args', k.args, { mono: 1, ph: 'optional' }))
        + field('If already running', seg('ifRunning', [['focus', 'Focus'], ['new', 'New'], ['minimize', 'Minimize'], ['toggle', 'Toggle']], k.ifRunning))
        + `<div class="help">${{ focus: 'Brings the open window to the front.', new: 'Always opens another copy.', minimize: 'Minimizes it if it is open, launches it if not.', toggle: 'Brings it to the front. Press again while it is in front to minimize it.' }[k.ifRunning] || ''}</div>`;
      break;
    case 'hotkey': case 'media': {
      const recMain = S.recording && S.recKey === k;
      const caps = ((recMain ? S.recKeys : k.keys) || []).map(c => `<span class="cap">${esc(c.n)}</span>`).join('');
      h += labelFields(k)
        + field('Shortcut', `<div class="recorder${recMain ? ' rec' : ''}" data-act="record">${recMain ? (caps || '<span class="ph">Press keys…</span>') : k.type === 'hotkey' && caps ? caps : '<span class="ph">Click to record a shortcut</span>'}</div>
          ${recMain ? '<div class="rec-hint">Recording — press keys, Esc to stop</div>' : ''}`)
        + (k.type === 'hotkey' ? field('Send as', seg('sendAs', [['press', 'Press'], ['hold', 'Hold while touched']], k.sendAs)) : '')
        + field('Or pick a media key', `<div class="mkeys">${Object.entries(MEDIA).map(([v, m]) => `<button class="mkey${k.type === 'media' && k.media === v ? ' on' : ''}" data-media="${v}">${gi(m.g)}${m.n}</button>`).join('')}</div>`);
      if (k.type === 'media') h = h.replace('<div class="field"><label>Label</label>', iconSection(k) + '<div class="field"><label>Label</label>');
      break;
    }
    case 'url':
      h += iconSection(k) + labelFields(k) + field('URL', input('url', k.url, { mono: 1, ph: 'https://' }));
      break;
    case 'script': {
      const lr = k.lastRun;
      h += iconSection(k) + labelFields(k)
        + field('Runtime', seg('runtime', [['powershell', 'PowerShell', 'terminal'], ['python', 'Python', 'file-py']], k.runtime))
        + field('Script file', `<div class="inrow">${input('file', k.file, { mono: 1, ph: k.runtime === 'python' ? 'C:\\scripts\\job.py' : 'C:\\scripts\\job.ps1' })}<button class="btnsq" data-act="browseScript">${gi('folder-open')}</button></div>`)
        + field('Window', seg('window', [['hidden', 'Hidden'], ['visible', 'Visible'], ['admin', 'Admin']], k.window))
        + field('Last run', `<div class="lastrun">${lr ? `${esc(lr.time)} · exit ${esc(lr.exit)} · ${esc(lr.dur)} s\n${esc(lr.line || '')}` : '<span class="dim">Not run yet</span>'}</div>`);
      break;
    }
    case 'ssh':
      h += iconSection(k) + labelFields(k)
        + field('Host', `<div class="hostchips">${seg('hostId', S.cfg.hosts.map(x => [x.id, esc(x.name)]).concat([['__add', gi('plus')]]), k.hostId)}</div>`)
        + '<div class="help" style="margin-top:6px">Double-click a host to edit it.</div>'
        + field('Command', `<textarea class="in mono" data-f="command" spellcheck="false" placeholder="uptime">${esc(k.command)}</textarea>`)
        + `<div class="row2">${field('Auth', input('keyPath', k.keyPath, { mono: 1, ph: '~/.ssh/id_ed25519' }))}<div class="field" style="flex:0 0 120px"><label>Timeout</label>${suffixInput('timeout', k.timeout, 's')}</div></div>`
        + field('On the key after firing', seg('after', [['ring', 'Ring'], ['lastline', 'Last line'], ['nothing', 'Nothing']], k.after))
        + `<div class="note">${gi('zap')}Fires on tap. No confirmation.</div>`;
      break;
    case 'status':
      h += field('Title', input('title', k.title)) + statusSourceFields(k)
        + field('Show', seg('show', [['valuebar', 'Value + bar'], ['value', 'Value'], ['updown', 'Up / down']], k.show))
        + `<div class="row2">${k.source === 'push' ? '' : `<div class="field"><label>Refresh</label>${suffixInput('refresh', k.refresh, 's')}</div>`}${field('On tap', input('onTap', k.onTap, { ph: 'URL to open' }))}</div>`;
      break;
    case 'folder':
      h += iconSection(k) + labelFields(k)
        + `<div class="field"><button class="btn" data-act="openFolder">${gi('folder-open')}Open folder</button></div>`
        + '<div class="help">Folders get a Back key, top-left to start. Drag it to move it. Double-click the key to open it.</div>';
      break;
    case 'goto':
      h += iconSection(k) + labelFields(k)
        + field('Page', `<select class="in" data-f="target">${S.cfg.pages.filter(x => x.id !== p.id).map(x => `<option value="${x.id}"${x.id === k.target ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`);
      break;
    case 'panel': {
      const z = sizeOf(k);
      h += field('Title', input('title', k.title))
        + `<div class="row2"><div class="field"><label>Width</label><div class="stepper" data-size="pw"><button data-d="-1">${gi('minus')}</button><span class="val">${z.w}</span><button data-d="1">${gi('plus')}</button></div></div>`
        + `<div class="field"><label>Height</label><div class="stepper" data-size="ph"><button data-d="-1">${gi('minus')}</button><span class="val">${z.h}</span><button data-d="1">${gi('plus')}</button></div></div></div>`
        + statusSourceFields(k, true)
        + `<div class="row2">${k.source === 'push' ? '' : `<div class="field"><label>Refresh</label>${suffixInput('refresh', k.refresh, 's')}</div>`}${field('On tap', input('onTap', k.onTap, { ph: 'URL to open' }))}</div>`;
      break;
    }
    case 'terminal': {
      const prog = TERM_PROGRAMS.some(x => x[0] === k.program) ? k.program : 'wt';
      if (S.wtProfiles == null) { S.wtProfiles = []; call('wtProfiles', {}).then(r => { S.wtProfiles = r || []; if (selKey() === k) renderInspector(); }).catch(() => {}); }
      const profs = S.wtProfiles.slice(); if (k.profile && !profs.includes(k.profile)) profs.unshift(k.profile);
      h += iconSection(k) + labelFields(k)
        + field('Program', seg('program', TERM_PROGRAMS.map(([v, n]) => [v, n]), prog, ' wrap'))
        + (prog === 'ssh' ? field('Host', `<div class="hostchips">${seg('hostId', S.cfg.hosts.map(x => [x.id, esc(x.name)]).concat([['__add', gi('plus')]]), k.hostId)}</div>`) + field('Auth', input('keyPath', k.keyPath, { mono: 1, ph: '~/.ssh/id_ed25519' })) : '')
        + field('Open in', seg('openIn', [['window', 'New window'], ['tab', 'New tab']], k.openIn || 'window'))
        + field('Windows Terminal profile', `<select class="in" data-f="profile"><option value=""${!k.profile ? ' selected' : ''}>Default profile</option>${profs.map(n => `<option value="${esc(n)}"${n === k.profile ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>`)
        + (prog === 'ssh' ? '' : field('Start folder', `<div class="inrow">${input('folder', k.folder, { mono: 1, ph: 'optional, like C:\\Projects' })}<button class="btnsq" data-act="browseFolder">${gi('folder-open')}</button></div>`))
        + (prog === 'wt' ? '<div class="help">Opens the profile you pick. To also run a command, pick PowerShell, cmd, WSL or SSH.</div>'
          : field('Command when it opens', `<textarea class="in mono" data-f="command" spellcheck="false" placeholder="${prog === 'cmd' ? 'dir' : prog === 'wsl' || prog === 'ssh' ? 'htop' : 'Get-Process | Sort CPU -Desc | Select -First 10'}">${esc(k.command)}</textarea>`) + '<div class="help">Optional. The terminal stays open after it runs.</div>')
        + field('Run as', seg('admin', [['false', 'Normal'], ['true', 'Admin']], k.admin ? 'true' : 'false'))
        + '<div class="help">New tab goes into the Windows Terminal window you used last. Without Windows Terminal, it opens in a classic console window.</div>';
      break;
    }
    case 'termsend':
      h += iconSection(k) + labelFields(k)
        + field('Text to send', `<textarea class="in mono" data-f="text" spellcheck="false" placeholder="git status">${esc(k.text)}</textarea>`)
        + '<div class="help">Typed exactly as written. Nothing presses Enter for you. A line break in the text is typed as Enter.</div>'
        + field('Send to', seg('target', [['recent', 'Last used terminal'], ['title', 'Window title has…']], k.target || 'recent'))
        + (k.target === 'title' ? field('Title has', input('title', k.title, { ph: 'e.g. Ubuntu or my-server' })) : '')
        + '<div class="help">If no terminal is open, nothing happens. A terminal running as admin needs Deckwell to run as admin too.</div>';
      break;
    case 'snap': {
      if (!S.monitors.length) refreshMonitors();
      h += iconSection(k) + labelFields(k)
        + field('Window', seg('target', [['active', 'Active window'], ['app', 'An app']], k.target || 'active'))
        + (k.target === 'app' ? field('App', `<div class="inrow">${input('exe', k.exe, { mono: 1, ph: 'C:\\path\\to\\app.exe' })}<button class="btnsq" data-act="browseSnapExe">${gi('folder-open')}</button></div>`) + '<div class="help">Opens the app first if it isn\'t running.</div>' : '')
        + field('Monitor', `<select class="in" data-f="monitor">${monitorOptions(k.monitor)}</select>`)
        + field('Spot', spotGrid(k))
        + `<div class="field"><button class="btn" data-act="editZones" data-mon="${esc(k.monitor || '')}">${gi('pencil')}Edit zones</button></div>`
        + '<div class="help">Custom zones show up once you pick Main or a specific monitor. If that monitor is unplugged, the main one is used.</div>';
      break;
    }
    case 'winpick': {
      const hide = !!(S.cfg.snap && S.cfg.snap.hideTitles);
      h += iconSection(k) + labelFields(k)
        + '<div class="help" style="margin-top:0">Tap it on the deck to see your open windows. Pick one, then pick a monitor and a spot.</div>'
        + field('On the deck, show', seg('hideTitles', [['false', 'App + window title'], ['true', 'App name only']], hide ? 'true' : 'false'))
        + '<div class="help">Window titles can show things like email subjects. They are sent to the deck signed, not encrypted.</div>'
        + `<div class="field"><button class="btn" data-act="editZones" data-mon="main">${gi('pencil')}Edit zones</button></div>`;
      break;
    }
    case 'layout': {
      const wins = k.windows || [];
      h += iconSection(k) + labelFields(k)
        + `<div class="field"><button class="btn accent" data-act="captureLayout">${gi('camera')}${wins.length ? 'Capture again' : 'Capture my windows now'}</button></div>`
        + '<div class="help">Saves where every open window is right now. Minimized windows are skipped. Pressing the key puts them back and opens any app that isn\'t running.</div>'
        + field(`Saved windows (${wins.length})`, wins.length ? `<div class="winlist">${wins.map((w, i) => `<div class="wl"><div class="wl-t"><b>${esc(w.app)}</b><span>${esc(w.monName || '')} · ${w.max ? 'maximized' : Math.round(w.w * 100) + '% × ' + Math.round(w.h * 100) + '%'}</span></div><button class="mini" data-act="dropWin" data-i="${i}" title="Remove">${gi('x')}</button></div>`).join('')}</div>` : '<div class="lastrun"><span class="dim">Nothing saved yet</span></div>');
      break;
    }
    case 'nowplaying':
      h += '<div class="help" style="margin-top:0">Shows whatever Windows is playing right now: track, artist, app, progress and album art. Tap it on the deck to play or pause.</div>'
        + '<div class="help">Takes two keys side by side.</div>';
      break;
  }
  if (EXTRA_TYPES.includes(k.type)) h += extrasSection(k, p);
  h += footer(!['folder', 'goto', 'nowplaying', 'panel'].includes(k.type) || (k.steps && k.steps.length > 0));
  el.innerHTML = h; hydrate(el);
}
/* ---------------- status tile sources (docs/status-tiles.md) ---------------- */
const STATUS_FORMAT = '<div class="help">The last line your command prints is shown on the tile: <span class="code">value|subtitle|bar</span>, like <span class="code">72%|4 cores|0.72</span>. Only the value is required. <a href="#" data-act="docs" data-doc="status-tiles">How status tiles work</a></div>';
const PANEL_FORMAT = '<div class="help">Everything your command prints is shown, top to bottom. The text grows to fill the panel. If it\'s too long, swipe up and down on the deck to scroll. <a href="#" data-act="docs" data-doc="status-tiles">How panels work</a></div>';
function statusSourceFields(k, panel) {
  const src = ['pc', 'command', 'ssh', 'push'].includes(k.source) ? k.source : '';
  const FORMAT = panel ? PANEL_FORMAT : STATUS_FORMAT;
  let h = field('Data source', seg('source', [['pc', 'This PC'], ['command', 'Command'], ['ssh', 'SSH'], ['push', 'Push']], src));
  if (!src) return h + `<div class="help">Pick where this ${panel ? 'panel' : 'tile'} gets its ${panel ? 'text' : 'value'}. It shows "—" until then.</div>`;
  if (src === 'pc' && panel) h += field('Show this PC\'s', seg('metric', [['topcpu', 'Top apps by CPU'], ['topmem', 'Top apps by memory']], k.metric === 'topmem' ? 'topmem' : 'topcpu'));
  else if (src === 'pc') h += field('Show this PC\'s', seg('metric', [['cpu', 'CPU'], ['ram', 'RAM']], k.metric || 'cpu'));
  if (src === 'command') h += field('Runs in', seg('shell', [['powershell', 'PowerShell'], ['cmd', 'cmd']], k.shell || 'powershell'))
    + field('Command', `<textarea class="in mono" data-f="command" spellcheck="false" placeholder="${panel ? 'Get-Process | Sort CPU -Desc | Select -First 10 Name, CPU | Format-Table -Auto' : "$d = Get-PSDrive C; '{0:0}%|C: {1:0} GB free' -f (100*$d.Used/($d.Used+$d.Free)), ($d.Free/1GB)"}">${esc(k.command)}</textarea>`) + FORMAT;
  if (src === 'ssh') h += field('Host', `<div class="hostchips">${seg('hostId', S.cfg.hosts.map(x => [x.id, esc(x.name)]).concat([['__add', gi('plus')]]), k.hostId)}</div>`)
    + field('Command', `<textarea class="in mono" data-f="command" spellcheck="false" placeholder="${panel ? 'sensors' : 'uptime -p'}">${esc(k.command)}</textarea>`)
    + field('Auth', input('keyPath', k.keyPath, { mono: 1, ph: '~/.ssh/id_ed25519' })) + FORMAT;
  if (src === 'push') {
    const feed = k.feed || '';
    const pi = S.push || {};
    const url = `http://127.0.0.1:${pi.port || 8770}/status/${encodeURIComponent(feed || 'my-feed')}`;
    h += field('Feed name', input('feed', feed, { mono: 1, ph: 'gpu-temp' }))
      + `<div class="help">Your script sends values to this tile. It only works from this computer and needs your token.</div>`
      + field('Send to', `<div class="lastrun">${esc(url)}</div>`)
      + field('Token', `<div class="inrow"><input class="in mono" readonly value="${pi.token ? '••••••••••••••••' : 'starting…'}"><button class="btn" data-act="copyToken">${gi('copy')}Copy</button></div>`)
      + (pi.error ? `<div class="help" style="color:var(--danger)">${esc(pi.error)}</div>` : '')
      + `<div class="help">PowerShell example:<div class="lastrun">$t = Get-Content "$env:APPDATA\\Deckwell\\push-token.txt"\nInvoke-RestMethod -Method Post ${esc(url)} -Headers @{ Authorization = "Bearer $t" } -Body ${panel ? "(Get-Process | Out-String)" : "'72%|4 cores|0.72'"}</div><a href="#" data-act="docs" data-doc="status-tiles">More examples</a></div>`;
  }
  return h;
}
/* ---------------- window snap helpers ---------------- */
function refreshMonitors() { return call('getMonitors', {}).then(r => { S.monitors = r || []; const k = selKey(); if (k && (k.type === 'snap')) renderInspector(); }).catch(() => {}); }
function monitorOptions(cur) {
  cur = cur || 'current';
  const opts = [['current', 'Where the window is now'], ['main', 'Main monitor']].concat(S.monitors.map(m => [m.id, `${m.name} · ${m.w}×${m.h}${m.main ? ' · main' : ''}`]));
  if (!opts.some(o => o[0] === cur)) opts.push([cur, 'Unplugged display (uses main)']);
  return opts.map(([v, n]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(n)}</option>`).join('');
}
function spotList(mon) { const m = zoneMonitor(mon); return SPOTS.concat(m ? zonesOf(m.id).map(z => ['zone:' + z.id, z.name, z.x, z.y, z.w, z.h, true]) : []); }
function spotOptions(cur, mon) { return spotList(mon).map(([v, n]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(n)}</option>`).join(''); }
function spotGrid(k) {
  const m = zoneMonitor(k.monitor) || mainMonitor() || { w: 16, h: 9 };
  const ar = Math.max(.4, Math.min(.8, m.h / m.w));
  return `<div class="spots">${spotList(k.monitor).map(([v, n, x, y, w, h, zone]) => `<button class="spot${v === k.spot ? ' on' : ''}" data-spot="${esc(v)}" title="${esc(n)}">
    <i style="padding-top:${ar * 100}%"><b class="${zone ? 'zone' : ''}" style="left:${x * 100}%;top:${y * 100}%;width:${w * 100}%;height:${h * 100}%"></b></i><span>${esc(n)}</span></button>`).join('')}</div>`;
}

/* ---------------- custom zones (per monitor, drawn on a picture of it) ---------------- */
let zoneMon = null, zoneSel = null, zoneDrag = null;
function openZones(mon) {
  const m = zoneMonitor(mon) || mainMonitor();
  if (!m) { refreshMonitors().then(() => { if (S.monitors.length) openZones(mon); else toast('No monitors found'); }); return; }
  zoneMon = m.id; zoneSel = null; renderZones();
}
function renderZones() {
  const el = $('#zones'); const m = S.monitors.find(x => x.id === zoneMon) || zoneMonitor(zoneMon);
  S.cfg.zones = S.cfg.zones || {};
  const zs = zonesOf(zoneMon); const sel = zs.find(z => z.id === zoneSel);
  const W = 640, H = Math.round(W * Math.max(.3, Math.min(1, m.h / m.w)));
  el.innerHTML = `<div class="zone-card" role="dialog" aria-label="Custom zones"><div class="zone-head"><h2>Custom zones</h2><span class="spacer"></span><button class="btn accent" data-z="done">Done</button></div>
    ${S.monitors.length > 1 ? `<div class="seg zone-mons">${S.monitors.map(x => `<button data-zm="${esc(x.id)}" class="${x.id === zoneMon ? 'on' : ''}">${esc(x.name)}</button>`).join('')}</div>` : ''}
    <div class="help">Drag on the screen to draw a zone. Click a zone to rename or remove it. Zones show up in Snap window keys and the deck's window picker.</div>
    <div class="zone-screen" id="zoneScreen" style="width:${W}px;height:${H}px">${zs.map(z => `<div class="zone${z.id === zoneSel ? ' sel' : ''}" data-zid="${esc(z.id)}" style="left:${z.x * 100}%;top:${z.y * 100}%;width:${z.w * 100}%;height:${z.h * 100}%"><span>${esc(z.name)}</span></div>`).join('')}
      <div class="zone ghost" id="zoneGhost" hidden></div><div class="zone-res">${esc(m.name)} · ${m.w}×${m.h}</div></div>
    ${sel ? `<div class="zone-edit"><input class="in" id="zoneName" maxlength="30" value="${esc(sel.name)}" spellcheck="false"><button class="btn danger" data-z="del">${gi('trash')}Remove</button></div>` : ''}</div>`;
  el.hidden = false; hydrate(el);
  const nm = el.querySelector('#zoneName');
  if (nm) { nm.addEventListener('input', () => { sel.name = nm.value.trim() || 'Zone'; el.querySelectorAll(`[data-zid="${CSS.escape(sel.id)}"] span`).forEach(x => x.textContent = sel.name); coalescedCommit(); }); nm.addEventListener('keydown', e => e.stopPropagation()); }
}
function wireZones() {
  const el = $('#zones');
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-z],[data-zm]');
    if (!b) { if (e.target.id === 'zones') closeZones(); return; }
    if (b.dataset.zm) { zoneMon = b.dataset.zm; zoneSel = null; renderZones(); return; }
    if (b.dataset.z === 'done') closeZones();
    if (b.dataset.z === 'del') { S.cfg.zones[zoneMon] = zonesOf(zoneMon).filter(z => z.id !== zoneSel); zoneSel = null; commit(); renderZones(); }
  });
  el.addEventListener('mousedown', e => {
    const scr = e.target.closest('#zoneScreen'); if (!scr || e.button !== 0) return;
    const hit = e.target.closest('.zone[data-zid]');
    if (hit) { zoneSel = hit.dataset.zid; renderZones(); return; }
    const r = scr.getBoundingClientRect();
    zoneDrag = { r, x0: (e.clientX - r.left) / r.width, y0: (e.clientY - r.top) / r.height };
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!zoneDrag) return;
    const g = $('#zoneGhost'); const d = zoneDrag;
    const x1 = Math.max(0, Math.min(1, (e.clientX - d.r.left) / d.r.width)), y1 = Math.max(0, Math.min(1, (e.clientY - d.r.top) / d.r.height));
    d.box = { x: Math.min(d.x0, x1), y: Math.min(d.y0, y1), w: Math.abs(x1 - d.x0), h: Math.abs(y1 - d.y0) };
    g.hidden = false; Object.assign(g.style, { left: d.box.x * 100 + '%', top: d.box.y * 100 + '%', width: d.box.w * 100 + '%', height: d.box.h * 100 + '%' });
  });
  document.addEventListener('mouseup', () => {
    if (!zoneDrag) return; const b = zoneDrag.box; zoneDrag = null;
    if (!b || b.w < .05 || b.h < .05) { const g = $('#zoneGhost'); if (g) g.hidden = true; return; }
    const r4 = v => Math.round(v * 1000) / 1000;
    const z = { id: uid(), name: 'Zone ' + (zonesOf(zoneMon).length + 1), x: r4(b.x), y: r4(b.y), w: r4(b.w), h: r4(b.h) };
    S.cfg.zones[zoneMon] = zonesOf(zoneMon).concat([z]); zoneSel = z.id; commit(); renderZones();
    setTimeout(() => { const n = $('#zoneName'); if (n) { n.focus(); n.select(); } }, 0);
  });
  document.addEventListener('keydown', e => { if (!$('#zones').hidden && e.key === 'Escape') { closeZones(); e.stopImmediatePropagation(); } }, true);
}
function closeZones() { $('#zones').hidden = true; zoneDrag = null; renderInspector(); }

const suffixInput = (f, v, suf) => `<div class="suffix"><input class="in" data-f="${f}" data-num="1" value="${esc(v)}" spellcheck="false"><span data-suf="${suf}"></span></div>`;
function layoutSuffixes() {
  document.querySelectorAll('.suffix').forEach(w => {
    const inp = w.querySelector('input'), sp = w.querySelector('span');
    const m = document.createElement('canvas').getContext('2d'); m.font = '13.5px Inter';
    sp.style.left = (11 + m.measureText(inp.value).width + 5) + 'px'; sp.textContent = sp.dataset.suf;
  });
}
function sliderInspector(p, i) {
  const s = p.strip[i];
  let h = `<div class="ins-head"><span class="badge">Slider</span><span class="ins-loc">${esc(p.name)} · slider ${i + 1} of ${p.strip.length}</span></div>`;
  h += field('Controls', seg('control', [['master', 'Master'], ['app', 'App'], ['mic', 'Mic']], s.control));
  if (s.control === 'app') {
    const list = S.sessions.slice();
    if (s.app && !list.find(x => x.name.toLowerCase() === s.app.toLowerCase())) list.unshift({ name: s.app, label: s.appLabel || s.app, offline: true });
    h += field('App (audio sessions right now)', `<div class="sessions">${list.length ? list.map(x => `<div class="sess${s.app && x.name.toLowerCase() === s.app.toLowerCase() ? ' on' : ''}" data-sess="${esc(x.name)}" data-label="${esc(x.label)}">
      <span class="mono2">${esc(monogram(x.label))}</span>${esc(x.label)}${x.offline ? ' <span style="color:var(--text3);font-size:12px">· not running</span>' : ''}${s.app && x.name.toLowerCase() === s.app.toLowerCase() ? `<span class="ck">${svg('check')}</span>` : ''}</div>`).join('')
      : '<div class="sess none">No apps are playing audio right now.</div>'}</div>`)
      + `<div class="help">If ${esc(s.appLabel || 'the app')} isn't running, the slider greys out on the deck.</div>`;
  }
  h += `<div class="row2"><div class="field"><label>Step</label>${suffixInput('step', s.step, '%')}</div>${field('Button below', `<select class="in" data-f="button"><option value="mute"${s.button === 'mute' ? ' selected' : ''}>Mute toggle</option><option value="none"${s.button === 'none' ? ' selected' : ''}>None</option></select>`)}</div>`;
  h += `<div class="ins-foot"><span class="spacer"></span><button class="clear" data-act="clearSlider">${gi('trash')}Clear</button></div>`;
  return h;
}
function pageInspector(p) {
  const par = page(p.parentId);
  const isFolder = p.parentId && par && par.keys.some(k => k.type === 'folder' && k.target === p.id);
  let h = `<div class="ins-head"><span class="badge">${isFolder ? 'Folder' : p.parentId ? 'Key page' : 'Page'}</span><span class="ins-loc">${p.cols} × ${p.rows}${par ? ' · in ' + esc(par.name) : ''}</span></div>`;
  h += field('Name', `<input class="in" data-pf="name" value="${esc(p.name)}" spellcheck="false">`);
  h += `<div class="help">Click a key to edit it. Drag actions from the bottom onto a key, or drag keys to move them. Drop a key on a page in the sidebar to move it there.</div>`;
  h += `<div class="help">Ctrl+Z undo · Ctrl+Y redo · Delete clears the selected key.</div>`;
  const roots = S.cfg.pages.filter(x => !x.parentId);
  const openers = S.cfg.pages.flatMap(x => x.keys.filter(k => k.goPage === p.id).map(k => k.label || 'a key'));
  if (openers.length) h += `<div class="help">The deck shows this page after you press <b>${openers.map(esc).join('</b>, <b>')}</b>.</div>`;
  const orphan = p.parentId && !isFolder;
  const del = (!p.parentId && roots.length > 1) || orphan ? `<button class="clear" data-act="deletePage">${gi('trash')}Delete page</button>` : '';
  if (!p.parentId && del) h += `<div class="ins-foot"><span class="spacer"></span>${del}</div>`;
  if (p.parentId) h += `<div class="ins-foot"><button class="btn" data-act="upFolder">${gi('back')}Back to ${esc(par ? par.name : '')}</button><span class="spacer"></span>${del}</div>`;
  return h;
}

/* ---------------- inspector events ---------------- */
function onInspectorInput(e) {
  const t = e.target; const p = curPage();
  if (t.dataset.pf) { p[t.dataset.pf] = t.value; syncFolderKeyName(p); commit({ coalesce: 1 }); renderSidebar(); renderHeader(); return; }
  if (t.dataset.sf != null) {
    const k = selKey(); const st = k && k.steps && k.steps[+t.dataset.si]; if (!st) return;
    let v = t.value;
    if (t.dataset.num) { v = parseFloat(v); if (isNaN(v)) return; }
    if (t.dataset.sf === 'sec') st.ms = Math.round(Math.max(0, Math.min(30, v)) * 1000); else st[t.dataset.sf] = v;
    if (st.type === 'snap' && t.dataset.sf === 'monitor' && !spotList(v).some(x => x[0] === st.spot)) st.spot = 'left';
    coalescedCommit();
    if (t.tagName === 'SELECT' && ['monitor', 'program'].includes(t.dataset.sf)) renderInspector();
    return;
  }
  if (!t.dataset.f) return;
  const tgt = S.sel.t === 'slider' ? p.strip[S.sel.i] : selKey(); if (!tgt) return;
  let v = t.value;
  if (t.dataset.num) { v = parseFloat(v); if (isNaN(v)) return; layoutSuffixes(); }
  tgt[t.dataset.f] = v;
  if (tgt.type === 'folder' && t.dataset.f === 'label') { const fp = page(tgt.target); if (fp) fp.name = v; renderSidebar(); }
  if (t.dataset.f === 'monitor' && tgt.type === 'snap' && !spotList(v).some(x => x[0] === tgt.spot)) { tgt.spot = 'left'; coalescedCommit(); renderBoard(); renderInspector(); return; }
  if (t.dataset.f === 'monitor' && tgt.type === 'snap') { coalescedCommit(); renderInspector(); return; }
  if (t.dataset.f === 'goPage') { if (!v) delete tgt.goPage; coalescedCommit(); renderBoard(); renderInspector(); return; }
  if (tgt.type === 'goto' && t.dataset.f === 'target') { const tp = page(v); if (tp && (tgt.label === 'Go to page' || S.cfg.pages.some(x => x.name === tgt.label))) tgt.label = tp.name; renderInspector(); }
  coalescedCommit(); renderBoard();
}
let coalesceTimer = null, coalescing = false;
function coalescedCommit() {
  if (!coalescing) { S.hist.push(S.lastSnap); S.fut = []; coalescing = true; }
  S.lastSnap = JSON.stringify(S.cfg); S.sync = 'pending'; renderSync();
  clearTimeout(saveTimer); saveTimer = setTimeout(save, 400);
  clearTimeout(coalesceTimer); coalesceTimer = setTimeout(() => coalescing = false, 900);
}
function syncFolderKeyName(p) { if (!p.parentId) return; const par = page(p.parentId); const k = par && par.keys.find(x => x.type === 'folder' && x.target === p.id); if (k) k.label = p.name; }
async function onInspectorChange(e) {
  const t = e.target; const k = selKey();
  if (k && k.type === 'app' && t.dataset.f === 'exe') await pullExeIcon(k, true);
}
async function pullExeIcon(k, auto) {
  if (!k.exe) return;
  if (auto && k.icon && k.icon.kind === 'image') return;
  try { const r = await call('iconFromExe', { path: k.exe }); if (r && r.id) { k.icon = { kind: 'exe', id: r.id }; commit(); renderBoard(); renderInspector(); } else if (!auto) toast("Couldn't read an icon from that file"); }
  catch (e) { if (!auto) toast(e.message); }
}
async function onInspectorClick(e) {
  const b = e.target.closest('button,[data-act],.sess'); if (!b) return;
  const p = curPage(); const k = selKey();
  const ss = b.closest('[data-sseg]');
  if (ss && b.dataset.v != null && k && k.steps) { const st = k.steps[+ss.dataset.si]; if (st) { st[ss.dataset.sseg] = b.dataset.v; commit(); renderInspector(); } return; }
  if (b.closest('[data-seg]') && b.dataset.v != null) {
    const segEl = b.closest('[data-seg]'); const f = segEl.dataset.seg; const tgt = S.sel && S.sel.t === 'slider' ? p.strip[S.sel.i] : k;
    if (!tgt || segEl.classList.contains('disabled')) return;
    if (f === 'hostId' && b.dataset.v === '__add') return hostPopover(null, b);
    if (f === 'hideTitles') { S.cfg.snap = Object.assign({}, S.cfg.snap, { hideTitles: b.dataset.v === 'true' }); commit(); renderInspector(); return; }
    if (f === 'admin') { tgt.admin = b.dataset.v === 'true'; commit(); renderInspector(); return; }
    tgt[f] = b.dataset.v;
    if (f === 'control' && tgt.control !== 'app') { tgt.app = ''; tgt.appLabel = ''; }
    if (tgt.type === 'status' && f === 'metric' && ['CPU', 'RAM'].includes(tgt.title)) tgt.title = tgt.label = b.dataset.v.toUpperCase();
    if (tgt.type === 'status' && f === 'source' && b.dataset.v === 'ssh' && (tgt.refresh || 5) < 10) tgt.refresh = 10;
    commit(); renderBoard(); renderInspector(); return;
  }
  if (b.classList.contains('sess') && b.dataset.sess) { const s = p.strip[S.sel.i]; s.app = b.dataset.sess; s.appLabel = b.dataset.label; commit(); renderBoard(); renderInspector(); return; }
  if (b.dataset.spot != null && k) {
    const wasDefault = !k.label || k.label === spotName(k.spot, k.monitor);
    k.spot = b.dataset.spot; if (wasDefault) k.label = spotName(k.spot, k.monitor);
    commit(); renderBoard(); renderInspector(); return;
  }
  const sz = b.closest('[data-size]');
  if (sz && b.dataset.d && k) {
    const f = sz.dataset.size, max = f === 'pw' ? 4 : 3, old = sizeOf(k);
    const v = Math.max(1, Math.min(max, (f === 'pw' ? old.w : old.h) + +b.dataset.d));
    const w = f === 'pw' ? v : old.w, h = f === 'ph' ? v : old.h;
    if (w === old.w && h === old.h) return;
    if (w * h < 2) return toast('A panel is at least 2 keys');
    if (!areaFree(p, k.row, k.col, w, h, k.id)) return toast(k.row + h > p.rows || k.col + w > p.cols ? 'Not enough room on the page. Add columns or rows, or move the panel.' : 'Other keys are in the way');
    k.pw = w; k.ph = h; commit(); renderBoard(); renderInspector(); return;
  }
  if (b.dataset.media && k) { k.type = 'media'; k.media = b.dataset.media; if (!k.label || k.label === 'Hotkey' || Object.values(MEDIA).some(m => m.lab === k.label)) k.label = MEDIA[k.media].lab; delete k.keys; commit(); renderBoard(); renderInspector(); return; }
  switch (b.dataset.act) {
    case 'fromExe': if (!k.exe) { const f = await call('pickFile', { kind: 'exe' }); if (!f) return; k.exe = f; if (k.label === 'App') k.label = exeName(f).replace(/\.exe$/i, ''); }
      k.icon = null; await pullExeIcon(k, false); renderInspector(); renderBoard(); break;
    case 'upload': { const r = await call('uploadImage', {}); if (r && r.id) { k.icon = { kind: 'image', id: r.id }; commit(); renderAll(); } break; }
    case 'resetIcon': k.icon = null; commit(); renderAll(); break;
    case 'glyphs': if (k.type !== 'app' && k.type !== 'hotkey') glyphPopover(k, b); break;
    case 'browseExe': { const f = await call('pickFile', { kind: 'exe' }); if (f) { k.exe = f; if (k.label === 'App') k.label = exeName(f).replace(/\.exe$/i, ''); commit(); await pullExeIcon(k, true); renderAll(); } break; }
    case 'browseScript': { const f = await call('pickFile', { kind: k.runtime === 'python' ? 'py' : 'ps1' }); if (f) { k.file = f; commit(); renderInspector(); } break; }
    case 'record': startRecording(k); break;
    case 'test': testKey(k); break;
    case 'dup': duplicateKey(k); break;
    case 'clear': removeKey(p, k); S.sel = null; commit(); renderAll(); break;
    case 'clearSlider': p.strip[S.sel.i] = null; S.sel = null; commit(); renderAll(); break;
    case 'openFolder': openPage(k.target); break;
    case 'addStep': stepMenu(k, b); break;
    case 'stepUp': case 'stepDown': {
      const i = +b.dataset.si, j = b.dataset.act === 'stepUp' ? i - 1 : i + 1;
      if (j < 0 || j >= k.steps.length) return;
      [k.steps[i], k.steps[j]] = [k.steps[j], k.steps[i]]; commit(); renderInspector(); break;
    }
    case 'stepDel': if (S.recording && S.recKey === k.steps[+b.dataset.si]) stopRecording(true); k.steps.splice(+b.dataset.si, 1); if (!k.steps.length) delete k.steps; commit(); renderBoard(); renderInspector(); break;
    case 'stepRecord': startRecording(k.steps[+b.dataset.si], true); break;
    case 'stepExe': { const f = await call('pickFile', { kind: 'exe' }); if (f) { k.steps[+b.dataset.si].exe = f; commit(); renderInspector(); } break; }
    case 'stepScript': { const st = k.steps[+b.dataset.si]; const f = await call('pickFile', { kind: st.runtime === 'python' ? 'py' : 'ps1' }); if (f) { st.file = f; commit(); renderInspector(); } break; }
    case 'openGoPage': openPage(k.goPage); break;
    case 'browseFolder': { const f = await call('pickFolder', {}); if (f) { k.folder = f; commit(); renderInspector(); } break; }
    case 'browseSnapExe': { const f = await call('pickFile', { kind: 'exe' }); if (f) { k.exe = f; commit(); renderInspector(); } break; }
    case 'editZones': openZones(b.dataset.mon || 'main'); break;
    case 'captureLayout': {
      try { const r = await call('captureLayout', {}); k.windows = r || []; commit(); renderAll(); toast(`Saved ${k.windows.length} window${k.windows.length === 1 ? '' : 's'}`); }
      catch (err) { toast('Capture failed: ' + err.message); } break;
    }
    case 'dropWin': k.windows.splice(+b.dataset.i, 1); commit(); renderAll(); break;
    case 'copyToken': { const pi = S.push || {}; if (!pi.token) return toast('The push server is still starting'); try { await navigator.clipboard.writeText(pi.token); toast('Token copied'); } catch { toast('Couldn\'t copy. The token is in %APPDATA%\\Deckwell\\push-token.txt'); } break; }
    case 'docs': e.preventDefault(); call('openDocs', { page: b.dataset.doc || '' }); break;
    case 'newGoPage': {
      const name = (k.label || 'App').trim() || 'App';
      const np = { id: uid(), name, parentId: p.id, cols: p.cols, rows: p.rows, sliders: 'off', strip: [null, null, null], keys: [] };
      S.cfg.pages.push(np); k.goPage = np.id; commit(); renderAll();
      toast(`Made page "${name}" · open it to add its keys`); break;
    }
    case 'upFolder': openPage(p.parentId); break;
    case 'deletePage': deletePageTree(p.id); cleanGoPages(); S.pageId = p.parentId && page(p.parentId) ? p.parentId : S.cfg.pages.find(x => !x.parentId).id; S.sel = null; commit(); renderAll(); toast('Page deleted · Ctrl+Z to undo'); break;
  }
}
function duplicateKey(k) {
  const p = curPage(); const f = firstFree(p, sizeOf(k)); if (!f) return toast('No free keys on this page');
  const c = clone(k); c.id = uid(); c.row = f[0]; c.col = f[1]; delete c.lastRun; (c.steps || []).forEach(s => s.id = uid());
  if (c.type === 'folder') { const src = page(k.target); const np = clone(src); np.id = uid(); np.name = src.name + ' copy'; np.keys.forEach(x => x.id = uid()); S.cfg.pages.push(np); c.target = np.id; c.label = np.name; }
  p.keys.push(c); S.sel = { t: 'key', id: c.id }; commit(); renderAll();
}
async function testKey(k) {
  try { const r = await call('runKey', { key: withFaces({ pages: [{ ...curPage(), keys: [k] }], hosts: S.cfg.hosts }).pages[0].keys[0] }); toast(r && r.text ? r.text : 'Sent'); }
  catch (e) { toast('Failed: ' + e.message); }
}

/* ---------------- shortcut recorder ---------------- */
function startRecording(k, isStep) {
  if (S.recording) { const same = S.recKey === k; stopRecording(); if (same) return; }
  S.recording = true; S.recKey = k; S.recIsStep = !!isStep; S.recKeys = []; S.recHeld = new Set();
  renderInspector(); call('recordStart', {});
}
function stopRecording(cancel) {
  if (!S.recording) return;
  const k = S.recKey; S.recording = false; call('recordStop', {});
  if (!cancel && S.recKeys.length) {
    if (S.recIsStep) k.keys = S.recKeys;
    else { k.type = 'hotkey'; k.keys = S.recKeys; k.sendAs = k.sendAs || 'press'; delete k.media; if (!k.label || Object.values(MEDIA).some(m => m.lab === k.label)) k.label = 'Hotkey'; }
    commit();
  }
  S.recIsStep = false;
  renderAll();
}
const MODS = { 0x11: 'Ctrl', 0xA2: 'Ctrl', 0xA3: 'Ctrl', 0x10: 'Shift', 0xA0: 'Shift', 0xA1: 'Shift', 0x12: 'Alt', 0xA4: 'Alt', 0xA5: 'Alt', 0x5B: 'Win', 0x5C: 'Win' };
const MODVK = { Ctrl: 0x11, Shift: 0x10, Alt: 0x12, Win: 0x5B };
function recKey(name, vk, down) {
  if (!S.recording) return;
  if (vk === 0x1B) { if (down) stopRecording(S.recKeys.length === 0); return; }
  const mod = MODS[vk];
  if (down) {
    if (mod) { if (!S.recKeys.find(x => x.n === mod)) S.recKeys.push({ n: mod, vk: MODVK[mod] }); S.recHeld.add(mod); }
    else { S.recKeys = S.recKeys.filter(x => MODVK[x.n]); S.recKeys.push({ n: name, vk }); sortCaps(); renderInspector(); stopRecording(); return; }
    sortCaps(); renderInspector();
  } else if (mod) { S.recHeld.delete(mod); if (!S.recHeld.size && S.recKeys.length) stopRecording(); }
}
function sortCaps() { const o = { Ctrl: 0, Win: 1, Alt: 2, Shift: 3 }; S.recKeys.sort((a, b) => (o[a.n] ?? 9) - (o[b.n] ?? 9)); }
on('recKey', d => recKey(d.name, d.vk, d.down));
const CODEVK = (code, key) => {
  let m;
  if ((m = code.match(/^Key([A-Z])$/))) return [m[1], m[1].charCodeAt(0)];
  if ((m = code.match(/^Digit(\d)$/))) return [m[1], 48 + +m[1]];
  if ((m = code.match(/^F(\d+)$/))) return ['F' + m[1], 0x6F + +m[1]];
  if ((m = code.match(/^Numpad(\d)$/))) return ['Num ' + m[1], 0x60 + +m[1]];
  const T = { ControlLeft: ['Ctrl', 0x11], ControlRight: ['Ctrl', 0x11], ShiftLeft: ['Shift', 0x10], ShiftRight: ['Shift', 0x10], AltLeft: ['Alt', 0x12], AltRight: ['Alt', 0x12], MetaLeft: ['Win', 0x5B], MetaRight: ['Win', 0x5B],
    Space: ['Space', 0x20], Enter: ['Enter', 0x0D], Tab: ['Tab', 0x09], Backspace: ['Bksp', 0x08], Delete: ['Del', 0x2E], Insert: ['Ins', 0x2D], Home: ['Home', 0x24], End: ['End', 0x23], PageUp: ['PgUp', 0x21], PageDown: ['PgDn', 0x22],
    ArrowLeft: ['←', 0x25], ArrowUp: ['↑', 0x26], ArrowRight: ['→', 0x27], ArrowDown: ['↓', 0x28], Escape: ['Esc', 0x1B], PrintScreen: ['PrtSc', 0x2C], Pause: ['Pause', 0x13],
    Minus: ['-', 0xBD], Equal: ['=', 0xBB], BracketLeft: ['[', 0xDB], BracketRight: [']', 0xDD], Backslash: ['\\', 0xDC], Semicolon: [';', 0xBA], Quote: ["'", 0xDE], Comma: [',', 0xBC], Period: ['.', 0xBE], Slash: ['/', 0xBF], Backquote: ['`', 0xC0],
    NumpadAdd: ['Num +', 0x6B], NumpadSubtract: ['Num -', 0x6D], NumpadMultiply: ['Num *', 0x6A], NumpadDivide: ['Num /', 0x6F], NumpadDecimal: ['Num .', 0x6E], NumpadEnter: ['Enter', 0x0D], CapsLock: ['Caps', 0x14], ContextMenu: ['Menu', 0x5D] };
  return T[code] || [key.length === 1 ? key.toUpperCase() : key, 0];
};

/* ---------------- popovers ---------------- */
function showPopover(html, anchor, bind) {
  const pop = $('#popover'); pop.innerHTML = html; pop.hidden = false; hydrate(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.left)) + 'px';
  const top = r.bottom + 6 + pop.offsetHeight > window.innerHeight ? r.top - pop.offsetHeight - 6 : r.bottom + 6;
  pop.style.top = Math.max(40, top) + 'px';
  bind && bind(pop);
  const inp = pop.querySelector('input'); if (inp) inp.focus();
}
function hidePopover() { $('#popover').hidden = true; }
function glyphPopover(k, anchor) {
  const names = ['terminal', 'square-terminal', 'rotate-cw', 'power', 'arrow-down-up', 'broom', 'cloud-upload', 'zap', 'server', 'cpu', 'hard-drive', 'database', 'container', 'activity', 'clock', 'globe', 'link', 'home', 'monitor', 'folder', 'file-py', 'file-terminal', 'code', 'box', 'shield', 'bell', 'search', 'rocket', 'flame', 'bot', 'brain', 'lightbulb', 'sun', 'moon', 'star', 'heart', 'music', 'film', 'gamepad', 'camera', 'message', 'radio', 'settings', 'wifi', 'download', 'upload', 'refresh', 'lock', 'play-pause', 'skip-back', 'skip-forward', 'stop', 'vol-up', 'vol-down', 'volume-x', 'mic', 'mic-off', 'goto', 'back', 'chart'];
  const cur = faceOf(k, curPage()).glyph;
  showPopover(`<div class="glyphgrid">${names.map(n => `<button data-glyph="${n}" class="${n === cur ? 'on' : ''}" title="${n}">${gi(n)}</button>`).join('')}</div>`, anchor, pop => {
    pop.querySelectorAll('[data-glyph]').forEach(b => b.onclick = () => { k.glyph = b.dataset.glyph; k.icon = null; commit(); hidePopover(); renderAll(); });
  });
}
function hostPopover(h, anchor) {
  const isNew = !h; h = h || { id: uid(), name: '', address: '', user: 'root', port: 22 };
  showPopover(`<div class="field"><label>Name</label><input class="in" id="hpName" value="${esc(h.name)}" placeholder="my-server"></div>
    <div class="field"><label>Address</label><input class="in mono" id="hpAddr" value="${esc(h.address)}" placeholder="IP or hostname"></div>
    <div class="row2"><div class="field"><label>User</label><input class="in mono" id="hpUser" value="${esc(h.user)}"></div><div class="field" style="flex:0 0 80px"><label>Port</label><input class="in mono" id="hpPort" value="${esc(h.port)}"></div></div>
    <div class="pop-foot">${isNew ? '' : '<button class="btn danger" id="hpDel">Remove</button><span style="flex:1"></span>'}<button class="btn" id="hpCancel">Cancel</button><button class="btn accent" id="hpSave">${isNew ? 'Add host' : 'Save'}</button></div>`, anchor, pop => {
    pop.querySelector('#hpCancel').onclick = hidePopover;
    pop.querySelector('#hpSave').onclick = () => {
      h.name = pop.querySelector('#hpName').value.trim(); h.address = pop.querySelector('#hpAddr').value.trim();
      h.user = pop.querySelector('#hpUser').value.trim(); h.port = parseInt(pop.querySelector('#hpPort').value) || 22;
      if (!h.name || !h.address) return toast('Name and address are required');
      if (isNew) { S.cfg.hosts.push(h); const k = selKey(); if (k && ['ssh', 'status', 'panel', 'terminal'].includes(k.type)) k.hostId = h.id; }
      commit(); hidePopover(); renderAll();
    };
    const del = pop.querySelector('#hpDel');
    if (del) del.onclick = () => { S.cfg.hosts = S.cfg.hosts.filter(x => x !== h); commit(); hidePopover(); renderAll(); };
  });
}
function devDiagHTML() {
  const d = S.dev; const lines = [];
  const mode = S.cfg.linkMode || 'auto';
  lines.push(d.connected ? `<span class="ok">● connected over ${d.link === 'usb' ? 'USB' : 'Wi-Fi'} · ${d.rtt} ms</span>` : '<span class="bad">● not connected</span>');
  if (mode !== 'usb') {
    if (S.cfg.deckIp) lines.push(`Wi-Fi  using ${esc(S.cfg.deckIp)}:8765`);
    else lines.push(d.beacon ? `Wi-Fi  beacon from ${esc(d.beacon)} · ${d.beaconAge}s ago` : 'Wi-Fi  no beacon heard <span class="dim">(firewall? set the IP)</span>');
  }
  if (mode !== 'wifi') {
    lines.push(`USB    ${esc(d.usbState || 'checking…')}`);
    lines.push(`<span class="dim">adb    ${esc(d.adbPath || 'not found')}</span>`);
  }
  lines.push(d.connected ? 'Pair   <span class="ok">paired · messages signed</span>' : d.pairState === 'outdated' ? 'Pair   <span class="bad">deck app out of date</span>' : d.pairState ? 'Pair   <span class="bad">not paired</span>' : 'Pair   <span class="dim">waiting for a deck</span>');
  if (!d.connected && d.lastTry) lines.push(`Last   ${esc(d.lastTry)}${d.lastError ? ' · <span class="bad">' + esc(d.lastError) + '</span>' : ''}`);
  return lines.join('\n');
}
function devicePopover(anchor) {
  const mode = S.cfg.linkMode || 'auto';
  const rename = S.dev.connected ? `<div class="field"><label>Deck name</label><div class="inrow"><input class="in" id="dpName" maxlength="40" value="${esc(S.dev.name)}" spellcheck="false"><button class="btn" id="dpRename">Save</button></div></div>` : '';
  const orient = S.cfg.orient || 'landscape';
  showPopover(`${rename}<div class="field"><label>Deck orientation</label>${seg('orient', [['landscape', 'Landscape'], ['portrait', 'Portrait'], ['auto', 'Auto rotate']], orient)}</div>
    <div class="help">Auto rotate turns with the tablet. Each page gets a portrait layout made from its landscape one.</div>
    <div class="field"><label>Connection</label>${seg('linkMode', [['auto', 'Auto'], ['wifi', 'Wi-Fi only'], ['usb', 'USB only']], mode)}</div>
    <div class="help">Auto tries Wi-Fi first and falls back to USB. Force one if Auto keeps picking the wrong link.</div>
    <div class="field"><label>Deck IP (optional)</label><input class="in mono" id="dpIp" value="${esc(S.cfg.deckIp || '')}" placeholder="auto-detected on Wi-Fi"></div>
    <div class="help">The deck's IP is shown on its "Can't reach desktop" screen.</div>
    <div class="field"><label>Status</label><div class="lastrun devdiag" id="dpDiag">${devDiagHTML()}</div></div>
    <div class="pop-foot"><button class="btn" id="dpRe">${gi('refresh')}Reconnect now</button>${S.dev.connected ? '<button class="btn" id="dpForget">Forget deck</button>' : ''}<span style="flex:1"></span><button class="btn" id="dpCancel">Close</button><button class="btn accent" id="dpSave">Save IP</button></div>`, anchor, pop => {
    pop.style.width = '380px';
    pop.querySelector('[data-seg="linkMode"]').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      S.cfg.linkMode = b.dataset.v; commit({ now: 1 });
      pop.querySelectorAll('[data-seg="linkMode"] button').forEach(x => x.classList.toggle('on', x === b));
      renderDevice(); refreshDiag();
    });
    pop.querySelector('[data-seg="orient"]').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      S.cfg.orient = b.dataset.v; commit({ now: 1 });
      pop.querySelectorAll('[data-seg="orient"] button').forEach(x => x.classList.toggle('on', x === b));
      if (b.dataset.v !== 'auto') S.view = b.dataset.v;
      renderAll();
    });
    pop.querySelector('#dpRe').onclick = () => { call('reconnect', {}); toast('Reconnecting…'); };
    const rn = pop.querySelector('#dpRename');
    if (rn) rn.onclick = async () => {
      const v = pop.querySelector('#dpName').value.trim();
      if (!v) return toast('The name can\'t be empty');
      const r = await call('renameDeck', { name: v });
      toast(r && r.error ? r.error : 'Renamed to ' + v);
    };
    const fg = pop.querySelector('#dpForget');
    if (fg) fg.onclick = () => {
      if (!fg.dataset.armed) { fg.dataset.armed = '1'; fg.textContent = 'Click again to forget'; return; }
      call('forgetDeck', {}); hidePopover(); toast('Forgot the deck. Pair it again to use it.');
    };
    pop.querySelector('#dpCancel').onclick = hidePopover;
    pop.querySelector('#dpSave').onclick = () => { S.cfg.deckIp = pop.querySelector('#dpIp').value.trim(); commit({ now: 1 }); refreshDiag(); setTimeout(() => call('reconnect', {}), 400); toast('Saved. Reconnecting…'); };
  });
}
function refreshDiag() { const el = document.getElementById('dpDiag'); if (el && !$('#popover').hidden) el.innerHTML = devDiagHTML(); }

/* ---------------- pages ---------------- */
function openPage(id) { if (!page(id)) return; S.pageId = id; S.sel = null; if (S.recording) stopRecording(true); renderAll(); }
function renamePageInline(el, p) {
  const nm = el.querySelector('.nm'); const inp = document.createElement('input'); inp.value = p.name; nm.replaceWith(inp); inp.focus(); inp.select();
  const done = ok => { if (ok && inp.value.trim()) { p.name = inp.value.trim(); syncFolderKeyName(p); commit(); } renderAll(); };
  inp.onkeydown = e => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); e.stopPropagation(); };
  inp.onblur = () => done(true);
}

/* ---------------- toast ---------------- */
let toastTimer;
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2600); }

/* ---------------- wiring ---------------- */
function wire() {
  renderPalette(); hydrate(document);
  // window controls + edges + drag
  document.querySelectorAll('[data-win]').forEach(b => b.onclick = () => call('window', { op: b.dataset.win }));
  $('#titlebar').addEventListener('mousedown', e => { if (e.button === 0 && !e.target.closest('button') && e.detail === 1) call('window', { op: 'drag' }); });
  $('#titlebar').addEventListener('dblclick', e => { if (!e.target.closest('button')) call('window', { op: 'max' }); });
  // sidebar
  $('#pages').addEventListener('click', e => { const r = e.target.closest('.pg'); if (r && !e.target.closest('input')) openPage(r.dataset.page); });
  $('#pages').addEventListener('dblclick', e => { const r = e.target.closest('.pg'); if (r) renamePageInline(r, page(r.dataset.page)); });
  $('#addPage').onclick = () => { const n = S.cfg.pages.filter(p => !p.parentId).length + 1; const p = { id: uid(), name: 'Page ' + n, parentId: null, cols: 5, rows: 3, sliders: 'off', strip: [null, null, null], keys: [] }; S.cfg.pages.push(p); S.pageId = p.id; S.sel = null; commit(); renderAll(); };
  $('#addFolder').onclick = () => placeNew('folder');
  // Clicks in the pairing panel stay there (its buttons re-render mid-click, so check the event path, not the target).
  $('#devPair').addEventListener('click', e => e.stopPropagation());
  $('#devcard').onclick = e => devicePopover(e.currentTarget);
  // header
  $('#pageTitle').onclick = () => { const p = curPage(); const h = $('#pageTitle'); h.innerHTML = `<input value="${esc(p.name)}">`; const inp = h.querySelector('input'); inp.focus(); inp.select();
    const done = ok => { if (ok && inp.value.trim()) { p.name = inp.value.trim(); syncFolderKeyName(p); commit(); } renderAll(); };
    inp.onkeydown = e => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); e.stopPropagation(); }; inp.onblur = () => done(true); };
  const stepper = (id, f, min, max) => $(id).addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; const p = curPage(); const v = Math.max(min, Math.min(max, p[f] + +b.dataset.d)); if (v === p[f]) return; p[f] = v; if (S.sel && S.sel.t === 'key') { const k = selKey(); if (k && (k.row >= p.rows || k.col >= p.cols)) S.sel = null; } commit(); renderAll(); });
  stepper('#colStep', 'cols', 1, 8); stepper('#rowStep', 'rows', 1, 6);
  $('#sliderSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; const p = curPage(); p.sliders = b.dataset.v; ensureStrip(p); if (p.sliders === 'off' && S.sel && S.sel.t === 'slider') S.sel = null; commit(); renderAll(); });
  $('#viewSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b || S.view === b.dataset.v) return; S.view = b.dataset.v; if (S.view === 'portrait') S.emptyCell = null; renderAll(); });
  $('#orderSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; const p = curPage(); p.porder = b.dataset.v; commit(); renderAll(); });
  $('#pSliderSeg').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return; const p = curPage();
    if (b.dataset.v === 'off') { p.sliders = 'off'; if (S.sel && S.sel.t === 'slider') S.sel = null; }
    else { p.pside = b.dataset.v; if (!stripSide(p)) p.sliders = 'right'; }
    ensureStrip(p); commit(); renderAll();
  });
  $('#sliderStep').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; const p = curPage(); setSliderCount(p, p.strip.length + +b.dataset.d); });
  // board
  const board = $('#boardInner');
  board.addEventListener('click', e => {
    const sl = e.target.closest('.sl,.slh'); if (sl) { if (sl.classList.contains('empty')) addSlider(+sl.dataset.slot); else { S.sel = { t: 'slider', i: +sl.dataset.slot }; renderBoard(); renderInspector(); } return; }
    const k = e.target.closest('.k'); if (!k) return;
    if (k.classList.contains('empty')) {
      if (portraitView()) { S.sel = null; S.emptyCell = null; renderBoard(); renderInspector(); return toast('Portrait follows the landscape layout. Switch to Landscape to place keys.'); }
      S.sel = null; S.emptyCell = [+k.dataset.r, +k.dataset.c]; renderBoard(); renderInspector(); return;
    }
    if (k.dataset.key === '__back') return;
    if (S.recording) stopRecording(true);
    S.sel = { t: 'key', id: k.dataset.key }; renderBoard(); renderInspector();
  });
  board.addEventListener('dblclick', e => {
    const k = e.target.closest('.k'); if (!k) return;
    if (k.dataset.key === '__back') return openPage(curPage().parentId);
    const key = curPage().keys.find(x => x.id === k.dataset.key); if (key && (key.type === 'folder' || key.type === 'goto')) openPage(key.target);
  });
  // drag & drop
  let drag = null;
  document.addEventListener('dragstart', e => {
    const chip = e.target.closest && e.target.closest('.chip'); const key = e.target.closest && e.target.closest('.k[data-key]');
    if (chip) { drag = { add: chip.dataset.add }; chip.classList.add('dragging'); }
    else if (key) { drag = { move: key.dataset.key, from: S.pageId }; key.classList.add('moving'); }
    else return;
    e.dataTransfer.effectAllowed = 'copyMove'; e.dataTransfer.setData('text/plain', 'deckwell');
  });
  document.addEventListener('dragend', () => { drag = null; document.querySelectorAll('.dragging,.moving,.dropok,.drop').forEach(x => x.classList.remove('dragging', 'moving', 'dropok', 'drop')); });
  document.addEventListener('dragover', e => {
    if (!drag) return;
    document.querySelectorAll('.dropok,.drop').forEach(x => x.classList.remove('dropok', 'drop'));
    const k = e.target.closest('#boardInner .k'); const sl = e.target.closest('#boardInner .sl,#boardInner .slh'); const pg = e.target.closest('.pg');
    if (drag.add === 'slider') { if (sl) { sl.classList.add('dropok'); e.preventDefault(); } return; }
    if (portraitView() && !pg) return; // portrait is a preview of the landscape grid
    if (k && !(drag.move === '__back' && drag.from !== S.pageId)) { k.classList.add('dropok'); e.preventDefault(); }
    else if (pg && drag.move && pg.dataset.page !== S.pageId) { pg.classList.add('drop'); e.preventDefault(); }
  });
  document.addEventListener('drop', e => {
    if (!drag) return; e.preventDefault();
    const d = drag; drag = null;
    const k = e.target.closest('#boardInner .k'); const sl = e.target.closest('#boardInner .sl,#boardInner .slh'); const pg = e.target.closest('.pg');
    document.querySelectorAll('.dropok,.drop').forEach(x => x.classList.remove('dropok', 'drop'));
    if (d.add === 'slider') { if (sl) { const i = +sl.dataset.slot; if (curPage().strip[i]) { curPage().strip[i] = null; } addSlider(i); } return; }
    if (d.add && k) return placeNew(d.add, +k.dataset.r, +k.dataset.c);
    if (d.move === '__back') {
      if (k && d.from === S.pageId) return moveBack(curPage(), +k.dataset.r, +k.dataset.c);
      if (pg) toast('Back stays in its folder');
      return;
    }
    if (d.move) {
      const from = page(d.from); const key = from.keys.find(x => x.id === d.move); if (!key) return;
      if (k) return moveKey(key, from, curPage(), +k.dataset.r, +k.dataset.c);
      if (pg) { const to = page(pg.dataset.page); if (key.type === 'folder' && (key.target === to.id || isDescendant(to.id, key.target))) return toast("Can't move a folder into itself");
        const f = firstFree(to, sizeOf(key)); if (!f) return toast(`No free keys on ${to.name}`); moveKey(key, from, to, f[0], f[1]); toast(`Moved to ${to.name}`); }
    }
  });
  // palette click = add to selected empty cell or first free
  $('#palette').addEventListener('click', e => { const c = e.target.closest('.chip'); if (!c) return; const cell = S.emptyCell; S.emptyCell = null; if (cell && cellFree(curPage(), cell[0], cell[1])) placeNew(c.dataset.add, cell[0], cell[1]); else placeNew(c.dataset.add); });
  // inspector
  const ins = $('#inspector');
  ins.addEventListener('input', onInspectorInput); ins.addEventListener('change', onInspectorChange); ins.addEventListener('click', onInspectorClick);
  ins.addEventListener('dblclick', e => { const b = e.target.closest('[data-seg="hostId"] button'); if (b && b.dataset.v !== '__add') hostPopover(hostById(b.dataset.v), b); });
  new MutationObserver(layoutSuffixes).observe(ins, { childList: true });
  // global keys
  document.addEventListener('mousedown', e => { if (!e.target.closest('#popover') && !e.target.closest('[data-seg="hostId"]') && !e.target.closest('#devcard') && !e.target.closest('.iconbox')) hidePopover(); });
  document.addEventListener('keydown', e => {
    if (S.recording && !HOST) { e.preventDefault(); const [n, vk] = CODEVK(e.code, e.key); recKey(n, vk, true); return; }
    if (S.recording) { e.preventDefault(); return; }
    const typing = e.target.closest('input,textarea,select');
    if (e.ctrlKey && !typing && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (e.ctrlKey && !typing && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && S.sel) {
      const p = curPage();
      if (S.sel.t === 'key') { const k = selKey(); if (k) removeKey(p, k); } else p.strip[S.sel.i] = null;
      S.sel = null; commit(); renderAll();
    } else if (e.key === 'Escape') { hidePopover(); if (S.sel) { S.sel = null; renderBoard(); renderInspector(); } }
  });
  document.addEventListener('keyup', e => { if (S.recording && !HOST) { const [n, vk] = CODEVK(e.code, e.key); recKey(n, vk, false); } });
  document.addEventListener('contextmenu', e => { if (!e.target.closest('input,textarea')) e.preventDefault(); });
  window.addEventListener('resize', fitBoard);
  // live data
  on('device', d => { S.dev = Object.assign(S.dev, d); renderDevice(); refreshDiag(); });
  on('synced', d => { if (S.sync !== 'pending') { S.sync = d.deck ? 'ok' : 'off'; renderSync(); } });
  on('np', d => { S.live.np = d; renderBoardLive(); });
  on('status', d => { S.live.status[d.id] = d; renderBoardLive(); });
  on('panel', d => { S.live.panel[d.id] = d; renderBoardLive(); });
  on('sliders', d => { Object.assign(S.live.sliders, d); renderBoardLive(); });
  on('sessions', d => { S.sessions = d || []; if (S.sel && S.sel.t === 'slider') renderInspector(); });
  on('keyResult', d => { for (const p of S.cfg.pages) { const k = p.keys.find(x => x.id === d.id); if (k && d.lastRun) { k.lastRun = d.lastRun; commit({ silent: true }); if (selKey() === k) renderInspector(); } } });
  on('maximized', d => document.body.classList.toggle('maxed', !!d));
}
let liveQueued = false;
function renderBoardLive() { if (liveQueued) return; liveQueued = true; requestAnimationFrame(() => { liveQueued = false; renderBoard(); }); }
function isDescendant(pid, ancestorId) { let p = page(pid); while (p && p.parentId) { if (p.parentId === ancestorId) return true; p = page(p.parentId); } return false; }

/* ---------------- first-launch intro ---------------- */
const INTRO = [
  { t: 'Welcome to Deckwell', art: `<div class="sm">${gi('monitor')}</div><div class="wire"></div><div class="big">${gi('grid')}</div><div class="wire"></div><div class="sm">${gi('tablet')}</div>`,
    b: '<p>Deckwell turns a spare tablet or phone into a deck of buttons for your PC.</p><p>You build the buttons <b>here, in this editor</b>. The deck just shows them, and when you tap one, this computer does the work.</p>' },
  { t: 'Connect your deck', art: `<div class="sm">${gi('tablet')}</div><div class="wire"></div><div class="codebox">482 913</div><div class="wire"></div><div class="sm">${gi('monitor')}</div>`,
    b: '<p>Install the Deckwell app on your tablet or phone and open it. It finds this computer on your <b>Wi-Fi</b>, or over <b>USB</b> on Android.</p><p>The first time, the deck shows a 6-digit code. In the card at the top left, <b>name the deck</b> and type the code, then tap <b>Pair</b> on the deck. After that it reconnects by itself.</p>' },
  { t: 'Build your pages', art: `<div class="grid">${['play-pause', 'music', '', 'globe', '', 'terminal', 'folder', ''].map((g, i) => `<i class="${i === 0 || i === 5 ? 'on' : ''}">${g ? gi(g) : ''}</i>`).join('')}</div>`,
    b: '<p><b>Drag an action</b> from the bar at the bottom onto an empty key. <b>Click a key</b> to edit it in the panel on the right.</p><p>Use the sidebar for more pages and folders, and the controls above the deck to set columns and rows. Swipe sideways on the deck to change pages.</p>' },
  { t: 'What keys can do', art: `<div class="chips">${[['app-window', 'Open app'], ['keyboard', 'Hotkey'], ['play-pause', 'Media'], ['globe', 'Website'], ['terminal', 'Script'], ['square-terminal', 'SSH'], ['chart', 'Status tile'], ['music', 'Now Playing'], ['folder', 'Folder'], ['goto', 'Go to page']].map(([g, n]) => `<span>${gi(g)}${n}</span>`).join('')}</div>`,
    b: '<p>A key can open an app, send a shortcut, control music, open a website, run a script, or run a command on a server over SSH.</p><p>Any key can also run <b>extra steps</b> in order. For example, open an app and then switch the deck to that app\'s own page.</p>' },
  { t: 'Sliders', art: `<div class="sliders">${[70, 45, 85, 30].map(v => `<b><i style="height:${v}%"></i></b>`).join('')}</div>`,
    b: '<p>Each page can show <b>1 to 6 sliders</b>, on the <b>left or right</b>. Use the Sliders controls above the deck.</p><p>A slider controls your master volume, one app\'s volume, or your mic, with a mute button underneath.</p>' },
  { t: 'Scripts and live tiles', art: `<div class="sm">${gi('terminal')}</div><div class="wire"></div><div class="big">${gi('chart')}</div><div class="wire"></div><div class="sm">${gi('server')}</div>`,
    b: '<p><b>Script</b> and <b>SSH</b> keys run your own commands. <b>Status tiles</b> show live values from this PC, a command, a server, or a script that sends updates.</p><p>The guides explain every feature and include ready-to-use scripts. Open them anytime from <b>Help</b> at the top.</p>', docs: true },
];
let introAt = 0;
function showIntro(at) {
  introAt = Math.max(0, Math.min(INTRO.length - 1, at || 0));
  const s = INTRO[introAt], last = introAt === INTRO.length - 1, el = $('#intro');
  el.innerHTML = `<div class="intro-card" role="dialog" aria-label="${esc(s.t)}"><div class="intro-art">${s.art}</div>
    <div class="intro-body"><div class="intro-step">${introAt + 1} of ${INTRO.length}</div><h2>${esc(s.t)}</h2>${s.b}</div>
    <div class="intro-foot"><div class="intro-dots">${INTRO.map((_, i) => `<i class="${i === introAt ? 'on' : ''}"></i>`).join('')}</div>
      ${last ? '' : '<button class="intro-skip" data-i="skip">Skip</button>'}
      ${introAt ? '<button class="btn" data-i="back">Back</button>' : ''}
      ${s.docs ? `<button class="btn" data-i="docs">${gi('globe')}Open the guides</button>` : ''}
      <button class="btn accent" data-i="next">${last ? 'Start building' : 'Next'}</button></div></div>`;
  el.hidden = false;
}
function closeIntro() {
  $('#intro').hidden = true;
  if (!S.cfg.introSeen) { S.cfg.introSeen = true; commit({ silent: true }); }
}
function wireIntro() {
  $('#helpBtn').onclick = () => showIntro(0);
  $('#intro').addEventListener('click', e => {
    const b = e.target.closest('[data-i]');
    if (!b) { if (e.target.id === 'intro') closeIntro(); return; }
    const a = b.dataset.i;
    if (a === 'next') { if (introAt === INTRO.length - 1) closeIntro(); else showIntro(introAt + 1); }
    else if (a === 'back') showIntro(introAt - 1);
    else if (a === 'skip') closeIntro();
    else if (a === 'docs') call('openDocs', { page: '' });
  });
  document.addEventListener('keydown', e => {
    if ($('#intro').hidden) return;
    if (e.key === 'Escape') closeIntro();
    else if (e.key === 'ArrowRight') { if (introAt < INTRO.length - 1) showIntro(introAt + 1); }
    else if (e.key === 'ArrowLeft') showIntro(introAt - 1);
    else return;
    e.stopImmediatePropagation(); e.preventDefault();
  }, true);
}

/* ---------------- demo mode (plain browser, no host) ---------------- */
const Demo = {
  icons: {},
  async call(cmd, a) {
    switch (cmd) {
      case 'getState': return { config: null, device: { connected: true, link: 'wifi', rtt: 12, ip: '192.168.1.42', usb: true, adb: true, name: 'Demo tablet', mode: 'auto', beacon: '192.168.1.42', beaconAge: 1, usbState: 'KFTHWI ready', adbPath: 'C:\\Deckwell\\adb\\adb.exe', lastTry: '', lastError: '' },
        sessions: [{ name: 'Spotify', label: 'Spotify' }, { name: 'Discord', label: 'Discord' }, { name: 'chrome', label: 'Chrome' }, { name: 'steam', label: 'Steam' }] };
      case 'saveConfig': return { deck: true };
      case 'pickFile': return a.kind === 'exe' ? 'C:\\Program Files\\App\\app.exe' : 'C:\\scripts\\job.' + a.kind;
      case 'runKey': return { ok: true, text: 'Ran ' + (a.key.label || 'key') };
      case 'pushInfo': return { port: 8770, token: 'demo-token-0000000000000000' };
      case 'getMonitors': return [{ id: '\\\\.\\DISPLAY1', name: 'Display 1', x: 0, y: 0, w: 2560, h: 1440, main: true }, { id: '\\\\.\\DISPLAY2', name: 'Display 2', x: 2560, y: 180, w: 1920, h: 1080, main: false }];
      case 'wtProfiles': return ['Windows PowerShell', 'Command Prompt', 'Ubuntu', 'Azure Cloud Shell'];
      case 'pickFolder': return 'C:\\Projects';
      case 'captureLayout': return [{ exe: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', app: 'Google Chrome', title: 'Deckwell', monitor: '\\\\.\\DISPLAY1', monName: 'Display 1', max: false, x: 0, y: 0, w: .5, h: 1 },
        { exe: 'C:\\Users\\demo\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe', app: 'Visual Studio Code', title: 'Hub.cs', monitor: '\\\\.\\DISPLAY1', monName: 'Display 1', max: false, x: .5, y: 0, w: .5, h: 1 },
        { exe: 'C:\\Users\\demo\\AppData\\Roaming\\Spotify\\Spotify.exe', app: 'Spotify', title: 'Spotify Premium', monitor: '\\\\.\\DISPLAY2', monName: 'Display 2', max: true, x: 0, y: 0, w: 1, h: 1 }];
      default: return null;
    }
  },
  start() {
    emit('np', { title: 'Midnight City', artist: 'M83', source: 'Spotify', pos: 97, dur: 243, playing: true });
    const main = page('main');
    emit('sliders', Object.fromEntries(main.strip.filter(Boolean).map((s, i) => [s.id, { value: [64, 40, 82, 55, 30, 70][i], enabled: true }])));
    const st = main.keys.filter(k => k.type === 'status');
    if (st[0]) emit('status', { id: st[0].id, value: '18%', sub: 'load 0.42', bar: .18 });
    if (st[1]) emit('status', { id: st[1].id, value: '12%', sub: 'queries blocked', bar: .12 });
  },
};

/* ---------------- boot ---------------- */
(async function boot() {
  wire();
  const st = await call('getState', {});
  const valid = st && st.config && Array.isArray(st.config.pages) && st.config.pages.length && st.config.pages.every(p => p && p.id);
  S.cfg = valid ? st.config : defaultConfig();
  S.cfg.pages.forEach(p => { p.strip = p.strip || [null, null, null]; p.keys = p.keys || []; ensureStrip(p); });
  S.cfg.hosts = S.cfg.hosts || [];
  if (!S.cfg.orient) S.cfg.orient = 'landscape';
  S.view = S.cfg.orient === 'portrait' ? 'portrait' : 'landscape';
  call('getMonitors', {}).then(r => { S.monitors = r || []; }).catch(() => {});
  if (st && st.device) S.dev = Object.assign(S.dev, st.device);
  S.sessions = (st && st.sessions) || [];
  call('pushInfo', {}).then(r => { S.push = r || {}; const k = selKey(); if (k && k.type === 'status') renderInspector(); }).catch(() => {});
  S.pageId = S.cfg.pages[0].id; S.lastSnap = JSON.stringify(S.cfg);
  if (!valid) save();
  else if (S.cfg.pages.some(p => p.keys.some(k => !k.face))) save(); // migrated config: compute faces and push to the deck
  if (valid && S.cfg.migratedFromV1) { delete S.cfg.migratedFromV1; S.lastSnap = JSON.stringify(S.cfg); save(); setTimeout(() => toast('Imported your v1 layout'), 600); }
  if (!HOST) Demo.start();
  renderAll();
  wireIntro(); wireZones();
  if (!S.cfg.introSeen) showIntro(0);
  if (document.fonts) document.fonts.ready.then(() => { layoutSuffixes(); fitBoard(); });
})();
