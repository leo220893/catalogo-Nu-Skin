import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const STORE_HOME = 'https://www.nuskin.com/ar/es/';
const BATCH_LIMIT = 16;
const CONCURRENCY = 5;

function absoluteUrl(raw) {
  if (!raw) return '';
  try { return new URL(String(raw), STORE_HOME).href; } catch { return ''; }
}
function validProductUrl(raw) {
  const url = absoluteUrl(raw);
  try {
    const u = new URL(url);
    return u.hostname === 'www.nuskin.com' && u.pathname.startsWith('/ar/es/product/') ? u.href : '';
  } catch { return ''; }
}
function moneyNumber(raw) {
  if (raw == null || raw === '') return null;
  let s = String(raw).replace(/\s/g, '').replace(/[^0-9.,-]/g, '');
  if (!s) return null;
  const last = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
  if (last >= 0 && s.length - last - 1 === 2) s = `${s.slice(0,last).replace(/[.,]/g,'')}.${s.slice(last+1)}`;
  else s = s.replace(/[.,]/g, '');
  const n = Number(s);
  return Number.isFinite(n) && n >= 500 && n <= 100000000 ? Math.round(n) : null;
}

async function readDetail(browser, item) {
  const url = validProductUrl(item.url);
  if (!url) return { sku: item.sku || '', name: item.name || '', url: item.url || '', price: null, status: 'invalid-url' };
  const page = await browser.newPage();
  try {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'accept-language': 'es-AR,es;q=0.9' });
    page.setDefaultNavigationTimeout(12000);
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 12000 });
    if (response && response.status() >= 400) return { sku:item.sku||'', name:item.name||'', url, price:null, status:`http-${response.status()}` };
    await Promise.race([
      page.waitForFunction(() => /Precio de oferta|Precio al por menor|ARS|AR\$|\$\s*[0-9][0-9.]{3,}/i.test(document.body?.innerText || ''), { timeout: 5500 }).catch(() => null),
      new Promise(r => setTimeout(r, 2200))
    ]);
    const data = await page.evaluate(() => {
      const body = document.body?.innerText || '';
      let structured = null;
      for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
        try {
          const parsed = JSON.parse(script.textContent || 'null');
          const list = Array.isArray(parsed) ? parsed : [parsed];
          for (const obj of list) {
            const candidates = [obj, ...(Array.isArray(obj?.['@graph']) ? obj['@graph'] : [])];
            for (const x of candidates) {
              if (String(x?.['@type'] || '').toLowerCase() === 'product') {
                const offers = Array.isArray(x.offers) ? x.offers[0] : x.offers;
                if (offers?.price != null) structured = { price: offers.price, currency: offers.priceCurrency || '', name: x.name || '', sku: x.sku || '' };
              }
            }
          }
        } catch {}
      }
      const patterns = [
        /Precio de oferta\s*(?:ARS\s*)?\$?\s*([0-9][0-9.,]+)/i,
        /Precio al por menor\s*(?:ARS\s*)?\$?\s*([0-9][0-9.,]+)/i,
        /(?:ARS|AR\$)\s*\$?\s*([0-9][0-9.,]+)/i,
        /\$\s*([0-9][0-9.]{3,}(?:,[0-9]{2})?)/
      ];
      let textPrice = '';
      for (const re of patterns) { const m = body.match(re); if (m) { textPrice = m[1]; break; } }
      const h1 = document.querySelector('h1');
      const name = (h1?.textContent || structured?.name || '').replace(/\s+/g, ' ').trim();
      const sku = String(structured?.sku || (body.match(/(?:Artículo|Articulo|SKU|Sku|Item)\s*:?\s*(\d{6,12})/i) || [])[1] || '').match(/\d{6,12}/)?.[0] || '';
      return { price: structured?.price ?? textPrice, currency: structured?.currency || '', name, sku };
    });
    const currency = String(data.currency || '').toUpperCase();
    const price = (!currency || currency === 'ARS' || currency.includes('ARS')) ? moneyNumber(data.price) : null;
    return { sku: data.sku || item.sku || '', name: data.name || item.name || '', url, price, status: price ? 'ok' : 'no-price' };
  } catch (error) {
    return { sku:item.sku||'', name:item.name||'', url, price:null, status:'error', detail:String(error?.message||error).slice(0,180) };
  } finally {
    await page.close().catch(() => {});
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  const incoming = Array.isArray(req.body?.products) ? req.body.products : [];
  const products = incoming.slice(0, BATCH_LIMIT).filter(x => x && validProductUrl(x.url));
  if (!products.length) return res.status(400).json({ error: 'No hay productos válidos para consultar.' });

  let browser;
  try {
    browser = await puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true, defaultViewport:{width:1280,height:800} });
    const results = new Array(products.length);
    let cursor = 0;
    async function worker() {
      while (cursor < products.length) {
        const i = cursor++;
        results[i] = await readDetail(browser, products[i]);
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, products.length) }, () => worker()));
    return res.status(200).json({ checkedAt:new Date().toISOString(), count:results.length, pricedCount:results.filter(x=>x?.price).length, results });
  } catch (error) {
    console.error('Nu Skin Argentina price batch failed', error);
    return res.status(500).json({ error:'No se pudo consultar este lote de precios.', detail:String(error?.message||error) });
  } finally {
    await browser?.close().catch(() => {});
  }
}
