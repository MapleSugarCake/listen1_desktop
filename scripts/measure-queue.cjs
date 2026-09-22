const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
function measure(source) {
  let events = 0,
    snapshots = 0,
    records = 0,
    bytes = 0;
  const context = vm.createContext({
    window: {},
    navigator: {},
    setInterval() {},
    clearInterval() {},
    setTimeout,
    clearTimeout,
    Howler: { volume: () => 1, unload() {} },
    playerSendMessage(_mode, message) {
      events += 1;
      if (message.type === "BG_PLAYER:PLAYLIST") {
        snapshots += 1;
        records += message.data.length;
        bytes += JSON.stringify(message.data).length;
      }
    },
  });
  vm.runInContext(fs.readFileSync(source, "utf8"), context);
  events = 0;
  const tracks = Array.from({ length: 1000 }, (_, i) => ({
    id: `netrack_${i}`,
    title: `Synthetic ${i}`,
    artist: "Fixture",
    source: "netease",
  }));
  const start = performance.now();
  context.window.threadPlayer.appendAudioList(tracks);
  return {
    ms: performance.now() - start,
    events,
    snapshots,
    records,
    serializedCharacters: bytes,
  };
}
const report = {
  date: new Date().toISOString(),
  method:
    "Same Node process; player core plus JSON serialization. Excludes DOM rendering and disk writes. Five repetitions; no OS cache flush.",
  before: [],
  after: [],
};
for (let i = 0; i < 5; i += 1) {
  report.before.push(
    measure(
      path.join(
        root,
        "dist/maintenance/baseline/app/listen1_chrome_extension/js/player_thread.js"
      )
    )
  );
  report.after.push(
    measure(path.join(root, "app/listen1_chrome_extension/js/player_thread.js"))
  );
}
fs.mkdirSync(path.join(root, "docs/maintenance"), { recursive: true });
fs.writeFileSync(
  path.join(root, "docs/maintenance/queue-performance.json"),
  JSON.stringify(report, null, 2) + "\n"
);
console.log(JSON.stringify(report));
