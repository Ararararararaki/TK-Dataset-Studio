const { spawn } = require("node:child_process");
const readline = require("node:readline");
const fs = require("node:fs");
const path = require("node:path");
class Bridge {
  constructor(root, data, onEvent) {
    this.pending = new Map();
    this.counter = 0;
    this.closed = false;
    fs.mkdirSync(data, { recursive: true });
    this.log = fs.openSync(path.join(data, "backend.log"), "a");
    // The backend reports this in `bootstrap.version`; read it from the packaged
    // manifest so the footer cannot drift away from package.json again.
    let version = "0.0.0";
    try {
      version = JSON.parse(
        fs.readFileSync(path.join(root, "package.json"), "utf8"),
      ).version;
    } catch {}
    this.child = spawn(
      path.join(root, "runtime", "python.exe"),
      ["-u", "-m", "backend.server"],
      {
        cwd: root,
        windowsHide: true,
        env: {
          ...process.env,
          TKDS_DATA: data,
          TKDS_VERSION: version,
          PYTHONUTF8: "1",
        },
        stdio: ["pipe", "pipe", this.log],
      },
    );
    this.reader = readline.createInterface({ input: this.child.stdout });
    this.reader.on("line", (line) => {
      let value;
      try {
        value = JSON.parse(line);
      } catch {
        return;
      }
      if (value.event) {
        onEvent(value.event);
        return;
      }
      const request = this.pending.get(value.id);
      if (!request) return;
      this.pending.delete(value.id);
      clearTimeout(request.timer);
      value.error
        ? request.reject(new Error(value.error))
        : request.resolve(value.result);
    });
    const fail = (error) => {
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(error);
      }
      this.pending.clear();
    };
    this.child.on("error", fail);
    this.child.on("exit", () => {
      fail(new Error("后端已退出，请重新打开软件"));
      this.closed = true;
    });
  }
  call(method, params = {}) {
    if (this.closed) return Promise.reject(new Error("后端已关闭"));
    const id = ++this.counter;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.pending.delete(id);
          reject(new Error("操作仍未完成，请查看任务状态"));
        },
        method === "models.download" ||
          method === "datasets.import" ||
          method === "datasets.scan"
          ? 4 * 60 * 60 * 1000
          : method === "assistant.chat"
            ? 20 * 60 * 1000
            : 120000,
      );
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(
        JSON.stringify({ id, method, params }) + "\n",
        (error) => {
          if (error) {
            clearTimeout(timer);
            this.pending.delete(id);
            reject(error);
          }
        },
      );
    });
  }
  async close() {
    if (this.closed) return;
    try {
      await Promise.race([
        this.call("shutdown"),
        new Promise((r) => setTimeout(r, 18000).unref()),
      ]);
    } catch {}
    this.child.stdin.end();
    if (!this.closed)
      await Promise.race([
        new Promise((r) => this.child.once("exit", r)),
        new Promise((r) => setTimeout(r, 5000).unref()),
      ]);
    if (!this.closed) {
      this.child.kill();
      await new Promise((r) => setTimeout(r, 250));
    }
    this.reader.close();
    fs.closeSync(this.log);
  }
}
module.exports = { Bridge };
