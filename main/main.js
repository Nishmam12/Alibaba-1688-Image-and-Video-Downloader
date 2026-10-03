const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, Notification } = require('electron');
const { pathToFileURL } = require('url');
const fs = require('fs');
const path = require('path');

const browser = require('./browser');
const { normalizeList, slugify, detectSite } = require('./normalize');
const { downloadAll } = require('./downloader');
const { writeProductJson, writeCsv } = require('./exporter');
const upscaler = require('./upscaler');
const extractors = { alibaba: require('./extractors/alibaba'), '1688': require('./extractors/s1688') };

protocol.registerSchemesAsPrivileged([{ scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

const E2E = !!process.env.SCRAPER_E2E;
let ui = null;
const send = (channel, payload) => { if (ui && !ui.isDestroyed()) ui.webContents.send(channel, payload); };

// ---------- settings ----------
const DEFAULTS = () => ({
  outputDir: path.join(app.getPath('documents'), 'Alibaba-Scraper'),
  speed: 'normal', delayMin: 6, delayMax: 15,
  upscale: false, skipAtLeast: 1600,
  downloadVideos: true, downloadDescription: true, downloadVariants: true,
  bounds: null,
});
const userFile = (name) => path.join(app.getPath('userData'), name);
function loadSettings() {
  try { return { ...DEFAULTS(), ...JSON.parse(fs.readFileSync(userFile('settings.json'), 'utf8')) }; } catch { return DEFAULTS(); }
}
function saveSettings() {
  if (E2E) return; // smoke tests must never touch the real user data
  fs.mkdirSync(path.dirname(userFile('settings.json')), { recursive: true });
  fs.writeFileSync(userFile('settings.json'), JSON.stringify(settings, null, 2));
}
let settings = null;

// ---------- queue ----------
const jobs = []; // see makeJob()
let nextId = 1;
let running = false;
let paused = false;
let stopFlag = false;
let batchDone = 0;
let batchFailed = 0;
const doneProducts = [];
let csvPath = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let saveTimer = null;
function persistQueue() {
  if (E2E) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(userFile('queue.json'), JSON.stringify(jobs)); } catch { /* non-fatal */ }
  }, 400);
}
function restoreQueue() {
  try {
    const saved = JSON.parse(fs.readFileSync(userFile('queue.json'), 'utf8'));
    for (const j of saved) {
      if (!/^(done|failed)/.test(j.status)) Object.assign(j, { status: 'waiting', stage: null, done: 0, total: 0 });
      jobs.push(j);
      nextId = Math.max(nextId, j.id + 1);
    }
    if (jobs.some((j) => j.status === 'waiting')) paused = true; // let the user decide
  } catch { /* first run */ }
}

const t0 = Date.now();
function update(job, patch) {
  if (E2E && patch.status && patch.status !== job.status) console.log(`STAGE +${((Date.now() - t0) / 1000).toFixed(1)}s job${job.id} ${patch.status}`);
  Object.assign(job, patch);
  send('job:update', { ...job });
  persistQueue();
}

function makeJob(url) {
  const site = detectSite(url);
  return {
    id: nextId++, url, site, status: site ? 'waiting' : 'failed', error: site ? null : 'Not an alibaba.com or 1688.com link',
    title: '', folder: '', thumb: '', done: 0, total: 0, counts: null, startedAt: null, finishedAt: null,
  };
}

