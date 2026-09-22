// Optional Windows audit setup. Normal development uses the pinned Node/npm versions.
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const os = require("node:os");
const crypto = require("node:crypto");

async function main() {
  if (process.platform !== "win32" || process.arch !== "x64")
    throw new Error("This audit bootstrap targets Windows x64");
  const root = path.resolve(__dirname, "..");
  process.chdir(root);
  const out = path.join(root, "dist/maintenance");
  fs.mkdirSync(out, { recursive: true });
  if (!fs.existsSync(path.join(out, "baseline.json"))) {
    const state = {
      date: new Date().toISOString(),
      os: os.release(),
      arch: os.arch(),
      cpu: os.cpus()[0].model,
      memoryGiB: Math.round(os.totalmem() / 2 ** 30),
      repos: [],
    };
    for (const directory of [".", "app/listen1_chrome_extension"]) {
      const git = (args) =>
        cp.execFileSync("git", ["-C", directory, ...args], {
          encoding: "utf8",
        });
      const files = git(["ls-files", "-z"]).split("\0").filter(Boolean);
      if (!files.includes("AGENTS.md")) files.push("AGENTS.md");
      for (const file of files) {
        const src = path.join(directory, file);
        if (!fs.existsSync(src) || !fs.statSync(src).isFile()) continue;
        const dest = path.join(out, "baseline", directory, file);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
      }
      state.repos.push({
        root: directory,
        head: git(["rev-parse", "HEAD"]).trim(),
        status: git(["status", "--short"]),
      });
    }
    fs.writeFileSync(
      path.join(out, "baseline.json"),
      JSON.stringify(state, null, 2) + "\n"
    );
  }
  const tools = path.join(out, "tools");
  fs.mkdirSync(tools, { recursive: true });
  const version = "24.21.0";
  const base = `https://nodejs.org/dist/v${version}/`;
  const name = `node-v${version}-win-x64.zip`;
  const archive = path.join(tools, name);
  const sums = await fetch(base + "SHASUMS256.txt");
  if (!sums.ok)
    throw new Error(`Node checksum download failed: ${sums.status}`);
  const expected = (await sums.text())
    .split("\n")
    .find((line) => line.endsWith("  " + name))
    ?.split(" ")[0];
  if (!fs.existsSync(archive)) {
    const response = await fetch(base + name);
    if (!response.ok)
      throw new Error(`Node download failed: ${response.status}`);
    fs.writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
  }
  if (
    crypto
      .createHash("sha256")
      .update(fs.readFileSync(archive))
      .digest("hex") !== expected
  )
    throw new Error("Node checksum mismatch");
  const runtime = path.join(tools, `node-v${version}-win-x64`);
  if (!fs.existsSync(path.join(runtime, "node.exe")))
    cp.execFileSync("tar.exe", ["-xf", archive, "-C", tools], {
      stdio: "inherit",
    });
  const npmPrefix = path.join(out, "npm12");
  cp.execFileSync(
    path.join(runtime, "node.exe"),
    [
      path.join(runtime, "node_modules/npm/bin/npm-cli.js"),
      "install",
      "--prefix",
      npmPrefix,
      "--cache",
      path.join(out, "npm-cache"),
      "--save-exact",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "npm@12.0.2",
    ],
    { stdio: "inherit", windowsHide: true }
  );
  console.log(`Baseline: ${path.join(out, "baseline.json")}`);
  console.log(`Node: ${path.join(runtime, "node.exe")}`);
  console.log(
    `npm CLI: ${path.join(npmPrefix, "node_modules/npm/bin/npm-cli.js")}`
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
