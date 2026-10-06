# 维护验证

使用 Node 24.21.0、npm 12.0.2 和锁文件中的 Electron/Playwright。先在根目录 `npm ci`，再 `npm ci --prefix app/listen1_chrome_extension`。机器没有 npm 时可运行 `node scripts/prepare-maintenance.cjs`，在忽略目录内准备带官方 SHA 校验的 Windows x64 Node 工具链及 npm，不修改全局工具。该脚本也保存首次源码基线，不要用后续快照冒充更新前状态。

| 命令                                    | 覆盖                                                                                                     |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `npm test`                              | 请求乱序/取消/超时、队列生命周期、批量事件、URL 缓存重试、歌词容错、IPC 来源、本地并发、旧数据、加密向量 |
| `npm run test:electron`                 | 实际 Electron 页面、隔离 preload、本地播放、歌词、主题/语言、备份、断网收尾、代理和重启                  |
| `npm run test:online`                   | 六平台实际搜索输入/标签/分页/入队/地址/30 秒播放/暂停恢复；每平台尝试前六条直到两首可播放                |
| `node tests/netease-electron.cjs`       | 网易歌曲/歌单去重的真实 DOM、两布局四主题、账号/歌单失败重试、退出及六种语言；默认离线夹具               |
| `node tests/netease-login.cjs`          | 人工网易账号授权后读取三类歌单、详情并检查重启识别；每种方式强制使用全新隔离 profile                     |
| `node tests/loudness-electron.cjs`      | 当前完整资产 RMS、实际适配器输出及主音量／静音／跳转、两布局四主题六语言；需 FFmpeg                      |
| `node scripts/loudness-listening.cjs`   | 将已测 WAV 生成短 A/B 试听页，材料保存在忽略目录；不代替人工试听                                         |
| `node scripts/measure-queue.cjs`        | 同机更新前后核心队列与 JSON 序列化，五次样本；不包含 DOM 和磁盘                                          |
| `node scripts/dependency-inventory.cjs` | 三层直接/传递依赖清单、官方 latest 核对、npm 官方审计                                                    |
| `npm run dist:win:test`                 | 仅 x64 的 NSIS 和 7z，不发布                                                                             |

Electron 测试将 `LISTEN1_TEST_USER_DATA` 指向 `dist/maintenance/<run>/profile`。源码测试通过 electron-entry 启动，打包测试直接启动 Listen1.exe。它们不会读取真实用户 profile。为复现测试，给每次运行设置新名称：

```powershell
$env:LISTEN1_SMOKE_RUN = 'smoke-new-run'
npm run test:electron
$env:LISTEN1_ONLINE_RUN = 'online-new-run'
npm run test:online
# 可选：仅复查某平台
$env:LISTEN1_SOURCES = 'qq'
npm run test:online
# 测试打包程序
$env:LISTEN1_TEST_EXE = (Resolve-Path 'dist/windows-test/win-unpacked/Listen1.exe').Path
$env:LISTEN1_SMOKE_RUN = 'packaged-new-run'
npm run test:electron
```

在线测试使用游客会话，禁用自动换源，每首播放前设 5% 音量并解除静音；可能实际出声。音频检查同时记录 Howler playing、播放进度、静音状态和 Chromium `isCurrentlyAudible()`。这是音频输出检测，不能验证扬声器接线或代替人耳听感；主动静音的样本标为音频未验证。日志只保留平台、公共曲目 ID、阶段、HTTP/业务码，不保存 Cookie、令牌或带签名播放 URL。

网易专项测试同时捕获 Angular `ngRepeat:dupes` 控制台错误和真实 DOM 行数；在线模式用“星球卑”，以当前唯一结果数为断言，不固定线上条数。人工登录测试须由操作者在官方窗口分别完成 QQ 授权和网易扫码，再点击 Listen1 的“我已经登录完成”；脚本不填写凭据、不记录账号和私人歌单内容。每次使用新运行名称，已存在 profile 时拒绝复用；登录期间的测试 profile 包含实际会话，应留在忽略目录且不要分享。结果只保存成功/失败、错误码、歌单/曲目数量和重启比对布尔结论。

```powershell
$env:LISTEN1_NETEASE_RUN = 'netease-fixture-new-run'
node tests/netease-electron.cjs
$env:LISTEN1_NETEASE_ONLINE = '1'
$env:LISTEN1_NETEASE_RUN = 'netease-online-new-run'
node tests/netease-electron.cjs
Remove-Item Env:LISTEN1_NETEASE_ONLINE
$env:LISTEN1_NETEASE_LOGIN_METHOD = 'qq' # 下一独立会话改为 scan
$env:LISTEN1_NETEASE_LOGIN_RUN = 'netease-login-qq-new-run'
node tests/netease-login.cjs
```

网易本轮修复及实际验收边界见 [网易维护记录](../docs/maintenance/NETEASE.md)。游客成功不能代替真实账号和两种授权路径通过。

页面测试通过 Playwright 操作 DOM 与播放器边界。本地测试使用合成 WAV/歌词，原生文件选择框返回值由测试替换，之后标签解析、IPC、歌单、Howler 和解码均走实际链路。原生文件框交互、系统托盘点击、真实全局按键及多显示器等未自动覆盖的场景必须另记。

在线空结果和错误保存在 report.json，不以脚本 exit 0 代替平台通过；逐曲 status 才是依据。离线行为测试失败会返回非零。定时断言采用 100ms polling，防止隐藏窗口 requestAnimationFrame 停顿导致假超时。

诊断工具 `qq-search-diagnostic.cjs` 比较当前/旧请求头、系统代理/直连和官方页面；`qq-probe.cjs` 比较 QQ 不可用曲目的地址请求参数，均为可选在线诊断。`inspect-electron.cjs` 用于分组升级阶段记录，`audio-diagnostic.cjs` 的旧 Howler 对照需要首次基线快照。这些结果不能替代最终页面测试。

安装、升级、卸载必须在独立环境使用可丢弃数据，不运行真实用户安装程序来清理测试。测试用 profile、原始报告、截图和包都留在 dist，不加入源码版本管理；精简证据和环境边界保存在 docs/maintenance。
