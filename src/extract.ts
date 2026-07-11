import type { Page } from "playwright-core";

/**
 * Structured-first extraction. Strategy order:
 *  1. Embedded state JSON (__NEXT_DATA__ / window preloaded state) — most stable
 *  2. JSON-LD <script type="application/ld+json"> — product pages
 *  3. DOM fallback — last resort, most fragile
 *
 * ⚠️ Key names below are best-effort until verified against the live site
 * (run `npm run dev` with Chrome open and use the `debug_page_structure`
 * tool to inspect what Coupang actually embeds).
 */

export interface BrowserProduct {
  name: string;
  price: number | null;
  originalPrice?: number | null;
  rating?: number | null;
  reviewCount?: number | null;
  url: string;
  image?: string;
  rocket?: boolean;
  source: "embedded" | "jsonld" | "dom";
}

/** Pull every candidate JSON blob out of the page for inspection/parsing. */
export async function embeddedJson(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const out: Record<string, unknown> = {};
    const next = document.getElementById("__NEXT_DATA__");
    if (next?.textContent) {
      try {
        out.nextData = JSON.parse(next.textContent);
      } catch { /* not JSON — ignore this blob */ }
    }
    const w = window as unknown as Record<string, unknown>;
    for (const k of Object.keys(w)) {
      if (/^__(PRELOADED|INITIAL|APOLLO|NUXT)/.test(k) || k === "sdp") {
        try {
          out[k] = JSON.parse(JSON.stringify(w[k]));
        } catch { /* not JSON — ignore this blob */ }
      }
    }
    const ld: unknown[] = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
      try {
        ld.push(JSON.parse(s.textContent ?? ""));
      } catch { /* not JSON — ignore this blob */ }
    });
    if (ld.length) out.jsonLd = ld;
    return out;
  });
}

const num = (v: unknown): number | null => {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^\d.]/g, ""));
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
};

/** Recursively find arrays of product-shaped objects inside embedded state. */
export function harvestProducts(blob: unknown, baseUrl: string): BrowserProduct[] {
  const found: BrowserProduct[] = [];
  const seen = new Set<unknown>();
  const walk = (node: unknown, depth: number) => {
    if (!node || typeof node !== "object" || depth > 12 || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    const o = node as Record<string, unknown>;
    const name = o.productName ?? o.title ?? o.name;
    const price = o.salePrice ?? o.price ?? o.discountedPrice ?? o.finalPrice;
    const rawId = o.productId ?? o.id;
    // Only scalar ids can go into a URL; nested objects would stringify to
    // "[object Object]" and produce a dead link.
    const id = typeof rawId === "string" || typeof rawId === "number" ? rawId : null;
    if (typeof name === "string" && name.length > 2 && (num(price) !== null || id !== null)) {
      const rel = (o.productUrl ?? o.link ?? o.url) as string | undefined;
      found.push({
        name,
        price: num(price),
        originalPrice: num(o.originalPrice ?? o.basePrice),
        rating: num(o.rating ?? o.ratingAverage),
        reviewCount: num(o.reviewCount ?? o.ratingCount),
        url: rel
          ? new URL(rel, baseUrl).toString()
          : id !== null
            ? `https://www.coupang.com/vp/products/${id}`
            : baseUrl,
        image: typeof o.imageUrl === "string" ? o.imageUrl : (o.image as string | undefined),
        rocket: Boolean(o.isRocket ?? o.rocketDelivery ?? (typeof o.badge === "string" && o.badge.includes("로켓"))),
        source: "embedded",
      });
      return; // don't descend into an already-captured product
    }
    for (const v of Object.values(o)) walk(v, depth + 1);
  };
  walk(blob, 0);
  // dedupe by url
  const uniq = new Map<string, BrowserProduct>();
  for (const p of found) if (!uniq.has(p.url)) uniq.set(p.url, p);
  return [...uniq.values()];
}

/**
 * DOM extraction for search results.
 * Verified live 2026-07-11: Coupang search is Next.js App Router (no
 * __NEXT_DATA__; flight data in __next_f). Products render as
 * `li.ProductUnit_productUnit__<hash>` with data-id = vendorItemId and the
 * product name in the img alt attribute.
 */
export async function domSearchFallback(page: Page): Promise<BrowserProduct[]> {
  return page.evaluate(() => {
    const num = (t: string | null | undefined) => {
      const n = Number((t ?? "").replace(/[^\d]/g, ""));
      return n > 0 ? n : null;
    };
    const items: BrowserProduct[] = [];
    // current markup first, legacy fallbacks after
    let nodes = document.querySelectorAll('li[class*="ProductUnit"]');
    if (nodes.length === 0) nodes = document.querySelectorAll("li.search-product, ul#product-list > li");
    nodes.forEach((el) => {
      const a = el.querySelector<HTMLAnchorElement>('a[href*="/products/"]');
      const img = el.querySelector<HTMLImageElement>("img[alt]");
      // name: img alt (current), else any name/title-classed element (legacy)
      const name =
        (img?.alt ?? "").trim() ||
        (el.querySelector('[class*="productName"], [class*="name"], [class*="title"]')?.textContent ?? "").trim();
      if (!a || name.length < 3) return;
      const text = el.textContent ?? "";
      // price: prefer a Price-classed element, else the first "N,NNN원" in text
      const priceEl = el.querySelector('[class*="Price"] strong, strong[class*="price"], [class*="price-value"]');
      const price = num(priceEl?.textContent) ?? num(text.match(/([\d,]{4,})\s*원/)?.[1]);
      items.push({
        name,
        price,
        rating: num(text.match(/(\d\.\d)\s*\(/)?.[1].replace(".", "")) ? Number(text.match(/(\d\.\d)\s*\(/)?.[1]) : null,
        reviewCount: num(text.match(/\(\s*([\d,]+)\s*\)/)?.[1]),
        url: a.href,
        image: img?.src,
        rocket: !!el.querySelector('img[alt*="로켓"], [class*="rocket"], [class*="Rocket"]') || /로켓배송|로켓와우/.test(text),
        source: "dom",
      });
    });
    return items;
  });
}
