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

/* ---------------- deck geometry (shared with the Android/iOS deck apps, 1920x1200 design units) ---------------- */
const DECK = { W: 1920, H: 1200, pad: 37, top: 132, bottomReserve: 178, gap: 28, stripGap: 60, sliderW: 92, sliderGap: 50, maxSliders: 6 };
/** Width of a slider strip with n sliders. 3 sliders = 376, the original fixed strip. */
const stripW = n => n * DECK.sliderW + Math.max(0, n - 1) * DECK.sliderGap;
const stripSide = p => p.sliders === 'left' || p.sliders === 'right' ? p.sliders : null;
function geom(p) {
  const side = stripSide(p);
  const n = side ? Math.max(1, Math.min(DECK.maxSliders, p.strip.length)) : 0;
  const sw = side ? stripW(n) : 0;
  const availW = DECK.W - 2 * DECK.pad - (side ? sw + DECK.stripGap : 0);
  const availH = DECK.H - DECK.top - DECK.bottomReserve;
  const w = (availW - (p.cols - 1) * DECK.gap) / p.cols;
  let h = (availH - (p.rows - 1) * DECK.gap) / p.rows;
  h = Math.min(h, w);
  return { strip: !!side, side, n, sw, w, h, availW, gridH: p.rows * h + (p.rows - 1) * DECK.gap,
    gridX: side === 'left' ? sw + DECK.stripGap : 0, stripX: side === 'left' ? 0 : availW + DECK.stripGap,
    totalW: availW + (side ? DECK.stripGap + sw : 0) };
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
  live: { np: null, status: {}, sliders: {} }, sessions: [], hist: [], fut: [], sync: 'ok', recording: false,
};
const page = id => S.cfg.pages.find(p => p.id === (id || S.pageId));
const curPage = () => page(S.pageId);
const rootOf = p => { while (p && p.parentId) p = page(p.parentId); return p; };
const selKey = () => S.sel && S.sel.t === 'key' ? curPage().keys.find(k => k.id === S.sel.id) : null;
const hostById = id => S.cfg.hosts.find(h => h.id === id);

