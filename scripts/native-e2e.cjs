const { chromium } = require("playwright-core");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9236");
  const page = browser.contexts()[0].pages()[0];
  const call = (method, params = {}) =>
    page.evaluate(
      ({ method, params }) => window.studio.invoke(method, params),
      { method, params },
    );
  const mode = process.argv[2] || "caption";
  const boot = await call("bootstrap");
  const did = boot.datasets[0].id;
  const images = await call("images.list", { dataset_id: did });
  const row = images[mode === "moss" ? 1 : 0];
  await page.getByRole("button", { name: "图文列表", exact: true }).click();
  await page
    .getByRole("combobox", { name: "输出预设", exact: true })
    .selectOption(mode);
  await page
    .locator(`[data-image-id="${row.id}"]`)
    .getByRole("button", { name: "重新打标", exact: true })
    .click();
  await page.getByRole("button", { name: "备份并开始", exact: true }).click();
  const start = Date.now();
  let job;
  for (let n = 0; n < 300; n++) {
    await page.waitForTimeout(1000);
    const jobs = await call("jobs.list");
    job = jobs[0];
    if (n % 10 === 0)
      console.log(
        mode,
        ((Date.now() - start) / 1000).toFixed(1),
        job?.state,
        await page
          .locator(".job-strip")
          .innerText()
          .catch(() => ""),
      );
    if (job && job.state !== "running") break;
  }
  const detail = await call("images.get", { id: row.id });
  const result = {
    mode,
    elapsed_s: (Date.now() - start) / 1000,
    job,
    image: {
      name: detail.relative,
      status: detail.status,
      error: detail.error,
      text: detail.text,
      native: detail.native,
      raw: detail.raw,
    },
  };
  fs.writeFileSync(
    path.resolve(`.scratch/evidence/native-${mode}.json`),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
  await page.screenshot({
    path: path.resolve(`.scratch/screenshots/05-native-${mode}.png`),
  });
  assert.equal(detail.status, "done");
  assert.ok(detail.native.runId);
  assert.ok(detail.text.length > 50);
  assert.ok(!detail.text.includes('<<<TK_FINAL_PROMPT'));
  assert.ok(!/^(Reading|I will|I have read|Here (?:is|are))/i.test(detail.text));
  if(mode==='caption')assert.ok(!detail.text.startsWith('{'));
  if(mode==='hybrid')assert.ok(detail.text.includes('\n\n')&&!detail.text.startsWith('{'));
  if (mode === "moss") {
    const layout = JSON.parse(detail.text);
    assert.equal(layout.bbox_coord_space, "abs_centralized");
    assert.equal(layout.bbox_format, "yxyx");
    assert.ok(layout.items.length > 1);
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
