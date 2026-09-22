const electron = require("electron");
const {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  session,
  screen,
  Tray,
} = electron;
const { autoUpdater } = require("electron-updater");
const { join } = require("path");
const { createDesktopApi } = require("./desktop-api");
const { applyPlatformHeaders } = require("./request-headers");

// The packaged test executable must use the same disposable data boundary as source tests.
if (process.env.LISTEN1_TEST_USER_DATA) {
  const profile = require("node:path").resolve(
    process.env.LISTEN1_TEST_USER_DATA
  );
  require("node:fs").mkdirSync(profile, { recursive: true });
  app.setPath("userData", profile);
  app.setPath("sessionData", profile);
}

let store;
const iconPath = join(__dirname, "/listen1_chrome_extension/images/logo.png");

autoUpdater.on("error", (error) =>
  console.warn("Update check failed:", error.code || "UPDATE_ERROR")
);

let floatingWindowCssKey = undefined,
  appIcon = null,
  willQuitApp = false,
  transparent = false,
  trayIconPath;
/** @type {electron.BrowserWindow} */
let mainWindow;
/** @type {electron.BrowserWindow} */
let floatingWindow;
/** @type {electron.Tray} */
let appTray;
//platform-specific
switch (process.platform) {
  case "darwin":
    trayIconPath = join(__dirname, "/resources/logo_16.png");
    transparent = true;
    break;
  case "linux":
    trayIconPath = join(__dirname, "/resources/logo_32.png");
    // fix transparent window not working in linux bug
    app.disableHardwareAcceleration();
    break;
  case "win32":
    trayIconPath = join(__dirname, "/resources/logo_32.png");
    break;
  default:
    break;
}
// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
/** @type {{ width: number; height: number; maximized: boolean; zoomLevel: number}} */
const windowState = {
  width: 1000,
  height: 670,
  maximized: false,
  zoomLevel: 0,
};
/** @type {electron.Config} */
let proxyConfig = {
  mode: "system",
};
const settingsReady = import("electron-store").then(({ default: Store }) => {
  store = new Store();
  Object.assign(windowState, store.get("windowState") || {});
  proxyConfig = store.get("proxyConfig") || proxyConfig;
});
const desktopApi = createDesktopApi({
  getMainWindow: () => mainWindow,
  getFloatingWindow: () => floatingWindow,
});

const FLOATING_WINDOW_DEFAULT_BOUNDS = {
  width: 1000,
  height: 70,
};

/**
 * @param {Electron.Rectangle | undefined} bounds
 * @param {Electron.Display} display
 * @returns {Electron.Rectangle | undefined}
 */
function normalizeFloatingWindowBounds(bounds, display) {
  if (bounds == null) {
    return undefined;
  }

  const getNumber = (value, fallback) =>
    Number.isFinite(value) ? value : fallback;
  const storedWidth = getNumber(
    bounds.width,
    FLOATING_WINDOW_DEFAULT_BOUNDS.width
  );
  const width = Math.min(
    Math.max(storedWidth, 640),
    Math.min(display.workAreaSize.width, 1200)
  );
  const height = FLOATING_WINDOW_DEFAULT_BOUNDS.height;
  const storedX = getNumber(bounds.x, display.workArea.x);
  const storedY = getNumber(bounds.y, display.workArea.y);
  const x = Math.min(
    Math.max(storedX, display.workArea.x),
    display.workArea.x + display.workArea.width - width
  );
  const y = Math.min(
    Math.max(storedY, display.workArea.y),
    display.workArea.y + display.workArea.height - height
  );

  return {
    x,
    y,
    width,
    height,
  };
}

const globalShortcutMapping = {
  "CmdOrCtrl+Alt+Left": "left",
  "CmdOrCtrl+Alt+Right": "right",
  "CmdOrCtrl+Alt+Space": "space",
  MediaNextTrack: "right",
  MediaPreviousTrack: "left",
  MediaPlayPause: "space",
};
/**
 * @param {electron.BrowserWindow} mainWindow
 * @param {{ title: string; artist: string; }} [track]
 */
