'use strict';
const $ = (id) => document.getElementById(id);
// `api` is defined as a global by the preload bridge (contextBridge), so it is not redeclared here.

/* ---------------- small helpers ---------------- */
function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function icon(name) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  u.setAttribute('href', '#i-' + name);
  s.appendChild(u);
  return s;
}
const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;
const SITE_NAME = { alibaba: 'Alibaba', '1688': '1688' };
const isActive = (s) => s === 'loading' || s === 'downloading' || s === 'upscaling';
const isAttention = (s) => s === 'captcha' || s === 'login';
const isFinished = (s) => s === 'done' || s === 'done-with-errors' || s === 'failed';

/* ---------------- state ---------------- */
const jobs = new Map();       // id -> job
const rowEls = new Map();     // id -> li
const segEls = new Map();     // id -> button
let settings = {};
let queue = { running: false, paused: false, nextAt: null };
let logins = { alibaba: false, '1688': false };
let parsed = { valid: [], dup: 0, existing: 0, bad: [] };
const activity = [];

/* ---------------- toasts + activity ---------------- */
function toast(message, action, ms = 5000) {
  const t = h('div', 'toast');
  t.appendChild(h('span', null, message));
  if (action) {
    const b = h('button', 'btn', action.label);
    b.type = 'button';
    b.onclick = () => { action.run(); t.remove(); };
    t.appendChild(b);
  }
  $('toasts').appendChild(t);
  setTimeout(() => t.remove(), ms);
}
function log(message) {
  activity.unshift({ at: new Date(), message });
  if (activity.length > 200) activity.pop();
  const ol = $('log');
  ol.textContent = '';
  for (const a of activity) {
    const li = h('li');
    li.appendChild(h('time', null, a.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })));
    li.appendChild(h('span', null, a.message));
    ol.appendChild(li);
  }
}
log('Ready.');

/* ---------------- link parsing ---------------- */
const URL_RE = /https?:\/\/[^\s"'<>)\]]+/gi;

function classify(raw) {
  let u;
  try { u = new URL(raw.replace(/[.,;]+$/, '')); } catch { return { bad: 'not a valid link' }; }
  const host = u.hostname.toLowerCase();
  if (/(^|\.)1688\.com$/.test(host)) {
    const m = u.pathname.match(/offer\/(\d+)/);
    if (!m) return { bad: 'not a 1688 product page' };
    return { site: '1688', key: '1688:' + m[1], url: `https://detail.1688.com/offer/${m[1]}.html` };
  }
  if (/(^|\.)alibaba\.com$/.test(host)) {
    if (!/\/product-detail\//.test(u.pathname)) return { bad: 'not an Alibaba product page' };
    const id = (u.pathname.match(/_(\d+)\.html/) || [])[1];
    return { site: 'alibaba', key: 'alibaba:' + (id || u.pathname), url: u.origin + u.pathname };
  }
  return { bad: 'not an Alibaba or 1688 link' };
}

function existingKeys() {
  const keys = new Set();
  for (const j of jobs.values()) { const c = classify(j.url); if (c.key) keys.add(c.key); }
  return keys;
}

function parseInput() {
  const text = $('urls').value;
  const found = text.match(URL_RE) || [];
  const have = existingKeys();
  const seen = new Set();
  const out = { valid: [], dup: 0, existing: 0, bad: [] };
  for (const raw of found) {
    const c = classify(raw);
    if (c.bad) { out.bad.push({ raw, reason: c.bad }); continue; }
    if (have.has(c.key)) { out.existing++; continue; }
    if (seen.has(c.key)) { out.dup++; continue; }
    seen.add(c.key);
    out.valid.push(c);
  }
  parsed = out;
  renderParse(text.trim().length > 0);
}

function renderParse(hasText) {
  const el = $('parse');
  el.textContent = '';
  const { valid, dup, existing, bad } = parsed;
  if (!hasText) {
    el.textContent = 'Alibaba and 1688 product pages are supported.';
  } else {
    if (valid.length) { const b = h('b', 'ok', plural(valid.length, 'product link') + ' ready'); el.appendChild(b); }
    else el.appendChild(h('span', 'warn', 'No usable product links yet'));
    const notes = [];
    if (dup) notes.push(`${plural(dup, 'duplicate')} ignored`);
    if (existing) notes.push(`${existing} already in the list`);
    if (bad.length) notes.push(`${bad.length} can't be used (${bad[0].reason})`);
    if (notes.length) el.appendChild(document.createTextNode('. ' + notes.join(', ') + '.'));
  }
  $('start').disabled = parsed.valid.length === 0;
  $('g-links').classList.toggle('done', parsed.valid.length > 0);
}

async function startScraping() {
  if (!parsed.valid.length) return;
  const n = await api.addUrls(parsed.valid.map((v) => v.url).join('\n'));
  log(`Added ${plural(n, 'product')} to the list.`);
  $('urls').value = '';
  parseInput();
}

/* paste / drop */
$('urls').addEventListener('input', parseInput);
$('urls').addEventListener('paste', (e) => {
  const text = e.clipboardData.getData('text');
  const urls = text.match(URL_RE);
  if (urls && urls.length) {
    e.preventDefault();
    const ta = e.target;
    const add = urls.join('\n') + '\n';
    ta.setRangeText(add, ta.selectionStart, ta.selectionEnd, 'end');
    parseInput();
  }
});
$('urls').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); startScraping(); } });
$('start').onclick = startScraping;
$('load-file').onclick = () => $('file').click();
$('file').onchange = async (e) => { const f = e.target.files[0]; if (f) appendText(await f.text()); e.target.value = ''; };
function appendText(t) {
  const ta = $('urls');
  ta.value = (ta.value.trim() ? ta.value.replace(/\s*$/, '\n') : '') + (t.match(URL_RE) || []).join('\n') + '\n';
  parseInput();
}
window.addEventListener('dragover', (e) => { e.preventDefault(); $('paste').classList.add('dragging'); });
window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) $('paste').classList.remove('dragging'); });
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  $('paste').classList.remove('dragging');
  const f = e.dataTransfer.files[0];
  if (f) appendText(await f.text());
  else appendText(e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain'));
});

