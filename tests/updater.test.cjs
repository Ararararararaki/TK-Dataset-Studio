const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  UpdateManager,
  compareVersions,
  parseVersion,
} = require("../electron/updater.cjs");

test("version comparison orders releases and pre-releases", () => {
  assert.equal(compareVersions("0.2.3", "0.2.3"), 0);
  assert.equal(compareVersions("0.2.4", "0.2.3"), 1);
  assert.equal(compareVersions("0.2.3", "0.2.4"), -1);
  assert.equal(compareVersions("0.3.0", "0.2.99"), 1);
  assert.equal(compareVersions("1.0.0", "0.9.9"), 1);
  // a leading v is what GitHub tags actually look like
  assert.equal(compareVersions("v0.2.4", "0.2.3"), 1);
  // a pre-release must never outrank the matching stable release
  assert.equal(compareVersions("0.2.4-beta.1", "0.2.4"), -1);
  assert.equal(compareVersions("0.2.4", "0.2.4-beta.1"), 1);
  assert.equal(compareVersions("0.2.4-beta.2", "0.2.4-beta.1"), 1);
  // unparseable input must not be treated as "newer"
  assert.equal(compareVersions("nightly", "0.2.3"), 0);
  assert.equal(compareVersions("", "0.2.3"), 0);
});

test("parseVersion rejects anything that is not semver", () => {
  assert.deepEqual(parseVersion("1.2.3"), {
    major: 1,
    minor: 2,
    patch: 3,
    pre: "",
  });
  assert.equal(parseVersion("1.2"), null);
  assert.equal(parseVersion("latest"), null);
  assert.equal(parseVersion(null), null);
});

test("parseRelease picks the portable exe and its checksum file", () => {
  const release = UpdateManager.parseRelease(
    {
      tag_name: "v0.2.4",
      body: "## 0.2.4\n- fixed scanning",
      html_url: "https://github.com/o/r/releases/tag/v0.2.4",
      assets: [
        {
          name: "QUICKSTART.zh-CN.md",
          size: 100,
          browser_download_url: "https://example/quickstart",
        },
        {
          name: "TK-Dataset-Studio-0.2.4-Windows-x64.exe",
          size: 154590871,
          browser_download_url: "https://example/app.exe",
        },
        {
          name: "SHA256SUMS.txt",
          size: 90,
          browser_download_url: "https://example/sums",
        },
      ],
    },
    "o/r",
  );
  assert.equal(release.version, "0.2.4");
  assert.equal(release.asset.name, "TK-Dataset-Studio-0.2.4-Windows-x64.exe");
  assert.equal(release.asset.size, 154590871);
  assert.equal(release.asset.url, "https://example/app.exe");
  assert.equal(release.asset.sumsUrl, "https://example/sums");
  assert.match(release.notes, /fixed scanning/);
  assert.equal(release.pageUrl, "https://github.com/o/r/releases/tag/v0.2.4");
});

test("parseRelease tolerates a release without an exe", () => {
  const release = UpdateManager.parseRelease({ tag_name: "0.2.4", assets: [] }, "o/r");
  assert.equal(release.version, "0.2.4");
  assert.equal(release.asset, null);
  assert.equal(UpdateManager.parseRelease({ tag_name: "nope" }, "o/r"), null);
  assert.equal(UpdateManager.parseRelease(null, "o/r"), null);
});

test("parseSums reads sha256sum output in both GNU and Windows styles", () => {
  const digest = "a".repeat(64);
  const text = [
    `${"b".repeat(64)}  other-file.exe`,
    `${digest}  TK-Dataset-Studio-0.2.4-Windows-x64.exe`,
    `${"c".repeat(64)} *starred.exe`,
  ].join("\r\n");
  assert.equal(
    UpdateManager.parseSums(text, "TK-Dataset-Studio-0.2.4-Windows-x64.exe"),
    digest,
  );
  // `sha256sum -b` marks binary mode with an asterisk
  assert.equal(UpdateManager.parseSums(text, "starred.exe"), "c".repeat(64));
  assert.equal(UpdateManager.parseSums(text, "missing.exe"), "");
  assert.equal(UpdateManager.parseSums("", "x.exe"), "");
});

