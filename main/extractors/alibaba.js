// alibaba.com extractor.
// pageExtract() is serialised and run INSIDE the product page (webContents.executeJavaScript),
// so it must be self-contained. Data paths confirmed against a live product page:
//   window.detailData.globalData.product.mediaItems[]   imageUrl.big (original) | videoUrl.{hd,sd,ld,...}.videoUrl
//   ...product.{subject, productId, moq, price.productLadderPrices[], sku.skuAttrs, productBasicProperties, ...}
//   ...globalData.seller.{companyName, companyJoinYears, companyRegisterCountry}
// Description: GET /event/app/mainAction/desc.htm?detailId=<id>&language=en -> JSON, data.productHtmlDescription (HTML)

function pageExtract() {
  const dd = window.detailData;
  if (!dd || !dd.globalData || !dd.globalData.product) return { ready: false };
  const g = dd.globalData;
  const p = g.product;

  const images = [];
  const videos = [];
  for (const m of p.mediaItems || []) {
    if (m.imageUrl) images.push(m.imageUrl.big || m.imageUrl.normal || m.imageUrl.small);
    if (m.videoUrl) {
      const order = ['hd', 'sd', 'hd_265', 'sd_265', 'ld'];
      const key = order.find((k) => m.videoUrl[k] && m.videoUrl[k].videoUrl);
      if (key) videos.push({ url: m.videoUrl[key].videoUrl, quality: key, cover: m.videoCoverUrl || null });
    }
  }

  // Variant (SKU) images: skuAttrs is an object/array whose values carry skuImage / imageUrl style fields.
  const variantImages = [];
  const seenKeys = /image|img|pic/i;
  const walkSku = (o, depth) => {
    if (!o || depth > 6) return;
    if (typeof o === 'string') return;
    if (Array.isArray(o)) { o.forEach((x) => walkSku(x, depth + 1)); return; }
    if (typeof o === 'object') {
      for (const k of Object.keys(o)) {
        if (typeof o[k] === 'string' && seenKeys.test(k) && /alicdn\.com/.test(o[k])) variantImages.push(o[k]);
        else walkSku(o[k], depth + 1);
      }
    }
  };
  walkSku(p.sku && p.sku.skuAttrs, 0);

  const ladder = (p.price && p.price.productLadderPrices) || [];
  const specs = {};
  for (const list of [p.productBasicProperties, p.productKeyIndustryProperties, p.productOtherProperties]) {
    for (const it of list || []) {
      const name = it.attrName || it.name;
      const value = it.attrValue || it.value;
      if (name && value) specs[name] = value;
    }
  }

  const s = g.seller || {};
  return {
    ready: true,
    site: 'alibaba',
    id: String(p.productId || ''),
    title: p.subject || document.title,
    url: location.href.split('?')[0],
    images,
    variantImages,
    videos,
    descUrl: p.productId ? `https://${location.host}/event/app/mainAction/desc.htm?detailId=${p.productId}&language=en` : null,
    data: {
      moq: p.moq || null,
      unit: p.quantityUnit || null,
      priceRange: p.price && p.price.formatLadderPrice || null,
      priceTiers: ladder.map((t) => ({ min: t.min, max: t.max, usd: t.dollarPrice, local: t.formatPrice })),
      specs,
      supplier: s.companyName || null,
      supplierYears: s.companyJoinYears || null,
      supplierCountry: s.companyRegisterCountry || null,
    },
  };
}

// Runs in the main process. `fetchText(url)` must send the scraper session's cookies.
async function fetchDescriptionImages(descUrl, fetchText) {
  if (!descUrl) return [];
  const body = await fetchText(descUrl);
  let html = '';
  try {
    html = JSON.parse(body).data.productHtmlDescription || '';
  } catch {
    html = body;
  }
  const out = [];
  const re = /<img\b[^>]*>/gi;
  for (const tag of html.match(re) || []) {
    for (const attr of ['data-src', 'data-lazyload-src', 'src']) {
      const m = tag.match(new RegExp(`\\b${attr}\\s*=\\s*["']([^"']+)["']`, 'i'));
      if (m && !/placeholder/i.test(m[1])) { out.push(m[1]); break; }
    }
  }
  return out;
}

module.exports = { pageExtract, fetchDescriptionImages };
