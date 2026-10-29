const { chromium } = require("playwright-core");
const path = require("node:path");
const fs = require("node:fs");
(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9236");
  const context = browser.contexts()[0];
  const page = context.pages()[0];
  await page.waitForFunction(() => !!window.studio, { timeout: 20000 });
  await page.waitForTimeout(800);
  const state = await page.evaluate(() => window.studio.invoke("bootstrap"));
  console.log(
    JSON.stringify(
      {
        url: page.url(),
        version: state.version,
        models: state.models.length,
        body: (await page.locator("body").innerText()).slice(0, 700),
      },
      null,
      2,
    ),
  );
  fs.mkdirSync(path.resolve(".scratch/screenshots"), { recursive: true });
  await page.screenshot({
    path: path.resolve(".scratch/screenshots/01-empty.png"),
  });
  try {
    const catalog = await page.evaluate(() =>
      window.studio.invoke("dsh.catalog"),
    );
    console.log(
      "DSH",
      JSON.stringify({
        connected: catalog.connected,
        default: catalog.capabilities.models.default,
        groups: catalog.capabilities.models.groups.map((g) => ({
          id: g.id,
          count: g.models.length,
        })),
      }),
    );
  } catch (e) {
    console.log("DSH ERROR", e.message);
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
