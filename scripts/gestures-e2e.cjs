const { _electron } = require("playwright-core");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const assert = require("node:assert/strict");

(async () => {
  const packaged = process.argv.includes("--packaged");
  const root = path.resolve(__dirname, "..");
  const data = path.resolve(
    root,
    process.env.TKDS_QA_STATE ||
      `.scratch/gestures-${packaged ? "packaged" : "dev"}-state`,
  );
  const app = await _electron.launch({
    executablePath:
      process.env.TKDS_QA_EXE ||
      path.join(
        root,
        packaged
          ? "release/win-unpacked/TK Dataset Studio.exe"
          : "node_modules/electron/dist/electron.exe",
      ),
    args: packaged ? [] : ["."],
    cwd: root,
    env: { ...process.env, TKDS_DATA: data },
    timeout: 60000,
  });
  let closed = false;
  try {
    const page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const call = (method, params = {}) =>
      page.evaluate(
        ({ method, params }) => window.studio.invoke(method, params),
        { method, params },
      );
    const count = async () =>
      Number(
        (await page.locator(".select-all").innerText()).match(
          /已选 (\d+)/,
        )?.[1] || 0,
      );
    await page.locator(".workspace").waitFor();
    const [dataset] = await call("datasets.import", {
      paths: [path.join(root, ".scratch/scale-dataset")],
    });
    await call("ui.save", {
      dataset,
      view: "grid",
      imageScale: 1,
      inspector: false,
      theme: "light",
    });
    await page.reload();
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setBounds({ width: 1380, height: 880 });
      win.focus();
    });
    await page.locator(".thumb-card").first().waitFor();
    await page.waitForTimeout(350);
    const images = await call("images.list", { dataset_id: dataset });
    assert.equal(images.length, 1000);
    const cards = () => page.locator(".thumb-card");
    const bounds = async () => ({
      a: await cards().nth(0).boundingBox(),
      b: await cards().nth(1).boundingBox(),
      viewport: await page.locator(".image-scroll").boundingBox(),
    });
    async function box(from, to, key, during) {
      if (key) await page.keyboard.down(key);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 12 });
      await page.waitForTimeout(70);
      if (during) await during();
      await page.mouse.up();
      if (key) await page.keyboard.up(key);
      await page.waitForTimeout(60);
      if (process.env.TKDS_QA_TRACE)
        console.log({
          key,
          selected: await page
            .locator(".thumb-card.selected")
            .evaluateAll((elements) =>
              elements.map((el) => el.dataset.imageId),
            ),
          count: await count(),
          scroll: await page
            .locator(".image-scroll")
            .evaluate((el) => el.scrollTop),
          from,
          to,
        });
    }
    let { a, b } = await bounds();
    const start = { x: a.x - 5, y: a.y - 5 };
    const firstEnd = { x: a.x + a.width - 5, y: a.y + a.height - 5 };
    const secondEnd = { x: b.x + b.width - 5, y: b.y + b.height - 5 };
    await box(start, secondEnd);
    assert.equal(await count(), 2, "Forward marquee selects both cards");
    await box(start, firstEnd, "Control");
    assert.equal(
      await count(),
      1,
      "Ctrl marquee toggles against the starting selection",
    );
    await box(start, firstEnd, "Shift");
    assert.equal(await count(), 2, "Shift marquee adds");
    await box(start, firstEnd, "Alt");
    assert.equal(await count(), 1, "Alt marquee subtracts");
    await box(
      { x: b.x + b.width + 5, y: b.y + b.height + 5 },
      { x: a.x + 5, y: a.y + 5 },
    );
    assert.equal(await count(), 2, "Reverse marquee works");
    await box(start, firstEnd, null, () => page.keyboard.press("Escape"));
    assert.equal(
      await count(),
      2,
      "Escape restores the complete original selection",
    );
    assert.equal(await page.locator(".selection-marquee").count(), 0);
    await page.getByRole("button", { name: "取消选择", exact: true }).click();
    const viewport = (await bounds()).viewport;
    await box(
      start,
      { x: secondEnd.x, y: viewport.y + viewport.height - 2 },
      null,
      async () => {
        await page.waitForTimeout(800);
        assert.ok(
          (await page.locator(".image-scroll").evaluate((el) => el.scrollTop)) >
            200,
          "Holding at edge auto-scrolls",
        );
        await page.screenshot({
          path: path.join(
            root,
            `.scratch/screenshots/gestures-${packaged ? "packaged" : "dev"}-marquee.png`,
          ),
        });
      },
    );
    const autoSelected = await count();
    assert.ok(
      autoSelected > 4,
      "Selection includes rows that have left the viewport",
    );
    const initialDom = await cards().count();
    const initialHeight = (await cards().first().locator("img").boundingBox())
      .height;
    const scrollBox = await page.locator(".image-scroll").boundingBox();
    await page.mouse.move(
      scrollBox.x + scrollBox.width / 2,
      scrollBox.y + scrollBox.height / 2,
    );
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -120);
    await page.keyboard.up("Control");
    await page.waitForTimeout(300);
    const enlarged = await page.locator(".image-size-value").innerText();
    assert.ok(parseInt(enlarged) > 100);
    assert.ok(
      (await cards().first().locator("img").boundingBox()).height >
        initialHeight,
    );
    assert.equal(await count(), autoSelected, "Zoom keeps selected IDs");
    assert.equal(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].webContents.getZoomFactor(),
      ),
      1,
    );
    await page.reload();
    await cards().first().waitFor();
    assert.equal(
      await page.locator(".image-size-value").innerText(),
      enlarged,
      "Image size survives reload",
    );
    await page
      .getByRole("button", { name: "恢复图片显示大小", exact: true })
      .click();
    await page.getByRole("button", { name: "图文列表", exact: true }).click();
    await page.locator(".image-scroll").evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.locator(".image-entry").first().waitFor();
    await page.waitForTimeout(150);
    const entry = await page.locator(".image-entry").first().boundingBox();
    await box(
      { x: entry.x - 5, y: entry.y - 5 },
      {
        x: entry.x + entry.width - 4,
        y: Math.min(
          entry.y + entry.height - 4,
          scrollBox.y + scrollBox.height - 45,
        ),
      },
    );
    assert.equal(
      await count(),
      1,
      "List marquee selects the card without editing text",
    );
    const imageWidth = (
      await page.locator(".picture-wrap img").first().boundingBox()
    ).width;
    await page.mouse.move(entry.x + 60, entry.y + 120);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -120);
    await page.keyboard.up("Control");
    await page.waitForTimeout(200);
    assert.ok(
      (await page.locator(".picture-wrap img").first().boundingBox()).width >
        imageWidth,
      "List image gets larger too",
    );
    await page
      .getByRole("button", { name: "放大预览", exact: true })
      .first()
      .click();
    const svg = page.locator(".layout-preview");
    await svg.waitFor();
    const before = await svg.boundingBox();
    const point = {
      x: before.x + before.width / 2,
      y: before.y + before.height / 2 - 65,
    };
    await page.mouse.move(point.x, point.y);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -120);
    await page.keyboard.up("Control");
    await page.waitForTimeout(130);
    const after = await svg.boundingBox();
    assert.ok(after.height > before.height * 1.2);
    assert.ok(
      Math.abs(
        (point.y - before.y) / before.height -
          (point.y - after.y) / after.height,
      ) < 0.01,
      "Preview zoom anchors the cursor",
    );
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x, point.y + 55, { steps: 8 });
    await page.mouse.up();
    assert.ok(
      (await svg.boundingBox()).y > after.y + 20,
      "Enlarged preview pans",
    );
    await page.screenshot({
      path: path.join(
        root,
        `.scratch/screenshots/gestures-${packaged ? "packaged" : "dev"}-preview.png`,
      ),
    });
    await page.getByRole("button", { name: "适应窗口", exact: true }).click();
    assert.equal(
      await page.getByLabel("预览缩放比例", { exact: true }).innerText(),
      "100%",
    );
    await page
      .getByRole("button", { name: "放大预览图片", exact: true })
      .click();
    await svg.dblclick();
    assert.equal(
      await page.getByLabel("预览缩放比例", { exact: true }).innerText(),
      "100%",
    );
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "切换主题", exact: true }).click();
    await page.getByRole("button", { name: "缩略图网格", exact: true }).click();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setBounds({ width: 920, height: 650 }),
    );
    await page.waitForTimeout(200);
    const overflow = await page.evaluate(() => ({
      width: innerWidth,
      body: document.body.scrollWidth,
      scroll: document.querySelector(".image-scroll").clientWidth,
      content: document.querySelector(".image-scroll").scrollWidth,
      toolbar: document.querySelector(".browser-toolbar").clientWidth,
      toolbarContent: document.querySelector(".browser-toolbar").scrollWidth,
    }));
    assert.ok(
      overflow.body <= overflow.width &&
        overflow.content <= overflow.scroll &&
        overflow.toolbarContent <= overflow.toolbar,
    );
    await page.screenshot({
      path: path.join(
        root,
        `.scratch/screenshots/gestures-${packaged ? "packaged" : "dev"}-small-dark.png`,
      ),
    });
    assert.ok(
      initialDom < 100 && (await cards().count()) < 100,
      "Virtualized DOM stays bounded",
    );
    assert.deepEqual(errors, []);
    const boot = await call("bootstrap");
    const close = app.waitForEvent("close", { timeout: 12000 });
    await page.evaluate(() => window.studio.window("close"));
    await close;
    closed = true;
    const endpoint = JSON.parse(
      fs.readFileSync(path.join(data, "agent-endpoint.json"), "utf8"),
    );
    assert.equal(endpoint.status, "stopped");
    assert.throws(() => process.kill(endpoint.pid, 0));
    const port = Number(new URL(boot.agent.url).port);
    assert.ok(
      await new Promise((resolve) => {
        const server = net.createServer();
        server.once("error", () => resolve(false));
        server.listen(port, "127.0.0.1", () =>
          server.close(() => resolve(true)),
        );
      }),
    );
    const result = {
      passed: true,
      packaged,
      images: images.length,
      checks: [
        "forward/reverse marquee",
        "Ctrl toggle / Shift add / Alt subtract",
        "Escape restore",
        "cross-viewport auto-scroll",
        "list and grid zoom",
        "zoom persistence",
        "cursor-anchored preview and pan",
        "fit/double-click reset",
        "small dark window",
        "owned backend and port release",
      ],
      autoSelected,
      initialDom,
      enlarged,
      overflow,
      errors,
    };
    fs.writeFileSync(
      path.join(
        root,
        `.scratch/evidence/gestures-${packaged ? "packaged" : "dev"}.json`,
      ),
      JSON.stringify(result, null, 2),
    );
    console.log(result);
  } finally {
    if (!closed) {
      const pages = app.windows();
      if (pages[0])
        await pages[0]
          .screenshot({
            path: path.join(root, ".scratch/screenshots/gestures-failure.png"),
          })
          .catch(() => {});
      await app.close();
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
