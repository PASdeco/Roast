/* Diagnose mobile overflow using DealPort's Playwright install.
   Run from C:/Vibecode/DealPort:  npx playwright test --config=no ... (not a test)
   Actually run: node <this file>  (uses require from DealPort's node_modules) */
const path = require("path");
const { chromium } = require(path.join(
  "C:/",
  "Vibecode",
  "DealPort",
  "node_modules",
  "playwright-core",
));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await page.goto("http://localhost:3000", { waitUntil: "networkidle" });

  const metrics = await page.evaluate(() => {
    const doc = document.scrollingElement;
    const vw = window.innerWidth;
    const wide = [];
    document.querySelectorAll("*").forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.right > vw + 1 || rect.width > vw + 1) {
        wide.push({
          tag: el.tagName.toLowerCase(),
          cls: String(el.className).slice(0, 80),
          width: Math.round(rect.width),
          right: Math.round(rect.right),
        });
      }
    });
    return {
      scrollWidth: doc.scrollWidth,
      innerWidth: vw,
      overflowing: wide.sort((a, b) => b.right - a.right).slice(0, 15),
    };
  });

  console.log(JSON.stringify(metrics, null, 2));
  await browser.close();
})();