/* ---------------- status wording ---------------- */
function friendlyError(msg) {
  const m = String(msg || '');
  if (/Product data not found/i.test(m)) return "Couldn't read this page. It may be blocked, removed or not a product page.";
  if (/Timed out waiting for/i.test(m)) return "Timed out waiting for you. Retry when you're ready.";
  if (/ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ERR_NETWORK|ERR_TIMED_OUT/i.test(m)) return 'No internet connection. Check your network and retry.';
  if (/cancelled/i.test(m)) return 'Stopped.';
  return m || 'Something went wrong.';
}

function summary(job) {
  const c = job.counts || {};
  const imgs = (c.images || 0) + (c.variants || 0) + (c.description || 0);
  const parts = [plural(imgs, 'image')];
  if (c.videos) parts.push(plural(c.videos, 'video'));
  let text = parts.join(' and ');
  if (c.upscaled) text += `, ${c.upscaled} sharpened`;
  return text;
}

function describe(job) {
  const s = job.status;
  const pct = job.total ? Math.round((job.done / job.total) * 100) : 0;
  switch (s) {
    case 'waiting': return { text: 'Waiting', tone: '' };
    case 'loading': return { text: 'Opening the product page', tone: 'live', pct: 8 };
    case 'downloading': return { text: `Downloading ${job.done} of ${job.total} files`, tone: 'live', pct };
    case 'upscaling': return { text: `Sharpening ${job.done} of ${job.total} images`, tone: 'live', pct };
    case 'captcha': return { text: 'Needs you: solve the captcha', tone: 'warn', icon: 'alert' };
    case 'login': return { text: 'Needs you: log in', tone: 'warn', icon: 'alert' };
    case 'done': return { text: summary(job), tone: 'ok', icon: 'check' };
    case 'done-with-errors': return { text: `${summary(job)}. ${job.error || ''}`.trim(), tone: 'warn', icon: 'alert' };
    default: return { text: friendlyError(job.error), tone: 'bad', icon: 'x' };
  }
}

function shortUrl(u) { try { const x = new URL(u); return (x.hostname + x.pathname).replace(/^www\./, ''); } catch { return u; } }

