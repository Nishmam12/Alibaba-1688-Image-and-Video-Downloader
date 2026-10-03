const test = require('node:test');
const assert = require('node:assert');
const { normalizeImageUrl, normalizeList, detectSite, slugify } = require('../main/normalize');

test('alibaba thumbnail suffixes are stripped to the original', () => {
  assert.strictEqual(
    normalizeImageUrl('https://sc04.alicdn.com/kf/Ha45e1af7b55a4a4188c3e6d6b3a7438a1.jpg_350x350.jpg'),
    'https://sc04.alicdn.com/kf/Ha45e1af7b55a4a4188c3e6d6b3a7438a1.jpg');
  assert.strictEqual(
    normalizeImageUrl('https://sc04.alicdn.com/kf/H4f1bacdc88744eabb11d2e9067dc0064X.png_120x120.png'),
    'https://sc04.alicdn.com/kf/H4f1bacdc88744eabb11d2e9067dc0064X.png');
  assert.strictEqual(
    normalizeImageUrl('https://s.alicdn.com/@sc01/kf/H0592f0a65cd947e191ed19400dcaab6fZ.jpg_100x100.jpg'),
    'https://s.alicdn.com/@sc01/kf/H0592f0a65cd947e191ed19400dcaab6fZ.jpg');
});

test('1688 webp conversion suffix is stripped', () => {
  assert.strictEqual(
    normalizeImageUrl('https://cbu01.alicdn.com/img/ibank/O1CN01ZTPe7P1Pr2tKeBFM9_!!2222299391893-0-cib.jpg_.webp'),
    'https://cbu01.alicdn.com/img/ibank/O1CN01ZTPe7P1Pr2tKeBFM9_!!2222299391893-0-cib.jpg');
});

test('protocol-relative, http and query strings are cleaned', () => {
  assert.strictEqual(normalizeImageUrl('//sc04.alicdn.com/kf/Habc/200049686/Habc.jpg'), 'https://sc04.alicdn.com/kf/Habc/200049686/Habc.jpg');
  assert.strictEqual(normalizeImageUrl('http://x.alicdn.com/a.jpg?x=1'), 'https://x.alicdn.com/a.jpg');
  assert.strictEqual(normalizeImageUrl('https://x.alicdn.com/a.310x310.jpg'), 'https://x.alicdn.com/a.jpg');
});

test('list drops placeholders, icons and duplicates', () => {
  const out = normalizeList([
    '//u.alicdn.com/js/5v/esite/img/img-placeholder.png',
    'https://s.alicdn.com/@img/imgextra/i4/O1CN01_!!6000000000606-2-tps-54-55.png',
    'https://sc04.alicdn.com/kf/Ha.jpg_350x350.jpg',
    'https://sc04.alicdn.com/kf/Ha.jpg_50x50.jpg',
    'https://sc04.alicdn.com/kf/Hb.jpg',
  ]);
  assert.deepStrictEqual(out, ['https://sc04.alicdn.com/kf/Ha.jpg', 'https://sc04.alicdn.com/kf/Hb.jpg']);
});

test('site detection and slugs', () => {
  assert.strictEqual(detectSite('https://www.alibaba.com/product-detail/x_1.html'), 'alibaba');
  assert.strictEqual(detectSite('https://detail.1688.com/offer/1.html'), '1688');
  assert.strictEqual(detectSite('https://example.com/'), null);
  assert.strictEqual(slugify('a/b:c*?"<>|  d. '), 'a b c d');
});
