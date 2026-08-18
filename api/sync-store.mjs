import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const STORE_HOME = 'https://www.nuskin.com/ar/es/';
const CATALOG_URL = 'https://www.nuskin.com/ar/es/catalog/all_products';
const NAV_TIMEOUT = 18000;
const MAX_PAGES = 18;

function absoluteUrl(raw, base = STORE_HOME) {
  if (!raw) return '';
  try { return new URL(String(raw), base).href; } catch { return ''; }
}

function isArUrl(raw, kind = '') {
  const url = absoluteUrl(raw);
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.hostname !== 'www.nuskin.com' || !u.pathname.startsWith('/ar/es/')) return false;
    if (kind === 'product') return u.pathname.includes('/product/');
    if (kind === 'catalog') return u.pathname.includes('/catalog/');
    return true;
  } catch { return false; }
}

function moneyNumber(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : null;
  let s = String(raw).replace(/\s/g, '').replace(/[^0-9.,-]/g, '');
  if (!s) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  const last = Math.max(lastDot, lastComma);
  if (last >= 0 && s.length - last - 1 === 2) {
    const whole = s.slice(0, last).replace(/[.,]/g, '');
    const decimals = s.slice(last + 1);
    s = `${whole}.${decimals}`;
  } else s = s.replace(/[.,]/g, '');
  const n = Number(s);
  return Number.isFinite(n) && n >= 500 && n <= 100000000 ? Math.round(n) : null;
}

