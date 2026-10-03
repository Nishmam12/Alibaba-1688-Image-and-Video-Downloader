// 1688.com extractor.
// pageExtract() runs INSIDE the product page. Data paths confirmed against a live detail.1688.com page:
//   window.context.result.data.gallery.fields.{offerImgList[], video.videoUrl, subject}
//   window.context.result.data.Root.fields.dataJson.skuModel.{skuProps[].value[].imageUrl, skuInfoMap}
//   ...dataJson.orderParamModel.orderParam.skuParam.skuRangePrices[]   (tiered prices)
//   ...dataJson.tempModel.{offerId, companyName, sellerLoginId}
//   window.context.result.data.description.fields.detailUrl -> itemcdn.tmall.com JS file:
//        var offer_details={"content":"<div>...<img src=...>"}

function pageExtract() {
  const data = window.context && window.context.result && window.context.result.data;
  if (!data || !data.gallery || !data.gallery.fields) return { ready: false };
  const gf = data.gallery.fields;
  const dj = (data.Root && data.Root.fields && data.Root.fields.dataJson) || {};
  const temp = dj.tempModel || {};

  const images = (gf.offerImgList && gf.offerImgList.length ? gf.offerImgList : gf.mainImage) || [];
  const videos = [];
  if (gf.video && gf.video.videoUrl) videos.push({ url: gf.video.videoUrl, quality: 'hd', cover: gf.video.coverUrl || null });

  const variantImages = [];
  const variantNames = [];
  for (const prop of (dj.skuModel && dj.skuModel.skuProps) || []) {
    for (const v of prop.value || []) {
      if (v.imageUrl) { variantImages.push(v.imageUrl); variantNames.push(v.name || ''); }
    }
  }

  const tiers = [];
  const ranges = dj.orderParamModel && dj.orderParamModel.orderParam && dj.orderParamModel.orderParam.skuParam
    && dj.orderParamModel.orderParam.skuParam.skuRangePrices;
  for (const r of ranges || []) tiers.push({ min: Number(r.beginAmount) || null, price: r.price || null });

  const skus = [];
  const infoMap = (dj.skuModel && dj.skuModel.skuInfoMap) || {};
  for (const name of Object.keys(infoMap)) {
    const s = infoMap[name];
    skus.push({ name, price: s.discountPrice || s.price || null, stock: s.canBookCount != null ? s.canBookCount : null });
  }

  const offerId = String(temp.offerId || (location.pathname.match(/offer\/(\d+)/) || [])[1] || '');
  const attrFields = data.productAttributes && data.productAttributes.fields;

  return {
    ready: true,
    site: '1688',
    id: offerId,
    title: gf.subject || document.title,
    url: `https://detail.1688.com/offer/${offerId}.html`,
    images,
    variantImages,
    variantNames,
    videos,
    descUrl: data.description && data.description.fields && data.description.fields.detailUrl || null,
    data: {
      priceTiers: tiers,
      skus,
      attributes: attrFields && (attrFields.attributes || attrFields.list) || null,
      supplier: temp.companyName || null,
      supplierLoginId: temp.sellerLoginId || null,
    },
  };
}

// Runs in the main process. The description file is a JS assignment, not plain JSON.
async function fetchDescriptionImages(descUrl, fetchText) {
  if (!descUrl) return [];
  const body = await fetchText(descUrl);
  let html = body;
  const m = body.match(/offer_details\s*=\s*(\{[\s\S]*\})\s*;?\s*$/);
  if (m) {
    try { html = JSON.parse(m[1]).content || ''; } catch { /* fall back to raw text */ }
  }
  const out = [];
  for (const tag of html.match(/<img\b[^>]*>/gi) || []) {
    const src = tag.match(/\b(?:data-src|src)\s*=\s*["']([^"']+)["']/i);
    if (src) out.push(src[1]);
  }
  return out;
}

module.exports = { pageExtract, fetchDescriptionImages };