/* ---------------- rows ---------------- */
function placeholderThumb() {
  const d = h('div', 'thumb empty');
  d.appendChild(icon('image'));
  return d;
}

function createRow(job) {
  const li = h('li', 'row');
  li.tabIndex = 0;
  li.setAttribute('role', 'button');
  li.append(h('div', 'rail'), placeholderThumb());
  const main = h('div', 'row-main');
  const meta = h('div', 'row-meta');
  const status = h('span', 'status');
  meta.append(h('span', 'site'), status);
  const bar = h('div', 'bar');
  bar.appendChild(h('i'));
  main.append(h('div', 'row-title'), meta, bar);
  const actions = h('div', 'row-actions');
  const primary = h('button', 'btn small ghost');
  primary.type = 'button';
  const more = h('button', 'icon-btn');
  more.type = 'button';
  more.setAttribute('aria-label', 'More actions');
  more.appendChild(icon('more'));
  actions.append(primary, more);
  li.append(main, actions);

  li.addEventListener('click', (e) => { if (!e.target.closest('button')) openDrawer(job.id); });
  li.addEventListener('keydown', (e) => { if (e.target === li && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDrawer(job.id); } });
  more.addEventListener('click', (e) => { e.stopPropagation(); openMenu(job.id, more); });
  primary.addEventListener('click', (e) => { e.stopPropagation(); primaryAction(job.id); });
  return li;
}

function primaryAction(id) {
  const j = jobs.get(id);
  if (!j) return;
  if (j.status === 'failed' || j.status === 'done-with-errors') api.retryJob(id);
  else if (isAttention(j.status)) api.showBrowser();
  else if (j.folder) api.openPath(j.folder);
}

function renderRow(job) {
  jobs.set(job.id, job);
  let li = rowEls.get(job.id);
  if (!li) { li = createRow(job); rowEls.set(job.id, li); $('rows').appendChild(li); }
  const d = describe(job);
  li.dataset.s = job.status;
  li.querySelector('.row-title').textContent = job.title || shortUrl(job.url);
  li.querySelector('.site').textContent = SITE_NAME[job.site] || 'Other';
  const st = li.querySelector('.status');
  st.className = 'status ' + d.tone;
  st.textContent = '';
  if (d.icon) st.appendChild(icon(d.icon));
  st.appendChild(h('span', 'status-text', d.text));
  st.title = d.text;

  const bar = li.querySelector('.bar');
  bar.hidden = d.pct == null;
  if (d.pct != null) bar.firstChild.style.width = d.pct + '%';

  // thumbnail
  const cur = li.querySelector('.thumb');
  if (job.thumb) {
    if (cur.tagName !== 'IMG' || cur.getAttribute('src') !== job.thumb) {
      const img = h('img', 'thumb');
      img.alt = '';
      img.loading = 'lazy';
      img.onerror = () => img.replaceWith(placeholderThumb());
      img.src = job.thumb;
      cur.replaceWith(img);
    }
  }

  const primary = li.querySelector('.row-actions .btn');
  const label = job.status === 'failed' || job.status === 'done-with-errors' ? 'Retry' : isAttention(job.status) ? 'Show window' : isFinished(job.status) && job.folder ? 'Open folder' : '';
  primary.hidden = !label;
  primary.textContent = label;
  renderStrip();
  renderBatch();
  renderBanner();
  $('guide').hidden = jobs.size > 0 || localStorage.getItem('seenGuide') === '1';
  document.querySelector('.add').classList.toggle('compact', jobs.size > 0);
}

function removeRow(id) {
  jobs.delete(id);
  const li = rowEls.get(id);
  if (li) { li.remove(); rowEls.delete(id); }
  renderStrip(); renderBatch(); renderBanner();
  $('guide').hidden = jobs.size > 0 || localStorage.getItem('seenGuide') === '1';
  document.querySelector('.add').classList.toggle('compact', jobs.size > 0);
}

