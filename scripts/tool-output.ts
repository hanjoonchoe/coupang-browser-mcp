/**
 * Functional check for coupang-browser-mcp. Two layers:
 *  1. harvestProducts (pure) — against a fixture embedded-state blob
 *  2. live tools — IF Chrome is running with --remote-debugging-port=9222,
 *     runs search_products for real; otherwise records the graceful error.
 *
 *   npx tsx scripts/tool-output.ts
 */
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { harvestProducts } from "../src/extract.js";
import { serialize } from "../src/format.js";

const OUT = join(process.cwd(), "test-output");
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// Serialized exactly the way the tools return it, so these files show what the
// model actually sees.
const save = (name: string, args: unknown, body: unknown) => {
  const text = typeof body === "string" ? body : serialize(body);
  writeFileSync(
    join(OUT, `${name}.txt`),
    `TOOL: ${name}\nARGS: ${JSON.stringify(args)}\nDATE: ${new Date().toISOString()}\n${"-".repeat(60)}\n\n${text}\n`,
  );
  console.log(`✓ ${name}.txt (${text.length} bytes)`);
};

// 1 — pure extraction against a realistic embedded-state fixture
const fixtureState = {
  props: {
    pageProps: {
      searchResult: {
        products: [
          { productId: 7638094253, productName: "Apple 에어팟 프로 2세대", salePrice: 299000, isRocket: true, ratingAverage: 4.8, ratingCount: 21043, imageUrl: "https://thumbnail.coupangcdn.com/x.jpg" },
          { productId: 8123456789, productName: "에어팟 프로2 케이스", salePrice: "8,900원", isRocket: false },
        ],
      },
    },
  },
};
save(
  "harvest_products.fixture",
  { source: "__NEXT_DATA__-shaped fixture" },
  harvestProducts(fixtureState, "https://www.coupang.com/np/search?q=에어팟"),
);

// 2 — live tools via CDP (or graceful failure if Chrome isn't running)
try {
  const { withPage } = await import("../src/cdp.js");
  const { politeSlot } = await import("../src/throttle.js");
  const { embeddedJson, domSearchFallback } = await import("../src/extract.js");

  await politeSlot();
  const result = await withPage(async (page) => {
    const url = "https://www.coupang.com/np/search?q=%EC%97%90%EC%96%B4%ED%8C%9F";
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.waitForTimeout(1_500);
    const blobs = await embeddedJson(page);
    let products = harvestProducts(blobs, url);
    const domProducts = await domSearchFallback(page);
    if (domProducts.length > products.length) products = domProducts;
    return { availableBlobs: Object.keys(blobs), count: products.length, sample: products.slice(0, 5) };
  });
  save("search_products.live", { keyword: "에어팟" }, result);
} catch (e) {
  save("search_products.cdp-unavailable", { keyword: "에어팟" }, {
    error: (e as Error).message,
    note: "크롬을 --remote-debugging-port=9222로 실행한 뒤 다시 실행하면 live 출력이 생성됩니다.",
  });
}

console.log(`\nDone → ${OUT}`);
process.exit(0); // playwright ws connections keep the loop alive
