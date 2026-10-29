const { chromium } = require("playwright-core");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const evidence = path.join(root, ".scratch/evidence");
fs.mkdirSync(evidence, { recursive: true });
(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9236");
  const page = browser.contexts()[0].pages()[0];
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const call = (method, params = {}) =>
    page.evaluate(
      ({ method, params }) => window.studio.invoke(method, params),
      { method, params },
    );
  await page.waitForFunction(() => !!window.studio);
  const boot = await call("bootstrap");
  const dir = path.join(root, ".scratch/示例数据集");
  fs.mkdirSync(dir, { recursive: true });
  const sources = [
    ["party-room.jpg", "01-庆生与五人构图.jpg"],
    ["kick-action.jpg", "02-多人物动作与遮挡.jpg"],
  ];
  for (const [source, name] of sources) {
    const target = path.join(dir, name);
    if (!fs.existsSync(target))
      fs.copyFileSync(
        path.join(
          process.env.TKDS_TEST_IMAGE_DIR ||
            (() => {
              throw new Error(
                "Set TKDS_TEST_IMAGE_DIR for the two visual fixtures",
              );
            })(),
          source,
        ),
        target,
      );
  }
  const modelDir =
    process.env.TKDS_WD14_MODEL_DIR || boot.settings.model_dirs[0];
  assert.ok(modelDir, "Set TKDS_WD14_MODEL_DIR");
  await call("settings.save", {
    ...boot.settings,
    model_dirs: [modelDir],
    wd14: {
      ...boot.settings.wd14,
      model: modelDir + "/wd-v1-4-moat-tagger-v2.onnx",
    },
    character_snapshot:
      process.env.TKDS_CHARACTER_SNAPSHOT ||
      boot.settings.character_snapshot ||
      "",
    lookup_missing: false,
    character_update: false,
  });
  const [did] = await call("datasets.import", { paths: [dir] });
  await call("ui.save", { dataset: did, preset: "tags" });
  await page.reload();
  await page
    .getByRole("heading", { name: "示例数据集", exact: true })
    .waitFor();
  await page
    .getByRole("combobox", { name: "输出预设", exact: true })
    .selectOption("tags");
  const start = Date.now();
  await page.getByRole("button", { name: "开始打标", exact: true }).click();
  let current;
  for (let n = 0; n < 180; n++) {
    await page.waitForTimeout(1000);
    const state = await call("bootstrap");
    current = state.jobs[0];
    if (current && current.state !== "running") break;
  }
  const images = await call("images.list", { dataset_id: did });
  const details = await Promise.all(
    images.map((r) => call("images.get", { id: r.id })),
  );
  fs.writeFileSync(
    path.join(evidence, "wd14.json"),
    JSON.stringify(
      {
        elapsed_s: (Date.now() - start) / 1000,
        job: current,
        images: details.map((d) => ({
          name: d.relative,
          status: d.status,
          error: d.error,
          raw: d.raw,
          characters: d.raw.characters,
          revision: d.revision,
        })),
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      {
        elapsed_s: (Date.now() - start) / 1000,
        status: current?.state,
        images: details.map((d) => ({
          name: d.relative,
          status: d.status,
          tags: d.raw.tags?.length,
          characters: d.raw.characters,
          error: d.error,
        })),
        errors,
      },
      null,
      2,
    ),
  );
  await page.screenshot({
    path: path.join(root, ".scratch/screenshots/02-wd14.png"),
  });
  assert.equal(
    details.filter((d) => d.status === "done").length,
    2,
    "Actual WD14 images must succeed",
  );
  // Real editor autosave, history and retained height.
  const editor = page.getByRole("textbox", {
    name: "01-庆生与五人构图.jpg 打标文本",
    exact: true,
  });
  await editor.fill(details[0].text + "\nmanual QA note");
  await editor.blur();
  await page.waitForTimeout(1200);
  const edited = await call("images.get", { id: details[0].id });
  assert.ok(edited.text.endsWith("manual QA note"));
  assert.ok((await call("images.history", { id: details[0].id })).length > 0);
  await call("images.save", {
    id: edited.id,
    text: details[0].text,
    revision: edited.revision,
    format: "tags",
  });
  await page.getByRole("button", { name: "缩略图网格", exact: true }).click();
  await page.waitForTimeout(300);
  assert.ok(await page.locator(".thumb-card").count());
  await page.getByRole("button", { name: "切换主题", exact: true }).click();
  await page.screenshot({
    path: path.join(root, ".scratch/screenshots/03-dark-grid.png"),
  });
  await page.reload();
  await page.waitForSelector(".thumb-card");
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  await page.getByRole("button", { name: "切换主题", exact: true }).click();
  await page.getByRole("button", { name: "图文列表", exact: true }).click();
  await page.getByRole("button", { name: "设置与模型", exact: true }).click();
  await page.getByRole("button", { name: "检测连接", exact: true }).click();
  await page.getByText("已连接原生 DSH", { exact: true }).waitFor();
  await page.screenshot({
    path: path.join(root, ".scratch/screenshots/04-settings.png"),
  });
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    path.join(evidence, "desktop-ui.json"),
    JSON.stringify(
      {
        passed: true,
        checks: [
          "native application loaded",
          "two complex anime images WD14 CPU",
          "sidecar auto save",
          "manual edit history",
          "view persisted",
          "theme persisted",
          "native DSH catalog",
          "no page errors",
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log("Desktop UI checks passed");
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
