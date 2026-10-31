"use strict";
/**
 * Self-update for the portable Windows build.
 *
 * Why this is not electron-updater: the app ships as a single `portable` exe,
 * which electron-builder documents as "manual auto-update". The portable
 * wrapper also decompresses itself into %TEMP% and sets PORTABLE_EXECUTABLE_FILE
 * to the original exe, so the running process never holds a lock on the file we
 * need to replace. That makes a real in-app update possible without an
 * installer, code signing, or a helper service.
 *
 * The module is deliberately free of Electron UI code: it only needs `app` for
 * paths and `net` so downloads honour the system proxy. Everything else is
 * plain Node, which keeps it unit-testable (see tests/updater.test.cjs).
 */

const { app, net } = require("electron");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");

const DEFAULT_REPO = "Ararararararaki/TK-Dataset-Studio";
const CHECK_TTL_MS = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 5;

/**
 * `require("electron")` outside an Electron process resolves to the path of the
 * binary, so every `app` access must tolerate its absence: the pure logic in
 * this module is unit-tested under plain Node.
 */
const hostApp = app && typeof app.getVersion === "function" ? app : null;
const hostBase = () => {
  try {
    return hostApp ? hostApp.getPath("userData") : os.tmpdir();
  } catch {
    return os.tmpdir();
  }
};

/* ------------------------------------------------------------------ *
 * Version comparison (pure, no dependencies, unit-tested)
 * ------------------------------------------------------------------ */

function parseVersion(raw) {
  const text = String(raw == null ? "" : raw).trim().replace(/^v/i, "");
  const match = text.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] || "",
  };
}

/** -1 when a < b, 0 when equal, 1 when a > b. Unparseable input compares equal. */
function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return 0;
  for (const part of ["major", "minor", "patch"]) {
    if (left[part] !== right[part]) return left[part] > right[part] ? 1 : -1;
  }
  if (left.pre === right.pre) return 0;
  if (!left.pre) return 1; // 0.2.4 > 0.2.4-beta.1
  if (!right.pre) return -1;
  return left.pre > right.pre ? 1 : -1;
}

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(file);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function safeName(name) {
  return String(name || "").replace(/[^\w.+-]+/g, "_").slice(0, 120);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
  } catch {
    /* a cache that cannot be written must never break the app */
  }
}

/**
 * One HTTP request through Electron's net stack so the system proxy applies.
 * Resolves with the response object; the caller consumes the body stream.
 */
function request(url, { method = "GET", headers = {}, timeout = REQUEST_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const req = net.request({ method, url, redirect: "manual" });
    for (const [key, value] of Object.entries(headers)) req.setHeader(key, value);
    req.setHeader("User-Agent", `TK-Dataset-Studio/${hostApp ? hostApp.getVersion() : "0.0.0"}`);
    const timer = setTimeout(() => {
      req.abort();
      reject(new Error("网络请求超时"));
    }, timeout);
    req.on("response", (response) => {
      clearTimeout(timer);
      resolve(response);
    });
    req.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    req.end();
  });
}

function readBody(response, limit = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    response.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("响应体过大"));
        return;
      }
      chunks.push(chunk);
    });
    response.on("end", () => resolve(Buffer.concat(chunks)));
    response.on("error", reject);
  });
}

async function requestText(url, options) {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await request(current, options);
    const status = response.statusCode;
    if (status >= 300 && status < 400 && response.headers.location) {
      current = new URL(String(response.headers.location), current).href;
      continue;
    }
    if (status !== 200) throw new Error(`HTTP ${status}`);
    return readBody(response);
  }
  throw new Error("重定向过多");
}

/* ------------------------------------------------------------------ *
 * UpdateManager
 * ------------------------------------------------------------------ */

