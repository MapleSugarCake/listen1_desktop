const { readFile } = require("fs/promises");
const { basename, extname, parse, format } = require("path");
const { detect } = require("chardet");

// Kept behind a function so metadata loading can move to ESM independently.
let metadataModule;
async function parseAudio(filePath) {
  metadataModule ||= import("music-metadata");
  const { parseFile } = await metadataModule;
  return parseFile(filePath);
}

function normalizeLyrics(lyrics) {
  if (!Array.isArray(lyrics)) return [];
  return lyrics
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry?.syncText?.length && entry.timeStampFormat === 2) {
        return entry.syncText
          .map(({ timestamp = 0, text = "" }) => {
            const seconds = Math.max(0, timestamp) / 1000;
            return `[${String(Math.floor(seconds / 60)).padStart(2, "0")}:${(seconds % 60).toFixed(2).padStart(5, "0")}]${text}`;
          })
          .join("\n");
      }
      return (
        entry?.text ||
        entry?.syncText?.map((line) => line.text).join("\n") ||
        ""
      );
    })
    .filter(Boolean);
}

/**
 * 读取同名 .lrc 歌词文件；即使读取失败，也不能影响音频标签解析。
 * @param {string} audioPath
 * @returns {Promise<string | undefined>}
 */
async function readSidecarLyrics(audioPath) {
  const lyricPath = format({
    ...parse(audioPath),
    ext: ".lrc",
    base: undefined,
  });

  try {
    const fileBuffer = await readFile(lyricPath);
    const encoding = detect(fileBuffer) || "utf-8";
    return new TextDecoder(encoding).decode(fileBuffer);
  } catch {
    // .lrc 缺失、损坏或编码异常时，仍返回音频标签信息。
    return undefined;
  }
}

module.exports = {
  /**
   * 解析本地音频元数据；当标签中没有歌词时，补充同名 .lrc 文件。
   * 即使解析失败也返回 common 对象，便于 UI 显示文件名兜底标题。
   * @param {string} filePath
   */
  async readAudioTags(filePath, parseMetadata = parseAudio) {
    const fileName = basename(filePath, extname(filePath));
    try {
      const metaData = await parseMetadata(filePath);
      metaData.common ||= {};
      metaData.common.title ||= fileName;
      metaData.common.lyrics = normalizeLyrics(metaData.common.lyrics);
      if (!metaData.common.lyrics.length) {
        const lyric = await readSidecarLyrics(filePath);
        if (lyric) metaData.common.lyrics = [lyric];
      }
      return metaData;
    } catch (error) {
      return {
        error: { code: error.code || "INVALID_AUDIO", message: error.message },
        common: {
          title: fileName,
          album: "",
          artist: "",
        },
      };
    }
  },
  normalizeLyrics,
};
