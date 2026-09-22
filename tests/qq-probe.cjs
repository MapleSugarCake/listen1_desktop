const fs = require("node:fs");
const path = require("node:path");
const { _electron } = require("playwright");
async function main() {
  const output = path.resolve(__dirname, "../dist/maintenance/qq-probe");
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
    const results = await page.evaluate(async () => {
      const results = [];
      for (const songmid of ["001NmPTG1fVsUw", "0044g6hb1mnYOV"]) {
        for (const variant of ["existing", "single-mid", "default"]) {
          const filename =
            variant === "existing"
              ? [`M500${songmid}${songmid}.mp3`]
              : variant === "single-mid"
                ? [`M500${songmid}.mp3`]
                : [];
          const response = await axios.post(
            "https://u.y.qq.com/cgi-bin/musicu.fcg",
            {
              req_1: {
                module: "vkey.GetVkeyServer",
                method: "CgiGetVkey",
                param: {
                  filename,
                  guid: "10000",
                  songmid: [songmid],
                  songtype: [0],
                  uin: "0",
                  loginflag: 1,
                  platform: "20",
                },
              },
              loginUin: "0",
              comm: { uin: "0", format: "json", ct: 24, cv: 0 },
            }
          );
          const data = response.data;
          results.push({
            songmid,
            variant,
            status: response.status,
            code: data.code,
            businessCode: data.req_1?.code,
            available: !!data.req_1?.data?.midurlinfo?.[0]?.purl,
          });
        }
      }
      return results;
    });
    fs.writeFileSync(
      path.join(output, "report.json"),
      JSON.stringify(results, null, 2)
    );
    console.log(JSON.stringify(results));
  } finally {
    await app.close();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
