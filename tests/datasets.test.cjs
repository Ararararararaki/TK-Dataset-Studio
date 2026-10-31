const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Bridge } = require("../electron/bridge.cjs");

// Smallest valid PNG so the backend can read real pixel dimensions.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test(
  "datasets.remove drops only the index and keeps images plus sidecars on disk",
  { timeout: 60000 },
  async () => {
    const root = path.resolve(__dirname, "..");
    const data = fs.mkdtempSync(path.join(os.tmpdir(), "tkds-rm-"));
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "tkds-imgs-"));
    const image = path.join(folder, "a.png");
    const sidecar = path.join(folder, "a.txt");
    fs.writeFileSync(image, PNG);
    fs.writeFileSync(sidecar, "existing caption", "utf8");

    const b = new Bridge(root, data, () => {});
    try {
      await b.call("datasets.import", { paths: [folder] });
      const first = await b.call("bootstrap");
      assert.equal(first.datasets.length, 1);
      const id = first.datasets[0].id;
      assert.equal(first.datasets[0].count, 1);

      const rows = await b.call("images.list", {
        dataset_id: id,
        search: "",
        status: "all",
      });
      assert.equal(rows.length, 1);

      const rest = await b.call("datasets.remove", { id });
      assert.deepEqual(rest, []);

      const after = await b.call("bootstrap");
      assert.equal(after.datasets.length, 0);
      assert.equal(after.ui.dataset, undefined);

      // The whole point of "remove" over "delete": nothing on disk moves.
      assert.equal(fs.existsSync(image), true);
      assert.equal(fs.existsSync(sidecar), true);
      assert.equal(fs.readFileSync(sidecar, "utf8"), "existing caption");
    } finally {
      await b.close();
      fs.rmSync(data, { recursive: true, force: true });
      fs.rmSync(folder, { recursive: true, force: true });
    }
  },
);

test(
  "a removed dataset leaves no orphaned image rows behind",
  { timeout: 60000 },
  async () => {
    const root = path.resolve(__dirname, "..");
    const data = fs.mkdtempSync(path.join(os.tmpdir(), "tkds-orphan-"));
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "tkds-orphan-imgs-"));
    fs.writeFileSync(path.join(folder, "a.png"), PNG);
    fs.writeFileSync(path.join(folder, "b.png"), PNG);

    const b = new Bridge(root, data, () => {});
    try {
      await b.call("datasets.import", { paths: [folder] });
      const boot = await b.call("bootstrap");
      const id = boot.datasets[0].id;
      assert.equal(boot.datasets[0].count, 2);

      await b.call("datasets.remove", { id });

      // Re-importing the same folder must come back clean, which only holds if
      // the previous image rows were deleted along with the dataset row.
      await b.call("datasets.import", { paths: [folder] });
      const again = await b.call("bootstrap");
      assert.equal(again.datasets.length, 1);
      assert.equal(again.datasets[0].count, 2);
      const rows = await b.call("images.list", {
        dataset_id: again.datasets[0].id,
        search: "",
        status: "all",
      });
      assert.equal(rows.length, 2);
    } finally {
      await b.close();
      fs.rmSync(data, { recursive: true, force: true });
      fs.rmSync(folder, { recursive: true, force: true });
    }
  },
);
