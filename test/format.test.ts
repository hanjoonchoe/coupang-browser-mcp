import { describe, it, expect } from "vitest";
import { decode } from "@toon-format/toon";
import { serialize, resolveFormat } from "../src/format.js";

const searchPayload = {
  keyword: "에어팟",
  count: 2,
  products: [
    { name: "Apple 에어팟 프로 3", price: 369000, rating: null, rocket: false },
    { name: "SMIRIA 이어폰, 블랙", price: 129000, rating: 4.5, rocket: true },
  ],
  extractionSource: "dom",
  note: undefined,
};

describe("serialize", () => {
  it("emits a uniform array as one header plus one row per item", () => {
    const out = serialize(searchPayload, "toon");
    expect(out).toContain("products[2]{name,price,rating,rocket}:");
    // The keys are stated once in the header, not repeated on every row.
    expect(out.match(/price/g)).toHaveLength(1);
  });

  it("round-trips back to the original data", () => {
    expect(decode(serialize(searchPayload, "toon"))).toEqual({
      keyword: "에어팟",
      count: 2,
      products: [
        { name: "Apple 에어팟 프로 3", price: 369000, rating: null, rocket: false },
        { name: "SMIRIA 이어폰, 블랙", price: 129000, rating: 4.5, rocket: true },
      ],
      extractionSource: "dom",
    });
  });

  it("omits undefined properties instead of encoding them as null", () => {
    // Tools set `note: undefined` to mean "nothing went wrong" — it must not
    // show up as a `note: null` line.
    expect(serialize(searchPayload, "toon")).not.toContain("note");
    expect(serialize({ note: "추출 실패" }, "toon")).toContain("note: 추출 실패");
  });

  it("quotes values that would otherwise be read as structure", () => {
    const out = serialize({ items: [{ name: "이어폰, 블랙", price: 1 }] }, "toon");
    expect(out).toContain('"이어폰, 블랙",1'); // comma is the row delimiter
  });

  it("is smaller than the JSON it replaces", () => {
    const toon = serialize(searchPayload, "toon");
    const json = serialize(searchPayload, "json");
    expect(toon.length).toBeLessThan(json.length);
    expect(JSON.parse(json)).toEqual(decode(toon)); // same data either way
  });

  it("falls back to JSON only when COUPANG_MCP_FORMAT says so", () => {
    expect(resolveFormat({})).toBe("toon");
    expect(resolveFormat({ COUPANG_MCP_FORMAT: "JSON" })).toBe("json");
    expect(resolveFormat({ COUPANG_MCP_FORMAT: "toon" })).toBe("toon");
    expect(resolveFormat({ COUPANG_MCP_FORMAT: "nonsense" })).toBe("toon");
  });
});
