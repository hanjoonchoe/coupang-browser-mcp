import { chromium } from "playwright-core";
try {
  const b = await chromium.connectOverCDP("http://localhost:9222", { timeout: 10000 });
  console.log("CONNECTED, contexts:", b.contexts().length, "pages:", b.contexts()[0]?.pages().length);
  await b.close();
} catch (e) {
  console.log("FAIL:", (e as Error).message.slice(0, 300));
}
