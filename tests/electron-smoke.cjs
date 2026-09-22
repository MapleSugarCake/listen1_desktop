const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { _electron } = require("playwright");
const { writeAudioFixtures } = require("./fixtures.cjs");
const root = path.resolve(__dirname, "..");
const output = path.join(
  root,
  "dist/maintenance",
  process.env.LISTEN1_SMOKE_RUN || "electron-smoke"
);
const report = { date: new Date().toISOString(), checks: [], errors: [] };
const wait = (page, fn, arg = null, timeout = 8000) =>
  page.waitForFunction(fn, arg, { polling: 100, timeout });
async function main() {
  fs.mkdirSync(output, { recursive: true });
  const fixtures = writeAudioFixtures(path.join(output, "fixtures"));
  const profile = path.join(output, "profile");
  fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(
    path.join(profile, "config.json"),
    JSON.stringify({
      windowState: { width: 1000, height: 670, maximized: false, zoomLevel: 0 },
      proxyConfig: { mode: "direct" },
    })
  );
  const launch = () =>
    _electron.launch({
      executablePath: process.env.LISTEN1_TEST_EXE || require("electron"),
      args: process.env.LISTEN1_TEST_EXE
        ? []
        : [path.join(__dirname, "electron-entry.cjs")],
      env: { ...process.env, LISTEN1_TEST_USER_DATA: profile },
    });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    page.on("pageerror", (error) => report.errors.push(error.message));
    await wait(
      page,
      () => window.l1Player && angular.element(document.body).injector()
    );
    const check = async (name, fn) => {
      const start = Date.now();
      await fn();
      report.checks.push({
        name,
        status: "passed",
        elapsedMs: Date.now() - start,
      });
      console.log(name);
    };
    report.runtime = await app.evaluate(() => process.versions);
    await check("isolated renderer and IPC sender validation", async () => {
      assert.deepEqual(
        await page.evaluate(() => ({
          require: typeof require,
          process: typeof process,
          bridge: listen1Desktop.version,
        })),
        { require: "undefined", process: "undefined", bridge: 1 }
      );
      const rejected = await page.evaluate(async () => {
        try {
          await listen1Desktop.openLogin("https://example.invalid/");
          return false;
        } catch {
          return true;
        }
      });
      assert.equal(rejected, true);
    });
    await check(
      "old queue and playlists restore without a storage migration",
      async () => {
        await page.evaluate(({ audio }) => {
          const track = {
            id: `lmtrack_${audio}`,
            title: "Old title",
            artist: "",
            source: "localmusic",
            sound_url: `file://${audio}`,
          };
          localStorage.setObject("current-playing", [track]);
          localStorage.setObject("player-settings", {
            volume: 5,
            playmode: 0,
            nowplaying_track_id: track.id,
          });
          localStorage.setObject("playerlists", ["myplaylist_fixture"]);
          localStorage.setObject("myplaylist_fixture", {
            is_mine: 1,
            info: { id: "myplaylist_fixture", title: "旧歌单" },
            tracks: [track],
          });
        }, fixtures);
        await page.reload();
        await wait(page, () => threadPlayer.playlist.length === 1);
        assert.equal(
          await page.evaluate(
            () => localStorage.getObject("myplaylist_fixture").tracks.length
          ),
          1
        );
      }
    );
    await check(
      "local file dialog result → ESM tags → batch playlist → playback and lyrics",
      async () => {
        await app.evaluate(
          ({ dialog }, paths) => {
            dialog.showOpenDialog = async () => ({
              canceled: false,
              filePaths: paths,
            });
          },
          [fixtures.audio, fixtures.plain, fixtures.broken]
        );
        await page.evaluate(() =>
          angular
            .element(
              document.querySelector('[ng-controller="NavigationController"]')
            )
            .scope()
            .addLocalMusic()
        );
        await wait(
          page,
          () =>
            localStorage.getObject("lmplaylist_reserve")?.tracks.length === 3
        );
        const tracks = await page.evaluate(
          () => localStorage.getObject("lmplaylist_reserve").tracks
        );
        const tagged = tracks.find(
          (track) => track.title === "Synthetic title"
        );
        assert.ok(tagged);
        assert.equal(tagged.artist, "Fixture artist");
        assert.match(tagged.sound_url, /%23/);
        assert.match(tagged.sound_url, /%25/);
        assert.match(tagged.lyrics[0], /合成歌词/);
        assert.ok(tracks.some((track) => track.title === "no-tags"));
        assert.ok(tracks.some((track) => track.title === "broken"));
        await page.evaluate((track) => {
          l1Player.setNewPlaylist([track]);
          l1Player.play();
        }, tagged);
        await wait(
          page,
          () => threadPlayer.playing && threadPlayer.currentHowl.seek() > 1
        );
        assert.equal(
          await app.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()[0].webContents.isCurrentlyAudible()
          ),
          true
        );
        await page.evaluate(() => l1Player.pause());
        await wait(page, () => !threadPlayer.playing);
        await page.evaluate(() => {
          l1Player.seek(0.5);
          l1Player.play();
        });
        await wait(
          page,
          () => threadPlayer.playing && threadPlayer.currentHowl.seek() >= 20
        );
        await page.evaluate(() => l1Player.pause());
      }
    );
    await check(
      "all themes preserve a single player listener and keyboard binding",
      async () => {
        await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].showInactive()
        );
        const listenerCount = await page.evaluate(
          () => frontPlayerListener.length
        );
        for (const theme of ["white2", "black2", "black", "white"]) {
          await page.evaluate((theme) => {
            const scope = angular
              .element(
                document.querySelector('[ng-controller="ProfileController"]')
              )
              .scope();
            scope.$apply(() => scope.setTheme(theme));
          }, theme);
          await wait(
            page,
            (theme) =>
              document.getElementById("theme-css").sheet?.href?.includes(
                {
                  white: "iparanoid.css",
                  black: "origin.css",
                  white2: "iparanoid2.css",
                  black2: "origin2.css",
                }[theme]
              ),
            theme
          );
          assert.equal(
            await page.evaluate(() => frontPlayerListener.length),
            listenerCount
          );
          await page.screenshot({
            path: path.join(output, `theme-${theme}.png`),
            timeout: 8000,
            animations: "disabled",
          });
        }
        await page.evaluate(() => l1Player.unmute());
        await page.keyboard.press("m");
        assert.equal(await page.evaluate(() => threadPlayer.muted), true);
        await page.keyboard.press("m");
        assert.equal(await page.evaluate(() => threadPlayer.muted), false);
      }
    );
    await check("language switching and restart persistence", async () => {
      for (const language of [
        "zh-TC",
        "en-US",
        "fr-FR",
        "ko-KR",
        "pt-BR",
        "zh-CN",
      ]) {
        await page.evaluate(
          (language) =>
            angular
              .element(
                document.querySelector('[ng-controller="ProfileController"]')
              )
              .scope()
              .setLang(language),
          language
        );
        await wait(
          page,
          (language) =>
            localStorage.getObject("language") === language &&
            i18next.language === language,
          language
        );
      }
      await page.evaluate(() =>
        angular
          .element(
            document.querySelector('[ng-controller="ProfileController"]')
          )
          .scope()
          .setLang("fr-FR")
      );
      await wait(page, () => localStorage.getObject("language") === "fr-FR");
      await page.reload();
      await wait(page, () => i18next.language === "fr-FR" && window.l1Player);
    });
    await check(
      "queue insertion emits one complete snapshot for 1,000 tracks",
      async () => {
        report.queue = await page.evaluate(() => {
          l1Player.clearPlaylist();
          const snapshots = [];
          const remove = addPlayerListener("front", (msg) => {
            if (msg.type === "BG_PLAYER:PLAYLIST")
              snapshots.push(msg.data.length);
          });
          const started = performance.now();
          l1Player.addTracks(
            Array.from({ length: 1000 }, (_, id) => ({
              id: `netrack_test${id}`,
              title: `Test ${id}`,
              source: "netease",
            }))
          );
          const elapsedMs = performance.now() - started;
          remove();
          return { snapshots, elapsedMs };
        });
        assert.deepEqual(report.queue.snapshots, [1000]);
        await page.evaluate(() => l1Player.clearPlaylist());
      }
    );
    await check(
      "JSON backup round trip and malformed backup rejection",
      async () => {
        const backup = await page.evaluate(() => {
          const scope = angular
            .element(
              document.querySelector('[ng-controller="NavigationController"]')
            )
            .scope();
          let exported;
          const download = scope.downloadFile;
          scope.downloadFile = (_name, _type, content) => {
            exported = content;
          };
          scope.backupMySettings();
          scope.downloadFile = download;
          localStorage.removeItem("myplaylist_fixture");
          return exported;
        });
        await page.evaluate(async (text) => {
          const scope = angular
            .element(
              document.querySelector('[ng-controller="NavigationController"]')
            )
            .scope();
          scope.importMySettings({
            target: {
              files: [
                new File([text], "backup.json", { type: "application/json" }),
              ],
            },
          });
        }, backup);
        await wait(
          page,
          () =>
            localStorage.getObject("myplaylist_fixture")?.info.title ===
            "旧歌单"
        );
        await page.evaluate(() => {
          const scope = angular
            .element(
              document.querySelector('[ng-controller="NavigationController"]')
            )
            .scope();
          scope.importMySettings({ target: { files: [] } });
          scope.importMySettings({
            target: { files: [new File(["null"], "invalid.json")] },
          });
        });
        assert.equal(
          await page.evaluate(
            () => localStorage.getObject("myplaylist_fixture").info.title
          ),
          "旧歌单"
        );
      }
    );
    await check(
      "offline search and playlist failures finish without unhandled errors",
      async () => {
        await page.context().setOffline(true);
        await page.evaluate(() => {
          const search = angular
            .element(
              document.querySelector(
                '[ng-controller="InstantSearchController"]'
              )
            )
            .scope();
          search.$apply(() => {
            search.keywords = "offline fixture";
          });
          angular
            .element(
              document.querySelector('[ng-controller="PlayListController"]')
            )
            .scope()
            .loadPlaylist();
        });
        await wait(
          page,
          () => {
            const search = angular
              .element(
                document.querySelector(
                  '[ng-controller="InstantSearchController"]'
                )
              )
              .scope();
            const playlists = angular
              .element(
                document.querySelector('[ng-controller="PlayListController"]')
              )
              .scope();
            return (
              !search.loading &&
              search.searchError === "NETWORK" &&
              !playlists.loading
            );
          },
          null,
          17000
        );
        await page.context().setOffline(false);
      }
    );
    await check(
      "lyrics bridge, text rendering, translation, style and close",
      async () => {
        await page.evaluate(() =>
          listen1Desktop.control(
            "enable_lyric_floating_window",
            "div.content { font-size: 22px; }"
          )
        );
        const floating = await app
          .waitForEvent("window", {
            predicate: (candidate) => candidate !== page,
            timeout: 5000,
          })
          .catch(() => app.windows().find((candidate) => candidate !== page));
        assert.ok(floating);
        await floating.waitForLoadState("domcontentloaded");
        await page.evaluate(() =>
          listen1Desktop.setLyric({
            lyric: "<b>原文</b>",
            tlyric: "translation",
          })
        );
        await wait(
          floating,
          () =>
            document.body.textContent.includes("<b>原文</b>") &&
            document.body.textContent.includes("translation")
        );
        assert.equal(await floating.locator("b").count(), 0);
        await floating.evaluate(() =>
          window.api.send("control", "float_window_ignore_mouse_event")
        );
        await page.evaluate(() =>
          listen1Desktop.control("disable_lyric_floating_window")
        );
      }
    );
    await check(
      "direct/system/custom proxy settings and close hides window",
      async () => {
        for (const config of [
          { mode: "system" },
          { proxyRules: "http://localhost:7890" },
          { mode: "direct" },
        ])
          await page.evaluate(
            (config) => listen1Desktop.control("update_proxy_config", config),
            config
          );
        await page.evaluate(() => listen1Desktop.control("window_close"));
        assert.equal(
          await app.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()
              .find((window) =>
                window.webContents.getURL().includes("listen1.html")
              )
              .isVisible()
          ),
          false
        );
      }
    );
    await check(
      "second instance exits and restores the existing window",
      async () => {
        const second = spawn(
          process.env.LISTEN1_TEST_EXE || require("electron"),
          process.env.LISTEN1_TEST_EXE
            ? []
            : [path.join(__dirname, "electron-entry.cjs")],
          {
            env: { ...process.env, LISTEN1_TEST_USER_DATA: profile },
            windowsHide: true,
            stdio: "ignore",
          }
        );
        const code = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            second.kill();
            reject(new Error("Second instance did not exit"));
          }, 10000);
          second.once("error", (error) => {
            clearTimeout(timer);
            reject(error);
          });
          second.once("exit", (code) => {
            clearTimeout(timer);
            resolve(code);
          });
        });
        assert.equal(code, 0);
        assert.equal(
          await app.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()
              .find((window) =>
                window.webContents.getURL().includes("listen1.html")
              )
              .isVisible()
          ),
          true
        );
      }
    );
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await wait(page, () => window.l1Player && i18next.language === "fr-FR");
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(profile, "config.json"), "utf8"))
        .proxyConfig.mode,
      "direct"
    );
    report.checks.push({
      name: "application restart and desktop config persistence",
      status: "passed",
    });
    assert.deepEqual(report.errors, []);
  } finally {
    if (app) await app.close();
    fs.writeFileSync(
      path.join(output, "report.json"),
      JSON.stringify(report, null, 2)
    );
  }
}
main().catch((error) => {
  report.failure = error.stack;
  fs.writeFileSync(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2)
  );
  console.error(error);
  process.exitCode = 1;
});