/* ---------------- overflow menu ---------------- */
let menuEl = null;
function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
function openMenu(id, anchor) {
  closeMenu();
  const j = jobs.get(id);
  const items = [];
  if (j.folder && isFinished(j.status) && j.status !== 'failed') items.push(['Open folder', () => api.openPath(j.folder)]);
  if (j.status === 'done' || j.status === 'done-with-errors') items.push(['View details', () => openDrawer(id)]);
  items.push(['Open product page', () => api.openExternal(j.url)]);
  items.push(['Copy link', async () => { try { await navigator.clipboard.writeText(j.url); toast('Link copied.'); } catch { toast("Couldn't copy the link."); } }]);
  if (j.status === 'failed' || j.status === 'done-with-errors') items.push(['Retry', () => api.retryJob(id)]);
  if (!isActive(j.status) && !isAttention(j.status)) items.push(['Remove from list', async () => { if (await api.removeJob(id)) removeRow(id); }, true]);
  menuEl = h('div', 'menu');
  menuEl.setAttribute('role', 'menu');
  for (const [label, fn, danger] of items) {
    const b = h('button', danger ? 'danger' : '', label);
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.onclick = () => { closeMenu(); fn(); };
    menuEl.appendChild(b);
  }
  document.body.appendChild(menuEl);
  const r = anchor.getBoundingClientRect();
  const mh = menuEl.offsetHeight;
  menuEl.style.top = Math.min(r.bottom + 4, window.innerHeight - mh - 8) + 'px';
  menuEl.style.left = Math.max(8, r.right - menuEl.offsetWidth) + 'px';
  menuEl.querySelector('button').focus();
}
document.addEventListener('click', (e) => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); });

/* ---------------- manifest strip + batch bar ---------------- */
function renderStrip() {
  const strip = $('strip');
  for (const [id, b] of segEls) if (!jobs.has(id)) { b.remove(); segEls.delete(id); }
  for (const j of jobs.values()) {
    let b = segEls.get(j.id);
    if (!b) {
      b = h('button', 'seg-cell');
      b.type = 'button';
      b.setAttribute('role', 'listitem');
      b.onclick = () => { const li = rowEls.get(j.id); if (li) { li.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); li.classList.remove('flash'); void li.offsetWidth; li.classList.add('flash'); } };
      segEls.set(j.id, b);
      strip.appendChild(b);
    }
    const s = j.status;
    b.className = 'seg-cell' + (s === 'done' || s === 'done-with-errors' ? ' done' : s === 'failed' ? ' failed' : isAttention(s) ? ' attention' : isActive(s) ? ' active pulse' : '');
    if (s === 'downloading' || s === 'upscaling') b.style.setProperty('--fill', Math.max(8, Math.round((j.done / Math.max(1, j.total)) * 100)) + '%');
    else if (s === 'loading') b.style.setProperty('--fill', '8%');
    const label = `${j.title || shortUrl(j.url)}: ${describe(j).text}`;
    b.title = label;
    b.setAttribute('aria-label', label);
  }
}

function etaText() {
  const finished = [...jobs.values()].filter((j) => (j.status === 'done' || j.status === 'done-with-errors') && j.startedAt && j.finishedAt).slice(-5);
  const remaining = [...jobs.values()].filter((j) => j.status === 'waiting' || isActive(j.status) || isAttention(j.status)).length;
  if (!finished.length || !remaining) return '';
  const avg = finished.reduce((a, j) => a + (j.finishedAt - j.startedAt), 0) / finished.length;
  const gap = ((settings.delayMin || 0) + (settings.delayMax || 0)) / 2 * 1000;
  const mins = Math.max(1, Math.round((remaining * (avg + gap)) / 60000));
  return mins >= 60 ? `About ${Math.floor(mins / 60)} h ${mins % 60} min left` : `About ${mins} min left`;
}