function initialTray(mainWindow, track) {
  track ||= {
    title: "暂无歌曲",
    artist: "  ",
  };

  let nowPlayingTitle = `${track.title}`;
  let nowPlayingArtist = `歌手: ${track.artist}`;

  function toggleVisiable() {
    mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  }
  const menuTemplate = [
    {
      label: nowPlayingTitle,
      click() {
        mainWindow.show();
      },
    },
    {
      label: nowPlayingArtist,
      click() {
        mainWindow.show();
      },
    },
    { type: "separator" },
    {
      label: "播放/暂停",
      click() {
        mainWindow.webContents.send("globalShortcut", "space");
      },
    },
    {
      label: "上一首",
      click() {
        mainWindow.webContents.send("globalShortcut", "left");
      },
    },
    {
      label: "下一首",
      click() {
        mainWindow.webContents.send("globalShortcut", "right");
      },
    },
    {
      label: "显示/隐藏窗口",
      click() {
        toggleVisiable();
      },
    },
    {
      label: "退出",
      click() {
        app.quit();
      },
    },
  ];

  const contextMenu = Menu.buildFromTemplate(menuTemplate);

  if (appTray?.destroy != undefined) {
    // appTray had create, just refresh tray menu here
    appTray?.setContextMenu(contextMenu);
    return;
  }

  appTray = new Tray(trayIconPath);
  appTray.setContextMenu(contextMenu);
  appTray.on("click", () => {
    toggleVisiable();
  });
}

/**
 * @param {string | electron.Accelerator} key
 * @param {string} message
 */
function setKeyMapping(key, message) {
  globalShortcut.register(key, () => {
    mainWindow.webContents.send("globalShortcut", message);
  });
}

function enableGlobalShortcuts() {
  // initial global shortcuts
  for (const [key, value] of Object.entries(globalShortcutMapping)) {
    setKeyMapping(key, value);
  }
}

function disableGlobalShortcuts() {
  globalShortcut.unregisterAll();
}
/**
 * @param {string} cssStyle
 */
async function updateFloatingWindow(cssStyle) {
  if (cssStyle === undefined) {
    return;
  }
  try {
    const newCssKey = await floatingWindow.webContents.insertCSS(cssStyle, {
      cssOrigin: "author",
    });
    if (floatingWindowCssKey !== undefined) {
      await floatingWindow.webContents.removeInsertedCSS(floatingWindowCssKey);
    }
    floatingWindowCssKey = newCssKey;
  } catch (err) {
    console.log(err);
  }
}
/**
 * @param {electron.Config} params
 */
async function updateProxyConfig(params) {
  proxyConfig = params;

  await mainWindow.webContents.session.setProxy(params);
  await mainWindow.webContents.session.forceReloadProxyConfig();
}
/**
 * @param {string} cssStyle
 */
function createFloatingWindow(cssStyle) {
  const display = screen.getPrimaryDisplay();
  if (process.platform === "linux") {
    // fix transparent window not working in linux bug
    floatingWindow?.destroy();
    floatingWindow = null;
  }
  if (!floatingWindow) {
    /** @type {Electron.Rectangle} */
    const winBounds = normalizeFloatingWindowBounds(
      store.get("floatingWindowBounds"),
      display
    );

    floatingWindow = new BrowserWindow({
      width: FLOATING_WINDOW_DEFAULT_BOUNDS.width,
      height: FLOATING_WINDOW_DEFAULT_BOUNDS.height,
      titleBarStyle: "hidden",
      transparent: true,
      frame: false,
      resizable: false,
      thickFrame: false,
      hasShadow: false,
      alwaysOnTop: true,
      webPreferences: {
        sandbox: true,
        preload: join(__dirname, "preload.js"),
      },
      ...winBounds,
    });

    if (winBounds === undefined) {
      floatingWindow.setPosition(
        floatingWindow.getPosition()[0],
        display.bounds.height - 150
      );
    }
    floatingWindow.setVisibleOnAllWorkspaces(true);
    floatingWindow.setSkipTaskbar(true);
    floatingWindow.loadURL(`file://${__dirname}/floatingWindow.html`);
    floatingWindow.setAlwaysOnTop(true, "floating");
    floatingWindow.setIgnoreMouseEvents(false);
    floatingWindow.webContents.on("did-finish-load", async () => {
      await updateFloatingWindow(cssStyle);
    });
    floatingWindow.on("closed", () => {
      floatingWindow = null;
    });

    // floatingWindow.webContents.openDevTools();
  }
  floatingWindow.showInactive();
}

