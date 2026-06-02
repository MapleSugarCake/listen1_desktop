const { existsSync } = require("fs");
const { readFile } = require("fs/promises");
const { parseFile } = require("music-metadata");
const { basename, extname, parse, format } = require("path");
const { detect } = require("chardet");

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
  async readAudioTags(filePath) {
    const fileName = basename(filePath, extname(filePath));
    try {
      const metaData = await parseFile(filePath);
      metaData.common.title ||= fileName;
      const lyric_url = format({
        ...parse(filePath),
        ext: ".lrc",
        base: undefined,
      });
      //if metadata doesn't include lyric, then try to read from local lyric file
      if (!metaData.common.lyrics && existsSync(lyric_url)) {
        metaData.common.lyrics = [];
        const fileBuffer = await readFile(lyric_url);
        const encoding = detect(fileBuffer);
        const decoder = new TextDecoder(encoding);
        metaData.common.lyrics[0] = decoder.decode(fileBuffer);
      }
      return metaData;
    } catch (error) {
      return {
        error,
        common: {
          title: fileName,
          album: "",
          artist: "",
        },
      };
    }
  },
};