class UpdateManager extends EventEmitter {
  /**
   * @param {object} options
   * @param {string} options.version        current app version
   * @param {string} options.cacheFile      where check results are cached
   * @param {string} options.downloadDir    where the new exe is written
   * @param {string} [options.repo]         "owner/name" on GitHub
   * @param {string} [options.feedUrl]      explicit releases endpoint (overrides repo)
   * @param {string} [options.executable]   file to replace; defaults to the portable exe
   * @param {boolean} [options.portable]    whether we are inside the portable wrapper
   * @param {(line: string) => void} [options.log]
   */
  constructor(options = {}) {
    super();
    this.version = options.version || (hostApp ? hostApp.getVersion() : "0.0.0");
    this.cacheFile = options.cacheFile || path.join(hostBase(), "update-state.json");
    this.downloadDir = options.downloadDir || path.join(hostBase(), "updates");
    this.repo = options.repo || DEFAULT_REPO;
    this.feedUrl = options.feedUrl || `https://api.github.com/repos/${this.repo}/releases/latest`;
    this.portableFile = options.executable || process.env.PORTABLE_EXECUTABLE_FILE || "";
    this.isPortable = options.portable != null ? options.portable : Boolean(process.env.PORTABLE_EXECUTABLE_FILE);
    this.log = options.log || (() => {});
    this.cache = readJson(this.cacheFile) || {};
    this.abort = null;
    this.state = {
      status: "idle",
      current: this.version,
      latest: "",
      notes: "",
      pageUrl: "",
      asset: null,
      progress: null,
      error: "",
      checkedAt: this.cache.checkedAt || 0,
      skipped: this.cache.skipped || "",
      downloaded: this.cache.downloaded || null,
    };
    // A file left over from a previous run means the last swap already happened.
    this.sweepLeftovers();
  }

  /** Remove the backup written by a completed swap so it cannot be re-applied. */
  sweepLeftovers() {
    const target = this.targetExecutable();
    if (!target) return;
    const backup = `${target}.old`;
    try {
      if (fs.existsSync(backup)) fs.rmSync(backup, { force: true });
    } catch {
      /* locked by a still-running previous instance: retried on the next launch */
    }
  }

  /** The file an update should replace. */
  targetExecutable() {
    if (this.isPortable && this.portableFile) return this.portableFile;
    if (hostApp && hostApp.isPackaged) return process.execPath;
    return "";
  }

  snapshot() {
    return { ...this.state };
  }

  setState(patch) {
    this.state = { ...this.state, ...patch };
    this.emit("state", this.snapshot());
  }

  /** Parse a GitHub releases payload into the internal release shape. */
  static parseRelease(payload, repo) {
    if (!payload || typeof payload !== "object") return null;
    const tag = payload.tag_name || payload.name || "";
    const version = String(tag).replace(/^v/i, "").trim();
    if (!parseVersion(version)) return null;
    const assets = Array.isArray(payload.assets) ? payload.assets : [];
    const exe = assets.find((a) => /\.exe$/i.test(a.name || ""));
    const sums = assets.find((a) => /sha256sums?\.txt$/i.test(a.name || ""));
    return {
      version,
      notes: typeof payload.body === "string" ? payload.body : "",
      pageUrl: payload.html_url || (repo ? `https://github.com/${repo}/releases` : ""),
      asset: exe
        ? {
            name: exe.name,
            size: Number(exe.size) || 0,
            url: exe.browser_download_url || exe.url || "",
            sumsUrl: sums ? sums.browser_download_url || sums.url || "" : "",
          }
        : null,
    };
  }

  /** Read `sha256  filename` lines and return the digest for one file. */
  static parseSums(text, fileName) {
    const lines = String(text || "").split(/\r?\n/);
    for (const line of lines) {
      const match = line.trim().match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
      if (!match) continue;
      if (!fileName || match[2].trim() === fileName) return match[1].toLowerCase();
    }
    return "";
  }

  async check({ force = false } = {}) {
    if (this.state.status === "downloading" || this.state.status === "applying") return this.snapshot();
    if (!force && Date.now() - this.state.checkedAt < CHECK_TTL_MS && this.state.status !== "error") {
      return this.snapshot();
    }
    this.setState({ status: "checking", error: "" });
    try {
      const body = await requestText(this.feedUrl, {
        headers: { Accept: "application/vnd.github+json" },
      });
      const release = UpdateManager.parseRelease(JSON.parse(body.toString("utf8")), this.repo);
      if (!release) throw new Error("发布信息格式不正确");
      this.cache.checkedAt = Date.now();
      writeJson(this.cacheFile, this.cache);
      const newer = compareVersions(release.version, this.version) > 0;
      if (!newer) {
        this.setState({
          status: "current",
          latest: release.version,
          notes: release.notes,
          pageUrl: release.pageUrl,
          asset: null,
          checkedAt: this.cache.checkedAt,
          error: "",
        });
        return this.snapshot();
      }
      const skipped = this.state.skipped === release.version;
      this.setState({
        status: skipped ? "skipped" : "available",
        latest: release.version,
        notes: release.notes,
        pageUrl: release.pageUrl,
        asset: release.asset,
        checkedAt: this.cache.checkedAt,
        error: "",
        progress: null,
      });
    } catch (error) {
      // A failed check is background noise, never a modal: keep the app usable.
      this.setState({ status: "error", error: String(error && error.message ? error.message : error) });
    }
    return this.snapshot();
  }

