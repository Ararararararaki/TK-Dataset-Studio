const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Bridge } = require("../electron/bridge.cjs");
test(
  "independent Python RPC, durable settings, shutdown without host",
  { timeout: 30000 },
  async () => {
    const root = path.resolve(__dirname, "..");
    const data = fs.mkdtempSync(path.join(os.tmpdir(), "tkds-rpc-"));
    const b = new Bridge(root, data, () => {});
    try {
      const initial = await b.call("bootstrap");
      assert.equal(initial.presets.length, 4);
      assert.equal(initial.settings.overwrite, false);
      assert.equal(initial.datasets.length, 0);
      await b.call("ui.save", { view: "grid", outputHeight: 350 });
      const current = await b.call("bootstrap");
      assert.equal(current.ui.outputHeight, 350);
      assert.equal(current.ui.view, "grid");
      await assert.rejects(() => b.call("unknown"), /未知操作/);
    } finally {
      await b.close();
      assert.equal(b.closed, true);
      fs.rmSync(data, { recursive: true, force: true });
    }
  },
);