function renderBatch() {
  const all = [...jobs.values()];
  $('batch').hidden = all.length === 0;
  if (!all.length) return;
  const ok = all.filter((j) => j.status === 'done' || j.status === 'done-with-errors').length;
  const failed = all.filter((j) => j.status === 'failed').length;
  const waiting = all.filter((j) => j.status === 'waiting').length;
  const busy = all.some((j) => isActive(j.status) || isAttention(j.status));
  let title;
  if (queue.running && queue.paused) title = 'Paused';
  else if (busy || waiting) title = queue.running ? `${ok + failed} of ${all.length} finished` : `${plural(waiting, 'product')} waiting`;
  else title = failed && !ok ? 'Nothing could be scraped' : 'Finished';
  $('batch-title').textContent = title;

  let sub = '';
  if (queue.running && queue.paused) sub = 'Resume when you are ready. The current product finishes first.';
  else if (queue.nextAt) sub = `Next product in ${Math.max(0, Math.ceil((queue.nextAt - Date.now()) / 1000))} s. The short pause helps avoid captchas.`;
  else if (all.some((j) => isAttention(j.status))) sub = 'Waiting for you in the browser window.';
  else if (busy) sub = etaText();
  else if (!waiting) sub = [ok && `${plural(ok, 'product')} saved`, failed && `${failed} failed`].filter(Boolean).join(', ');
  $('batch-sub').textContent = sub;

  $('pause').hidden = !queue.running;
  $('pause').textContent = queue.paused ? 'Resume' : 'Pause';
  $('stop').hidden = !queue.running;
  $('retry-failed').hidden = failed === 0;
  $('clear').hidden = ok + failed === 0;
}
setInterval(() => { if (queue.nextAt) renderBatch(); }, 500);

function renderBanner() {
  const att = [...jobs.values()].find((j) => isAttention(j.status));
  $('banner').hidden = !att;
  if (att) {
    $('banner-title').textContent = att.status === 'login' ? 'Log in to continue' : 'Solve the captcha to continue';
    $('banner-body').textContent = 'A browser window is open. Finish there and scraping carries on by itself.';
  }
}
$('banner-action').onclick = () => api.showBrowser();

/* restore prompt (queue from last session) */
function maybeRestorePrompt(state) {
  const waiting = [...jobs.values()].filter((j) => j.status === 'waiting').length;
  const show = !state.running && state.paused && waiting > 0;
  $('restore').hidden = !show;
  if (show) $('restore-title').textContent = `${plural(waiting, 'product')} from your last session`;
}
$('restore-go').onclick = () => { $('restore').hidden = true; api.resume(); };
$('restore-discard').onclick = async () => {
  $('restore').hidden = true;
  for (const j of [...jobs.values()]) if (j.status === 'waiting' && (await api.removeJob(j.id))) removeRow(j.id);
};

/* batch buttons */
$('pause').onclick = () => (queue.paused ? api.resume() : api.pause());
$('stop').onclick = () => api.stop();
$('retry-failed').onclick = () => api.retryFailed();
$('clear').onclick = async () => {
  const left = await api.clearFinished();
  const keep = new Set(left.map((j) => j.id));
  for (const id of [...jobs.keys()]) if (!keep.has(id)) removeRow(id);
};

/* ---------------- logins ---------------- */
function renderLogins() {
  for (const site of ['alibaba', '1688']) {
    const pill = $('pill-' + site);
    pill.classList.toggle('on', !!logins[site]);
    $('state-' + site).textContent = logins[site] ? 'Signed in' : 'Log in';
    pill.title = logins[site] ? `Signed in to ${SITE_NAME[site]}. Click to open the login page again.` : `Open the ${SITE_NAME[site]} login page`;
  }
  $('g-login').classList.toggle('done', logins['1688']);
  const any = logins.alibaba || logins['1688'];
  $('acct-hint').textContent = any ? 'Signing out removes your saved logins for Alibaba and 1688.' : 'You are not signed in to either site.';
  $('logout').disabled = !any;
}
async function refreshLogins() { try { logins = await api.loginStatus(); renderLogins(); } catch { /* window closing */ } }
$('pill-alibaba').onclick = () => { api.openLogin('alibaba'); toast('The login page opened in a separate window.'); };
$('pill-1688').onclick = () => { api.openLogin('1688'); toast('The login page opened in a separate window.'); };

/* ---------------- footer / folder links ---------------- */
function renderFolder() {
  $('foot-folder').textContent = settings.outputDir || '';
  $('foot-folder').title = 'Open this folder';
  $('guide-folder').textContent = settings.outputDir ? `Saved to ${settings.outputDir}` : '';
  $('outputDir').value = settings.outputDir || '';
}
$('foot-folder').onclick = () => api.openPath(settings.outputDir);
$('guide-folder').onclick = () => api.openPath(settings.outputDir);
$('open-activity').onclick = () => $('activity').showModal();

