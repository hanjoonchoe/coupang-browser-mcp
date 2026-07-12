# coupang-browser-mcp

**Tagline:** Search Coupang, read reviews, and check your own orders and cart — through the Chrome browser you already have open. No API key.

**Category:** E-commerce / Browser automation
**Tags:** coupang, shopping, e-commerce, browser, cdp, chrome, korea, personal-use
**License:** MIT
**Repository:** https://github.com/hanjoonchoe/coupang-browser-mcp
**Package:** https://www.npmjs.com/package/coupang-browser-mcp
**Author:** hanjoonchoe

## Overview

Coupang has no public product API for individuals. This server gets the data the
official Partners API can't reach — review text, ratings, your order history,
your cart — by driving a Chrome browser **you** launched, logged in as **you**,
on **your** IP. Nothing is hosted, proxied, or collected.

It does not bypass bot protection and does not run headless (Coupang serves
"Access Denied" to headless Chrome). It drives a real browser session you own.

## Scope: personal use

Read this before installing:

- **This is a personal tool, not a service or a scraping backend.** It is built
  for one person automating their own browser, and it self-throttles to stay
  that way: minimum 5 seconds between page loads, maximum 60 loads per hour.
- **Do not use it for bulk or commercial data collection.** Coupang's Terms of
  Service may restrict automation; you use it on your own responsibility.
- **Payment is never automated.** `proceed_to_checkout` opens the order sheet
  and stops. No code path clicks a pay button — the final click is always human.
- Unofficial project, **not affiliated with Coupang**.

## Requirements

- Node.js >= 18
- Google Chrome, started with `--remote-debugging-port=9222`
- A Coupang account logged into that Chrome — only for the order and cart tools;
  search, product detail, and reviews work logged out.

## Setup

**1. Start Chrome with remote debugging** (quit Chrome completely first):

```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```

**2. Add the server to your MCP client:**

```bash
claude mcp add coupang-browser -- npx -y coupang-browser-mcp
```

Or, as raw client config:

```json
{
  "mcpServers": {
    "coupang-browser": { "command": "npx", "args": ["-y", "coupang-browser-mcp"] }
  }
}
```

On macOS, `scripts/run-mcp-hidden.sh` is bundled as an alternative entry point:
it starts a separate Chrome on its own profile and keeps the window hidden, so
you don't have a browser window in your face while working.

## Tools

| Tool | Description |
|---|---|
| `search_products` | Products from the search page — name, price, rating, rocket delivery. Filter to rocket-only, sort by price. |
| `get_product_detail` | Price, rating, review count, and delivery info from a product page. |
| `get_product_reviews` | Individual reviews — author, date, star rating, purchased option, and text. |
| `get_my_orders` | Your order history and delivery status. Read-only, needs login. |
| `get_cart` | Your cart contents. Read-only, needs login. |
| `add_to_cart` | Adds a product. **Two-step:** previews the target first, acts only on `confirm=true`. |
| `remove_from_cart` | Removes an item. **Two-step**, and only when exactly one item matches the name. |
| `proceed_to_checkout` | **Two-step.** Opens the order sheet and stops. Never clicks pay. |
| `debug_page_structure` | Dumps the page's embedded-JSON skeleton. Use this when Coupang changes its markup and extraction breaks. |

## Safety model

1. **Reads are free; writes confirm.** Every cart mutation, and checkout itself,
   returns a preview and requires an explicit second call with `confirm=true`.
2. **Money never moves automatically — enforced in code, not just promised.**
   Checkout clicks only while the URL is still `cart.coupang.com`, refuses any
   button whose label reads like payment (`결제`, `바로구매`, `pay`), and stops
   touching the page once the order sheet is open.
3. **Polite self-throttle.** >= 5s between page loads, <= 60 loads/hour. There is
   no contractual rate limit here, so the tool imposes its own.

## Configuration

| Env var | Default | Description |
|---|---|---|
| `COUPANG_CDP_URL` | `http://localhost:9222` | Chrome DevTools endpoint |
| `COUPANG_MIN_GAP_MS` | `5000` | Minimum gap between page loads |
| `COUPANG_HOURLY_CEILING` | `60` | Max page loads per hour |
| `COUPANG_MCP_FORMAT` | `toon` | Tool output encoding; set to `json` to opt out of TOON |

## Output format

Tool results are [TOON](https://toonformat.dev) (Token-Oriented Object Notation)
rather than JSON. The payloads here are mostly uniform arrays — products,
reviews, cart items, orders — so the keys are stated once in a header instead of
being repeated on every element:

```
items[2]{productName,price,quantity}:
  에어팟 프로 3,369000,1
  충전 케이스,8900,2
```

The server advertises the format in its MCP `instructions`, so the model knows
how to read it. Set `COUPANG_MCP_FORMAT=json` for JSON.

## Example prompts

- "Find AirPods Pro under 300,000 won on Coupang, rocket delivery only."
- "What do the reviews for this product actually complain about?"
- "What did I order last month, and has it shipped?"
- "Add this to my cart, then show me the cart total."

## Troubleshooting

- **Can't connect to Chrome:** Chrome must be started with
  `--remote-debugging-port=9222`, and any already-running Chrome must be fully
  quit first, or the flag is ignored.
- **No products found:** Coupang changed its markup. Run `debug_page_structure`
  on the page to see the current JSON blobs and selectors.
- **Order/cart tools say you're logged out:** log into coupang.com inside the
  debug-port Chrome, not your normal one.