function findString(obj, keys) {
  for (const key of keys) {
    const v = obj?.[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function findSku(obj) {
  const raw = findString(obj, ['sku','SKU','itemNumber','itemNo','articleNumber','productCode','stockCode']);
  return raw.match(/\d{6,12}/)?.[0] || '';
}

function currencyLooksArs(value) {
  if (value == null || value === '') return true;
  const s = String(value).toUpperCase().replace(/\s/g, '');
  return s.includes('ARS') || s.includes('AR$') || s === '$';
}

function priceFromObject(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const currency = findString(obj, ['currency','currencyCode','currencyIso','isoCurrency']);
  for (const key of ['salePrice','salesPrice','discountPrice','offerPrice','customerPrice','retailPrice','price','amount','value']) {
    const v = obj[key];
    if (v == null) continue;
    if (typeof v === 'object') {
      const nestedCurrency = findString(v, ['currency','currencyCode','currencyIso','isoCurrency']) || currency;
      const nestedValue = v.value ?? v.amount ?? v.price ?? v.centAmount;
      if (nestedValue != null && currencyLooksArs(nestedCurrency)) {
        let n = moneyNumber(nestedValue);
        if (v.centAmount != null && n) n = Math.round(n / 100);
        if (n) return n;
      }
    } else if (currencyLooksArs(currency)) {
      const n = moneyNumber(v);
      if (n) return n;
    }
  }
  return null;
}

function collectJsonProducts(root, out, depth = 0) {
  if (root == null || depth > 10) return;
  if (Array.isArray(root)) { for (const x of root) collectJsonProducts(x, out, depth + 1); return; }
  if (typeof root !== 'object') return;
  const name = findString(root, ['productName','displayName','name','title']);
  const sku = findSku(root);
  const rawUrl = findString(root, ['url','href','productUrl','pdpUrl','canonicalUrl']);
  const url = absoluteUrl(rawUrl);
  if (name && name.length > 2 && name.length < 180 && (sku || isArUrl(url, 'product'))) {
    out.push({
      name,
      sku,
      price: priceFromObject(root),
      url: isArUrl(url, 'product') ? url : '',
      image: absoluteUrl(findString(root, ['image','imageUrl','primaryImage','thumbnail','thumbnailUrl'])) || findString(root, ['image','imageUrl','primaryImage','thumbnail','thumbnailUrl']),
      category: findString(root, ['categoryName','category','collectionName','productLine']) || 'Tienda Argentina'
    });
  }
  for (const value of Object.values(root)) collectJsonProducts(value, out, depth + 1);
}

function dedupe(items) {
  const map = new Map();
  for (const item of items) {
    const name = String(item?.name || '').replace(/\s+/g, ' ').trim();
    const sku = String(item?.sku || '').match(/\d{6,12}/)?.[0] || '';
    const url = isArUrl(item?.url, 'product') ? absoluteUrl(item.url) : '';
    if (!name || (!sku && !url)) continue;
    const key = sku ? `sku:${sku}` : `url:${url}`;
    const prev = map.get(key) || {};
    map.set(key, {
      name: name.length >= String(prev.name || '').length ? name : prev.name,
      sku: sku || prev.sku || '',
      price: moneyNumber(item.price) || prev.price || null,
      url: url || prev.url || '',
      image: absoluteUrl(item.image) || item.image || prev.image || '',
      category: (item.category && !/^tienda argentina$/i.test(item.category)) ? item.category : (prev.category || 'Tienda Argentina')
    });
  }
  return [...map.values()];
}

async function dismissOverlays(page) {
  try {
    await page.evaluate(() => {
      const wanted = ['aceptar','aceptar todo','accept','accept all','continuar','entendido'];
      for (const el of document.querySelectorAll('button')) {
        const t = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (wanted.includes(t)) { el.click(); break; }
      }
    });
  } catch {}
}

async function scrollOnce(page) {
  try {
    await page.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      let previous = 0;
      for (let i = 0; i < 12; i++) {
        window.scrollBy(0, Math.max(900, innerHeight));
        await sleep(90);
        const h = document.body.scrollHeight;
        if (h === previous && i > 4) break;
        previous = h;
      }
      window.scrollTo(0, document.body.scrollHeight);
    });
  } catch {}
}

async function extractDomProducts(page) {
  return page.evaluate(() => {
    const priceOf = text => {
      const patterns = [
        /Precio de oferta\s*(?:ARS\s*)?\$?\s*([0-9][0-9.,]+)/i,
        /Precio al por menor\s*(?:ARS\s*)?\$?\s*([0-9][0-9.,]+)/i,
        /(?:ARS|AR\$)\s*\$?\s*([0-9][0-9.,]+)/i,
        /\$\s*([0-9][0-9.]{3,}(?:,[0-9]{2})?)/
      ];
      for (const re of patterns) { const m = String(text || '').match(re); if (m) return m[1]; }
      return '';
    };
    const out = [];
    const anchors = [...document.querySelectorAll('a[href*="/ar/es/product/"]')];
    for (const a of anchors) {
      let box = a;
      for (let i = 0; i < 7 && box?.parentElement; i++) {
        const txt = box.textContent || '';
        if ((priceOf(txt) || /Artículo|Articulo|SKU|Item/i.test(txt)) && txt.length < 6000) break;
        box = box.parentElement;
      }
      const text = box?.textContent || a.textContent || '';
      const href = new URL(a.getAttribute('href'), location.href).href;
      const heading = box?.querySelector?.('h1,h2,h3,h4,[data-testid*="product-name"],[class*="product-name"],[class*="productName"]');
      const name = (heading?.textContent || a.textContent || '').replace(/\s+/g, ' ').trim();
      if (!name || name.length < 3 || name.length > 180) continue;
      const sku = (text.match(/(?:Artículo|Articulo|SKU|Sku|Item)\s*:?\s*(\d{6,12})/i) || href.match(/(?:^|[-_/])(\d{6,12})(?:[-_/?#]|$)/) || [])[1] || '';
      const img = box?.querySelector?.('img');
      out.push({ name, sku, price: priceOf(text), url: href, image: img?.currentSrc || img?.src || '', category: 'Tienda Argentina' });
    }
    return out;
  });
}

async function clickNext(page) {
  try {
    return await page.evaluate(() => {
      const clean = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const next = [...document.querySelectorAll('button,a')].find(el => {
        if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
        const label = clean(`${el.getAttribute('aria-label') || ''} ${el.textContent || ''}`);
        return label === 'next' || label === 'siguiente' || label === '›' || label.includes('next page') || label.includes('página siguiente') || label.includes('pagina siguiente');
      });
      if (!next) return false;
      next.click();
      return true;
    });
  } catch { return false; }
}

async function scrapeStore() {
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: { width: 1365, height: 900 },
    executablePath: await chromium.executablePath(),
    headless: true
  });
  const page = await browser.newPage();
  const jsonProducts = [];
  const pending = new Set();
  page.on('response', response => {
    const type = response.headers()['content-type'] || '';
    if (!type.includes('json')) return;
    const p = (async () => {
      try {
        const text = await response.text();
        if (text && text.length < 3_000_000) collectJsonProducts(JSON.parse(text), jsonProducts);
      } catch {}
    })();
    pending.add(p); p.finally(() => pending.delete(p));
  });

  try {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'accept-language': 'es-AR,es;q=0.9' });
    page.setDefaultNavigationTimeout(NAV_TIMEOUT);
    page.setDefaultTimeout(7000);

    // Open only the Argentina storefront and its all-products catalog. The old
    // implementation recursively walked every catalog category and then every
    // product page, which could take several minutes on Vercel.
    let response = await page.goto(CATALOG_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT }).catch(() => null);
    if (!response || response.status() >= 400) {
      response = await page.goto(STORE_HOME, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    }
    await new Promise(r => setTimeout(r, 1500));
    await dismissOverlays(page);

    const domProducts = [];
    const seenPageSignatures = new Set();
    for (let pageNo = 0; pageNo < MAX_PAGES; pageNo++) {
      await scrollOnce(page);
      domProducts.push(...await extractDomProducts(page));
      const signature = await page.evaluate(() => `${location.href}|${document.body.innerText.slice(-700)}`);
      if (seenPageSignatures.has(signature)) break;
      seenPageSignatures.add(signature);
      const clicked = await clickNext(page);
      if (!clicked) break;
      await new Promise(r => setTimeout(r, 650));
    }

    await Promise.race([
      Promise.allSettled([...pending]),
      new Promise(resolve => setTimeout(resolve, 1800))
    ]);

    return dedupe([...jsonProducts, ...domProducts]);
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  try {
    const products = await scrapeStore();
    if (products.length < 5) return res.status(502).json({ error: 'No se pudo obtener un catálogo utilizable desde Nu Skin Argentina.', found: products.length, source: STORE_HOME });
    return res.status(200).json({
      checkedAt: new Date().toISOString(),
      source: 'Nu Skin Argentina',
      sourceHome: STORE_HOME,
      count: products.length,
      pricedCount: products.filter(p => p.price).length,
      products
    });
  } catch (error) {
    console.error('Nu Skin Argentina catalog sync failed', error);
    return res.status(500).json({ error: 'No se pudo leer el catálogo de Nu Skin Argentina.', detail: String(error?.message || error) });
  }
}