/* ---------------- drawer ---------------- */
let drawerId = null;
let drawerOpener = null;
const TAB_LABELS = [['images', 'Gallery'], ['variants', 'Variants'], ['description', 'Description'], ['upscaled', 'Sharpened']];

function closeDrawer() {
  $('drawer').classList.remove('open');
  $('drawer').setAttribute('aria-hidden', 'true');
  $('scrim').hidden = true;
  drawerId = null;
  if (drawerOpener && document.contains(drawerOpener)) drawerOpener.focus();
}

async function openDrawer(id) {
  const job = jobs.get(id);
  if (!job) return;
  drawerOpener = rowEls.get(id);
  drawerId = id;
  if (job.thumb) $('d-thumb').src = job.thumb; else $('d-thumb').removeAttribute('src');
  $('d-thumb').hidden = !job.thumb;
  $('d-title').textContent = job.title || shortUrl(job.url);
  $('d-sub').textContent = `${SITE_NAME[job.site]}. ${describe(job).text}`;
  const body = $('d-body');
  body.textContent = '';
  const finished = job.status === 'done' || job.status === 'done-with-errors';
  $('d-folder').hidden = !job.folder || !finished;
  $('d-json').hidden = !finished;
  $('d-site').onclick = () => api.openExternal(job.url);
  $('d-folder').onclick = () => api.openPath(job.folder);
  $('drawer').classList.add('open');
  $('drawer').setAttribute('aria-hidden', 'false');
  $('scrim').hidden = false;
  $('d-close').focus();

  if (!finished) {
    body.appendChild(h('p', 'none', job.status === 'failed' ? friendlyError(job.error) : 'Images and details appear here when this product has finished.'));
    return;
  }
  const data = await api.getProduct(job.folder);
  if (drawerId !== id) return;
  if (!data) { body.appendChild(h('p', 'none', 'The files for this product were moved or deleted.')); return; }
  $('d-json').onclick = () => { $('json-pre').textContent = JSON.stringify(data.product, null, 2); $('json-view').showModal(); };
  renderDrawerBody(body, data);
}

function renderDrawerBody(body, data) {
  const { groups, videos, product } = data;
  const tabs = h('div', 'tabs');
  tabs.setAttribute('role', 'tablist');
  const grid = h('div', 'grid');
  const tabBtns = [];
  const show = (key) => {
    tabBtns.forEach(([k, b]) => b.setAttribute('aria-selected', String(k === key)));
    grid.textContent = '';
    const list = groups[key];
    if (!list.length) { grid.className = 'none'; grid.textContent = 'Nothing here.'; return; }
    grid.className = 'grid';
    list.forEach((it, i) => {
      const b = h('button');
      b.type = 'button';
      b.setAttribute('aria-label', `Preview image ${i + 1} of ${list.length}`);
      const img = h('img');
      img.alt = '';
      img.loading = 'lazy';
      img.src = it.url;
      b.appendChild(img);
      b.onclick = () => openLightbox(list, i);
      grid.appendChild(b);
    });
  };
  let first = null;
  for (const [key, label] of TAB_LABELS) {
    const n = groups[key].length;
    const b = h('button', null, `${label} ${n}`);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.disabled = n === 0;
    b.onclick = () => show(key);
    tabs.appendChild(b);
    tabBtns.push([key, b]);
    if (n && !first) first = key;
  }
  const gallery = h('section');
  gallery.append(tabs, grid);
  body.appendChild(gallery);
  show(first || 'images');

  if (videos.length) {
    const sec = h('section');
    sec.appendChild(h('h3', null, 'Videos'));
    const box = h('div', 'videos');
    videos.forEach((file, i) => {
      const b = h('button', 'btn');
      b.type = 'button';
      b.append(icon('play'), document.createTextNode(`Play video ${i + 1}`));
      b.onclick = () => api.openPath(file);
      box.appendChild(b);
    });
    sec.appendChild(box);
    body.appendChild(sec);
  }

  const d = product.data || {};
  const facts = h('dl', 'facts');
  const fact = (k, v) => { if (v == null || v === '') return; facts.append(h('dt', null, k), h('dd', null, String(v))); };
  fact('Company', d.supplier);
  fact('Minimum order', d.moq ? `${d.moq} pcs` : (d.priceTiers && d.priceTiers[0] && d.priceTiers[0].min ? `${d.priceTiers[0].min} pcs` : ''));
  if (d.supplierCountry) fact('Based in', d.supplierCountry);
  if (d.supplierYears) fact('On the platform', plural(d.supplierYears, 'year'));
  if (facts.children.length) { const s = h('section'); s.appendChild(h('h3', null, 'Supplier')); s.appendChild(facts); body.appendChild(s); }

  const tiers = (d.priceTiers || []).filter((t) => t.usd != null || t.price != null);
  if (tiers.length) {
    const s = h('section');
    s.appendChild(h('h3', null, 'Price'));
    const box = h('div', 'tiers');
    for (const t of tiers) {
      const row = h('div');
      const range = t.max && t.max > 0 ? `${t.min} to ${t.max} pcs` : `${t.min ?? 1} pcs or more`;
      row.append(h('span', null, range), h('b', null, t.usd != null ? `$${Number(t.usd).toFixed(2)}` : `¥${t.price}`));
      box.appendChild(row);
    }
    s.appendChild(box);
    body.appendChild(s);
  }

  const specs = d.specs ? Object.entries(d.specs) : [];
  const skus = d.skus || [];
  if (specs.length || skus.length) {
    const det = h('details');
    det.appendChild(h('summary', null, specs.length ? `Specifications (${specs.length})` : `Options (${skus.length})`));
    const dl = h('dl', 'facts');
    if (specs.length) specs.forEach(([k, v]) => dl.append(h('dt', null, k), h('dd', null, String(v))));
    else skus.forEach((s) => dl.append(h('dt', null, s.name), h('dd', null, [s.price != null && `¥${s.price}`, s.stock != null && `${s.stock} in stock`].filter(Boolean).join(', '))));
    det.appendChild(dl);
    body.appendChild(det);
  }
}
$('d-close').onclick = closeDrawer;
$('scrim').onclick = closeDrawer;

