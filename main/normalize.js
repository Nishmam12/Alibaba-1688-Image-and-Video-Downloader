// Turns alicdn thumbnail / re-encoded URLs into the original full-size file URL.
//   .../H123.jpg_350x350.jpg   -> .../H123.jpg
//   .../O1CN01_!!1-0-cib.jpg_.webp -> .../O1CN01_!!1-0-cib.jpg
//   .../abc.310x310.jpg        -> .../abc.jpg
//   //sc04.alicdn.com/x.jpg    -> https://sc04.alicdn.com/x.jpg

const EXT = '(?:jpg|jpeg|png|gif|webp|bmp)';

function normalizeImageUrl(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let url = raw.trim().replace(/&amp;/g, '&');
  if (url.startsWith('//')) url = 'https:' + url;
  if (!/^https?:\/\//i.test(url)) return null;
  url = url.replace(/^http:\/\//i, 'https://');
  url = url.split('?')[0].split('#')[0];

  // "<file>.<ext>_<anything>" (size / quality / format-conversion suffix) -> "<file>.<ext>"
  url = url.replace(new RegExp(`^(.*?\\.${EXT})_[^/]*$`, 'i'), '$1');
  // "<file>.<W>x<H>[q<N>].<ext>" -> "<file>.<ext>"
  url = url.replace(new RegExp(`\\.\\d+x\\d+(?:q\\d+)?(\\.${EXT})$`, 'i'), '$1');
  // "<file>.summ.<ext>" / ".search.<ext>" style
  url = url.replace(new RegExp(`\\.(?:summ|search|sum)(\\.${EXT})$`, 'i'), '$1');
  return url;
}

const JUNK = /img-placeholder|-tps-\d+-\d+\.(?:png|svg|gif|jpg)$|\.svg$|spaceball|\/flag\/|\/@icon\/|loading\.gif/i;

function isJunk(url) {
  return JUNK.test(url);
}

// Cleans, drops icons/placeholders and de-duplicates while keeping order.
function normalizeList(urls, seen = new Set()) {
  const out = [];
  for (const raw of urls || []) {
    const url = normalizeImageUrl(raw);
    if (!url || isJunk(url) || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

function slugify(text, max = 60) {
  const s = String(text || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, max)
    .trim();
  return s || 'product';
}

function detectSite(url) {
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch { return null; }
  if (host.endsWith('1688.com')) return '1688';
  if (host.endsWith('alibaba.com')) return 'alibaba';
  return null;
}

module.exports = { normalizeImageUrl, normalizeList, slugify, detectSite, isJunk };