/* ---------------- default config ---------------- */
/** A fresh install starts empty: one page, no keys, no hosts. Nothing is preset. */
function defaultConfig() {
  return { version: 1, deckIp: '', hosts: [], pages: [{ id: 'main', name: 'Main', parentId: null, cols: 5, rows: 3, sliders: 'off', strip: [null, null, null], keys: [] }] };
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
  document.querySelectorAll('#sliderSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === side));
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
function occupancy(p) {
  const occ = {};
  if (p.parentId) occ['0,0'] = '__back';
  p.keys.forEach(k => { if (k.row < p.rows && k.col < p.cols) { occ[k.row + ',' + k.col] = k.id; if (span(k) === 2 && k.col + 1 < p.cols) occ[k.row + ',' + (k.col + 1)] = k.id; } });
  return occ;
}
const span = k => k.type === 'nowplaying' ? 2 : 1;
function backKey(p) { const par = page(p.parentId); return { id: '__back', type: 'back', row: 0, col: 0, label: 'Back', labelPos: 'bottom', sub: par ? par.name : '' }; }
function renderBoard() {
  const p = curPage(); const g = geom(p); const inner = $('#boardInner');
  const occ = occupancy(p);
  let html = '';
  const pos = (r, c, sp) => `left:${g.gridX + c * (g.w + DECK.gap)}px;top:${r * (g.h + DECK.gap)}px;width:${sp * g.w + (sp - 1) * DECK.gap}px;height:${g.h}px`;
  for (let r = 0; r < p.rows; r++) for (let c = 0; c < p.cols; c++) if (!occ[r + ',' + c]) html += `<div class="k empty" data-r="${r}" data-c="${c}" style="${pos(r, c, 1)}"></div>`;
  const keys = p.keys.filter(k => k.row < p.rows && k.col < p.cols);
  if (p.parentId) keys.unshift(backKey(p));
  keys.forEach(k => {
    const sp = Math.min(span(k), p.cols - k.col);
    const cls = ['k', k.type === 'status' ? 'status' : k.type === 'nowplaying' ? 'np' : '', k.type === 'back' ? 'back locked' : '', k.labelPos === 'top' ? 'top' : '',
      S.sel && S.sel.t === 'key' && S.sel.id === k.id ? 'sel' : ''].filter(Boolean).join(' ');
    html += `<div class="${cls}" data-key="${k.id}" data-r="${k.row}" data-c="${k.col}" ${k.type !== 'back' ? 'draggable="true"' : ''} style="${pos(k.row, k.col, sp)}">${keyFaceHTML(k, p)}</div>`;
  });
  if (g.strip) {
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
  inner.style.width = g.totalW + 'px'; inner.style.height = g.gridH + 'px';
  fitBoard();
}
function sliderName(s) { return s.control === 'master' ? 'Master' : s.control === 'mic' ? 'Mic' : (s.appLabel || s.app || 'App'); }
function sliderShort(s) { return s.control === 'master' ? 'MST' : s.control === 'mic' ? 'MIC' : (s.appLabel || s.app || 'APP').replace(/[aeiou\s]/gi, '').slice(0, 3) || 'APP'; }
function fitBoard() {
  const p = curPage(); const g = geom(p); const wrap = $('#boardWrap'); const inner = $('#boardInner');
  const availW = wrap.clientWidth - 42;
  const availH = Math.max(160, window.innerHeight - 34 - 16 - 40 - 16 - 42 - 230);
  const z = Math.max(0.12, Math.min(availW / g.totalW, availH / g.gridH, 0.6));
  inner.style.zoom = z;
}

/* ---------------- palette ---------------- */
const PALETTE = [
  ['System', [['app', 'app-window', 'Launch app'], ['hotkey', 'keyboard', 'Hotkey'], ['media', 'media-chip', 'Media key'], ['url', 'globe', 'Open URL']]],
  ['Scripts', [['ps', 'terminal', 'PowerShell'], ['py', 'file-py', 'Python']]],
  ['Homelab', [['ssh', 'square-terminal', 'SSH command'], ['status', 'chart', 'Status tile']]],
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
    case 'folder': {
      const fp = { id: uid(), name: 'Folder', parentId: S.pageId, cols: 5, rows: 3, sliders: 'off', strip: [null, null, null], keys: [] };
      S.cfg.pages.push(fp);
      return Object.assign(base, { type: 'folder', label: 'Folder', target: fp.id });
    }
  }
}
function cellFree(p, r, c, ignoreId) { const o = occupancy(p)[r + ',' + c]; return !o || o === ignoreId; }
function firstFree(p, sp) {
  for (let r = 0; r < p.rows; r++) for (let c = 0; c < p.cols; c++)
    if (cellFree(p, r, c) && (sp < 2 || (c + 1 < p.cols && cellFree(p, r, c + 1)))) return [r, c];
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
  const sp = kind === 'nowplaying' ? 2 : 1;
  if (r == null) { const f = firstFree(p, sp); if (!f) return toast(sp > 1 ? 'Now Playing needs two free keys side by side' : 'No free keys on this page'); [r, c] = f; }
  if (p.parentId && r === 0 && c === 0) return toast('The top-left key in a folder is Back');
  if (sp === 2 && (c + 1 >= p.cols || (p.parentId && r === 0 && c + 1 === 0))) return toast('Now Playing needs two keys side by side');
  // replace whatever is there
  const hit = p.keys.filter(k => k.row === r && (k.col === c || (span(k) === 2 && k.col + 1 === c) || (sp === 2 && k.col === c + 1)));
  hit.forEach(k => removeKey(p, k));
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
function moveKey(k, fromP, toP, r, c) {
  const sp = span(k);
  if (toP.parentId && r === 0 && (c === 0 || (sp === 2 && c + 1 === 0))) return toast('The top-left key in a folder is Back');
  if (sp === 2 && c + 1 >= toP.cols) return toast('Not enough room for Now Playing there');
  const occ = occupancy(toP);
  const targets = [occ[r + ',' + c], sp === 2 ? occ[r + ',' + (c + 1)] : null].filter(x => x && x !== k.id);
  if (targets.includes('__back')) return toast('The top-left key in a folder is Back');
  const others = [...new Set(targets)].map(id => toP.keys.find(x => x.id === id));
  if (others.length > 1 || (others[0] && span(others[0]) !== sp)) return toast("Can't swap those two keys");
  if (others[0]) { others[0].row = k.row; others[0].col = k.col; if (fromP !== toP) { toP.keys = toP.keys.filter(x => x !== others[0]); fromP.keys.push(others[0]); } }
  if (fromP !== toP) { fromP.keys = fromP.keys.filter(x => x !== k); toP.keys.push(k); if (k.type === 'folder') { const fp = page(k.target); if (fp) fp.parentId = toP.id; } }
  k.row = r; k.col = c; commit(); renderAll();
}

/* ---------------- inspector ---------------- */
const TYPE_NAMES = { app: 'Launch app', hotkey: 'Hotkey', media: 'Media key', url: 'Open URL', script: 'Script', ssh: 'SSH command', status: 'Status tile', folder: 'Folder', goto: 'Go to page', nowplaying: 'Now Playing', back: 'Back' };
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
const EXTRA_TYPES = ['app', 'hotkey', 'media', 'url', 'script', 'ssh', 'folder', 'goto'];
const STEP_TYPES = { app: ['Open app', 'app-window'], hotkey: ['Hotkey', 'keyboard'], media: ['Media key', 'play-pause'], url: ['Open URL', 'globe'], script: ['Run script', 'terminal'], ssh: ['SSH command', 'square-terminal'], wait: ['Wait', 'clock'] };
function newStep(t) {
  const host = S.cfg.hosts[0] ? S.cfg.hosts[0].id : null;
  return Object.assign({ id: uid(), type: t }, ({
    app: { exe: '', args: '', ifRunning: 'focus' }, hotkey: { keys: [] }, media: { media: 'playpause' }, url: { url: 'https://' },
    script: { runtime: 'powershell', file: '', window: 'hidden' }, ssh: { hostId: host, command: '' }, wait: { ms: 1000 },
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
        + '<div class="help">Folders get a Back key in the top-left. Double-click the key to open it.</div>';
      break;
    case 'goto':
      h += iconSection(k) + labelFields(k)
        + field('Page', `<select class="in" data-f="target">${S.cfg.pages.filter(x => x.id !== p.id).map(x => `<option value="${x.id}"${x.id === k.target ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`);
      break;
    case 'nowplaying':
      h += '<div class="help" style="margin-top:0">Shows whatever Windows is playing right now: track, artist, app, progress and album art. Tap it on the deck to play or pause.</div>'
        + '<div class="help">Takes two keys side by side.</div>';
      break;
  }
  if (EXTRA_TYPES.includes(k.type)) h += extrasSection(k, p);
  h += footer(!['folder', 'goto', 'nowplaying'].includes(k.type) || (k.steps && k.steps.length > 0));
  el.innerHTML = h; hydrate(el);
}
/* ---------------- status tile sources (docs/status-tiles.md) ---------------- */
const STATUS_FORMAT = '<div class="help">The last line your command prints is shown on the tile: <span class="code">value|subtitle|bar</span>, like <span class="code">72%|4 cores|0.72</span>. Only the value is required. <a href="#" data-act="docs" data-doc="status-tiles">How status tiles work</a></div>';
function statusSourceFields(k) {
  const src = ['pc', 'command', 'ssh', 'push'].includes(k.source) ? k.source : '';
  let h = field('Data source', seg('source', [['pc', 'This PC'], ['command', 'Command'], ['ssh', 'SSH'], ['push', 'Push']], src));
  if (!src) return h + '<div class="help">Pick where this tile gets its value. It shows "—" until then.</div>';
  if (src === 'pc') h += field('Show this PC\'s', seg('metric', [['cpu', 'CPU'], ['ram', 'RAM']], k.metric || 'cpu'));
  if (src === 'command') h += field('Runs in', seg('shell', [['powershell', 'PowerShell'], ['cmd', 'cmd']], k.shell || 'powershell'))
    + field('Command', `<textarea class="in mono" data-f="command" spellcheck="false" placeholder="$d = Get-PSDrive C; '{0:0}%|C: {1:0} GB free' -f (100*$d.Used/($d.Used+$d.Free)), ($d.Free/1GB)">${esc(k.command)}</textarea>`) + STATUS_FORMAT;
  if (src === 'ssh') h += field('Host', `<div class="hostchips">${seg('hostId', S.cfg.hosts.map(x => [x.id, esc(x.name)]).concat([['__add', gi('plus')]]), k.hostId)}</div>`)
    + field('Command', `<textarea class="in mono" data-f="command" spellcheck="false" placeholder="uptime -p">${esc(k.command)}</textarea>`)
    + field('Auth', input('keyPath', k.keyPath, { mono: 1, ph: '~/.ssh/id_ed25519' })) + STATUS_FORMAT;
  if (src === 'push') {
    const feed = k.feed || '';
    const pi = S.push || {};
    const url = `http://127.0.0.1:${pi.port || 8770}/status/${encodeURIComponent(feed || 'my-feed')}`;
    h += field('Feed name', input('feed', feed, { mono: 1, ph: 'gpu-temp' }))
      + `<div class="help">Your script sends values to this tile. It only works from this computer and needs your token.</div>`
      + field('Send to', `<div class="lastrun">${esc(url)}</div>`)
      + field('Token', `<div class="inrow"><input class="in mono" readonly value="${pi.token ? '••••••••••••••••' : 'starting…'}"><button class="btn" data-act="copyToken">${gi('copy')}Copy</button></div>`)
      + (pi.error ? `<div class="help" style="color:var(--danger)">${esc(pi.error)}</div>` : '')
      + `<div class="help">PowerShell example:<div class="lastrun">$t = Get-Content "$env:APPDATA\\Deckwell\\push-token.txt"\nInvoke-RestMethod -Method Post ${esc(url)} -Headers @{ Authorization = "Bearer $t" } -Body '72%|4 cores|0.72'</div><a href="#" data-act="docs" data-doc="status-tiles">More examples</a></div>`;
  }
  return h;
}
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
    coalescedCommit(); return;
  }
  if (!t.dataset.f) return;
  const tgt = S.sel.t === 'slider' ? p.strip[S.sel.i] : selKey(); if (!tgt) return;
  let v = t.value;
  if (t.dataset.num) { v = parseFloat(v); if (isNaN(v)) return; layoutSuffixes(); }
  tgt[t.dataset.f] = v;
  if (tgt.type === 'folder' && t.dataset.f === 'label') { const fp = page(tgt.target); if (fp) fp.name = v; renderSidebar(); }
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
    tgt[f] = b.dataset.v;
    if (f === 'control' && tgt.control !== 'app') { tgt.app = ''; tgt.appLabel = ''; }
    if (tgt.type === 'status' && f === 'metric' && ['CPU', 'RAM'].includes(tgt.title)) tgt.title = tgt.label = b.dataset.v.toUpperCase();
    if (tgt.type === 'status' && f === 'source' && b.dataset.v === 'ssh' && (tgt.refresh || 5) < 10) tgt.refresh = 10;
    commit(); renderBoard(); renderInspector(); return;
  }
  if (b.classList.contains('sess') && b.dataset.sess) { const s = p.strip[S.sel.i]; s.app = b.dataset.sess; s.appLabel = b.dataset.label; commit(); renderBoard(); renderInspector(); return; }
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
  const p = curPage(); const f = firstFree(p, span(k)); if (!f) return toast('No free keys on this page');
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
      if (isNew) { S.cfg.hosts.push(h); const k = selKey(); if (k && (k.type === 'ssh' || k.type === 'status')) k.hostId = h.id; }
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
  showPopover(`${rename}<div class="field"><label>Connection</label>${seg('linkMode', [['auto', 'Auto'], ['wifi', 'Wi-Fi only'], ['usb', 'USB only']], mode)}</div>
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
  $('#sliderStep').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; const p = curPage(); setSliderCount(p, p.strip.length + +b.dataset.d); });
  // board
  const board = $('#boardInner');
  board.addEventListener('click', e => {
    const sl = e.target.closest('.sl'); if (sl) { if (sl.classList.contains('empty')) addSlider(+sl.dataset.slot); else { S.sel = { t: 'slider', i: +sl.dataset.slot }; renderBoard(); renderInspector(); } return; }
    const k = e.target.closest('.k'); if (!k) return;
    if (k.classList.contains('empty')) { S.sel = null; S.emptyCell = [+k.dataset.r, +k.dataset.c]; renderBoard(); renderInspector(); return; }
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
    const k = e.target.closest('#boardInner .k'); const sl = e.target.closest('#boardInner .sl'); const pg = e.target.closest('.pg');
    if (drag.add === 'slider') { if (sl) { sl.classList.add('dropok'); e.preventDefault(); } return; }
    if (k && k.dataset.key !== '__back') { k.classList.add('dropok'); e.preventDefault(); }
    else if (pg && drag.move && pg.dataset.page !== S.pageId) { pg.classList.add('drop'); e.preventDefault(); }
  });
  document.addEventListener('drop', e => {
    if (!drag) return; e.preventDefault();
    const d = drag; drag = null;
    const k = e.target.closest('#boardInner .k'); const sl = e.target.closest('#boardInner .sl'); const pg = e.target.closest('.pg');
    document.querySelectorAll('.dropok,.drop').forEach(x => x.classList.remove('dropok', 'drop'));
    if (d.add === 'slider') { if (sl) { const i = +sl.dataset.slot; if (curPage().strip[i]) { curPage().strip[i] = null; } addSlider(i); } return; }
    if (d.add && k) return placeNew(d.add, +k.dataset.r, +k.dataset.c);
    if (d.move) {
      const from = page(d.from); const key = from.keys.find(x => x.id === d.move); if (!key) return;
      if (k) return moveKey(key, from, curPage(), +k.dataset.r, +k.dataset.c);
      if (pg) { const to = page(pg.dataset.page); if (key.type === 'folder' && (key.target === to.id || isDescendant(to.id, key.target))) return toast("Can't move a folder into itself");
        const f = firstFree(to, span(key)); if (!f) return toast(`No free keys on ${to.name}`); moveKey(key, from, to, f[0], f[1]); toast(`Moved to ${to.name}`); }
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
  if (st && st.device) S.dev = Object.assign(S.dev, st.device);
  S.sessions = (st && st.sessions) || [];
  call('pushInfo', {}).then(r => { S.push = r || {}; const k = selKey(); if (k && k.type === 'status') renderInspector(); }).catch(() => {});
  S.pageId = S.cfg.pages[0].id; S.lastSnap = JSON.stringify(S.cfg);
  if (!valid) save();
  else if (S.cfg.pages.some(p => p.keys.some(k => !k.face))) save(); // migrated config: compute faces and push to the deck
  if (valid && S.cfg.migratedFromV1) { delete S.cfg.migratedFromV1; S.lastSnap = JSON.stringify(S.cfg); save(); setTimeout(() => toast('Imported your v1 layout'), 600); }
  if (!HOST) Demo.start();
  renderAll();
  wireIntro();
  if (!S.cfg.introSeen) showIntro(0);
  if (document.fonts) document.fonts.ready.then(() => { layoutSuffixes(); fitBoard(); });
})();
