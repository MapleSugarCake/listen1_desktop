const fs = require("node:fs");
const path = require("node:path");
const { _electron } = require("playwright");
const root = path.resolve(__dirname, "..");
async function main() {
  const output = path.join(root, "dist/maintenance/audio-diagnostic");
  fs.mkdirSync(output, { recursive: true });
  const app = await _electron.launch({
    executablePath: require("electron"),
    args: [path.join(__dirname, "electron-entry.cjs")],
    env: {
      ...process.env,
      LISTEN1_TEST_USER_DATA: path.join(output, "profile"),
    },
  });
  const results = [];
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(
      () => window.l1Player && angular.element(document.body).injector(),
      null,
      { polling: 100 }
    );
    await page.evaluate(() => {
      window.__muteTrace = [];
      const descriptor = Object.getOwnPropertyDescriptor(
        HTMLMediaElement.prototype,
        "muted"
      );
      Object.defineProperty(HTMLMediaElement.prototype, "muted", {
        ...descriptor,
        set(value) {
          if (value) window.__muteTrace.push(new Error("muted").stack);
          descriptor.set.call(this, value);
        },
      });
    });
    for (const version of ["2.2.4", "2.2.3"]) {
      if (version === "2.2.3") {
        await page.evaluate(() => {
          threadPlayer.clearPlaylist();
          Howler.unload();
        });
        await page.addScriptTag({
          path: path.join(
            root,
            "dist/maintenance/baseline/app/listen1_chrome_extension/js/vendor/howler.core.min.js"
          ),
        });
      }
      await page.evaluate(() => {
        localStorage.setObject("enable_auto_choose_source", false);
        l1Player.setNewPlaylist([
          {
            id: "kgtrack_33CA0759CA7738706894F08A8BE65CD7",
            title: "audio check",
            artist: "test",
            source: "kugou",
          },
        ]);
        l1Player.play();
      });
      for (let elapsed = 0; elapsed < 12; elapsed += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const state = await page.evaluate(() => {
          const howl = threadPlayer.currentHowl,
            audio = howl?._sounds?.[0]?._node;
          return {
            playing: threadPlayer.playing,
            pos: howl?.seek(),
            duration: howl?.duration(),
            state: howl?.state(),
            audio: audio && {
              paused: audio.paused,
              time: audio.currentTime,
              ready: audio.readyState,
              network: audio.networkState,
              error: audio.error?.code,
              muted: audio.muted,
              volume: audio.volume,
            },
          };
        });
        state.audible = await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].webContents.isCurrentlyAudible()
        );
        results.push({ version, elapsed, ...state });
      }
      console.log(
        JSON.stringify({
          version,
          states: results.filter((r) => r.version === version),
          muteTrace: await page.evaluate(() => window.__muteTrace),
        })
      );
    }
  } finally {
    fs.writeFileSync(
      path.join(output, "report.json"),
      JSON.stringify(results, null, 2)
    );
    await app.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
