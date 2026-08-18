import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const STORE_HOME = 'https://www.nuskin.com/ar/es/';
const PREFERRED_CATALOG = 'https://www.nuskin.com/ar/es/catalog/all_products';
const MAX_CATALOG_PAGES = 14;
const DETAIL_CONCURRENCY = 6;

function norm(value = '') {
  return String(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[®™©]/g, '')
    .replace(/&amp;/gi, '&')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

function absoluteUrl(raw) {
  if (!raw) return '';
  try { return new URL(String(raw), STORE_HOME).href; } catch { return ''; }
}

function isArgentinaStoreUrl(raw, kind = '') {
  const url = absoluteUrl(raw);
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.hostname !== 'www.nuskin.com') return false;
    if (!u.pathname.startsWith('/ar/es/')) return false;
    if (kind === 'product') return u.pathname.includes('/product/');
    if (kind === 'catalog') return u.pathname.includes('/catalog/');
    return true;
  } catch { return false; }
}

function moneyNumber(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw < 500 || raw > 100000000) return null;
    return Math.round(raw);
  }
  let s = String(raw).trim().replace(/\s/g, '').replace(/[^0-9.,-]/g, '');
  if (!s) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  const last = Math.max(lastDot, lastComma);
  if (last >= 0 && s.length - last - 1 === 2) {
    const decimals = s.slice(last + 1);
    const whole = s.slice(0, last).replace(/[.,]/g, '');
    s = `${whole}.${decimals}`;
  } else {
    s = s.replace(/[.,]/g, '');
  }
  const value = Number(s);
  if (!Number.isFinite(value) || value < 500 || value > 100000000) return null;
  return Math.round(value);
}

function findString(obj, keys) {
  for (const key of keys) {
    const v = obj?.[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function findSku(obj) {
  const raw = findString(obj, ['sku', 'SKU', 'itemNumber', 'itemNo', 'articleNumber', 'productCode', 'stockCode']);
  const m = raw.match(/\d{6,12}/);
  return m ? m[0] : '';
}

function currencyIsArs(value) {
  if (value == null || value === '') return true;
  const s = String(value).toUpperCase().replace(/\s/g, '');
  return s.includes('ARS') || s.includes('AR$') || s === '$';
}

function priceFromObject(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const currency = findString(obj, ['currency', 'currencyCode', 'currencyIso', 'isoCurrency', 'formattedCurrency']);
  const preferred = ['salePrice', 'salesPrice', 'discountPrice', 'discountedPrice', 'offerPrice', 'customerPrice', 'retailPrice', 'price', 'amount', 'value'];
  for (const key of preferred) {
    const v = obj[key];
    if (v == null) continue;
    if (typeof v === 'object') {
      const nestedCurrency = findString(v, ['currency', 'currencyCode', 'currencyIso', 'isoCurrency']);
      const nestedValue = v.value ?? v.amount ?? v.price ?? v.centAmount;
      if (nestedValue != null && currencyIsArs(nestedCurrency || currency)) {
        let n = moneyNumber(nestedValue);
        if (v.centAmount != null && n) n = Math.round(n / 100);
        if (n) return n;
      }
    } else if (currencyIsArs(currency)) {
      const n = moneyNumber(v);
      if (n) return n;
    }
  }
  return null;
}

function collectJsonProducts(root, out, depth = 0) {
  if (root == null || depth > 12) return;
  if (Array.isArray(root)) {
    for (const item of root) collectJsonProducts(item, out, depth + 1);
    return;
  }
  if (typeof root !== 'object') return;

  const name = findString(root, ['productName', 'displayName', 'name', 'title']);
  const price = priceFromObject(root);
  const sku = findSku(root);
  const rawUrl = findString(root, ['url', 'href', 'productUrl', 'pdpUrl', 'canonicalUrl']);
  const url = absoluteUrl(rawUrl);
  const productLikeUrl = isArgentinaStoreUrl(url, 'product');
  if (name && name.length >= 3 && name.length <= 180 && (sku || productLikeUrl)) {
    const image = absoluteUrl(findString(root, ['image', 'imageUrl', 'primaryImage', 'thumbnail', 'thumbnailUrl'])) || findString(root, ['image', 'imageUrl', 'primaryImage', 'thumbnail', 'thumbnailUrl']);
    const category = findString(root, ['categoryName', 'category', 'collectionName', 'productLine']);
    out.push({ name, price, sku, url: productLikeUrl ? url : '', image, category, source: 'json' });
  }
  for (const value of Object.values(root)) collectJsonProducts(value, out, depth + 1);
}

function dedupeProducts(items) {
  const map = new Map();
  for (const raw of items) {
    if (!raw?.name) continue;
    const name = String(raw.name).replace(/\s+/g, ' ').trim();
    if (!name || /^(comprar|buy now|añadir|agregar|cantidad|total|ver detalle)$/i.test(name)) continue;
    const sku = String(raw.sku || '').match(/\d{6,12}/)?.[0] || '';
    const url = isArgentinaStoreUrl(raw.url, 'product') ? absoluteUrl(raw.url) : '';
    if (!sku && !url) continue;
    const key = sku ? `sku:${sku}` : `url:${url}`;
    const existing = map.get(key);
    const next = {
      name,
      sku,
      price: moneyNumber(raw.price),
      url,
      image: absoluteUrl(raw.image) || raw.image || '',
      category: String(raw.category || '').trim() || 'Tienda Argentina'
    };
    if (!existing) map.set(key, next);
    else map.set(key, {
      ...existing,
      ...next,
      name: next.name.length >= existing.name.length ? next.name : existing.name,
      sku: next.sku || existing.sku,
      url: next.url || existing.url,
      image: next.image || existing.image,
      category: next.category !== 'Tienda Argentina' ? next.category : existing.category,
      price: next.price || existing.price
    });
  }
  return [...map.values()];
}

async function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function dismissOverlays(page) {
  try {
    await page.evaluate(() => {
      const labels = ['aceptar','aceptar todo','accept','accept all','continuar','entendido'];
      for (const el of [...document.querySelectorAll('button')]) {
        const t = (el.textContent || '').replace(/\s+/g,' ').trim().toLowerCase();
        if (labels.includes(t)) { el.click(); break; }
      }
    });
  } catch {}
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let lastHeight = 0;
      let unchanged = 0;
      let turns = 0;
      const timer = setInterval(() => {
        window.scrollBy(0, Math.max(750, Math.floor(window.innerHeight * .9)));
        const h = document.body.scrollHeight;
        unchanged = h === lastHeight ? unchanged + 1 : 0;
        lastHeight = h;
        turns++;
        if (turns >= 24 || unchanged >= 5) {
          clearInterval(timer);
          window.scrollTo(0, document.body.scrollHeight);
          resolve();
        }
      }, 130);
    });
  });
  await sleep(600);
}

