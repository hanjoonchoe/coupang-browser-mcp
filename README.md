# coupang-browser-mcp

[![npm](https://img.shields.io/npm/v/coupang-browser-mcp)](https://www.npmjs.com/package/coupang-browser-mcp)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![personal use](https://img.shields.io/badge/scope-personal--use-orange)](#%EF%B8%8F-read-this-first)

**English** · [한국어](./README.ko.md)

**Personal-use** MCP server that searches Coupang through **your own Chrome browser** (CDP). No API key, no Partners account — and it can see what the official API can't: ratings, review text, your orders, your cart.

## ⚠️ Read this first

- **This is a personal tool, not a service.** It remote-controls the Chrome *you* launched, logged in as *you*, on *your* IP. Nothing is hosted, collected, or redistributed.
- It does **not** bypass bot protection — it drives a real browser session you own.
- Coupang's ToS may restrict automation tools; use at your own responsibility. Do not use for bulk or commercial data collection.
- Coupang markup changes can break extraction — use the built-in `debug_page_structure` tool to diagnose and update.
- **Payment is never automated.** `proceed_to_checkout` stops at the order sheet; the final pay click is always yours.
- Unofficial project — not affiliated with Coupang.

## Quick Start

**1. Launch Chrome with remote debugging** (quit Chrome completely first):

```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```

Log into coupang.com in that Chrome if you want order/cart tools.

> **Don't want a browser window in your face?** (macOS) Use the bundled wrapper instead of step 1 — it starts a *separate* Chrome on its own profile (port 9223), hides its window, and keeps it hidden. Point your MCP client at `run-mcp-hidden.sh` instead of `npx coupang-browser-mcp`:
>
> ```bash
> claude mcp add coupang-browser -- \
>   "$(npm root -g)/coupang-browser-mcp/scripts/run-mcp-hidden.sh"
> ```
>
> Headless Chrome is *not* used: Coupang serves "Access Denied" to it, and this project does not evade bot detection. The window is real, just hidden. Run `scripts/show-chrome.sh` to bring it back for login or checkout (`rm ~/.coupang-chrome/keep-visible` re-hides it).

**2. Add the server to your MCP client:**

<details open>
<summary><b>Claude Code</b></summary>

```bash
claude mcp add coupang-browser -- npx -y coupang-browser-mcp
```
</details>

<details>
<summary><b>Claude Desktop</b></summary>

Add to `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "coupang-browser": { "command": "npx", "args": ["-y", "coupang-browser-mcp"] }
  }
}
```
</details>

<details>
<summary><b>Codex CLI</b></summary>

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.coupang-browser]
command = "npx"
args = ["-y", "coupang-browser-mcp"]
```
</details>

<details>
<summary><b>OpenCode</b></summary>

Add to `opencode.json` (project) or `~/.config/opencode/opencode.json` (global):

```json
{
  "mcp": {
    "coupang-browser": {
      "type": "local",
      "command": ["npx", "-y", "coupang-browser-mcp"],
      "enabled": true
    }
  }
}
```
</details>

<details>
<summary><b>Cursor</b></summary>

Add to `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global), or via Settings → MCP → Add new global MCP server:

```json
{
  "mcpServers": {
    "coupang-browser": { "command": "npx", "args": ["-y", "coupang-browser-mcp"] }
  }
}
```
</details>

## Architecture

```
┌─────────────────┐  stdio (JSON-RPC)  ┌──────────────────────┐
│   MCP client    │◄──────────────────►│  coupang-browser-mcp │
│  (Claude Code,  │                    │                      │
│   Cursor, ...)  │                    │  index.ts   9 tools  │
└─────────────────┘                    │  throttle.ts ≥5s gap │
                                       │  extract.ts  parsers │
                                       └──────────┬───────────┘
                                                  │ CDP (playwright-core)
                                                  │ localhost:9222
                                                  ▼
                                       ┌──────────────────────┐
                                       │   YOUR own Chrome    │
                                       │  (your session, your │
                                       │   login, your IP)    │
                                       └──────────┬───────────┘
                                                  │ real browser traffic
                                                  ▼
                                       ┌──────────────────────┐
                                       │     coupang.com      │
                                       │  search / product /  │
                                       │  reviews / orders /  │
                                       │        cart          │
                                       └──────────────────────┘

Per tool call:  navigate the shared tab → extract (embedded JSON ▸ DOM fallback) → reset to about:blank
Calls are serialized over ONE reused tab: opening a tab makes macOS un-hide Chrome,
which would pop a window on every call.
```

