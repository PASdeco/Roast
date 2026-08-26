/* Final visual captures via real browser emulation.
   Run: node scripts/capture-final.cjs  (from C:/Vibecode/Roast) */
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

  // Mobile light
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await mobile.goto("http://localhost:3000", { waitUntil: "networkidle" });
  await mobile.screenshot({
    path: "C:/Users/Hp/AppData/Local/Temp/rm_mobile.png",
    fullPage: true,
  });

  // Desktop dark
  const dark = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    colorScheme: "dark",
  });
  await dark.goto("http://localhost:3000", { waitUntil: "networkidle" });
  await dark.emulateMedia({ colorScheme: "dark" });
  await dark.waitForTimeout(600);
  await dark.screenshot({
    path: "C:/Users/Hp/AppData/Local/Temp/rm_dark.png",
    fullPage: true,
  });

  // Desktop light
  const light = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await light.goto("http://localhost:3000", { waitUntil: "networkidle" });
  await light.screenshot({
    path: "C:/Users/Hp/AppData/Local/Temp/rm_light.png",
    fullPage: true,
  });

  await browser.close();
  console.log("captured: rm_mobile.png, rm_dark.png, rm_light.png");
})();