async function discoverLinks(page) {
  return page.evaluate(() => {
    const out = { catalogs: [], products: [] };
    for (const a of [...document.querySelectorAll('a[href]')]) {
      try {
        const u = new URL(a.getAttribute('href'), location.href);
        if (u.hostname !== 'www.nuskin.com' || !u.pathname.startsWith('/ar/es/')) continue;
        if (u.pathname.includes('/catalog/')) out.catalogs.push(u.href);
        if (u.pathname.includes('/product/')) out.products.push(u.href);
      } catch {}
    }
    return { catalogs: [...new Set(out.catalogs)], products: [...new Set(out.products)] };
  });
}

async function domProducts(page) {
  return page.evaluate(() => {
    const parsePrice = text => {
      const patterns = [
        /Precio de oferta\s*(?:ARS\s*)?\$?\s*([0-9][0-9.,]+)/i,
        /Precio al por menor\s*(?:ARS\s*)?\$?\s*([0-9][0-9.,]+)/i,
        /Precio de venta[^0-9]{0,30}(?:ARS\s*)?\$?\s*([0-9][0-9.,]+)/i,
        /(?:ARS|AR\$)\s*\$?\s*([0-9][0-9.,]+)/i,
        /\$\s*([0-9][0-9.]{3,}(?:,[0-9]{2})?)/
      ];
      for (const re of patterns) { const m = String(text || '').match(re); if (m) return m[1]; }
      return '';
    };
    const cleanName = container => {
      for (const sel of ['[data-testid*="product-name"]','[class*="product-name"]','[class*="productName"]','h1','h2','h3','h4']) {
        const el = container?.querySelector?.(sel);
        const t = el?.textContent?.replace(/\s+/g,' ').trim();
        if (t && t.length > 2 && t.length < 180 && !/^(comprar|añadir|agregar)$/i.test(t)) return t;
      }
      return '';
    };
    const links = [...document.querySelectorAll('a[href*="/ar/es/product/"]')];
    const out = [];
    for (const a of links) {
      const href = new URL(a.getAttribute('href'), location.href).href;
      let c = a;
      for (let i=0;i<8 && c?.parentElement;i++) {
        const txt = c.textContent || '';
        if (parsePrice(txt) && txt.length < 7000) break;
        c = c.parentElement;
      }
      const text = c?.textContent || a.textContent || '';
      let name = cleanName(c || a) || a.textContent?.replace(/\s+/g,' ').trim() || '';
      if (!name || name.length < 3) continue;
      const skuMatch = text.match(/(?:Artículo|Articulo|SKU|Sku|Item)\s*:?\s*(\d{6,12})/i) || href.match(/(?:^|[-_/])(\d{6,12})(?:[-_/?#]|$)/);
      const img = (c || a).querySelector?.('img');
      const categoryEl = (c || a).querySelector?.('[class*="category"],[class*="collection"],[data-testid*="category"]');
      out.push({
        name,
        sku: skuMatch ? skuMatch[1] : '',
        price: parsePrice(text),
        url: href,
        image: img?.currentSrc || img?.src || '',
        category: categoryEl?.textContent?.replace(/\s+/g,' ').trim() || 'Tienda Argentina',
        source: 'dom'
      });
    }
    return out;
  });
}

async function clickNext(page) {
  return page.evaluate(() => {
    const clean = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const items = [...document.querySelectorAll('button,a')];
    const next = items.find(el => {
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
      const label = clean(`${el.getAttribute('aria-label') || ''} ${el.textContent || ''}`);
      return label === 'next' || label === 'siguiente' || label === '›' || label.includes('next page') || label.includes('página siguiente') || label.includes('pagina siguiente');
    });
    if (!next) return false;
    next.click();
    return true;
  });
}

async function scrapeCatalogPage(page, url, domOut, productLinksOut) {
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 });
  if (response && response.status() >= 400) return;
  await sleep(2200);
  await dismissOverlays(page);
  for (let pageNo = 0; pageNo < 12; pageNo++) {
    await autoScroll(page);
    domOut.push(...await domProducts(page));
    const links = await discoverLinks(page);
    links.products.forEach(x => productLinksOut.add(x));
    const before = await page.evaluate(() => `${location.href}|${document.body.innerText.slice(-1200)}`);
    const clicked = await clickNext(page);
    if (!clicked) break;
    await sleep(1400);
    const after = await page.evaluate(() => `${location.href}|${document.body.innerText.slice(-1200)}`);
    if (before === after) break;
  }
}

async function detailProduct(browser, url) {
  const page = await browser.newPage();
  try {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'accept-language': 'es-AR,es;q=0.9' });
    page.setDefaultNavigationTimeout(16000);
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 16000 });
    if (response && response.status() >= 400) return null;
    await sleep(900);
    return await page.evaluate(() => {
      const body = document.body?.innerText || '';
      const pricePatterns = [
        /Precio de oferta\s*(?:ARS\s*)?\$?\s*([0-9][0-9.,]+)/i,
        /Precio al por menor\s*(?:ARS\s*)?\$?\s*([0-9][0-9.,]+)/i,
        /(?:ARS|AR\$)\s*\$?\s*([0-9][0-9.,]+)/i,
        /\$\s*([0-9][0-9.]{3,}(?:,[0-9]{2})?)/
      ];
      let price=''; for (const re of pricePatterns) { const m=body.match(re); if(m){price=m[1];break;} }
      const h1=document.querySelector('h1');
      const name=h1?.textContent?.replace(/\s+/g,' ').trim()||document.title.split('|')[0].trim();
      const sku=(body.match(/(?:Artículo|Articulo|SKU|Sku|Item)\s*:?\s*(\d{6,12})/i)||location.href.match(/(?:^|[-_/])(\d{6,12})(?:[-_/?#]|$)/)||[])[1]||'';
      const img=document.querySelector('main img, img[alt*="'+CSS.escape(name.slice(0,20))+'"]')||document.querySelector('img');
      return {name,sku,price,url:location.href,image:img?.currentSrc||img?.src||'',category:'Tienda Argentina',source:'detail'};
    });
  } catch { return null; }
  finally { await page.close(); }
}

async function fillMissingPrices(browser, products) {
  const missing = products.filter(p => !p.price && isArgentinaStoreUrl(p.url, 'product'));
  if (!missing.length) return products;
  const byKey = new Map(products.map(p => [p.sku ? `sku:${p.sku}` : `url:${p.url}`, p]));
  let index = 0;
  async function worker() {
    while (index < missing.length) {
      const item = missing[index++];
      const detail = await detailProduct(browser, item.url);
      if (!detail) continue;
      const price = moneyNumber(detail.price);
      const key = item.sku ? `sku:${item.sku}` : `url:${item.url}`;
      const target = byKey.get(key);
      if (target) {
        if (price) target.price = price;
        if (!target.sku && detail.sku) target.sku = detail.sku;
        if (!target.image && detail.image) target.image = detail.image;
        if ((!target.name || target.name.length < 3) && detail.name) target.name = detail.name;
      }
    }
  }
  await Promise.all(Array.from({length: Math.min(DETAIL_CONCURRENCY, missing.length)}, () => worker()));
  return [...byKey.values()];
}

async function scrapeStore() {
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: { width: 1365, height: 900 },
    executablePath: await chromium.executablePath(),
    headless: true
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36');
  await page.setExtraHTTPHeaders({ 'accept-language': 'es-AR,es;q=0.9' });
  page.setDefaultNavigationTimeout(40000);
  page.setDefaultTimeout(12000);

  const jsonProducts = [];
  const pending = new Set();
  page.on('response', response => {
    const type = response.headers()['content-type'] || '';
    if (!type.includes('json')) return;
    const promise = (async () => {
      try {
        const text = await response.text();
        if (!text || text.length > 4_000_000) return;
        collectJsonProducts(JSON.parse(text), jsonProducts);
      } catch {}
    })();
    pending.add(promise);
    promise.finally(() => pending.delete(promise));
  });

  const dom = [];
  const productLinks = new Set();
  const catalogLinks = new Set([PREFERRED_CATALOG]);
  try {
    // The requested source of truth is the AR storefront itself. Start there and
    // discover its current catalog links instead of relying on the legacy es_AR list.
    await page.goto(STORE_HOME, { waitUntil: 'domcontentloaded', timeout: 40000 });
    await sleep(2500);
    await dismissOverlays(page);
    await autoScroll(page);
    const homeLinks = await discoverLinks(page);
    homeLinks.catalogs.forEach(x => catalogLinks.add(x));
    homeLinks.products.forEach(x => productLinks.add(x));

    let visited = 0;
    const queue = [...catalogLinks];
    const seenCatalogs = new Set();
    while (queue.length && visited < MAX_CATALOG_PAGES) {
      const url = queue.shift();
      if (!isArgentinaStoreUrl(url, 'catalog') || seenCatalogs.has(url)) continue;
      seenCatalogs.add(url);
      try {
        await scrapeCatalogPage(page, url, dom, productLinks);
        visited++;
        const more = await discoverLinks(page);
        more.catalogs.forEach(x => { if (!seenCatalogs.has(x)) queue.push(x); });
        more.products.forEach(x => productLinks.add(x));
      } catch {}
    }

    await Promise.allSettled([...pending]);
    let products = dedupeProducts([...jsonProducts, ...dom, ...[...productLinks].map(url => ({name: url.split('/').pop()?.replace(/[-_]/g,' ') || 'Producto Nu Skin', url}))]);
    products = await fillMissingPrices(browser, products);
    return dedupeProducts(products);
  } finally {
    await page.close().catch(()=>{});
    await browser.close();
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  try {
    const products = await scrapeStore();
    if (products.length < 5) {
      return res.status(502).json({
        error: 'Nu Skin Argentina cargó, pero no se pudieron extraer suficientes productos de la tienda AR.',
        source: STORE_HOME,
        found: products.length
      });
    }
    return res.status(200).json({
      checkedAt: new Date().toISOString(),
      source: 'Nu Skin Argentina',
      sourceHome: STORE_HOME,
      count: products.length,
      pricedCount: products.filter(p => p.price).length,
      products
    });
  } catch (error) {
    console.error('Nu Skin Argentina sync failed', error);
    return res.status(500).json({ error: 'No se pudo leer la tienda de Nu Skin Argentina.', detail: String(error?.message || error) });
  }
}
