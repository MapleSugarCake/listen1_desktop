const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { applyPlatformHeaders } = require("../app/request-headers");

function harness() {
  const handlers = {},
    directory = path.resolve(__dirname, "../app");
  const frame = {
    url: pathToFileURL(
      path.join(directory, "listen1_chrome_extension/listen1.html")
    ).href,
  };
  const sender = { mainFrame: frame },
    window = { webContents: sender, isDestroyed: () => false };
  const event = { sender, senderFrame: frame };
  let active = 0,
    maximum = 0;
  const context = {
    module: { exports: {} },
    __dirname: directory,
    URL,
    require(name) {
      if (name === "electron")
        return {
          ipcMain: {
            handle: (name, fn) => {
              handlers[name] = fn;
            },
          },
          dialog: {
            showOpenDialog: async () => ({
              canceled: false,
              filePaths: Array.from(
                { length: 17 },
                (_, i) => `C:/fixtures/中文 #${i}.wav`
              ),
            }),
          },
          session: { defaultSession: { cookies: { get: async () => [] } } },
        };
      if (name === "./functions")
        return {
          readAudioTags: async () => {
            active += 1;
            maximum = Math.max(maximum, active);
            await new Promise((resolve) => setTimeout(resolve, 3));
            active -= 1;
            return { common: { title: "fixture" } };
          },
        };
      return require(name);
    },
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(directory, "desktop-api.js"), "utf8"),
    context
  );
  const api = context.module.exports.createDesktopApi({
    getMainWindow: () => window,
    getFloatingWindow: () => null,
  });
  return { handlers, event, api, maximum: () => maximum };
}

test("desktop methods reject other windows, subframes, invalid URLs and controls", async () => {
  const { api, handlers, event } = harness();
  assert.equal(api.isMain(event), true);
  assert.equal(
    api.isMain({ ...event, senderFrame: { ...event.senderFrame } }),
    false
  );
  assert.equal(api.validControl(event, "arbitrary", {}), false);
  assert.equal(
    api.validControl(
      event,
      "update_lyric_floating_window_css",
      "@import url(https://invalid/)"
    ),
    false
  );
  await assert.rejects(
    handlers["desktop:cookieGet"]({ ...event, sender: {} }, {}),
    /Untrusted/
  );
  await assert.rejects(
    handlers["desktop:cookieGet"](event, {
      url: "https://qq.com.evil.invalid",
      name: "test",
    }),
    /Invalid cookie/
  );
  await assert.rejects(
    handlers["desktop:openLogin"](event, "file:///C:/test.html"),
    /Unsupported/
  );
});

test("local import limits metadata concurrency to four and returns encoded file URLs", async () => {
  const { handlers, event, maximum } = harness();
  const result = await handlers["desktop:importLocalMusic"](event);
  assert.equal(maximum(), 4);
  assert.equal(result.tracks.length, 17);
  assert.match(result.tracks[0].sound_url, /%23/);
  assert.equal(result.tracks[0].id, "lmtrack_C:/fixtures/中文 #0.wav");
});

test("platform headers handle Electron objects case-insensitively and use a valid Origin", () => {
  const details = {
    url: "https://u.y.qq.com/cgi-bin/musicu.fcg",
    requestHeaders: { origin: "null", referer: "file://app" },
  };
  applyPlatformHeaders(details);
  assert.equal(details.requestHeaders.Origin, "https://y.qq.com");
  assert.equal(details.requestHeaders.Referer, "https://y.qq.com/");
  assert.equal(Object.keys(details.requestHeaders).length, 2);
  const unrelated = {
    url: "https://example.invalid/",
    requestHeaders: { Accept: "text/plain" },
  };
  applyPlatformHeaders(unrelated);
  assert.deepEqual(unrelated.requestHeaders, { Accept: "text/plain" });
});
