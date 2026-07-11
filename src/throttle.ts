/**
 * Polite self-throttle. There is no contractual limit here (no API), so we
 * impose our own: behave like a human, not a crawler.
 *  - minimum gap between page loads
 *  - hard hourly ceiling
 */
const MIN_GAP_MS = Number(process.env.COUPANG_MIN_GAP_MS) || 5_000;
const HOURLY_CEILING = Number(process.env.COUPANG_HOURLY_CEILING) || 60;

let lastAt = 0;
let stamps: number[] = [];

export async function politeSlot(): Promise<void> {
  const now = Date.now();
  stamps = stamps.filter((t) => now - t < 3_600_000);
  if (stamps.length >= HOURLY_CEILING) {
    const resetAt = new Date(stamps[0] + 3_600_000).toISOString();
    throw new Error(
      `자율 스로틀: 시간당 ${HOURLY_CEILING}회 페이지 로드 한도에 도달했습니다 (해제: ${resetAt}). ` +
        `이 한도는 예의상 설정된 것으로 COUPANG_HOURLY_CEILING로 조정 가능합니다.`,
    );
  }
  const wait = lastAt + MIN_GAP_MS - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  stamps.push(lastAt);
}
