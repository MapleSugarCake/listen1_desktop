const fs = require("node:fs");
const path = require("node:path");
const { _electron } = require("playwright");
const root = path.resolve(__dirname, "..");
const output = path.join(root, "dist/maintenance/qq-search-diagnostic");
const report = {
  date: new Date().toISOString(),
  account: "guest",
  variants: [],
};
async function main() {
  fs.mkdirSync(output, { recursive: true });
  const app = await _electron.launch({
    executablePath: require("electron"),
    args: [path.join(__dirname, "electron-entry.cjs")],
    env: {
      ...process.env,
      LISTEN1_TEST_USER_DATA: path.join(output, "profile"),
    },
  });
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => window.l1Player, null, { polling: 100 });
    report.proxy = await app.evaluate(async ({ session }) =>
      (
        await session.defaultSession.resolveProxy("https://u.y.qq.com")
      ).startsWith("DIRECT")
        ? "DIRECT"
        : "proxy"
    );
    for (const variant of [
      "current",
      "legacy-origin",
      "legacy-UA",
      "direct",
      "current-repeat",
    ]) {
      await app.evaluate(
        async ({ session }, { variant, code }) => {
          await session.defaultSession.setProxy({
            mode: variant === "direct" ? "direct" : "system",
          });
          const module = { exports: {} };
          new Function("module", code)(module);
          const { applyPlatformHeaders } = module.exports;
          session.defaultSession.webRequest.onBeforeSendHeaders(
            (details, callback) => {
              applyPlatformHeaders(details);
              if (details.url.startsWith("https://u.y.qq.com/")) {
                if (variant === "legacy-origin")
                  details.requestHeaders.Origin = "https://y.qq.com/";
                if (variant === "legacy-UA")
                  details.requestHeaders["User-Agent"] =
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/72.0.3626.119 Safari/537.36";
              }
              callback({ requestHeaders: details.requestHeaders });
            }
          );
        },
        {
          variant,
          code: fs.readFileSync(
            path.join(root, "app/request-headers.js"),
            "utf8"
          ),
        }
      );
      const result = await page.evaluate(async () => {
        try {
          const response = await axios.post(
            "https://u.y.qq.com/cgi-bin/musicu.fcg",
            {
              comm: { ct: "19", cv: "1859", uin: "0" },
              req: {
                method: "DoSearchForQQMusicDesktop",
                module: "music.search.SearchCgiService",
                param: {
                  grp: 1,
                  num_per_page: 50,
                  page_num: 1,
                  query: "夜空中最亮的星",
                  search_type: 0,
                },
              },
            }
          );
          const data = response.data;
          return {
            status: response.status,
            code: data.code,
            businessCode: data.req?.code,
            count: data.req?.data?.body?.song?.list?.length,
            total: data.req?.data?.meta?.sum,
          };
        } catch (error) {
          return { error: error.code, status: error.response?.status };
        }
      });
      report.variants.push({ variant, ...result });
    }
    const officialPromise = app.waitForEvent("window");
    await app.evaluate(({ BrowserWindow }) => {
      const window = new BrowserWindow({
        show: false,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      window
        .loadURL(
          "https://y.qq.com/n/ryqq/search?w=%E5%A4%9C%E7%A9%BA%E4%B8%AD%E6%9C%80%E4%BA%AE%E7%9A%84%E6%98%9F&t=song"
        )
        .catch(() => {});
    });
    const official = await officialPromise;
    await official
      .waitForLoadState("domcontentloaded", { timeout: 20000 })
      .catch(() => {});
    report.official = await official.evaluate(() => ({
      title: document.title,
      keywordPresent: document.body.innerText.includes("夜空中最亮的星"),
      loginPresent: /登录/.test(document.body.innerText),
      visibleText: document.body.innerText.slice(0, 1000),
    }));
  } finally {
    fs.writeFileSync(
      path.join(output, "report.json"),
      JSON.stringify(report, null, 2)
    );
    await app.close();
    console.log(JSON.stringify(report));
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
