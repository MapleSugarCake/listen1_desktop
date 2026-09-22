// Opt-in online audit. Uses guest profiles and low-volume samples; no credentials are logged.
const fs = require("node:fs");
const path = require("node:path");
const { _electron } = require("playwright");
const root = path.resolve(__dirname, "..");
const output = path.join(
  root,
  "dist/maintenance",
  process.env.LISTEN1_ONLINE_RUN || "online-ui"
);
const keyword = process.env.LISTEN1_KEYWORD || "夜空中最亮的星";
const sources = (
  process.env.LISTEN1_SOURCES || "netease,qq,kugou,kuwo,bilibili,migu"
).split(",");
const report = {
  date: new Date().toISOString(),
  keyword,
  account: "guest",
  fallback: false,
  platforms: [],
  errors: [],
  network: [],
};
const wait = (page, fn, arg = null, timeout = 18000) =>
  page.waitForFunction(fn, arg, { polling: 100, timeout });
async function main() {
  fs.mkdirSync(output, { recursive: true });
  const app = await _electron.launch({
    executablePath: process.env.LISTEN1_TEST_EXE || require("electron"),
    args: process.env.LISTEN1_TEST_EXE
      ? []
      : [path.join(__dirname, "electron-entry.cjs")],
    env: {
      ...process.env,
      LISTEN1_TEST_USER_DATA: path.join(output, "profile"),
    },
  });
  try {
    const page = await app.firstWindow();
    page.on("pageerror", (error) =>
      report.errors.push(error.message.replace(/https?:\/\/\S+/g, "[URL]"))
    );
    page.on("response", async (response) => {
      const url = new URL(response.url());
      if (!/search|musicu|playurl|playUrl|enhance|SongInfo/i.test(url.pathname))
        return;
      const body = await response.json().catch(() => null);
      report.network.push({
        host: url.hostname,
        path: url.pathname,
        status: response.status(),
        code: body?.code,
        businessCode: body?.req?.code ?? body?.req_1?.code,
        message: String(body?.message ?? body?.msg ?? "").slice(0, 100),
      });
    });
    await wait(
      page,
      () => window.l1Player && angular.element(document.body).injector()
    );
    await page.evaluate(() => {
      localStorage.setObject("enable_auto_choose_source", false);
      l1Player.setVolume(5);
      window.__playbackEvents = [];
      addPlayerListener("front", (event) => {
        if (/FAIL|RETRIEVE_URL/.test(event.type))
          window.__playbackEvents.push({
            type: event.type,
            id: event.data?.id,
            code: event.data?.error?.code,
            platform: event.data?.platform,
          });
      });
    });
    report.runtime = await app.evaluate(() => process.versions);
    report.initialMetrics = await app.evaluate(({ app }) =>
      app
        .getAppMetrics()
        .map(({ type, cpu, memory }) => ({ type, cpu, memory }))
    );
    const input = page.locator('input[ng-model="keywords"]');
    await input.fill(keyword);
    await wait(
      page,
      (keyword) => {
        const scope = angular
          .element(
            document.querySelector('[ng-controller="InstantSearchController"]')
          )
          .scope();
        return scope.keywords === keyword && !scope.loading;
      },
      keyword
    );
    for (const source of sources) {
      const result = { source, playback: [] };
      report.platforms.push(result);
      const tabs = page.locator('[ng-click="changeSourceTab(source.name)"]');
      const index = await tabs.evaluateAll(
        (elements, source) =>
          elements.findIndex(
            (element) => angular.element(element).scope().source.name === source
          ),
        source
      );
      const start = Date.now();
      await tabs.nth(index).click();
      await wait(
        page,
        (source) => {
          const scope = angular
            .element(
              document.querySelector(
                '[ng-controller="InstantSearchController"]'
              )
            )
            .scope();
          return scope.tab === source && !scope.loading;
        },
        source
      );
      result.search = await page.evaluate(() => {
        const scope = angular
          .element(
            document.querySelector('[ng-controller="InstantSearchController"]')
          )
          .scope();
        return {
          count: scope.result.length,
          error: scope.searchError,
          hasMore: scope.hasMore,
          totalpage: scope.totalpage,
          samples: scope.result
            .slice(0, 6)
            .map(({ id, title, artist }) => ({ id, title, artist })),
        };
      });
      result.search.elapsedMs = Date.now() - start;
      let played = 0;
      for (const [position, sample] of result.search.samples.entries()) {
        if (played >= 2) break;
        const entry = { ...sample, audioChecks: [] };
        result.playback.push(entry);
        await page.evaluate(() => {
          l1Player.clearPlaylist();
          l1Player.setVolume(5);
          l1Player.unmute();
          window.__playbackEvents = [];
        });
        const playStart = Date.now();
        await page
          .locator('.searchbox .detail-songlist [add-and-play="song"]')
          .nth(position)
          .click();
        try {
          await wait(
            page,
            (id) =>
              threadPlayer.currentAudio?.id === id &&
              ((threadPlayer.playing &&
                threadPlayer.currentHowl.seek() > 0.2) ||
                threadPlayer.currentAudio.disabled),
            sample.id,
            32000
          );
          const unavailable = await page.evaluate(
            () => !!threadPlayer.currentAudio.disabled
          );
          if (unavailable) {
            entry.status = "unavailable";
          } else {
            entry.firstProgressMs = Date.now() - playStart;
            for (const seconds of [1, 5, 10, 20, 30]) {
              await wait(
                page,
                (seconds) => threadPlayer.currentHowl?.seek() >= seconds,
                seconds,
                20000
              );
              const state = await page.evaluate(() => ({
                position: threadPlayer.currentHowl.seek(),
                playing: threadPlayer.playing,
                muted: threadPlayer.muted,
                actualSource: threadPlayer.currentAudio.platform,
              }));
              state.audible = await app.evaluate(({ BrowserWindow }) =>
                BrowserWindow.getAllWindows()
                  .find((window) =>
                    window.webContents.getURL().includes("listen1.html")
                  )
                  .webContents.isCurrentlyAudible()
              );
              entry.audioChecks.push(state);
            }
            // Exercise actual footer controls after the continuous playback sample.
            await page.locator("[play-pause-toggle]").first().click();
            await wait(page, () => !threadPlayer.playing, null, 3000);
            await page.evaluate(() => l1Player.seek(0.5));
            await page.locator("[play-pause-toggle]").first().click();
            await wait(
              page,
              () =>
                threadPlayer.playing &&
                threadPlayer.currentHowl.seek() >
                  threadPlayer.currentHowl.duration() * 0.49,
              null,
              3000
            );
            entry.controls = "pause/seek/resume passed";
            const hasAudio =
              entry.audioChecks.filter((check) => check.audible).length >= 2 &&
              entry.audioChecks.every((check) => !check.muted);
            entry.status = hasAudio
              ? "passed"
              : "progress-confirmed/audio-unverified";
            played += 1;
          }
        } catch (error) {
          entry.status = "failed-or-unverified";
          entry.error = error.message.split("\n")[0];
        }
        entry.events = await page.evaluate(() => window.__playbackEvents);
        await page.evaluate(() => l1Player.pause());
        console.log(JSON.stringify({ source, ...entry }));
        fs.writeFileSync(
          path.join(output, "report.json"),
          JSON.stringify(report, null, 2)
        );
      }
      if (result.search.hasMore) {
        const firstId = result.search.samples[0]?.id;
        await page
          .locator('.search-pagination button[ng-click="nextPage()"]')
          .click();
        await wait(page, () => {
          const scope = angular
            .element(
              document.querySelector(
                '[ng-controller="InstantSearchController"]'
              )
            )
            .scope();
          return scope.curpage === 2 && !scope.loading;
        });
        result.pagination = await page.evaluate((firstId) => {
          const scope = angular
            .element(
              document.querySelector(
                '[ng-controller="InstantSearchController"]'
              )
            )
            .scope();
          return {
            page: scope.curpage,
            count: scope.result.length,
            firstResultChanged: scope.result[0]?.id !== firstId,
            error: scope.searchError,
          };
        }, firstId);
      }
    }
    await page.locator("[ng-click=\"changeSourceTab('allmusic')\"]").click();
    await wait(page, () => {
      const scope = angular
        .element(
          document.querySelector('[ng-controller="InstantSearchController"]')
        )
        .scope();
      return scope.tab === "allmusic" && !scope.loading;
    });
    report.aggregate = await page.evaluate(() => {
      const scope = angular
        .element(
          document.querySelector('[ng-controller="InstantSearchController"]')
        )
        .scope();
      return {
        count: scope.result.length,
        sources: scope.searchSources,
        hasMore: scope.hasMore,
      };
    });
    report.finalMetrics = await app.evaluate(({ app }) =>
      app
        .getAppMetrics()
        .map(({ type, cpu, memory }) => ({ type, cpu, memory }))
    );
  } finally {
    fs.writeFileSync(
      path.join(output, "report.json"),
      JSON.stringify(report, null, 2)
    );
    await app.close();
  }
}
main().catch((error) => {
  report.failure = error.message;
  fs.writeFileSync(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2)
  );
  console.error(error.message);
  process.exitCode = 1;
});
