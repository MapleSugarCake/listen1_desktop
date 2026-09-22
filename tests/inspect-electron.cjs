const fs = require("node:fs");
const path = require("node:path");
const { _electron } = require("playwright");
const root = path.resolve(__dirname, "..");
const run = process.env.LISTEN1_AUDIT_RUN || "baseline";
const output = path.join(root, "dist/maintenance", run);
const report = {
  run,
  date: new Date().toISOString(),
  errors: [],
  platforms: [],
  playback: [],
  network: [],
};
const safe = (value) =>
  String(value)
    .replace(/https?:\/\/[^\s"']+/g, "[URL]")
    .slice(0, 350);

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const start = Date.now();
  const app = await _electron.launch({
    executablePath: path.join(root, "node_modules/electron/dist/electron.exe"),
    args: [path.join(__dirname, "electron-entry.cjs")],
    env: {
      ...process.env,
      NODE_PATH: path.join(root, "app/node_modules"),
      LISTEN1_TEST_USER_DATA: path.join(output, "profile"),
      ELECTRON_ENABLE_LOGGING: "1",
    },
    timeout: 25000,
  });
  try {
    const page = await app.firstWindow();
    page.on("pageerror", (error) => report.errors.push(safe(error.stack)));
    page.on("response", async (response) => {
      try {
        const url = new URL(response.url());
        if (
          !/163\.com|qq\.com|kugou\.com|kuwo\.cn|bilibili\.com|migu\.cn/.test(
            url.hostname
          )
        )
          return;
        if (
          !/search|musicu|playurl|playUrl|enhance|resource|SongInfo/i.test(
            url.pathname
          )
        )
          return;
        const entry = {
          host: url.hostname,
          path: url.pathname,
          status: response.status(),
        };
        if (!/audio|video/.test(response.headers()["content-type"] || "")) {
          const body = await response.json().catch(() => null);
          if (body) {
            entry.code =
              body.code ??
              body.status ??
              body.req?.code ??
              body.req_0?.code ??
              body.req_1?.code;
            entry.message = safe(body.message ?? body.msg ?? body.errmsg ?? "");
          }
        }
        report.network.push(entry);
      } catch {}
    });
    await page.waitForLoadState("domcontentloaded");
    await page.waitForFunction(
      () =>
        typeof angular !== "undefined" &&
        !!window.l1Player &&
        !!angular.element(document.body).injector() &&
        threadPlayer.mode === "front",
      null,
      { timeout: 15000, polling: 100 }
    );
    report.startupMs = Date.now() - start;
    report.runtime = await app.evaluate(({ app }) => ({
      versions: process.versions,
      platform: process.platform,
      userData: app.getPath("userData"),
    }));
    report.window = await page.evaluate(() => ({
      title: document.title,
      width: innerWidth,
      height: innerHeight,
      electron: !!isElectron(),
      angular: angular.version.full,
    }));
    if (process.env.LISTEN1_AUDIT_SCREENSHOT === "1")
      await page.screenshot({
        path: path.join(output, "startup.png"),
        timeout: 10000,
      });
    console.log(
      JSON.stringify({
        run,
        startupMs: report.startupMs,
        runtime: report.runtime.versions.electron,
      })
    );
    if (process.env.LISTEN1_AUDIT_ONLINE !== "0") {
      await page.evaluate(() => {
        window.__auditEvents = [];
        addPlayerListener("front", (event) => {
          if (/FAIL|RETRIEVE_URL/.test(event.type))
            window.__auditEvents.push({
              type: event.type,
              id: event.data?.id,
              code: event.data?.error?.code,
              platform: event.data?.platform,
            });
        });
      });
      for (const source of [
        "netease",
        "qq",
        "kugou",
        "kuwo",
        "bilibili",
        "migu",
      ]) {
        const result = await page.evaluate(async (source) => {
          const started = performance.now();
          return new Promise((resolve) => {
            let done = false;
            const finish = (data) => {
              if (!done) {
                done = true;
                clearTimeout(timer);
                resolve({
                  source,
                  elapsedMs: Math.round(performance.now() - started),
                  ...data,
                });
              }
            };
            const timer = setTimeout(
              () => finish({ status: "timeout" }),
              18000
            );
            try {
              const task = MediaService.search(source, {
                keywords: "夜空中最亮的星",
                curpage: 1,
                type: 0,
              });
              task.success((data) => {
                window.__auditResults ||= {};
                window.__auditResults[source] = data.result;
                finish({
                  status: "response",
                  count: data.result.length,
                  total: data.total,
                  samples: data.result.slice(0, 2).map((t) => ({
                    id: t.id,
                    title: t.title,
                    artist: t.artist,
                    source: t.source,
                  })),
                });
              });
              if (task.error)
                task.error((error) =>
                  finish({
                    status: "error",
                    code: error.code,
                    message: error.message,
                  })
                );
            } catch (error) {
              finish({ status: "exception", message: error.message });
            }
          });
        }, source);
        report.platforms.push(result);
        fs.writeFileSync(
          path.join(output, "report.json"),
          JSON.stringify(report, null, 2)
        );
        console.log(JSON.stringify(result));
      }
      if (process.env.LISTEN1_AUDIT_PLAY === "1") {
        await page.evaluate(() =>
          localStorage.setObject("enable_auto_choose_source", false)
        );
        for (const platform of report.platforms) {
          for (const sample of platform.samples || []) {
            const started = Date.now();
            const item = {
              source: platform.source,
              id: sample.id,
              title: sample.title,
            };
            try {
              await page.evaluate(
                ({ source, id }) => {
                  window.__auditEvents = [];
                  const track = window.__auditResults[source].find(
                    (t) => t.id === id
                  );
                  l1Player.setNewPlaylist([track]);
                  l1Player.setVolume(30);
                  l1Player.unmute();
                  l1Player.playById(id);
                },
                { source: platform.source, id: sample.id }
              );
              await page.waitForFunction(
                () =>
                  window.threadPlayer.playing &&
                  Number(window.threadPlayer.currentHowl.seek()) > 0.2,
                null,
                { timeout: 18000, polling: 100 }
              );
              item.firstSoundMs = Date.now() - started;
              item.audible = await app.evaluate(({ BrowserWindow }) =>
                BrowserWindow.getAllWindows().some((w) =>
                  w.webContents.isCurrentlyAudible()
                )
              );
              await page.waitForFunction(
                () => Number(threadPlayer.currentHowl?.seek()) >= 5,
                null,
                { timeout: 10000, polling: 100 }
              );
              item.audible =
                item.audible ||
                (await app.evaluate(({ BrowserWindow }) =>
                  BrowserWindow.getAllWindows().some((w) =>
                    w.webContents.isCurrentlyAudible()
                  )
                ));
              await page.waitForFunction(
                () => Number(window.threadPlayer.currentHowl?.seek()) >= 30,
                null,
                { timeout: 38000, polling: 100 }
              );
              item.state = await page.evaluate(() => ({
                position: threadPlayer.currentHowl.seek(),
                duration: threadPlayer.currentHowl.duration(),
                platform: threadPlayer.currentAudio.platform,
                playing: threadPlayer.playing,
              }));
              await page.evaluate(() => l1Player.pause());
              item.paused = await page.evaluate(() => !threadPlayer.playing);
              await page.evaluate(() => {
                l1Player.seek(0.5);
                l1Player.play();
              });
              await page.waitForFunction(
                () =>
                  threadPlayer.playing &&
                  threadPlayer.currentHowl.seek() >=
                    threadPlayer.currentHowl.duration() * 0.48,
                null,
                { timeout: 5000, polling: 100 }
              );
              item.status = item.audible
                ? "audio-output-and-controls-confirmed"
                : "progress-only-audio-unverified";
            } catch (error) {
              item.status = "failed-or-unverified";
              item.error = safe(error.message);
            }
            item.events = await page.evaluate(() => window.__auditEvents);
            item.finalState = await page.evaluate(() => ({
              playing: threadPlayer.playing,
              position: threadPlayer.currentHowl?.seek(),
              duration: threadPlayer.currentHowl?.duration(),
              muted: threadPlayer.currentHowl?._sounds?.[0]?._node?.muted,
            }));
            await page.evaluate(() => l1Player.pause()).catch(() => {});
            report.playback.push(item);
            fs.writeFileSync(
              path.join(output, "report.json"),
              JSON.stringify(report, null, 2)
            );
            console.log(JSON.stringify(item));
          }
        }
      }
    }
  } finally {
    fs.writeFileSync(
      path.join(output, "report.json"),
      JSON.stringify(report, null, 2)
    );
    await app.close();
  }
}
main().catch((error) => {
  report.error = safe(error.stack);
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2)
  );
  console.error(report.error);
  process.exitCode = 1;
});
