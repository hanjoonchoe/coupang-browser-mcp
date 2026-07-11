import { describe, it, expect } from "vitest";
import { harvestProducts } from "../src/extract.js";

const BASE = "https://www.coupang.com/np/search?q=x";

describe("harvestProducts", () => {
  it("finds product-shaped objects nested anywhere in embedded state", () => {
    const blob = {
      props: {
        pageProps: {
          results: {
            items: [
              { productId: 123, productName: "에어팟 프로 2", salePrice: 299000, isRocket: true },
              { productId: 456, productName: "버즈3 프로", salePrice: "189,000원", rating: 4.5 },
            ],
          },
        },
      },
    };
    const out = harvestProducts(blob, BASE);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      name: "에어팟 프로 2",
      price: 299000,
      rocket: true,
      url: "https://www.coupang.com/vp/products/123",
      source: "embedded",
    });
    expect(out[1].price).toBe(189000); // string price parsed
  });

  it("dedupes by url and ignores non-product objects", () => {
    const blob = {
      a: { productId: 1, productName: "상품 하나", price: 1000 },
      b: { productId: 1, productName: "상품 하나", price: 1000 },
      junk: { name: "메뉴", foo: true },
    };
    const out = harvestProducts(blob, BASE);
    expect(out).toHaveLength(1);
  });

  it("returns empty on unrelated state", () => {
    expect(harvestProducts({ user: { id: 1 }, nav: ["a", "b"] }, BASE)).toHaveLength(0);
  });

  it("survives circular-ish deep nesting without blowing up", () => {
    const deep: Record<string, unknown> = {};
    let cur = deep;
    for (let i = 0; i < 30; i++) {
      const next: Record<string, unknown> = {};
      cur.child = next;
      cur = next;
    }
    expect(harvestProducts(deep, BASE)).toHaveLength(0);
  });
});