function addUrls(text) {
  const urls = [...new Set(String(text).split(/[\s,]+/).map((s) => s.trim()).filter((s) => /^https?:\/\//i.test(s)))];
  const added = urls.map((u) => makeJob(u));
  jobs.push(...added);
  persistQueue();
  send('jobs:added', added.map((j) => ({ ...j })));
  if (added.some((j) => j.status === 'waiting')) { paused = false; runQueue(); }
  return added.length;
}

// ---------- media:// (read-only access to scraped files) ----------
const mediaUrl = (file) => 'media://local/' + encodeURIComponent(file);
function allowedRoots() { return [settings.outputDir, ...jobs.map((j) => j.folder).filter(Boolean)]; }
function isAllowed(p) {
  const abs = path.resolve(p);
  return allowedRoots().some((root) => { const rel = path.relative(path.resolve(root), abs); return rel && !rel.startsWith('..') && !path.isAbsolute(rel); });
}

function notify(title, body, onClick) {
  if (E2E || !Notification.isSupported() || (ui && ui.isFocused())) return;
  const n = new Notification({ title, body });
  if (onClick) n.on('click', onClick);
  n.show();
}
const showUi = () => { if (ui) { if (ui.isMinimized()) ui.restore(); ui.show(); ui.focus(); } };

async function processJob(job) {
  const ex = extractors[job.site];
  const s = settings;
  update(job, { status: 'loading', startedAt: Date.now(), finishedAt: null, error: null, done: 0, total: 0 });

  const page = await browser.scrape(job.url, ex.pageExtract, {
    cancelled: () => stopFlag,
    hooks: {
      onWait: (kind) => {
        update(job, { status: kind });
        if (ui && !E2E) ui.flashFrame(true);
        notify(kind === 'login' ? 'Login needed' : 'Captcha needs solving', 'Open the scraper window to continue.', () => browser.show());
      },
      onResume: () => { update(job, { status: 'loading' }); if (ui) ui.flashFrame(false); },
    },
  });
  browser.hide();

  const seen = new Set();
  const images = normalizeList(page.images, seen);
  const variants = s.downloadVariants ? normalizeList(page.variantImages, seen) : [];
  update(job, { title: page.title, thumb: images[0] || '' });
  let description = [];
  if (s.downloadDescription && page.descUrl) {
    try {
      description = normalizeList(await ex.fetchDescriptionImages(page.descUrl, (u) => browser.fetchText(u, page.url)), seen);
    } catch (e) {
      send('log', `Description failed for ${page.id}: ${e.message}`);
    }
  }
  const videos = s.downloadVideos ? page.videos.map((v) => v.url).filter(Boolean) : [];

  const folder = path.join(s.outputDir, job.site, `${page.id}_${slugify(page.title, 50)}`);
  const pad = (n, total) => String(n + 1).padStart(Math.max(2, String(total).length), '0');
  const items = [
    ...images.map((url, i) => ({ url, dir: path.join(folder, 'images'), name: pad(i, images.length), group: 'images' })),
    ...variants.map((url, i) => ({ url, dir: path.join(folder, 'variants'), name: pad(i, variants.length), group: 'variants' })),
    ...description.map((url, i) => ({ url, dir: path.join(folder, 'description'), name: pad(i, description.length), group: 'description' })),
    ...videos.map((url, i) => ({ url, dir: path.join(folder, 'videos'), name: pad(i, videos.length), group: 'videos' })),
  ];
  update(job, { folder, status: 'downloading', done: 0, total: items.length });
  const results = await downloadAll(browser.ses(), items, page.url, (d, t) => update(job, { done: d, total: t }));
  const failed = results.filter((r) => r.error);

  const saved = items.map((it, i) => ({ ...it, ...results[i] }));
  const count = (g) => saved.filter((x) => x.group === g && x.file).length;
  const counts = { images: count('images'), variants: count('variants'), description: count('description'), videos: count('videos'), failed: failed.length, upscaled: 0 };
  const firstLocal = saved.find((x) => x.group === 'images' && x.file);
  if (firstLocal) update(job, { thumb: mediaUrl(firstLocal.file) });

  const product = {
    site: page.site, id: page.id, title: page.title, url: page.url, scrapedAt: new Date().toISOString(),
    data: page.data, variantNames: page.variantNames || undefined, counts, folder,
    files: saved.map((x) => ({ group: x.group, url: x.url, file: x.file ? path.relative(folder, x.file) : null, error: x.error || null })),
  };
  await writeProductJson(folder, product);
  doneProducts.push(product);
  if (!csvPath) csvPath = path.join(s.outputDir, `products_${new Date().toISOString().slice(0, 10)}.csv`);
  await fs.promises.mkdir(s.outputDir, { recursive: true });
  await writeCsv(csvPath, doneProducts);

  if (s.upscale) {
    const files = saved.filter((x) => x.file && x.group !== 'videos').map((x) => x.file);
    if (!upscaler.isAvailable()) {
      send('log', 'Upscaling skipped: the upscaler is not installed.');
    } else if (files.length) {
      update(job, { status: 'upscaling', done: 0, total: files.length });
      const ups = await upscaler.upscaleFiles(files, { skipAtLeast: s.skipAtLeast }, (d, t) => update(job, { done: d, total: t }));
      counts.upscaled = ups.filter((u) => u.output).length;
      const errs = ups.filter((u) => u.error);
      if (errs.length) send('log', `${errs.length} image(s) failed to upscale: ${errs[0].error}`);
    }
  }

  update(job, {
    status: failed.length ? 'done-with-errors' : 'done', counts, finishedAt: Date.now(),
    error: failed.length ? `${failed.length} file(s) could not be downloaded` : null,
  });
}

async function runQueue() {
  if (running) return;
  running = true;
  stopFlag = false;
  batchDone = 0; batchFailed = 0;
  send('queue:state', { running: true, paused });
  try {
    while (!stopFlag) {
      if (paused) { await sleep(500); continue; }
      const job = jobs.find((j) => j.status === 'waiting');
      if (!job) break;
      try {
        await processJob(job);
        batchDone++;
      } catch (e) {
        if (stopFlag) update(job, { status: 'waiting', error: null, done: 0, total: 0 });
        else { update(job, { status: 'failed', error: e.message, finishedAt: Date.now() }); batchFailed++; }
        browser.hide();
      }
      if (stopFlag) break;
      if (jobs.some((j) => j.status === 'waiting')) {
        const ms = (settings.delayMin + Math.random() * Math.max(0, settings.delayMax - settings.delayMin)) * 1000;
        send('queue:next', { at: Date.now() + ms });
        const end = Date.now() + ms;
        while (Date.now() < end && !stopFlag && !paused) await sleep(250);
        send('queue:next', { at: null });
      }
    }
  } finally {
    running = false;
    send('queue:state', { running: false, paused });
    send('queue:next', { at: null });
    if (!stopFlag && batchDone + batchFailed > 0) {
      send('queue:finished', { done: batchDone, failed: batchFailed });
      notify('Scraping finished', `${batchDone} done${batchFailed ? `, ${batchFailed} failed` : ''}. Click to open the folder.`, () => shell.openPath(settings.outputDir));
    }
  }
}

// ---------- product details for the drawer ----------
function listDir(dir, exts) {
  try { return fs.readdirSync(dir).filter((f) => exts.test(f)).sort().map((f) => path.join(dir, f)); } catch { return []; }
}
function productDetails(folder) {
  if (!folder || !isAllowed(folder)) return null;
  let product = null;
  try { product = JSON.parse(fs.readFileSync(path.join(folder, 'product.json'), 'utf8')); } catch { return null; }
  const img = /\.(jpe?g|png|webp|gif)$/i;
  const up = (g) => listDir(path.join(folder, 'images_upscaled', g), img);
  const toUrls = (files) => files.map((f) => ({ url: mediaUrl(f), file: f }));
  return {
    product,
    groups: {
      images: toUrls(listDir(path.join(folder, 'images'), img)),
      variants: toUrls(listDir(path.join(folder, 'variants'), img)),
      description: toUrls(listDir(path.join(folder, 'description'), img)),
      upscaled: toUrls([...up('images'), ...up('variants'), ...up('description')]),
    },
    videos: listDir(path.join(folder, 'videos'), /\.(mp4|mov|webm)$/i),
  };
}

// ---------- window / IPC ----------
function createWindow() {
  const b = settings.bounds || {};
  ui = new BrowserWindow({
    width: b.width || 1120, height: b.height || 800, x: b.x, y: b.y, minWidth: 760, minHeight: 560,
    title: 'Alibaba 1688 Scraper', backgroundColor: '#0d1118', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  const icon = path.join(__dirname, '..', 'build', 'icon.png');
  if (fs.existsSync(icon)) ui.setIcon(icon);
  ui.setMenuBarVisibility(false);
  ui.once('ready-to-show', () => ui.show());
  ui.on('close', () => { settings.bounds = ui.getNormalBounds(); saveSettings(); });
  ui.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  ui.webContents.on('will-navigate', (e) => e.preventDefault());
  ui.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  settings = loadSettings();
  restoreQueue();

  protocol.handle('media', (req) => {
    const p = decodeURIComponent(new URL(req.url).pathname.slice(1));
    if (!isAllowed(p)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(p).toString());
  });

  ipcMain.handle('app:info', () => ({ version: app.getVersion() }));
  ipcMain.handle('settings:get', () => ({ ...settings, upscalerInstalled: upscaler.isAvailable() }));
  ipcMain.handle('settings:set', (_e, patch) => { settings = { ...settings, ...patch }; saveSettings(); return settings; });
  ipcMain.handle('jobs:add', (_e, text) => addUrls(text));
  ipcMain.handle('jobs:list', () => ({ jobs: jobs.map((j) => ({ ...j })), running, paused }));
  ipcMain.handle('jobs:retry', (_e, id) => {
    const j = jobs.find((x) => x.id === id);
    if (j && /^(failed|done-with-errors)/.test(j.status) && j.site) { update(j, { status: 'waiting', error: null, done: 0, total: 0 }); paused = false; runQueue(); }
  });
  ipcMain.handle('jobs:retryFailed', () => {
    jobs.filter((j) => j.status === 'failed' && j.site).forEach((j) => update(j, { status: 'waiting', error: null, done: 0, total: 0 }));
    paused = false; runQueue();
  });
  ipcMain.handle('jobs:remove', (_e, id) => {
    const i = jobs.findIndex((x) => x.id === id);
    if (i >= 0 && !/^(loading|downloading|upscaling|captcha|login)$/.test(jobs[i].status)) { jobs.splice(i, 1); persistQueue(); return true; }
    return false;
  });
  ipcMain.handle('jobs:clearFinished', () => {
    for (let i = jobs.length - 1; i >= 0; i--) if (/^(done|failed)/.test(jobs[i].status)) jobs.splice(i, 1);
    persistQueue();
    return jobs.map((j) => ({ ...j }));
  });
  ipcMain.handle('queue:pause', () => { paused = true; send('queue:state', { running, paused }); });
  ipcMain.handle('queue:resume', () => { paused = false; send('queue:state', { running, paused }); runQueue(); });
  ipcMain.handle('queue:stop', () => { stopFlag = true; });
  ipcMain.handle('login:open', (_e, site) => browser.openLogin(site));
  ipcMain.handle('login:status', () => browser.loginStatus());
  ipcMain.handle('session:clear', async () => { await browser.clearSession(); return browser.loginStatus(); });
  ipcMain.handle('browser:show', () => browser.show());
  ipcMain.handle('product:get', (_e, folder) => productDetails(folder));
  ipcMain.handle('path:open', (_e, p) => {
    if (!p) return null;
    if (path.resolve(p) === path.resolve(settings.outputDir)) fs.mkdirSync(p, { recursive: true }); // first run: folder doesn't exist yet
    return fs.existsSync(p) && (isAllowed(p) || path.resolve(p) === path.resolve(settings.outputDir)) ? shell.openPath(p) : null;
  });
  ipcMain.handle('path:reveal', (_e, p) => { if (p && fs.existsSync(p) && isAllowed(p)) shell.showItemInFolder(p); });
  ipcMain.handle('external:open', (_e, url) => {
    try { const u = new URL(url); if (/^https?:$/.test(u.protocol) && detectSite(url)) shell.openExternal(url); } catch { /* ignore */ }
  });
  ipcMain.handle('folder:choose', async () => {
    const r = await dialog.showOpenDialog(ui, { properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('window:focus', showUi);

  createWindow();

  // Headless smoke test: SCRAPER_E2E="url1 url2" SCRAPER_OUT=<dir> npx electron .
  if (E2E) {
    if (process.env.SCRAPER_OUT) settings.outputDir = process.env.SCRAPER_OUT;
    settings.upscale = process.env.SCRAPER_UPSCALE === '1';
    settings.delayMin = settings.delayMax = 2;
    jobs.length = 0;
    ui.webContents.once('did-finish-load', () => {
      addUrls(process.env.SCRAPER_E2E);
      const timer = setInterval(() => {
        if (running || jobs.some((j) => j.status === 'waiting')) return;
        clearInterval(timer);
        console.log('E2E_RESULT ' + JSON.stringify(jobs.map(({ url, status, title, counts, error, folder }) => ({ url, status, title, counts, error, folder }))));
        app.quit();
      }, 1000);
    });
  }
});

app.on('before-quit', () => browser.destroy());
app.on('window-all-closed', () => { browser.destroy(); app.quit(); });
