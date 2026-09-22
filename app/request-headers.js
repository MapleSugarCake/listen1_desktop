const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 14_3 like Mac OS X) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30";

/**
 * @param {electron.OnBeforeSendHeadersListenerDetails} details
 */
function applyPlatformHeaders(details) {
  let replace_referer = true;
  let replace_origin = true;
  let add_referer = true;
  let add_origin = true;
  let referer_value = "";
  let origin_value = "";
  let ua_value = "";

  if (details.url.includes("://music.163.com/")) {
    referer_value = "https://music.163.com/";
    origin_value = "https://music.163.com"; // 【新增】严格符合标准的 Origin
  }
  if (details.url.includes("://interface3.music.163.com/")) {
    referer_value = "https://music.163.com/";
    origin_value = "https://music.163.com"; // 【新增】严格符合标准的 Origin
  }
  if (details.url.includes("://gist.githubusercontent.com/")) {
    referer_value = "https://gist.githubusercontent.com/";
  }

  if (details.url.includes(".xiami.com/")) {
    add_origin = false;
    referer_value = "https://www.xiami.com/";
  }
  if (details.url.includes("www.xiami.com/api/search/searchSongs")) {
    const key = /key%22:%22(.*?)%22/.exec(details.url)[1];
    add_origin = false;
    referer_value = `https://www.xiami.com/search?key=${key}`;
  }
  if (details.url.includes("c.y.qq.com/")) {
    referer_value = "https://y.qq.com/";
    origin_value = "https://y.qq.com";
  }
  if (
    details.url.includes("y.qq.com/") ||
    details.url.includes("qqmusic.qq.com/") ||
    details.url.includes("music.qq.com/") ||
    details.url.includes("imgcache.qq.com/")
  ) {
    referer_value = "https://y.qq.com/";
  }
  if (details.url.includes(".kugou.com/")) {
    referer_value = "https://www.kugou.com/";
    ua_value = MOBILE_UA;
  }
  if (details.url.includes("m.kugou.com/")) {
    ua_value = MOBILE_UA;
  }
  if (details.url.includes(".kuwo.cn/")) {
    referer_value = "https://www.kuwo.cn/";
  }
  if (
    details.url.includes(".bilibili.com/") ||
    details.url.includes(".bilivideo.com/")
  ) {
    referer_value = "https://www.bilibili.com/";
    replace_origin = false;
    add_origin = false;
  }
  if (details.url.includes(".bilivideo.cn")) {
    referer_value = "https://www.bilibili.com/";
    origin_value = "https://www.bilibili.com/";
    add_referer = true;
    add_origin = true;
  }
  if (details.url.includes(".migu.cn")) {
    referer_value = "http://music.migu.cn/v3/music/player/audio?from=migu";
  }
  if (details.url.includes("m.music.migu.cn")) {
    referer_value = "https://m.music.migu.cn/";
  }

  //缺省逻辑：如果没有设置 Origin，则默认 Origin 与 Referer 保持一致
  if (origin_value == "") {
    origin_value = referer_value ? new URL(referer_value).origin : "";
  }

  const headers = details.requestHeaders;
  const hasHeader = (name) =>
    Object.keys(headers).some(
      (key) => key.toLowerCase() === name.toLowerCase()
    );
  const setHeader = (name, value) => {
    Object.keys(headers)
      .filter((key) => key.toLowerCase() === name.toLowerCase())
      .forEach((key) => delete headers[key]);
    headers[name] = value;
  };
  if (
    referer_value &&
    (add_referer || (replace_referer && hasHeader("Referer")))
  )
    setHeader("Referer", referer_value);
  if (origin_value && (add_origin || (replace_origin && hasHeader("Origin"))))
    setHeader("Origin", new URL(origin_value).origin);
  if (ua_value) setHeader("User-Agent", ua_value);
  details.requestHeaders = headers;
}

module.exports = { applyPlatformHeaders };
