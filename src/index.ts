#!/usr/bin/env node
import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { withPage } from "./cdp.js";
import { politeSlot } from "./throttle.js";
import { embeddedJson, harvestProducts, domSearchFallback, type BrowserProduct } from "./extract.js";

const ok = (payload: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(payload, null, 1) }],
});
const fail = (e: unknown) => ok({ error: e instanceof Error ? e.message : String(e) });

const VERSION = (
  createRequire(import.meta.url)("../package.json") as { version: string }
).version;

const server = new McpServer({ name: "coupang-browser-mcp", version: VERSION });

// Count registrations rather than hardcoding a number that drifts.
let TOOL_COUNT = 0;
{
  const target = server as unknown as { registerTool: (...args: unknown[]) => unknown };
  const original = target.registerTool.bind(server);
  target.registerTool = (...args: unknown[]) => {
    TOOL_COUNT++;
    return original(...args);
  };
}

server.registerTool(
  "search_products",
  {
    title: "Search Coupang products (own browser)",
    description:
      "Search Coupang by opening the search page in the USER'S OWN Chrome (CDP). No API key needed. " +
      "Personal-use tool — Chrome must be running with --remote-debugging-port=9222.",
    inputSchema: {
      keyword: z.string().min(1).max(100),
      limit: z.number().int().min(1).max(36).default(10),
      rocketOnly: z.boolean().default(false),
      sortBy: z.enum(["relevance", "price"]).default("relevance"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ keyword, limit, rocketOnly, sortBy }) => {
    try {
      await politeSlot();
      return await withPage(async (page) => {
        const url = `https://www.coupang.com/np/search?q=${encodeURIComponent(keyword)}`;
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
        await page.waitForTimeout(1_500); // let client-side render settle

        const blobs = await embeddedJson(page);
        let products: BrowserProduct[] = harvestProducts(blobs, url);
        // Coupang search is App Router (no rich embedded state) — the DOM
        // usually wins; use whichever source found more real items.
        const domProducts = await domSearchFallback(page);
        if (domProducts.length > products.length) products = domProducts;

        if (rocketOnly) products = products.filter((p) => p.rocket);
        if (sortBy === "price")
          products = [...products].sort((a, b) => (a.price ?? 1e12) - (b.price ?? 1e12));

        return ok({
          keyword,
          count: products.length,
          products: products.slice(0, limit),
          extractionSource: products[0]?.source ?? "none",
          note:
            products.length === 0
              ? "추출 실패 — 쿠팡 마크업이 변경되었을 수 있습니다. debug_page_structure로 확인하세요."
              : undefined,
        });
      });
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "get_product_detail",
  {
    title: "Product detail (own browser)",
    description:
      "Open a Coupang product page and extract price, rating, review count, and delivery info " +
      "(JSON-LD / embedded data first). Gives details the official API cannot provide.",
    inputSchema: {
      url: z
        .string()
        .url()
        .refine((u) => new URL(u).hostname.endsWith("coupang.com"), "coupang.com URL만 허용"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ url }) => {
    try {
      await politeSlot();
      return await withPage(async (page) => {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
        await page.waitForTimeout(1_500);
        const blobs = await embeddedJson(page);
        const products = harvestProducts(blobs, url);
        const title = await page.title();
        return ok({
          url,
          pageTitle: title,
          extracted: products.slice(0, 3),
          jsonLd: (blobs.jsonLd as unknown[])?.slice(0, 2),
        });
      });
    } catch (e) {
      return fail(e);
    }
  },
);

interface Review {
  author: string | null;
  date: string | null;
  rating: number | null;
  option: string | null;
  text: string;
}

server.registerTool(
  "get_product_reviews",
  {
    title: "Product reviews (own browser)",
    description:
      "Open a Coupang product page, scroll to the review section, and extract individual " +
      "reviews (author, date, rating, text). Returns the first review page (up to 10).",
    inputSchema: {
      url: z
        .string()
        .url()
        .refine((u) => new URL(u).hostname.endsWith("coupang.com"), "coupang.com URL만 허용"),
      limit: z.number().int().min(1).max(10).default(5),
      maxTextLength: z.number().int().min(100).max(3000).default(600),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ url, limit, maxTextLength }) => {
    try {
      await politeSlot();
      return await withPage(async (page) => {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
        // Reviews lazy-load when the section scrolls into view. A single scroll
        // is unreliable: if .sdp-review isn't in the DOM yet the scroll is a
        // no-op and nothing ever triggers the load. Keep scrolling until the
        // review articles appear.
        await page.waitForSelector(".sdp-review", { timeout: 15_000 }).catch(() => {});
        for (let attempt = 0; attempt < 5; attempt++) {
          await page.evaluate('document.querySelector(".sdp-review")?.scrollIntoView()');
          const loaded = await page
            .waitForSelector(".sdp-review article", { timeout: 3_000 })
            .then(() => true)
            .catch(() => false);
          if (loaded) break;
        }
        await page.waitForTimeout(500);
        const reviews = await page.evaluate<Review[]>(`(() => {
          const sr = document.querySelector(".sdp-review");
          if (!sr) return [];
          return [...sr.querySelectorAll("article")].map((a) => {
            const lines = a.innerText.split("\\n").map((s) => s.trim()).filter(Boolean);
            const dateIdx = lines.findIndex((l) => /^\\d{4}\\.\\d{2}\\.\\d{2}$/.test(l));
            const full = a.querySelectorAll('[class*="full-star"]').length;
            const half = a.querySelectorAll('[class*="half-star"]').length;
            // lines: [author, date, "판매자: …", productOption, headline?, body…]
            const bodyStart = dateIdx >= 0 ? dateIdx + 3 : 0;
            return {
              author: dateIdx > 0 ? lines[dateIdx - 1] : null,
              date: dateIdx >= 0 ? lines[dateIdx] : null,
              rating: full + half * 0.5 || null,
              option: dateIdx >= 0 ? (lines[bodyStart - 1] ?? null) : null,
              text: lines.slice(bodyStart).join(" "),
            };
          });
        })()`);
        return ok({
          url,
          count: reviews.length,
          reviews: reviews.slice(0, limit).map((r) => ({
            ...r,
            text: r.text.slice(0, maxTextLength),
          })),
          note:
            reviews.length === 0
              ? "리뷰를 찾지 못했습니다 — 리뷰가 없는 상품이거나 마크업이 변경되었을 수 있습니다. debug_page_structure로 확인하세요."
              : undefined,
        });
      });
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "debug_page_structure",
  {
    title: "Debug page structure",
    description:
      "Summarize which embedded JSON blobs (__NEXT_DATA__, preloaded state, JSON-LD) exist on a Coupang page " +
      "and their key skeleton. Use when extraction breaks (markup drift) to find the new keys/selectors.",
    inputSchema: {
      url: z
        .string()
        .url()
        .refine((u) => new URL(u).hostname.endsWith("coupang.com"), "coupang.com URL만 허용"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ url }) => {
    try {
      await politeSlot();
      return await withPage(async (page) => {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
        await page.waitForTimeout(1_500);
        const blobs = await embeddedJson(page);
        const skeleton = (node: unknown, depth: number): unknown => {
          if (depth > 4) return "…";
          if (Array.isArray(node))
            return node.length ? [`(${node.length} items)`, skeleton(node[0], depth + 1)] : [];
          if (node && typeof node === "object") {
            const o: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(node as Record<string, unknown>).slice(0, 25))
              o[k] = skeleton(v, depth + 1);
            return o;
          }
          return typeof node;
        };
        return ok({ url, availableBlobs: Object.keys(blobs), skeleton: skeleton(blobs, 0) });
      });
    } catch (e) {
      return fail(e);
    }
  },
);

// ---------------------------------------------------------------- account tools
import {
  ORDER_LIST_URL,
  CART_URL,
  assertLoggedIn,
  extractOrders,
  extractCart,
  clickAddToCart,
  openCheckout,
} from "./account.js";
import { harvestProducts as harvest2 } from "./extract.js";

server.registerTool(
  "get_my_orders",
  {
    title: "My orders",
    description: "Read the user's Coupang order history and delivery status (read-only; requires a logged-in Chrome session).",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async () => {
    try {
      await politeSlot();
      return await withPage(async (page) => {
        await page.goto(ORDER_LIST_URL, { waitUntil: "domcontentloaded", timeout: 20_000 });
        await page.waitForTimeout(2_000);
        assertLoggedIn(page);
        const orders = await extractOrders(page);
        return ok({
          orders,
          note: orders.length === 0 ? "주문을 찾지 못했습니다 — 로그인 상태 또는 마크업 변경 확인 (debug_page_structure)." : undefined,
        });
      });
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "get_cart",
  {
    title: "View cart",
    description: "Read the user's Coupang cart contents (read-only; requires a logged-in Chrome session).",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async () => {
    try {
      await politeSlot();
      return await withPage(async (page) => {
        await page.goto(CART_URL, { waitUntil: "domcontentloaded", timeout: 20_000 });
        await page.waitForTimeout(2_000);
        assertLoggedIn(page);
        return ok({ items: await extractCart(page) });
      });
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "add_to_cart",
  {
    title: "Add to cart",
    description:
      "Add a product to the cart. With confirm=false (default) it does NOT add — it returns a preview of the " +
      "target product for the user to verify; call again with confirm=true to actually add. " +
      "Products requiring option selection are added with the default option, or an explanation is returned.",
    inputSchema: {
      url: z
        .string()
        .url()
        .refine((u) => new URL(u).hostname.endsWith("coupang.com"), "coupang.com URL만 허용"),
      quantity: z.number().int().min(1).max(10).default(1),
      confirm: z.boolean().default(false).describe("Only adds when true; false returns a preview"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async ({ url, quantity, confirm }) => {
    try {
      await politeSlot();
      return await withPage(async (page) => {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
        await page.waitForTimeout(1_500);
        assertLoggedIn(page);
        const preview = harvest2(await embeddedJson(page), url).slice(0, 1);
        const pageTitle = await page.title();
        if (!confirm) {
          return ok({
            preview: { pageTitle, product: preview[0] ?? null, quantity },
            confirmed: false,
            next: "이 상품이 맞으면 confirm=true로 다시 호출하세요.",
          });
        }
        const result = await clickAddToCart(page, quantity);
        return ok({ confirmed: true, result, product: preview[0] ?? pageTitle, quantity });
      });
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "remove_from_cart",
  {
    title: "Remove from cart",
    description:
      "Remove an item from the cart. With confirm=false (default) it only returns items matching the name — " +
      "narrow to exactly one match, then call again with confirm=true to remove.",
    inputSchema: {
      productName: z.string().min(2).describe("Product name to remove (partial match)"),
      confirm: z.boolean().default(false),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  },
  async ({ productName, confirm }) => {
    try {
      await politeSlot();
      return await withPage(async (page) => {
        await page.goto(CART_URL, { waitUntil: "domcontentloaded", timeout: 20_000 });
        await page.waitForTimeout(2_000);
        assertLoggedIn(page);
        const items = await extractCart(page);
        const matches = items.filter((i) => i.productName.includes(productName));
        if (!confirm) {
          return ok({ matches, confirmed: false, next: matches.length === 1 ? "confirm=true로 다시 호출하면 제거합니다." : "상품명을 더 구체적으로 지정하세요." });
        }
        if (matches.length !== 1) {
          return ok({ error: `일치 항목이 ${matches.length}개 — 정확히 1개일 때만 제거합니다.`, matches });
        }
        const row = page.locator(`li:has-text("${matches[0].productName.slice(0, 30)}")`).first();
        const del = row.locator('button[class*="delete"], [aria-label*="삭제"], button:has-text("삭제")').first();
        if ((await del.count()) === 0) return ok({ error: "삭제 버튼을 찾지 못했습니다 (마크업 변경)." });
        await del.click();
        await page.waitForTimeout(1_500);
        return ok({ confirmed: true, removed: matches[0].productName });
      });
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "proceed_to_checkout",
  {
    title: "Open checkout (payment is human-only)",
    description:
      "Open the order sheet (pre-payment page) from the cart and STOP. The tab is left open in the user's browser. " +
      "This tool NEVER clicks the pay button — the final payment is always done by the human. " +
      "Two-step like the other write tools: call without confirm to see what is in the cart, then confirm=true to open the order sheet.",
    inputSchema: {
      confirm: z
        .boolean()
        .default(false)
        .describe("false previews the cart; true clicks 구매하기 and opens the order sheet"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  async ({ confirm }) => {
    try {
      await politeSlot();
      if (!confirm) {
        // Same preview-then-confirm contract as add_to_cart / remove_from_cart:
        // this is the tool closest to spending money, so it gets the gate too.
        const items = await withPage(async (page) => {
          await page.goto(CART_URL, { waitUntil: "domcontentloaded", timeout: 20_000 });
          await page.waitForTimeout(1_500);
          assertLoggedIn(page);
          return extractCart(page);
        });
        return ok({
          preview: true,
          cart: items,
          total: items.reduce((s, i) => s + (i.price ?? 0) * (i.quantity ?? 1), 0),
          next: "위 장바구니로 주문서를 열려면 confirm=true로 다시 호출하세요. 결제 버튼은 절대 누르지 않습니다.",
        });
      }
      return ok({ result: await openCheckout() });
    } catch (e) {
      return fail(e);
    }
  },
);

server
  .connect(new StdioServerTransport())
  .then(() =>
    console.error(
      `coupang-browser-mcp ${VERSION} ready (${TOOL_COUNT} tools) — needs Chrome on --remote-debugging-port=9222`,
    ),
  )
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
