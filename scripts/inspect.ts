import { chromium } from "playwright-core";
const b = await chromium.connectOverCDP("http://localhost:9222", { timeout: 10000 });
const ctx = b.contexts()[0];
const page = await ctx.newPage();
await page.goto("https://www.coupang.com/np/search?q=%EC%97%90%EC%96%B4%ED%8C%9F", { waitUntil: "domcontentloaded", timeout: 25000 });
await page.waitForTimeout(3000);
const info = await page.evaluate(() => {
  const counts: Record<string, number> = {};
  for (const sel of ['li.search-product', '[class*="ProductUnit"]', 'li[class*="ProductUnit"]', 'ul#product-list > li', '#product-list li', 'a[href*="/vp/products/"]']) {
    counts[sel] = document.querySelectorAll(sel).length;
  }
  // find the product list container class names
  const sample = document.querySelector('[class*="ProductUnit"]');
  const sampleHtml = sample ? sample.outerHTML.slice(0, 800) : null;
  // window keys that look like state
  const stateKeys = Object.keys(window as never).filter(k => /^__|state|STATE|INITIAL|PRELOAD/i.test(k)).slice(0, 20);
  return { counts, sampleClass: sample?.className, sampleParentClass: sample?.parentElement?.className, sampleHtml, stateKeys };
});
console.log(JSON.stringify(info, null, 1).slice(0, 2500));
await page.close(); await b.close();