  skip() {
    if (!this.state.latest) return this.snapshot();
    this.cache.skipped = this.state.latest;
    writeJson(this.cacheFile, this.cache);
    this.setState({ status: "skipped", skipped: this.state.latest });
    return this.snapshot();
  }

  cancel() {
    if (this.abort) {
      this.abort();
      this.abort = null;
    }
    if (this.state.status === "downloading")
      this.setState({ status: "available", progress: null });
  }

  /** Download the release exe, resuming a partial file when possible. */
  async download() {
    const asset = this.state.asset;
    if (!asset || !asset.url) throw new Error("没有可下载的安装文件");
    if (this.state.status === "downloading") return this.snapshot();
    const target = path.join(this.downloadDir, safeName(asset.name || `update-${this.state.latest}.exe`));
    await fsp.mkdir(this.downloadDir, { recursive: true });
    const partial = `${target}.part`;
    let start = 0;
    try {
      start = (await fsp.stat(partial)).size;
    } catch {
      start = 0;
    }
    if (asset.size && start >= asset.size) {
      // A complete .part already exists (interrupted after the last byte).
    } else if (!asset.size && start > 0) {
      start = 0; // cannot trust an unknown-length resume
    }
    const headers = start > 0 ? { Range: `bytes=${start}-` } : {};
    this.setState({
      status: "downloading",
      error: "",
      progress: { received: start, total: asset.size || 0, percent: asset.size ? Math.round((start / asset.size) * 100) : 0 },
    });
    let aborted = false;
    try {
      const response = await request(asset.url, { headers, timeout: 60000 });
      const status = response.statusCode;
      if (status !== 200 && status !== 206) throw new Error(`下载失败 HTTP ${status}`);
      const resumed = status === 206;
      if (!resumed && start > 0) start = 0;
      const total = Number(response.headers["content-length"]) + (resumed ? start : 0) || asset.size || 0;
      const sink = fs.createWriteStream(partial, { flags: resumed ? "a" : "w" });
      let received = start;
      let lastEmit = 0;
      await new Promise((resolve, reject) => {
        this.abort = () => {
          aborted = true;
          response.destroy();
          sink.end();
          reject(new Error("已取消"));
        };
        response.on("data", (chunk) => {
          received += chunk.length;
          const now = Date.now();
          if (now - lastEmit > 120) {
            lastEmit = now;
            this.setState({
              progress: {
                received,
                total,
                percent: total ? Math.min(99, Math.round((received / total) * 100)) : 0,
              },
            });
          }
        });
        response.on("error", reject);
        response.pipe(sink);
        sink.on("error", reject);
        sink.on("finish", resolve);
      });
      this.abort = null;
      if (aborted) throw new Error("已取消");
      await fsp.rename(partial, target);
      // Integrity: prefer the published SHA256SUMS, fall back to nothing rather
      // than pretending an unverified binary is safe.
      let digest = "";
      if (asset.sumsUrl) {
        try {
          const sums = (await requestText(asset.sumsUrl)).toString("utf8");
          digest = UpdateManager.parseSums(sums, asset.name);
        } catch {
          digest = "";
        }
      }
      const actual = await sha256File(target);
      if (digest && digest !== actual) {
        await fsp.rm(target, { force: true });
        throw new Error("校验失败：下载文件与发布校验和不一致");
      }
      this.cache.downloaded = {
        version: this.state.latest,
        file: target,
        sha256: actual,
        verified: Boolean(digest),
        size: (await fsp.stat(target)).size,
      };
      writeJson(this.cacheFile, this.cache);
      this.setState({
        status: "ready",
        downloaded: this.cache.downloaded,
        progress: { received: total, total, percent: 100 },
      });
    } catch (error) {
      this.abort = null;
      this.setState({
        status: aborted ? "available" : "error",
        error: aborted ? "" : String(error && error.message ? error.message : error),
        progress: null,
      });
      throw error;
    }
    return this.snapshot();
  }