/* ---------------- lightbox ---------------- */
let lb = { list: [], i: 0 };
function showLb() {
  const it = lb.list[lb.i];
  $('lb-img').src = it.url;
  $('lb-count').textContent = `${lb.i + 1} of ${lb.list.length}`;
  $('lb-prev').hidden = $('lb-next').hidden = lb.list.length < 2;
}
function openLightbox(list, i) { lb = { list, i }; $('lightbox').hidden = false; showLb(); $('lb-close').focus(); }
function closeLightbox() { $('lightbox').hidden = true; $('lb-img').removeAttribute('src'); }
function stepLb(n) { lb.i = (lb.i + n + lb.list.length) % lb.list.length; showLb(); }
$('lb-close').onclick = closeLightbox;
$('lb-prev').onclick = () => stepLb(-1);
$('lb-next').onclick = () => stepLb(1);
$('lightbox').addEventListener('click', (e) => { if (e.target === $('lightbox')) closeLightbox(); });
document.addEventListener('keydown', (e) => {
  if (!$('lightbox').hidden) {
    if (e.key === 'Escape') closeLightbox();
    else if (e.key === 'ArrowLeft') stepLb(-1);
    else if (e.key === 'ArrowRight') stepLb(1);
    return;
  }
  if (e.key === 'Escape') { if (menuEl) closeMenu(); else if (drawerId != null && !document.querySelector('dialog[open]')) closeDrawer(); }
});

