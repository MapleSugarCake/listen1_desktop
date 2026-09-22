const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function loadAudio({ readFile, parseFile, detect = () => "utf-8" }) {
  const module = { exports: {} };
  const context = vm.createContext({
    module,
    exports: module.exports,
    TextDecoder,
    require(name) {
      if (name === "music-metadata") return { parseFile };
      if (name === "fs" || name === "node:fs")
        return { existsSync: () => true };
      if (name === "fs/promises" || name === "node:fs/promises")
        return { readFile };
      if (name === "chardet") return { detect };
      return require(name);
    },
  });
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../app/functions.js"), "utf8"),
    context
  );
  return {
    ...module.exports,
    readAudioTags: (file) => module.exports.readAudioTags(file, parseFile),
  };
}

test("unreadable sidecar keeps successfully read audio tags", async () => {
  const audio = loadAudio({
    parseFile: async () => ({
      common: { title: "Title", artist: "Artist", album: "Album" },
    }),
    readFile: async () => {
      throw Error("EACCES");
    },
  });
  const result = await audio.readAudioTags("C:/synthetic/song.mp3");
  assert.equal(result.common.title, "Title");
  assert.equal(result.common.artist, "Artist");
  assert.equal(result.common.album, "Album");
});

test("broken audio returns a usable filename fallback", async () => {
  const audio = loadAudio({
    parseFile: async () => {
      throw Error("Invalid audio");
    },
    readFile: async () => Buffer.alloc(0),
  });
  const result = await audio.readAudioTags("C:/synthetic/song.mp3");
  assert.equal(result.common.title, "song");
  assert.ok(result.error);
});

test("structured millisecond lyrics are converted without losing old text lyrics", () => {
  const { normalizeLyrics } = loadAudio({});
  const lines = normalizeLyrics([
    "[00:01.00]old",
    {
      timeStampFormat: 2,
      syncText: [
        { timestamp: 1250, text: "中文" },
        { timestamp: 62000, text: "next" },
      ],
    },
    { text: "plain" },
  ]);
  assert.equal(lines[0], "[00:01.00]old");
  assert.equal(lines[1], "[00:01.25]中文\n[01:02.00]next");
  assert.equal(lines[2], "plain");
});

test("invalid sidecar encoding does not discard valid tags", async () => {
  const audio = loadAudio({
    parseFile: async () => ({ common: { title: "still valid" } }),
    readFile: async () => Buffer.from("lyrics"),
    detect: () => "unsupported-encoding",
  });
  assert.equal(
    (await audio.readAudioTags("C:/synthetic/song.mp3")).common.title,
    "still valid"
  );
});
