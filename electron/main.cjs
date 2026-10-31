const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  protocol,
  net,
  shell,
  nativeImage,
  screen,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { Bridge } = require("./bridge.cjs");
const { UpdateManager } = require("./updater.cjs");
protocol.registerSchemesAsPrivileged([
  {
    scheme: "studio",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
if (process.env.TKDS_DATA)
  app.setPath("userData", path.resolve(process.env.TKDS_DATA));
app.setName("TK Dataset Studio");
if (process.platform === "win32") app.setAppUserModelId("com.tk.datasetstudio");
if (!app.requestSingleInstanceLock()) {
  app.quit();
  // app.quit() does not stop execution of this CommonJS module.
  // A losing instance must never register hooks or start another backend.
  return;
}
let win,
  bridge,
  updater,
  quitting = false,
  allowExit = false;
const allowed = new Set([
  "bootstrap",
  "datasets.import",
  "datasets.scan",
  "datasets.remove",
  "datasets.relocate",
  "images.list",
  "images.get",
  "images.save",
  "images.history",
  "settings.save",
  "ui.save",
  "models.list",
  "models.download",
  "presets.save",
  "presets.delete",
  "dsh.catalog",
  "dsh.start",
  "jobs.list",
  "jobs.start",
  "jobs.resume",
  "jobs.pause",
  "jobs.cancel",
  "assistant.chat",
  "characters.save",
]);
function trusted(event) {
  if (
    event.sender !== win?.webContents ||
    event.senderFrame !== win.webContents.mainFrame
  )
    throw new Error("未知窗口");
}
app.on("second-instance", () => {
  if (win) {
    win.show();
    win.focus();
  }
});
app.whenReady().then(async () => {
  const root = app.isPackaged
    ? process.resourcesPath
    : path.resolve(__dirname, "..");
  const data = app.getPath("userData");
  bridge = new Bridge(root, data, (event) => {
    if (win && !win.isDestroyed()) win.webContents.send("studio:event", event);
  });
  protocol.handle("studio", async (request) => {
    try {
      const url = new URL(request.url);
      const id = url.pathname.slice(1);
      if (
        url.hostname !== "image" ||
        !/^[a-f0-9]{32}$/.test(id) ||
        request.method !== "GET"
      )
        return new Response("Not found", { status: 404 });
      const file = await bridge.call("images.thumbnail", {
        id,
        full: url.searchParams.get("full") === "1",
      });
      return net.fetch(pathToFileURL(file).href);
    } catch {
      return new Response("Image unavailable", { status: 404 });
    }
  });
  let geometry = { width: 1500, height: 960 };
  try {
    geometry = {
      ...geometry,
      ...JSON.parse(fs.readFileSync(path.join(data, "window.json"), "utf8")),
    };
  } catch {}
  // Restore onto a currently connected display, including after a monitor change.
  const display = screen.getDisplayMatching({
    x: Number.isFinite(geometry.x) ? geometry.x : 0,
    y: Number.isFinite(geometry.y) ? geometry.y : 0,
    width: geometry.width,
    height: geometry.height,
  }).workArea;
  geometry.width = Math.min(Math.max(920, geometry.width), display.width);
  geometry.height = Math.min(Math.max(650, geometry.height), display.height);
  if (Number.isFinite(geometry.x))
    geometry.x = Math.max(
      display.x,
      Math.min(geometry.x, display.x + display.width - geometry.width),
    );
  if (Number.isFinite(geometry.y))
    geometry.y = Math.max(
      display.y,
      Math.min(geometry.y, display.y + display.height - geometry.height),
    );
  win = new BrowserWindow({
    ...geometry,
    minWidth: 920,
    minHeight: 650,
    show: false,
    frame: false,
    icon: path.join(root, "assets", "icon.png"),
    backgroundColor: "#f8f9fb",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault();
  });
  updater = new UpdateManager({ version: app.getVersion(), log: () => {} });
  updater.on("state", (state) => {
    if (win && !win.isDestroyed()) win.webContents.send("studio:update", state);
  });
  updater.on("restart", ({ executable, script, immediate }) => {
    if (script) updater.launchSwap(script);
    if (!immediate) {
      allowExit = true;
      app.quit();
      return;
    }
    // Portable: the original exe is free, so relaunch it directly instead of
    // app.relaunch() (which would re-open the decompressed copy in %TEMP%).
    try {
      require("node:child_process").spawn(executable, [], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      }).unref();
    } catch {
      /* fall through to a normal relaunch */
    }
    allowExit = true;
    app.quit();
  });
  ipcMain.handle("studio:update", async (e, action, arg) => {
    trusted(e);
    if (action === "state") return updater.snapshot();
    if (action === "check") return updater.check({ force: Boolean(arg) });
    if (action === "download") return updater.download();
    if (action === "apply") return updater.apply();
    if (action === "skip") return updater.skip();
    if (action === "cancel") return updater.cancel();
    throw new Error("未知更新操作");
  });
  ipcMain.handle("studio:invoke", (e, method, params) => {
    trusted(e);
    if (!allowed.has(method)) throw new Error("未知操作");
    return bridge.call(method, params);
  });
  ipcMain.handle("studio:folder", async (e) => {
    trusted(e);
    const r = await dialog.showOpenDialog(win, {
      properties: ["openDirectory"],
    });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle("studio:file", async (e) => {
    trusted(e);
    const r = await dialog.showOpenDialog(win, {
      properties: ["openFile"],
      filters: [{ name: "Relay descriptor", extensions: ["json"] }],
    });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle("studio:external", (e, url) => {
    trusted(e);
    const u = new URL(url);
    if (
      u.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)
    )
      throw new Error("只允许打开本机 DSH 会话");
    return shell.openExternal(u.href);
  });
  ipcMain.handle("studio:reveal", async (e, id) => {
    trusted(e);
    const row = await bridge.call("images.get", { id });
    shell.showItemInFolder(row.path);
  });
  ipcMain.on("studio:drag", async (e, id) => {
    trusted(e);
    const row = await bridge.call("images.get", { id });
    const thumb = await bridge.call("images.thumbnail", { id });
    e.sender.startDrag({
      file: row.path,
      icon: nativeImage.createFromPath(thumb).resize({ width: 96 }),
    });
  });
  ipcMain.on("studio:window", (e, action) => {
    trusted(e);
    if (action === "minimize") win.minimize();
    if (action === "maximize")
      win.isMaximized() ? win.unmaximize() : win.maximize();
    if (action === "close") win.close();
  });
  let boundsTimer;
  const saveBounds = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => persistBounds(), 180);
  };
  const persistBounds = () => {
    if (!win.isMaximized() && !win.isMinimized())
      fs.writeFileSync(
        path.join(data, "window.json"),
        JSON.stringify(win.getBounds()),
      );
  };
  win.on("resize", saveBounds);
  win.on("move", saveBounds);
  win.once("ready-to-show", () => win.show());
  win.on("close", (event) => {
    clearTimeout(boundsTimer);
    persistBounds();
    if (!allowExit) {
      event.preventDefault();
      app.quit();
    }
  });
  if (process.env.TKDS_DEV_URL) await win.loadURL(process.env.TKDS_DEV_URL);
  else
    await win.loadFile(
      path.join(
        root,
        app.isPackaged ? "app.asar/dist/index.html" : "dist/index.html",
      ),
    );
  // Background check after the window is up: a failure must never interrupt
  // first paint or surface a dialog on launch.
  if (app.isPackaged && !process.env.TKDS_NO_UPDATE_CHECK)
    setTimeout(() => {
      updater.check().catch(() => {});
    }, 8000);
});
app.on("before-quit", (event) => {
  if (allowExit) return;
  event.preventDefault();
  if (quitting) return;
  quitting = true;
  const flush = new Promise((resolve) => {
    if (!win || win.isDestroyed()) return resolve();
    const id = require("node:crypto").randomUUID();
    const done = (e, value) => {
      if (value !== id || e.sender !== win?.webContents) return;
      clearTimeout(timer);
      ipcMain.removeListener("studio:flushed", done);
      resolve();
    };
    const timer = setTimeout(() => {
      ipcMain.removeListener("studio:flushed", done);
      resolve();
    }, 4000);
    ipcMain.on("studio:flushed", done);
    win.webContents.send("studio:prepare-close", id);
  });
  flush
    .then(() => bridge?.close())
    .finally(() => {
      allowExit = true;
      app.quit();
    });
});
app.on("window-all-closed", () => app.quit());
