const AR_HOME = 'https://www.nuskin.com/ar/es';
const GLOBAL_PAGES = [
  'https://www.nuskin.com/ar/es/catalog/all_products',
  'https://www.nuskin.com/ar/es/catalog/kits_bundles',
  'https://www.nuskin.com/es_AR/products/shop/view_all.html'
];

function norm(value = '') {
  return String(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[®™©]/g, '')
    .replace(/&amp;/gi, '&')
    .replace(/[^a-zA-Z0-9áéíóúüñ]+/g, ' ')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

function htmlText(html = '') {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#36;/g, '$')
    .replace(/&dollar;/gi, '$')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
}

function toARS(raw) {
  if (raw == null) return null;
  let s = String(raw).trim().replace(/\s/g, '').replace(/[^0-9.,-]/g, '');
  if (!s) return null;
  const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
  const dec = Math.max(lastDot, lastComma);
  // Nu Skin storefronts normally show 2 decimal digits. Strip locale separators safely.
  if (dec >= 0 && s.length - dec - 1 === 2) s = s.slice(0, dec).replace(/[.,]/g, '') + '.' + s.slice(dec + 1);
  else s = s.replace(/[.,]/g, '');
  const n = Number(s);
  if (!Number.isFinite(n) || n < 500 || n > 100000000) return null;
  return Math.round(n);
}

function priceFromTextNearName(text, name) {
  const cleanText = String(text).replace(/[®™©]/g, ' ');
  const cleanName = String(name || '').replace(/[®™©]/g, ' ').replace(/\s+/g, ' ').trim();
  if (cleanName.length < 4) return null;
  let idx = cleanText.toLocaleLowerCase('es').indexOf(cleanName.toLocaleLowerCase('es'));
  if (idx < 0) {
    // Conservative fallback: require the first two meaningful name tokens close together.
    const tokens = norm(cleanName).split(' ').filter(t => t.length >= 4).slice(0, 4);
    if (tokens.length < 2) return null;
    const lower = norm(cleanText);
    const a = lower.indexOf(tokens[0]);
    if (a < 0) return null;
    const b = lower.indexOf(tokens[1], a + tokens[0].length);
    if (b < 0 || b - a > 180) return null;
    // Indices remain close enough because normalization only removes decoration/diacritics.
    idx = Math.max(0, a - 40);
  }
  const window = cleanText.slice(Math.max(0, idx - 100), idx + 2200);
  const patterns = [
    /(?:ARS|AR\$)\s*\$?\s*([0-9][0-9.,]{2,})/i,
    /\$\s*([0-9][0-9.,]{2,})\s*(?:ARS)?/i,
    /(?:precio|price)[^0-9]{0,80}([0-9][0-9.,]{2,})/i
  ];
  for (const re of patterns) {
    const m = window.match(re); const p = m && toARS(m[1]); if (p) return p;
  }
  return null;
}

function priceFromHtml(html, product) {
  // Prefer structured snippets containing the exact SKU.
  const sku = String(product.sku || '');
  if (sku) {
    const pos = html.indexOf(sku);
    if (pos >= 0) {
      const w = html.slice(Math.max(0, pos - 1800), pos + 3500);
      const structured = [
        /"(?:currency|currencyCode)"\s*:\s*"ARS"[\s\S]{0,500}?"(?:value|amount|price)"\s*:\s*"?([0-9.,]+)"?/i,
        /"(?:value|amount|price)"\s*:\s*"?([0-9.,]+)"?[\s\S]{0,500}?"(?:currency|currencyCode)"\s*:\s*"ARS"/i,
        /(?:ARS|AR\$)\s*\$?\s*([0-9][0-9.,]{2,})/i,
        /\$\s*([0-9][0-9.,]{2,})/i
      ];
      for (const re of structured) { const m = w.match(re); const p = m && toARS(m[1]); if (p) return p; }
    }
  }
  const text = htmlText(html);
  return priceFromTextNearName(text, product.name);
}

async function fetchHtml(url, timeoutMs = 4500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      redirect: 'follow', signal: controller.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; NuSkinPriceChecker/1.0)',
        'accept': 'text/html,application/xhtml+xml',
        'accept-language': 'es-AR,es;q=0.9'
      }
    });
    if (!r.ok) return null;
    const type = r.headers.get('content-type') || '';
    if (!type.includes('text/html') && !type.includes('application/xhtml')) return null;
    return { html: await r.text(), finalUrl: r.url || url };
  } catch { return null; }
  finally { clearTimeout(timer); }
}

async function resolveProduct(product, globalDocs) {
  for (const doc of globalDocs) {
    if (!doc) continue;
    const p = priceFromHtml(doc.html, product);
    if (p) return { sku: product.sku, name: product.name, price: p, sourceUrl: doc.finalUrl, matchedBy: 'catalog' };
  }
  const sku = encodeURIComponent(product.sku);
  const candidates = [
    `https://www.nuskin.com/ar/es/product/${sku}`,
    `https://www.nuskin.com/content/nuskin/es_AR/products/product.${sku}.html`
  ];
  const docs = await Promise.all(candidates.map(url => fetchHtml(url, 2800)));
  for (const doc of docs) {
    if (!doc) continue;
    const p = priceFromHtml(doc.html, product);
    if (p) return { sku: product.sku, name: product.name, price: p, sourceUrl: doc.finalUrl, matchedBy: 'product' };
  }
  return null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  const products = Array.isArray(req.body?.products) ? req.body.products : [];
  const clean = products.slice(0, 10).map(p => ({ sku: String(p?.sku || '').replace(/\D/g, '').slice(0, 16), name: String(p?.name || '').slice(0, 180) })).filter(p => p.sku && p.name);
  if (!clean.length) return res.status(400).json({ error: 'No se recibieron productos válidos' });

  const globalDocs = await Promise.all(GLOBAL_PAGES.map(u => fetchHtml(u, 2500)));
  const settled = await Promise.all(clean.map(p => resolveProduct(p, globalDocs)));
  const results = settled.filter(Boolean);
  return res.status(200).json({
    checkedAt: new Date().toISOString(),
    source: 'Nu Skin Argentina',
    sourceHome: AR_HOME,
    requested: clean.length,
    found: results.length,
    results,
    errors: results.length === 0 ? ['Nu Skin no expuso precios ARS verificables para este lote.'] : []
  });
};