/* ---------------- settings ---------------- */
const SPEEDS = {
  safe: { delayMin: 10, delayMax: 20, hint: 'Fewest captchas. Waits 10 to 20 seconds between products.' },
  normal: { delayMin: 6, delayMax: 15, hint: 'A good balance for most batches. Waits 6 to 15 seconds between products.' },
  fast: { delayMin: 3, delayMax: 6, hint: 'Quicker, but captchas are more likely. Best for a handful of products.' },
};
let savedTimer = null;
async function save(patch) {
  settings = await api.setSettings(patch);
  const s = $('saved');
  s.textContent = 'Saved';
  s.classList.add('show');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => s.classList.remove('show'), 1400);
}
function renderSettings() {
  for (const k of ['downloadVariants', 'downloadDescription', 'downloadVideos', 'upscale']) $(k).checked = !!settings[k];
  $('skipAtLeast').value = settings.skipAtLeast;
  $('skip-out').textContent = settings.skipAtLeast;
  $('skip-wrap').hidden = !settings.upscale;
  const speed = SPEEDS[settings.speed] ? settings.speed : 'normal';
  document.querySelector(`input[name="speed"][value="${speed}"]`).checked = true;
  $('speed-hint').textContent = SPEEDS[speed].hint;
  if (!settings.upscalerInstalled) {
    $('upscale').disabled = true;
    $('upnote').textContent = "The image upscaler isn't available on this computer.";
  }
  renderFolder();
}
for (const k of ['downloadVariants', 'downloadDescription', 'downloadVideos', 'upscale']) {
  $(k).onchange = async (e) => { await save({ [k]: e.target.checked }); renderSettings(); };
}
$('skipAtLeast').oninput = (e) => { $('skip-out').textContent = e.target.value; };
$('skipAtLeast').onchange = (e) => save({ skipAtLeast: Number(e.target.value) });
document.querySelectorAll('input[name="speed"]').forEach((r) => {
  r.onchange = async () => { const p = SPEEDS[r.value]; await save({ speed: r.value, delayMin: p.delayMin, delayMax: p.delayMax }); renderSettings(); };
});
$('choose').onclick = async () => { const p = await api.chooseFolder(); if (p) { await save({ outputDir: p }); renderSettings(); } };
$('open-settings').onclick = () => $('settings').showModal();
$('logout').onclick = async () => {
  if (!confirm('Sign out of Alibaba and 1688? You will need to log in again to scrape 1688.')) return;
  logins = await api.clearSession();
  renderLogins();
  toast('Signed out of both sites.');
};
document.querySelectorAll('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));

/* ---------------- live events ---------------- */
let lastStatus = new Map();
api.onJobAdded((list) => list.forEach(renderRow));
api.onJobUpdate((job) => {
  const prev = lastStatus.get(job.id);
  lastStatus.set(job.id, job.status);
  renderRow(job);
  if (prev !== job.status) {
    const name = job.title || shortUrl(job.url);
    if (job.status === 'done' || job.status === 'done-with-errors') { log(`Saved ${name}: ${summary(job)}.`); localStorage.setItem('seenGuide', '1'); }
    else if (job.status === 'failed') log(`Failed ${name}: ${friendlyError(job.error)}`);
    else if (isAttention(job.status)) log(`${name}: waiting for you in the browser window.`);
    parseInput();
  }
  if (drawerId === job.id && (job.status === 'done' || job.status === 'done-with-errors') && prev !== job.status) openDrawer(job.id);
  $('g-files').classList.toggle('done', [...jobs.values()].some((j) => j.status === 'done'));
});
api.onQueueState((s) => { queue = { ...queue, running: s.running, paused: s.paused }; if (!s.running) queue.nextAt = null; renderBatch(); maybeRestorePrompt(s); refreshLogins(); });
api.onQueueNext(({ at }) => { queue.nextAt = at; renderBatch(); });
api.onQueueFinished(({ done, failed }) => {
  log(`Batch finished: ${done} saved${failed ? `, ${failed} failed` : ''}.`);
  toast(`Finished. ${plural(done, 'product')} saved${failed ? `, ${failed} failed` : ''}.`, { label: 'Open folder', run: () => api.openPath(settings.outputDir) }, 9000);
});
api.onLog((m) => log(m));

/* ---------------- boot ---------------- */
(async function init() {
  const [s, info, state] = await Promise.all([api.getSettings(), api.appInfo(), api.listJobs()]);
  settings = s;
  $('about').textContent = `Version ${info.version}. Your logins and files stay on this computer.`;
  renderSettings();
  queue = { running: state.running, paused: state.paused, nextAt: null };
  state.jobs.forEach((j) => { lastStatus.set(j.id, j.status); renderRow(j); });
  renderBatch();
  maybeRestorePrompt(state);
  $('guide').hidden = jobs.size > 0 || localStorage.getItem('seenGuide') === '1';
  $('g-files').classList.toggle('done', [...jobs.values()].some((j) => j.status === 'done'));
  parseInput();
  await refreshLogins();
  setInterval(refreshLogins, 6000);
})();
