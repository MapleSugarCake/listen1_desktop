const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const output = path.join(root, "docs/maintenance");
const read = (name) =>
  JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
const names = [
  "online-final",
  "online-qq-final",
  "online-qq-confirm",
  "qq-search-diagnostic",
  "qq-probe",
  "electron-smoke-visible",
  "packaged-smoke",
  "packaged-online",
  "packaged-smoke-final",
  "packaged-final-netease",
];
const evidence = {
  generated: new Date().toISOString(),
  environment: read("dist/maintenance/baseline.json"),
  observations: {},
};
for (const name of names) {
  const file = `dist/maintenance/${name}/report.json`;
  if (fs.existsSync(path.join(root, file)))
    evidence.observations[name] = { file, ...read(file) };
  else evidence.observations[name] = { file, status: "unverified: no report" };
}
evidence.startupObservations = [
  "baseline",
  "baseline-playback",
  "fixed-before-upgrade-playback",
  "electron44-runtime",
  "electron44-network-polling",
  "all-dependencies-startup",
].map((name) => {
  const file = `dist/maintenance/${name}/report.json`;
  const result = read(file);
  return {
    name,
    file,
    date: result.date,
    electron: result.runtime?.electron,
    startupMs: result.startupMs,
    errors: result.errors,
  };
});
evidence.artifacts = [
  "dist/windows-test/listen1_2.33.1_win_x64.exe",
  "dist/windows-test/listen1_2.33.1_win_x64.7z",
]
  .filter((file) => fs.existsSync(path.join(root, file)))
  .map((file) => ({
    file,
    bytes: fs.statSync(path.join(root, file)).size,
    sha256: crypto
      .createHash("sha256")
      .update(fs.readFileSync(path.join(root, file)))
      .digest("hex"),
    signature: "unsigned test build; Authenticode checked separately",
  }));
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(
  path.join(output, "validation.json"),
  JSON.stringify(evidence, null, 2) + "\n"
);
console.log(
  "Saved validation.json; artifacts:",
  JSON.stringify(evidence.artifacts)
);