const previousButton = {
  tooltip: "Previous",
  icon: join(__dirname, "/resources/prev-song.png"),
  click() {
    mainWindow.webContents.send("globalShortcut", "left");
  },
};
const nextButton = {
  tooltip: "Next",
  icon: join(__dirname, "/resources/next-song.png"),
  click() {
    mainWindow.webContents.send("globalShortcut", "right");
  },
};
const playButton = {
  tooltip: "Play",
  icon: join(__dirname, "/resources/play-song.png"),
  click() {
    mainWindow.webContents.send("globalShortcut", "space");
  },
};
const pauseButton = {
  tooltip: "Pause",
  icon: join(__dirname, "/resources/pause-song.png"),
  click() {
    mainWindow.webContents.send("globalShortcut", "space");
  },
};
const setThumbarPause = () => {
  mainWindow?.setThumbarButtons([previousButton, playButton, nextButton]);
};
const setThumbbarPlay = () => {
  mainWindow?.setThumbarButtons([previousButton, pauseButton, nextButton]);
};

function createWindow() {
  const filter = {
    urls: [
      "*://*.music.163.com/*",
      "*://music.163.com/*",
      "*://*.xiami.com/*",
      "*://*.qq.com/*", // 【修改这行】拦截所有 qq.com 子域名，包含授权页
      "*://*.kugou.com/*",
      "*://*.kuwo.cn/*",
      "*://*.bilibili.com/*",
      "*://*.bilivideo.com/*",
      "*://*.bilivideo.cn/*",
      "*://*.migu.cn/*",
      "*://*.githubusercontent.com/*",
      "https://listen1.github.io/listen1/callback.html?code=*",
    ],
  };

  session.defaultSession.webRequest.onBeforeSendHeaders(
    filter,
    (details, callback) => {
      if (
        details.url.startsWith(
          "https://listen1.github.io/listen1/callback.html?code="
        )
      ) {
        const { url } = details;
        const code = new URL(url).searchParams.get("code");
        if (code && code.length < 1000)
          mainWindow.webContents.send("githubOAuthCode", code);
      } else {
        applyPlatformHeaders(details);
      }
      callback({ cancel: false, requestHeaders: details.requestHeaders });
    }
  );

  // 【新增核心代码：拦截并篡改响应头，修复跨域 Cookie 无法写入的问题】
  session.defaultSession.webRequest.onHeadersReceived(
    filter,
    (details, callback) => {
      let responseHeaders = details.responseHeaders;
      let cookies =
        responseHeaders["set-cookie"] || responseHeaders["Set-Cookie"];

      if (cookies) {
        // 遍历服务器发来的所有 Cookie
        const newCookies = cookies.map((cookie) => {
          let newCookie = cookie;
          // 强行注入 SameSite=None 和 Secure 属性，骗过新版 Chromium 的跨域安全拦截
          if (!newCookie.toLowerCase().includes("samesite")) {
            newCookie += "; SameSite=None";
          }
          if (!newCookie.toLowerCase().includes("secure")) {
            newCookie += "; Secure";
          }
          return newCookie;
        });

        // 将篡改后（允许跨域）的 Cookie 写回响应头
        if (responseHeaders["set-cookie"])
          responseHeaders["set-cookie"] = newCookies;
        if (responseHeaders["Set-Cookie"])
          responseHeaders["Set-Cookie"] = newCookies;
      }

      callback({ cancel: false, responseHeaders: responseHeaders });
    }
  );

  // Create the browser window.
  mainWindow = new BrowserWindow({
    show: !process.env.LISTEN1_TEST_USER_DATA,
    width: windowState.width,
    height: windowState.height,
    minHeight: 300,
    minWidth: 600,
    webPreferences: {
      preload: join(__dirname, "desktop-preload.js"),
      backgroundThrottling: !process.env.LISTEN1_TEST_USER_DATA,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
    icon: iconPath,
    titleBarStyle: "hiddenInset",
    transparent: transparent,
    vibrancy: "light",
    frame: false,
    hasShadow: true,
  });

  mainWindow.on("ready-to-show", () => {
    if (windowState.maximized) {
      mainWindow.maximize();
    }
    mainWindow.webContents.send("setZoomLevel", windowState.zoomLevel);
  });

  mainWindow.on("resized", () => {
    if (!mainWindow.isMaximized() && !mainWindow.isFullScreen()) {
      const [width, height] = mainWindow.getSize();
      windowState.width = width;
      windowState.height = height;
    }
  });
  mainWindow.on("close", (e) => {
    if (willQuitApp) {
      /* the user tried to quit the app */
      mainWindow = null;
    } else {
      /* the user only tried to close the window */
      //if (process.platform != 'linux') {
      e.preventDefault();
      mainWindow.hide();
      //mainWindow.minimize();
      //}
    }
  });

  // and load the index.html of the app.
  mainWindow.webContents.session
    .setProxy(proxyConfig)
    .then(() => {
      mainWindow.loadFile(
        join(__dirname, "listen1_chrome_extension/listen1.html")
      );
    })
    .catch((error) => {
      console.error(
        "Proxy initialization failed:",
        error.code || "PROXY_ERROR"
      );
      mainWindow.loadFile(
        join(__dirname, "listen1_chrome_extension/listen1.html")
      );
    });
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  setThumbarPause();
  // Emitted when the window is closed.
  mainWindow.on("closed", () => {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    mainWindow = null;
  });

  // define global menu content, also add support for cmd+c and cmd+v shortcuts
  const template = [
    {
      label: "Application",
      submenu: [
        {
          label: "Zoom Out",
          accelerator: "CmdOrCtrl+=",
          click() {
            if (windowState.zoomLevel <= 2.5) {
              windowState.zoomLevel += 0.5;
              mainWindow.webContents.send(
                "setZoomLevel",
                windowState.zoomLevel
              );
            }
          },
        },
        {
          label: "Zoom in",
          accelerator: "CmdOrCtrl+-",
          click() {
            if (windowState.zoomLevel >= -1) {
              windowState.zoomLevel -= 0.5;
              mainWindow.webContents.send(
                "setZoomLevel",
                windowState.zoomLevel
              );
            }
          },
        },
        {
          label: "Toggle Developer Tools",
          accelerator: "F12",
          click() {
            mainWindow.webContents.toggleDevTools();
          },
        },
        {
          label: "About Application",
          selector: "orderFrontStandardAboutPanel:",
        },
        { type: "separator" },
        {
          label: "Close Window",
          accelerator: "CmdOrCtrl+W",
          click() {
            mainWindow.close();
          },
        },
        {
          label: "Quit",
          accelerator: "Command+Q",
          click() {
            app.quit();
          },
        },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { label: "Undo", accelerator: "CmdOrCtrl+Z", selector: "undo:" },
        { label: "Redo", accelerator: "Shift+CmdOrCtrl+Z", selector: "redo:" },
        { type: "separator" },
        { label: "Cut", accelerator: "CmdOrCtrl+X", selector: "cut:" },
        { label: "Copy", accelerator: "CmdOrCtrl+C", selector: "copy:" },
        { label: "Paste", accelerator: "CmdOrCtrl+V", selector: "paste:" },
        {
          label: "Select All",
          accelerator: "CmdOrCtrl+A",
          selector: "selectAll:",
        },
      ],
    },
  ];

  mainWindow.setMenu(null);

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  initialTray(mainWindow);
}

ipcMain.on("currentLyric", (event, arg) => {
  if (
    !desktopApi.isMain(event) ||
    !(
      typeof arg === "string" ||
      (arg && typeof arg.lyric === "string" && typeof arg.tlyric === "string")
    )
  )
    return;
  if (floatingWindow && floatingWindow !== null) {
    if (typeof arg === "string") {
      floatingWindow.webContents.send("currentLyric", arg);
      floatingWindow.webContents.send("currentLyricTrans", "");
    } else {
      floatingWindow.webContents.send("currentLyric", arg.lyric);
      floatingWindow.webContents.send("currentLyricTrans", arg.tlyric);
    }
  }
});

ipcMain.on("trackPlayingNow", (event, track) => {
  if (!desktopApi.isMain(event) || !track || typeof track.title !== "string")
    return;
  if (mainWindow != null) {
    initialTray(mainWindow, track);
  }
});

ipcMain.on("isPlaying", (event, isPlaying) => {
  if (!desktopApi.isMain(event) || typeof isPlaying !== "boolean") return;
  isPlaying ? setThumbbarPlay() : setThumbarPause();
});

async function handleControl(event, arg, params) {
  if (!desktopApi.validControl(event, arg, params))
    throw new Error("Unsupported desktop control");
  switch (arg) {
    case "enable_global_shortcut":
      enableGlobalShortcuts();
      break;

    case "disable_global_shortcut":
      disableGlobalShortcuts();
      break;

    case "enable_lyric_floating_window":
      createFloatingWindow(params);
      break;

    case "disable_lyric_floating_window":
      floatingWindow?.hide();
      break;

    case "window_min":
      mainWindow.minimize();
      break;

    case "window_max":
      windowState.maximized ? mainWindow.unmaximize() : mainWindow.maximize();
      windowState.maximized = !windowState.maximized;
      break;

    case "window_close":
      mainWindow.close();
      break;

    case "float_window_accept_mouse_event":
      floatingWindow?.setIgnoreMouseEvents(false);
      break;

    case "float_window_ignore_mouse_event":
      floatingWindow?.setIgnoreMouseEvents(true, { forward: true });
      break;

    case "float_window_close":
    case "float_window_font_small":
    case "float_window_font_large":
    case "float_window_background_light":
    case "float_window_background_dark":
    case "float_window_font_change_color":
      mainWindow.webContents.send("lyricWindow", arg);
      break;

    case "update_lyric_floating_window_css":
      await updateFloatingWindow(params);
      break;

    case "get_proxy_config":
      mainWindow.webContents.send("proxyConfig", proxyConfig);
      break;

    case "update_proxy_config":
      await updateProxyConfig(params);
      break;

    default:
      break;
  }
  // event.sender.send('asynchronous-reply', 'pong')
}
ipcMain.handle("desktop:control", handleControl);
ipcMain.on("control", (event, arg, params) => {
  handleControl(event, arg, params).catch(() => {});
});

ipcMain.on("floatWindowMoving", (e, offsets) => {
  if (
    !desktopApi.isFloating(e) ||
    !offsets ||
    !Number.isFinite(offsets.mouseX) ||
    !Number.isFinite(offsets.mouseY)
  )
    return;
  const { mouseX, mouseY } = offsets;
  const { x, y } = screen.getCursorScreenPoint();
  if (!floatingWindow) {
    return;
  }

  const display = screen.getDisplayNearestPoint({ x, y });
  const width = Math.min(
    FLOATING_WINDOW_DEFAULT_BOUNDS.width,
    display.workArea.width
  );
  const height = FLOATING_WINDOW_DEFAULT_BOUNDS.height;
  const nextX = Math.min(
    Math.max(x - mouseX, display.workArea.x),
    display.workArea.x + display.workArea.width - width
  );
  const nextY = Math.min(
    Math.max(y - mouseY, display.workArea.y),
    display.workArea.y + display.workArea.height - height
  );

  floatingWindow.setBounds({ x: nextX, y: nextY, width, height });
});

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      // When start a new instance, show the main window and active in taskbar.
      mainWindow.show();
      mainWindow.setSkipTaskbar(false);
    }
  });

  // Create myWindow, load the rest of the app, etc...
  app
    .whenReady()
    .then(() => settingsReady)
    .then(() => {
      createWindow();
      if (app.isPackaged && !process.env.LISTEN1_TEST_USER_DATA)
        autoUpdater.checkForUpdatesAndNotify().catch(() => {});
    })
    .catch((error) => {
      console.error(
        "Application initialization failed:",
        error.code || error.message
      );
      app.quit();
    });
}

// Quit when all windows are closed.
app.on("window-all-closed", () => {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== "darwin") {
    app.quit();
  }
});

/* 'activate' is emitted when the user clicks the Dock icon (OS X) */
app.on("activate", () => {
  if (mainWindow) mainWindow.show();
});

/* 'before-quit' is emitted when Electron receives
 * the signal to exit and wants to start closing windows */
app.on("before-quit", () => {
  if (
    mainWindow &&
    !mainWindow.isDestroyed() &&
    mainWindow.webContents.isDevToolsOpened()
  ) {
    mainWindow.webContents.closeDevTools();
  }
  if (floatingWindow && store) {
    store.set("floatingWindowBounds", floatingWindow.getBounds());
  }
  if (store) {
    store.set("windowState", windowState);
    store.set("proxyConfig", proxyConfig);
  }

  willQuitApp = true;
});

app.on("will-quit", () => {
  disableGlobalShortcuts();
});