## Example Prompts

| You say | Tool used |
|---|---|
| "쿠팡에서 에어팟 검색해줘" | `search_products` |
| "이 상품 평점이랑 리뷰 수 알려줘" | `get_product_detail` |
| "이 상품 리뷰 좀 읽어줘" | `get_product_reviews` |
| "내 주문 배송 어디까지 왔어?" | `get_my_orders` |
| "장바구니에 뭐 들어있지?" | `get_cart` |
| "이거 장바구니에 담아줘" | `add_to_cart` (preview → confirm) |
| "주문할게, 결제 페이지 열어줘" | `proceed_to_checkout` (stops before payment) |

## Tools

| Tool | Parameters | Description |
|---|---|---|
| `search_products` | `keyword`\*, `limit` (≤36), `rocketOnly`, `sortBy` | Extract products from the search page (embedded JSON first, DOM fallback) |
| `get_product_detail` | `url`\* | Price, rating, review count from a product page — data the official API can't provide |
| `get_product_reviews` | `url`\*, `limit` (≤10), `maxTextLength` | Individual reviews (author, date, rating, purchased option, text) — scrolls the lazy-loaded review section into view |
| `debug_page_structure` | `url`\* | Skeleton of embedded JSON blobs on a page — self-diagnosis when markup drifts |
| `get_my_orders` | — | Order history + delivery status (read-only, needs login) |
| `get_cart` | — | Cart contents (read-only, needs login) |
| `add_to_cart` | `url`\*, `quantity`, `confirm` | **Two-step**: preview first, executes only with `confirm=true` |
| `remove_from_cart` | `productName`\*, `confirm` | Two-step; removes only when exactly one item matches |
| `proceed_to_checkout` | — | Opens the order sheet and **stops** — tab left open, pay button never clicked |

## Safety model

1. **Reads are free, writes confirm.** Cart mutations return a preview and require an explicit `confirm=true` second call.
2. **Money never moves automatically.** Checkout stops at the order sheet.
3. **Polite self-throttle**: ≥5s between page loads, ≤60 loads/hour (configurable). There's no contractual limit here, so we impose our own.

## Configuration

| Env var | Default | Description |
|---|---|---|
| `COUPANG_CDP_URL` | `http://localhost:9222` | Chrome DevTools endpoint |
| `COUPANG_MIN_GAP_MS` | `5000` | Minimum gap between page loads |
| `COUPANG_HOURLY_CEILING` | `60` | Max page loads per hour |

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Chrome CDP에 연결할 수 없습니다" | Chrome isn't running with `--remote-debugging-port=9222`, or an older non-debug Chrome instance is holding the profile — quit Chrome fully and relaunch with the flag |
| `Browser context management is not supported` | Stale debug instance — kill it and relaunch Chrome cleanly |
| Empty results / "추출 실패" | Coupang markup changed — run `debug_page_structure` on the same URL and file an issue with its output |
| "쿠팡 로그인이 필요합니다" | Log into coupang.com in the debug Chrome (order/cart tools only) |
| A Chrome window pops up on every call | You're on an older version — 0.2.1 and earlier opened a new tab per call. Upgrade, and use `run-mcp-hidden.sh` if you want the window hidden entirely |

## Development

```bash
npm install
npm run lint                      # eslint (type-checked)
npm test                          # extraction unit tests (no browser needed)
npm run build                     # tsc → dist/
npx tsx scripts/tool-output.ts    # live check → test-output/*.txt (uses your Chrome if running)
```

## License

[MIT](./LICENSE)