test("swap script waits for the running pid and can roll back", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tkds-updater-"));
  try {
    const manager = new UpdateManager({
      version: "0.2.3",
      cacheFile: path.join(dir, "state.json"),
      downloadDir: dir,
      portable: false,
    });
    const script = manager.writeSwapScript(
      "C:\\Apps\\TK Dataset Studio.exe",
      path.join(dir, "new.exe"),
    );
    const body = fs.readFileSync(script, "latin1");
    assert.match(body, /set "TARGET=C:\\Apps\\TK Dataset Studio\.exe"/);
    // The rename is retried until the running build releases the file. A
    // process-table poll would stall forever in a detached hidden script.
    assert.match(body, /:retry/);
    assert.match(body, /move \/y "%TARGET%" "%BACKUP%" >nul 2>&1/);
    assert.match(body, /if not errorlevel 1 goto swapped/);
    assert.match(body, /if %TRIES% GEQ 60 exit \/b 1/);
    assert.match(body, /copy \/y "%SOURCE%" "%TARGET%"/);
    // a failed copy must put the original back before giving up
    assert.match(body, /move \/y "%BACKUP%" "%TARGET%"/);
    assert.match(body, /start "" "%TARGET%"/);
    // the script deletes itself so repeated updates do not pile up
    assert.match(body, /del \/f \/q "%~f0"/);
    // cmd.exe reads ANSI; the payload must stay pure ASCII
    assert.ok(/^[\x00-\x7F]*$/.test(body), "swap script must be ASCII only");
    assert.ok(body.includes("\r\n"), "cmd scripts need CRLF line endings");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a non-portable unpackaged run refuses to guess a target", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tkds-updater-"));
  try {
    const manager = new UpdateManager({
      version: "0.2.3",
      cacheFile: path.join(dir, "state.json"),
      downloadDir: dir,
      portable: false,
    });
    // In a plain `electron .` run there is no exe to replace, so apply() must
    // fail loudly instead of writing somewhere unexpected.
    assert.equal(manager.targetExecutable(), "");
    return manager.apply().then(
      () => assert.fail("apply() should reject without a target"),
      (error) => assert.match(String(error.message), /没有已下载的更新/),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("portable apply swaps the executable and keeps a backup", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tkds-swap-"));
  const target = path.join(dir, "TK Dataset Studio.exe");
  const incoming = path.join(dir, "downloaded.exe");
  const options = {
    version: "0.2.3",
    cacheFile: path.join(dir, "state.json"),
    downloadDir: dir,
    portable: true,
    executable: target,
  };
  try {
    fs.writeFileSync(target, "OLD-BUILD");
    fs.writeFileSync(incoming, "NEW-BUILD");
    const manager = new UpdateManager(options);
    manager.state.downloaded = {
      version: "0.2.4",
      file: incoming,
      sha256: "x",
      verified: false,
      size: 9,
    };
    const restarts = [];
    manager.on("restart", (event) => restarts.push(event));
    await manager.apply();
    assert.equal(fs.readFileSync(target, "utf8"), "NEW-BUILD");
    assert.equal(fs.readFileSync(`${target}.old`, "utf8"), "OLD-BUILD");
    assert.equal(fs.existsSync(incoming), false, "the download is consumed");
    assert.equal(restarts.length, 1);
    assert.equal(restarts[0].immediate, true);
    assert.equal(restarts[0].executable, target);
    // The next launch must drop the backup, otherwise a second update would
    // find a stale .old and refuse to move the target aside.
    const relaunched = new UpdateManager(options);
    assert.equal(fs.existsSync(`${target}.old`), false);
    assert.ok(relaunched);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a failed portable swap leaves the original executable intact", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tkds-swap-"));
  const target = path.join(dir, "TK Dataset Studio.exe");
  const incoming = path.join(dir, "downloaded.exe");
  try {
    fs.writeFileSync(target, "OLD-BUILD");
    fs.writeFileSync(incoming, "NEW-BUILD");
    // Make the backup path undeletable: a non-empty directory where a file is
    // expected. apply() must give up without touching the real executable.
    fs.mkdirSync(`${target}.old`);
    fs.writeFileSync(path.join(`${target}.old`, "keep"), "x");
    const manager = new UpdateManager({
      version: "0.2.3",
      cacheFile: path.join(dir, "state.json"),
      downloadDir: dir,
      portable: true,
      executable: target,
    });
    manager.state.downloaded = {
      version: "0.2.4",
      file: incoming,
      sha256: "x",
      verified: false,
      size: 9,
    };
    await assert.rejects(() => manager.apply());
    assert.equal(
      fs.readFileSync(target, "utf8"),
      "OLD-BUILD",
      "the running build must survive a failed swap",
    );
    assert.equal(manager.snapshot().status, "error");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("swap script replaces and restarts an unlocked target", async () => {
  const { spawn } = require("node:child_process");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tkds-swaprun-"));
  const target = path.join(dir, "app.cmd");
  const source = path.join(dir, "incoming.cmd");
  const marker = path.join(dir, "restarted.txt");
  try {
    fs.writeFileSync(target, "@echo off\r\necho OLD\r\n");
    fs.writeFileSync(source, `@echo off\r\necho NEW> "${marker}"\r\n`);
    const manager = new UpdateManager({
      version: "0.2.4",
      cacheFile: path.join(dir, "state.json"),
      downloadDir: dir,
      portable: false,
    });
    const script = manager.writeSwapScript(target, source);
    spawn("cmd.exe", ["/c", script], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
    // The rename succeeds on the first try, so the swap is near-instant.
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && !fs.existsSync(marker)) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.equal(fs.existsSync(marker), true, "the new build must be started");
    assert.match(fs.readFileSync(target, "utf8"), /NEW/);
    assert.match(fs.readFileSync(`${target}.old`, "utf8"), /OLD/);
    assert.equal(fs.existsSync(source), false, "the download is consumed");
    assert.equal(fs.existsSync(script), false, "the script deletes itself");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("swap script replaces a running executable by renaming it aside", async () => {
  const { spawn } = require("node:child_process");
  const crypto = require("node:crypto");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tkds-locked-"));
  const sys = process.env.SystemRoot || "C:\\Windows";
  const target = path.join(dir, "app.exe");
  const source = path.join(dir, "incoming.exe");
  const digest = (file) =>
    crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let holder = null;
  try {
    // Windows refuses to delete a running executable but does allow renaming it,
    // so the swap works while the old build is still executing. The test runs a
    // copy of ping and swaps in whoami to prove it.
    fs.copyFileSync(path.join(sys, "System32", "ping.exe"), target);
    fs.copyFileSync(path.join(sys, "System32", "whoami.exe"), source);
    const oldDigest = digest(target);
    const newDigest = digest(source);
    holder = spawn(target, ["-n", "60", "127.0.0.1"], {
      windowsHide: true,
      stdio: "ignore",
    });
    await sleep(900);
    const manager = new UpdateManager({
      version: "0.2.4",
      cacheFile: path.join(dir, "state.json"),
      downloadDir: dir,
      portable: false,
    });
    const script = manager.writeSwapScript(target, source);
    spawn("cmd.exe", ["/c", script], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && digest(target) !== newDigest) {
      await sleep(300);
    }
    assert.equal(
      digest(target),
      newDigest,
      "the running build must be swapped out",
    );
    assert.equal(digest(`${target}.old`), oldDigest, "the old build is kept");
    assert.equal(fs.existsSync(source), false, "the download is consumed");
  } finally {
    if (holder) {
      try {
        holder.kill();
      } catch {
        /* already gone */
      }
    }
    // The process the swap script started can still hold the file for a moment,
    // and a leftover temp directory is not worth failing the test over.
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* leave it to the OS temp cleaner */
    }
  }
});