  /**
   * Swap the downloaded exe in place.
   *
   * Portable: the wrapper's own exe is not locked, so we can rename + copy and
   * relaunch immediately. Any other layout keeps the running exe locked, so we
   * hand the swap to a detached cmd script that waits for this PID to exit.
   */
  async apply() {
    const downloaded = this.state.downloaded;
    if (!downloaded || !downloaded.file) throw new Error("没有已下载的更新");
    const target = this.targetExecutable();
    if (!target) throw new Error("当前运行方式不支持自动更新，请手动下载");
    if (!fs.existsSync(downloaded.file)) throw new Error("更新文件已丢失，请重新下载");
    this.setState({ status: "applying", error: "" });

    if (this.isPortable) {
      const backup = `${target}.old`;
      try {
        if (fs.existsSync(backup)) fs.rmSync(backup, { force: true });
        await fsp.rename(target, backup);
        await fsp.copyFile(downloaded.file, target);
        await fsp.rm(downloaded.file, { force: true });
        this.cache.downloaded = null;
        writeJson(this.cacheFile, this.cache);
        this.emit("restart", { executable: target, immediate: true });
        return this.snapshot();
      } catch (error) {
        // Roll back so a failed swap never leaves the user without a working app.
        try {
          if (!fs.existsSync(target) && fs.existsSync(backup)) await fsp.rename(backup, target);
        } catch {
          /* the backup stays on disk for manual recovery */
        }
        this.setState({
          status: "error",
          error: `替换失败：${error && error.message ? error.message : error}`,
        });
        throw error;
      }
    }

    const script = this.writeSwapScript(target, downloaded.file);
    this.emit("restart", { executable: target, script, immediate: false });
    return this.snapshot();
  }

  /** Detached cmd script for the locked-exe case. */
  writeSwapScript(target, source) {
    const scriptPath = path.join(this.downloadDir, `swap-${Date.now()}.cmd`);
    const quoted = (value) => `"${String(value).replace(/"/g, "")}"`;
    const lines = [
      "@echo off",
      "setlocal enableextensions",
      `set "TARGET=${String(target).replace(/"/g, "")}"`,
      `set "SOURCE=${String(source).replace(/"/g, "")}"`,
      `set "BACKUP=%TARGET%.old"`,
      "set /a TRIES=0",
      // Retry the rename instead of polling the process table. tasklist needs a
      // console and stalls forever inside a detached hidden script, which would
      // leave the update hanging; a rename either succeeds or fails immediately,
      // so retrying it is both simpler and safe.
      `if exist "%BACKUP%" del /f /q "%BACKUP%" >nul 2>&1`,
      ":retry",
      `if not exist "%TARGET%" exit /b 1`,
      `move /y "%TARGET%" "%BACKUP%" >nul 2>&1`,
      "if not errorlevel 1 goto swapped",
      "set /a TRIES+=1",
      "if %TRIES% GEQ 60 exit /b 1",
      `"%SystemRoot%\\System32\\ping.exe" -n 2 127.0.0.1 >nul 2>&1`,
      "goto retry",
      ":swapped",
      `copy /y "%SOURCE%" "%TARGET%" >nul`,
      "if errorlevel 1 (",
      `  move /y "%BACKUP%" "%TARGET%" >nul`,
      "  exit /b 1",
      ")",
      `del /f /q "%SOURCE%" >nul 2>&1`,
      // Give the quitting process time to release the single-instance lock,
      // otherwise the relaunched build exits immediately.
      `"%SystemRoot%\\System32\\ping.exe" -n 4 127.0.0.1 >nul 2>&1`,
      `start "" "%TARGET%"`,
      // The backup is deliberately left for the next launch to sweep, so a build
      // that fails to start can still be recovered by hand.
      `del /f /q "%~f0" >nul 2>&1`,
      "",
    ];
    fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
    // cmd.exe reads scripts as ANSI; keep the payload ASCII so Chinese paths in
    // the app directory cannot corrupt the script.
    fs.writeFileSync(scriptPath, lines.join("\r\n"), "latin1");
    return scriptPath;
  }

  launchSwap(scriptPath) {
    if (!scriptPath) return;
    const child = spawn("cmd.exe", ["/c", scriptPath], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
  }
}

module.exports = { UpdateManager, compareVersions, parseVersion, DEFAULT_REPO };
