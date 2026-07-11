import type { Page } from "playwright-core";
import { getBrowser } from "./cdp.js";

/**
 * Account tools (orders / cart / checkout) — operate on the user's own
 * logged-in session. Design rules:
 *  - reads are free; writes require confirm:true after a preview response
 *  - checkout STOPS at the order sheet: the final pay button is always human
 *  - selectors are best-effort; login-wall and drift are reported, not hidden
 */

export const ORDER_LIST_URL = "https://mc.coupang.com/ssr/desktop/order/list";
export const CART_URL = "https://cart.coupang.com/cartView.pang";

export function looksLikeLogin(url: string): boolean {
  return /login\.coupang\.com|\/login/i.test(url);
}

export function assertLoggedIn(page: Page): void {
  if (looksLikeLogin(page.url())) {
    throw new Error("쿠팡 로그인이 필요합니다. 크롬에서 coupang.com에 로그인한 뒤 다시 시도하세요.");
  }
}

export interface OrderItem {
  orderedAt?: string;
  status?: string;
  productName: string;
  price?: number | null;
  quantity?: number | null;
  deliveryText?: string;
}

/** DOM extraction of the order list — text-anchored, best-effort. */
export async function extractOrders(page: Page): Promise<OrderItem[]> {
  return page.evaluate(() => {
    const num = (t: string | null | undefined) => {
      const n = Number((t ?? "").replace(/[^\d]/g, ""));
      return n > 0 ? n : null;
    };
    const out: OrderItem[] = [];
    // order cards: elements containing both a date-ish header and product links
    const containers = document.querySelectorAll(
      '[class*="order-list"] [class*="order"], [class*="sc-"] article, div[class*="renewal"] > div',
    );
    const seen = new Set<string>();
    containers.forEach((el) => {
      el.querySelectorAll('a[href*="/vp/products/"], a[href*="/products/"]').forEach((a) => {
        const name = (a.textContent ?? "").trim();
        if (name.length < 3 || seen.has(name)) return;
        seen.add(name);
        const card = a.closest("li, article, div");
        const text = card?.textContent ?? "";
        const status =
          text.match(/(배송완료|배송중|배송준비중|주문완료|취소완료|반품|교환|출고)/)?.[1];
        const date = text.match(/(\d{4})[.\s/-]+(\d{1,2})[.\s/-]+(\d{1,2})/);
        out.push({
          productName: name,
          status,
          orderedAt: date ? `${date[1]}-${date[2].padStart(2, "0")}-${date[3].padStart(2, "0")}` : undefined,
          price: num(text.match(/([\d,]+)\s*원/)?.[1]),
          deliveryText: text.match(/(\d{1,2}\/\d{1,2}\([월화수목금토일]\)\s*도착[^\s]*)/)?.[1],
        });
      });
    });
    return out.slice(0, 30);
  });
}

export interface CartItem {
  productName: string;
  price?: number | null;
  quantity?: number | null;
  rocket?: boolean;
}

export async function extractCart(page: Page): Promise<CartItem[]> {
  return page.evaluate(() => {
    const num = (t: string | null | undefined) => {
      const n = Number((t ?? "").replace(/[^\d]/g, ""));
      return n > 0 ? n : null;
    };
    const out: CartItem[] = [];
    document
      .querySelectorAll('[class*="cart-deal-item"], [class*="cartItem"], li[class*="cart"] ')
      .forEach((el) => {
        const nameEl = el.querySelector('a[href*="/vp/products/"], [class*="product-name"], [class*="name"]');
        const name = (nameEl?.textContent ?? "").trim();
        if (name.length < 3) return;
        const text = el.textContent ?? "";
        const qtyInput = el.querySelector('input[type="number"], input[class*="quantity"]');
        out.push({
          productName: name,
          price: num(text.match(/([\d,]+)\s*원/)?.[1]),
          quantity: num((qtyInput as HTMLInputElement | null)?.value),
          rocket: /로켓/.test(text),
        });
      });
    // dedupe by name
    const uniq = new Map<string, CartItem>();
    for (const c of out) if (!uniq.has(c.productName)) uniq.set(c.productName, c);
    return [...uniq.values()].slice(0, 50);
  });
}

/** Click the add-to-cart button on a product page. Returns what happened. */
export async function clickAddToCart(page: Page, quantity: number): Promise<string> {
  // set quantity if an input exists
  const qty = page.locator('input[type="number"]').first();
  if ((await qty.count()) > 0 && quantity > 1) {
    await qty.fill(String(quantity)).catch(() => {});
  }
  const btn = page
    .locator('button:has-text("장바구니 담기"), a:has-text("장바구니 담기"), button:has-text("장바구니")')
    .first();
  if ((await btn.count()) === 0) {
    throw new Error(
      "장바구니 버튼을 찾지 못했습니다 (마크업 변경 또는 옵션 선택 필요 상품). debug_page_structure로 확인하세요.",
    );
  }
  await btn.click();
  await page.waitForTimeout(1_500);
  return "장바구니 담기 버튼 클릭 완료";
}

/**
 * Open the checkout (order sheet) from the cart and LEAVE THE TAB OPEN.
 * Never clicks anything on the order sheet itself — payment is human-only.
 */
export async function openCheckout(): Promise<string> {
  const b = await getBrowser();
  const ctx = b.contexts()[0] ?? (await b.newContext());
  const page = await ctx.newPage(); // intentionally NOT closed
  await page.goto(CART_URL, { waitUntil: "domcontentloaded", timeout: 20_000 });
  await page.waitForTimeout(1_500);
  assertLoggedIn(page);
  const buy = page
    .locator('button:has-text("구매하기"), a:has-text("구매하기"), [class*="order-btn"]')
    .first();
  if ((await buy.count()) === 0) {
    return "장바구니 페이지를 열었지만 '구매하기' 버튼을 찾지 못했습니다. 브라우저에서 직접 진행하세요 (탭은 열어두었습니다).";
  }
  await buy.click();
  await page.waitForTimeout(2_000);
  return `주문서 페이지까지 열었습니다 (현재: ${page.url()}). ⚠️ 결제는 자동화하지 않습니다 — 브라우저에서 내용을 확인하고 직접 결제 버튼을 눌러주세요.`;
}
