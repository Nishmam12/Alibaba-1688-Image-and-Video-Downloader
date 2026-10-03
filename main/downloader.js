const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const EXT_BY_TYPE = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
  'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm',
};

function extFromUrl(url) {
  const m = new URL(url).pathname.match(/\.(jpg|jpeg|png|webp|gif|mp4|mov|webm)$/i);
  return m ? '.' + m[1].toLowerCase().replace('jpeg', 'jpg') : null;
}

// Downloads one file using the scraper session (cookies kept). Returns the saved path.
async function downloadOne(ses, url, destNoExt, referer, retries = 2) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // A manual "Referer" header is rejected (ERR_BLOCKED_BY_CLIENT); the fetch `referrer` option is the supported way.
      const res = await ses.fetch(url, { referrer: referer, headers: { Accept: '*/*' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ext = extFromUrl(url) || EXT_BY_TYPE[(res.headers.get('content-type') || '').split(';')[0]] || '.bin';
      const dest = destNoExt + ext;
      const tmp = dest + '.part';
      await fs.promises.mkdir(path.dirname(dest), { recursive: true });
      await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
      const size = (await fs.promises.stat(tmp)).size;
      if (size < 200) throw new Error(`file too small (${size} bytes)`);
      await fs.promises.rename(tmp, dest);
      return dest;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }
  throw lastErr;
}

// items: [{url, dir, name}] -> [{url, file?, error?}], at most `limit` in flight.
async function downloadAll(ses, items, referer, onProgress, limit = 3) {
  const results = new Array(items.length);
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      const it = items[i];
      try {
        results[i] = { url: it.url, file: await downloadOne(ses, it.url, path.join(it.dir, it.name), referer) };
      } catch (e) {
        results[i] = { url: it.url, error: e.message };
      }
      onProgress && onProgress(++done, items.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

module.exports = { downloadAll, downloadOne };
