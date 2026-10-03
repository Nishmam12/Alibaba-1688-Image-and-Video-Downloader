const { BrowserWindow, session } = require('electron');

const PARTITION = 'persist:scraper';
// Real desktop Chrome UA with the version Electron actually ships, so the page sees a normal browser.
const UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;

const LOGIN_URLS = {
  alibaba: 'https://passport.alibaba.com/icbu_login.htm',
  '1688': 'https://login.1688.com/member/signin.htm',
};

// Cookie names are best-effort markers of a signed-in session (to confirm on first real login).
const LOGIN_COOKIES = {
  alibaba: { domain: 'alibaba.com', names: ['xman_t', 'xman_us_t', 'ali_apache_id', 'intl_common_forever'] },
  '1688': { domain: '1688.com', names: ['__cn_logon__', 'cookie2', 'last_mid'] },
};

let win = null;

function ses() {
  const s = session.fromPartition(PARTITION);
  s.setUserAgent(UA);
  return s;
}

function getWindow() {
  if (win && !win.isDestroyed()) return win;
  win = new BrowserWindow({
    width: 1280, height: 900, show: false, title: 'Scraper browser',
    webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  win.webContents.setUserAgent(UA);
  win.webContents.setWindowOpenHandler(({ url }) => { win.loadURL(url); return { action: 'deny' }; });
  win.on('close', (e) => { if (!win.forceClose) { e.preventDefault(); win.hide(); } });
  return win;
}

function show() { const w = getWindow(); w.show(); w.focus(); }
function hide() { if (win && !win.isDestroyed()) win.hide(); }

async function loginStatus() {
  const s = ses();
  const out = {};
  for (const [site, cfg] of Object.entries(LOGIN_COOKIES)) {
    const cookies = await s.cookies.get({ domain: cfg.domain });
    out[site] = cookies.some((c) => cfg.names.includes(c.name));
  }
  return out;
}

function openLogin(site) {
  const w = getWindow();
  w.loadURL(LOGIN_URLS[site]).catch(() => {});
  show();
}

const CAPTCHA_CHECK = `(() => {
  const u = location.href;
  // Sites keep hidden, empty captcha containers on every page (e.g. <div id="nocaptcha" style="display:none">),
  // so an element only counts when it is actually on screen.
  const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 20 && r.height > 20 && cs.display !== 'none' && cs.visibility !== 'hidden'; };
  const SEL = '#nc_1_n1z, .nc_wrapper, .baxia-dialog, #baxia-dialog-content, iframe[src*="punish"]';
  const hit = [...document.querySelectorAll(SEL)].find(visible);
  const hasSlider = !!hit;
  const blocked = /punish|_____tmd_____|sec\\.1688\\.com|\\/security\\//i.test(u);
  const login = /login\\.1688\\.com|passport\\.alibaba\\.com|login\\.alibaba\\.com\\/?(?:$|\\?)/i.test(u);
  return { url: u, captcha: hasSlider || blocked, login, which: hit ? hit.outerHTML.slice(0, 160) : '' };
})()`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Loads `url`, waits until the site's data global exists, handling captcha / login walls.
// hooks.onWait(kind) is called with 'captcha' | 'login' while waiting on the user.
// Returns the extractor result.
async function scrape(url, extractorFn, { timeoutMs = 45000, userWaitMs = 10 * 60 * 1000, hooks = {}, cancelled = () => false } = {}) {
  const w = getWindow();
  w.loadURL(url).catch(() => {}); // navigation errors on slow trackers are expected; we poll for data instead
  const expr = `(${extractorFn})()`;
  const start = Date.now();
  let waitingSince = 0;
  let notified = null;

  while (true) {
    if (cancelled()) throw new Error('cancelled');
    await sleep(700);
    let state = null;
    try { state = await w.webContents.executeJavaScript(CAPTCHA_CHECK); } catch { /* page mid-navigation */ }

    if (state && (state.captcha || state.login)) {
      const kind = state.login ? 'login' : 'captcha';
      if (!waitingSince) {
        waitingSince = Date.now(); show();
        if (process.env.SCRAPER_E2E) console.log('WAIT-STATE', JSON.stringify(state));
      }
      if (notified !== kind) { notified = kind; hooks.onWait && hooks.onWait(kind); }
      if (Date.now() - waitingSince > userWaitMs) throw new Error(`Timed out waiting for ${kind} to be solved`);
      continue;
    }
    if (waitingSince) {
      // user finished; hide the window and give the page time to settle
      waitingSince = 0; notified = null; hide(); hooks.onResume && hooks.onResume();
      if (!/offer|product-detail/.test(w.webContents.getURL())) w.loadURL(url).catch(() => {});
    }

    try {
      const result = await w.webContents.executeJavaScript(expr);
      if (result && result.ready) return result;
    } catch { /* not ready yet */ }
    if (Date.now() - start > timeoutMs) throw new Error('Product data not found on page (layout changed, blocked, or not a product page)');
  }
}

// Plain GET with the scraper session cookies (no CORS rules in the main process).
async function fetchText(url, referer) {
  const res = await ses().fetch(url, { referrer: referer || url });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

// Signs out of both sites by wiping the scraper session (cookies, storage, cache).
async function clearSession() {
  const s = ses();
  await s.clearStorageData();
  await s.clearCache();
}

function destroy() { if (win && !win.isDestroyed()) { win.forceClose = true; win.destroy(); } }

module.exports = { ses, scrape, fetchText, show, hide, openLogin, loginStatus, clearSession, destroy, PARTITION };
