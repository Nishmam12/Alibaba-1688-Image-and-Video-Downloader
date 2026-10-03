const fs = require('fs');
const path = require('path');

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function writeProductJson(folder, product) {
  await fs.promises.mkdir(folder, { recursive: true });
  await fs.promises.writeFile(path.join(folder, 'product.json'), JSON.stringify(product, null, 2), 'utf8');
}

const HEADERS = ['site', 'id', 'title', 'url', 'price', 'moq', 'supplier', 'images', 'variant_images', 'description_images', 'videos', 'folder'];

function productRow(p) {
  const d = p.data || {};
  const tiers = d.priceTiers || [];
  const price = d.priceRange || (tiers.length ? tiers.map((t) => `${t.min ?? ''}+: ${t.usd ?? t.price ?? ''}`).join(' | ') : '');
  return [p.site, p.id, p.title, p.url, price, d.moq || (tiers[0] && tiers[0].min) || '', d.supplier,
    p.counts.images, p.counts.variants, p.counts.description, p.counts.videos, p.folder];
}

// Rewrites the full CSV each time (UTF-8 BOM so Excel shows Chinese correctly).
async function writeCsv(file, products) {
  const lines = [HEADERS.join(',')].concat(products.map((p) => productRow(p).map(csvCell).join(',')));
  await fs.promises.writeFile(file, '﻿' + lines.join('\r\n') + '\r\n', 'utf8');
}

module.exports = { writeProductJson, writeCsv };
