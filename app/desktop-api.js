const { ipcMain, dialog, shell, session, BrowserWindow } = require("electron");
const { pathToFileURL, fileURLToPath } = require("node:url");
const { resolve, basename, isAbsolute } = require("node:path");
const { readAudioTags } = require("./functions");

const cookieDomains = [
  "music.163.com",
  "qq.com",
  "kugou.com",
  "kuwo.cn",
  "bilibili.com",
  "migu.cn",
  "taihe.com",
  "91q.com",
];
const loginDomains = ["music.163.com", "qq.com", "migu.cn", "github.com"];
const controls = new Set([
  "enable_global_shortcut",
  "disable_global_shortcut",
  "enable_lyric_floating_window",
  "disable_lyric_floating_window",
  "window_min",
  "window_max",
  "window_close",
  "get_proxy_config",
  "update_proxy_config",
  "update_lyric_floating_window_css",
]);
const floatingControls = new Set([
  "float_window_accept_mouse_event",
  "float_window_ignore_mouse_event",
  "float_window_close",
  "float_window_font_small",
  "float_window_font_large",
  "float_window_background_light",
  "float_window_background_dark",
  "float_window_font_change_color",
]);

function allowedUrl(value, domains) {
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      (!domains ||
        domains.some(
          (domain) =>
            url.hostname === domain || url.hostname.endsWith(`.${domain}`)
        ))
    );
  } catch {
    return false;
  }
}

function createDesktopApi({ getMainWindow, getFloatingWindow }) {
  const matches = (event, window, file) => {
    if (
      !window ||
      window.isDestroyed() ||
      event.sender !== window.webContents ||
      event.senderFrame !== event.sender.mainFrame
    )
      return false;
    try {
      return (
        resolve(fileURLToPath(event.senderFrame.url)) ===
        resolve(__dirname, file)
      );
    } catch {
      return false;
    }
  };
  const isMain = (event) =>
    matches(event, getMainWindow(), "listen1_chrome_extension/listen1.html");
  const isFloating = (event) =>
    matches(event, getFloatingWindow(), "floatingWindow.html");
  const validControl = (event, operation, params) => {
    if (isFloating(event)) return floatingControls.has(operation);
    if (!isMain(event) || !controls.has(operation)) return false;
    if (
      operation.includes("css") ||
      operation === "enable_lyric_floating_window"
    )
      return (
        typeof params === "string" &&
        params.length <= 20000 &&
        !/@import|url\s*\(/i.test(params)
      );
    if (operation === "update_proxy_config")
      return (
        !!params &&
        (["system", "direct"].includes(params.mode) ||
          (typeof params.proxyRules === "string" &&
            /^(https?|socks[45]|quic):\/\/[^\s/@]+:\d{1,5}$/.test(
              params.proxyRules
            )))
      );
    return true;
  };
  const handle = (channel, fn) =>
    ipcMain.handle(channel, async (event, ...args) => {
      if (!isMain(event)) throw new Error("Untrusted desktop caller");
      return fn(...args);
    });
  handle("desktop:openExternal", async (url) => {
    if (!allowedUrl(url)) throw new Error("Unsupported external URL");
    await shell.openExternal(url);
  });
  handle("desktop:openLogin", async (url) => {
    if (!allowedUrl(url, loginDomains))
      throw new Error("Unsupported login URL");
    const window = new BrowserWindow({
      parent: getMainWindow(),
      width: 985,
      height: 700,
      autoHideMenuBar: true,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    window.webContents.on("will-navigate", (event, target) => {
      if (
        !allowedUrl(target, loginDomains) &&
        !target.startsWith("https://listen1.github.io/listen1/callback.html?")
      )
        event.preventDefault();
    });
    window.webContents.setWindowOpenHandler(({ url: target }) => {
      if (allowedUrl(target, loginDomains))
        window.loadURL(target).catch(() => {});
      return { action: "deny" };
    });
    await window.loadURL(url);
  });
  function cookieDetails(input, set) {
    if (
      !input ||
      !allowedUrl(input.url, cookieDomains) ||
      typeof input.name !== "string" ||
      !input.name ||
      input.name.length > 256
    )
      throw new Error("Invalid cookie request");
    const details = { url: input.url, name: input.name };
    if (!set) return details;
    if (typeof input.value !== "string" || input.value.length > 16384)
      throw new Error("Invalid cookie value");
    details.value = input.value;
    if (input.domain) {
      const domain = input.domain.replace(/^\./, "");
      const hostname = new URL(input.url).hostname;
      if (hostname !== domain && !hostname.endsWith(`.${domain}`))
        throw new Error("Invalid cookie domain");
      details.domain = input.domain;
    }
    if (typeof input.path === "string" && input.path.startsWith("/"))
      details.path = input.path;
    for (const key of ["secure", "httpOnly"])
      if (typeof input[key] === "boolean") details[key] = input[key];
    if (
      ["unspecified", "no_restriction", "lax", "strict"].includes(
        input.sameSite
      )
    )
      details.sameSite = input.sameSite;
    if (details.sameSite === "no_restriction") details.secure = true;
    if (Number.isFinite(input.expirationDate))
      details.expirationDate = Math.min(
        input.expirationDate,
        Date.now() / 1000 + 400 * 86400
      );
    return details;
  }
  handle(
    "desktop:cookieGet",
    async (input) =>
      (
        await session.defaultSession.cookies.get(cookieDetails(input, false))
      )[0] || null
  );
  handle("desktop:cookieSet", async (input) =>
    session.defaultSession.cookies.set(cookieDetails(input, true))
  );
  handle("desktop:cookieRemove", async (input) => {
    const details = cookieDetails(input, false);
    await session.defaultSession.cookies.remove(details.url, details.name);
  });
  handle("desktop:localFileUrl", (trackId) => {
    if (
      typeof trackId !== "string" ||
      !trackId.startsWith("lmtrack_") ||
      !isAbsolute(trackId.slice(8))
    )
      throw new Error("Invalid local track ID");
    return pathToFileURL(trackId.slice(8)).href;
  });
  handle("desktop:importLocalMusic", async () => {
    const selection = await dialog.showOpenDialog(getMainWindow(), {
      title: "添加歌曲",
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "Music Files",
          extensions: ["flac", "mp3", "mp4", "ogg", "wav", "webm"],
        },
      ],
    });
    if (selection.canceled) return { cancelled: true, tracks: [], errors: [] };
    const tracks = new Array(selection.filePaths.length),
      errors = [];
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, tracks.length) }, async () => {
        while (next < tracks.length) {
          const index = next++;
          const file = selection.filePaths[index];
          const metadata = await readAudioTags(file);
          const { common } = metadata;
          if (metadata.error)
            errors.push({ file: basename(file), code: metadata.error.code });
          tracks[index] = {
            id: `lmtrack_${file}`,
            title: common.title,
            artist: common.artist || "",
            artist_id: `lmartist_${common.artist || ""}`,
            album: common.album || "",
            album_id: `lmalbum_${common.album || ""}`,
            source: "localmusic",
            source_url: "",
            img_url: "",
            lyrics: common.lyrics || [],
            sound_url: pathToFileURL(file).href,
          };
        }
      })
    );
    return { cancelled: false, tracks, errors };
  });
  return { isMain, isFloating, validControl };
}
module.exports = { createDesktopApi, allowedUrl };
