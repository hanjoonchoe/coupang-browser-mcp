import { encode } from "@toon-format/toon";

export type OutputFormat = "toon" | "json";

/**
 * Tool results are TOON by default: the payloads here are mostly uniform arrays
 * (products, reviews, cart items, orders), which TOON emits as a single header
 * plus one row per item instead of repeating every key on every element. Set
 * COUPANG_MCP_FORMAT=json to fall back to JSON for a client that needs it.
 */
export const resolveFormat = (env: Record<string, string | undefined> = process.env): OutputFormat =>
  env.COUPANG_MCP_FORMAT?.toLowerCase() === "json" ? "json" : "toon";

/**
 * The encoder turns an `undefined` property into an explicit `null`, but tools
 * use `note: undefined` to mean "no note at all". Round-tripping through JSON
 * drops those keys first, so absent stays absent.
 */
const toJsonSafe = (payload: unknown): unknown => {
  const json = JSON.stringify(payload);
  return json === undefined ? null : JSON.parse(json);
};

export const serialize = (payload: unknown, format: OutputFormat = resolveFormat()): string => {
  const safe = toJsonSafe(payload);
  return format === "json" ? JSON.stringify(safe, null, 1) : encode(safe);
};
