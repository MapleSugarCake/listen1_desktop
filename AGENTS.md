# Listen 1 桌面版：架构与维护指南

本文以当前工作区为依据。进入 `app/listen1_chrome_extension` 时还应阅读[子模块维护指南](app/listen1_chrome_extension/AGENTS.md)。第 1～5 节是实现事实，第 6 节是 AI 操作规则，第 7 节是验证方法；代码存在不代表所有环境或线上服务已验收。2026-09-22 的环境、证据和限制见[维护报告](docs/maintenance/REPORT.md)。

## 1. 项目与架构

桌面仓库负责 Electron 生命周期、窗口、系统集成和安装包；`app/listen1_chrome_extension` 是独立 Git 子模块，负责 AngularJS 页面、音乐业务及扩展入口。`.gitmodules` 指向 MapleSugarCake 的共享播放器仓库，包元数据仍有 listen1 上游链接，二者用途不同。父仓库保存子模块提交指针，不能代替保存子模块文件。

```text
app/main.js → 主窗口 listen1.html（隔离，禁止页面 Node）
  ├─ desktop-api.js ← desktop-preload.js ← window.listen1Desktop
  │    ├─ 窗口 / 登录 / Cookie / 代理 / 本地导入
  │    └─ functions.js → music-metadata / 同名 .lrc
  ├─ floatingWindow.html ← preload.js ← 歌词转发
  └─ 托盘 / 系统快捷键 / 请求头 / 更新

AngularJS controllers → MediaService → provider → RequestTask / Axios
l1Player → bridge → threadPlayer / Howler → BG_PLAYER:* → UI
```

桌面播放核心在主窗口渲染进程运行，`player_thread.js` 没有创建独立线程。保留现有 AngularJS 和两套界面布局。

## 2. 目录与依赖

| 路径                                           | 职责                                                                    |
| ---------------------------------------------- | ----------------------------------------------------------------------- |
| `package.json`、`package-lock.json`            | Electron、electron-builder、Playwright、Prettier、脚本与安装包配置      |
| `app/package.json`、`app/package-lock.json`    | 桌面运行依赖：electron-store、electron-updater、music-metadata、chardet |
| `app/main.js`、`app/request-headers.js`        | 生命周期、窗口和系统能力；按站点处理现有请求头                          |
| `app/desktop-api.js`、`app/desktop-preload.js` | 主窗口桌面能力边界，来源和参数校验                                      |
| `app/preload.js`、`app/floatingWindow.html`    | 独立的悬浮歌词窗口桥接和显示                                            |
| `app/functions.js`                             | 本地标签、歌词规范化和独立的 sidecar 容错                               |
| `app/listen1_chrome_extension`                 | 独立包和锁文件，静态业务播放器；不是 npm workspace                      |
| `scripts/`、`tests/`、`docs/maintenance/`      | 工具、行为/桌面测试、依赖和验证证据                                     |
| `build/`、`app/resources/`                     | 已跟踪的打包图标、系统集成图片，不是输出目录                            |
| `dist/`                                        | 被忽略的测试数据、临时工具链、报告及构建输出                            |

双 package.json 布局保持不变。根 `postinstall` 先运行 Electron 44 的 `install-electron`，再运行 `electron-builder install-app-deps`；子模块工具需单独 `npm ci --prefix app/listen1_chrome_extension`。正常启动直接读取已提交的 vendor 文件，只有维护静态库时运行子模块 `vendor:build`。其版本、来源、许可和哈希见 `vendor/`。

## 3. 交互与数据边界

主窗口通过专用 preload 暴露 `window.listen1Desktop`，`@electron/remote` 已移除，主窗口设置 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。浏览器扩展仍有独立适配，不能以桌面验证代替扩展验证。

| 页面接口                               | 作用与返回                                                         |
| -------------------------------------- | ------------------------------------------------------------------ |
| `control(operation, params)`           | 白名单窗口、快捷键、歌词、代理操作；Promise                        |
| `openExternal(url)` / `openLogin(url)` | HTTP(S) 外部链接 / 有来源限制的隔离登录窗口；Promise               |
| `cookieGet/Set/Remove(request)`        | 平台域名、字段和有效期校验；Promise                                |
| `importLocalMusic()`                   | 文件选择 → 最多 4 个并发标签读取 → `{ cancelled, tracks, errors }` |
| `localFileUrl(trackId)`                | 旧 `lmtrack_` 绝对路径 ID → 编码后的文件 URL；Promise              |
| `setLyric` / `setTrack` / `setPlaying` | 转发歌词、曲目信息和播放状态                                       |
| `on(channel, callback)`                | 白名单桌面事件，去掉 Electron event；返回取消订阅函数              |
| `setZoomLevel(level)`                  | 有范围检查的页面缩放                                               |

主进程校验主窗口、主 frame 和准确本地页面来源；歌词窗使用独立控制白名单。歌词输入保留 `{ lyric, tlyric }`，转发通道分别为 `currentLyric` 和 `currentLyricTrans`。歌词窗使用 `textContent`，保留原有工作区边界处理；原始 ipcRenderer 不暴露给页面。调用双方和窗口生命周期必须一起维护。

登录窗禁止 Node、启用 sandbox 与 webSecurity；登录入口允许指定平台域名。现有请求头和 Cookie SameSite 处理仍需平台登录实测，不能将游客搜索通过视为账号流程通过。更新检查只在普通打包应用启动后异步执行，测试和开发启动跳过，失败不阻塞播放器；桌面设置页查询桌面上游 release，扩展查询扩展上游。

本地标签通过缓存的 ESM import 加载 music-metadata。同步歌词转换为旧播放器可读 LRC，缺失歌词才读取同名 `.lrc`；sidecar 失败保留已成功解析的标签，损坏音频回退文件名。曲目与歌单 ID、存储键和备份格式不迁移。文件 URL 使用 `pathToFileURL`，旧曲目按 ID 恢复真实路径。

| 持久化位置        | 内容                                                             |
| ----------------- | ---------------------------------------------------------------- |
| electron-store    | `windowState`、`floatingWindowBounds`、`proxyConfig`，读取既有键 |
| 页面 localStorage | 歌单、队列、主题、语言、播放设置和部分认证数据                   |
| Electron session  | 平台 Cookie                                                      |
| 用户原音频文件    | 只读取，歌单保存路径和元数据，不复制音频                         |

JSON/Gist 备份不包含上述全部桌面状态、Cookie 和音频，JSON 遍历 localStorage，不能当作已脱敏文件。`LISTEN1_TEST_USER_DATA` 是测试专用环境变量，为开发与打包应用指定可丢弃 profile，并隔离更新和测试窗口行为。不要指向真实用户目录。NSIS 仍保留原有 `deleteAppDataOnUninstall: true`，卸载验证必须使用独立环境。

## 4. 开发、打包与校验

固定工具链：Node 24.21.0、npm 12.0.2；Electron 44.4.3、builder 26.15.3。`.node-version`、`engines`、`packageManager` 和 CI 已同步。直接依赖使用精确版本，三份锁文件分别管理三个依赖层。

```sh
git submodule update --init --recursive
npm ci
npm ci --prefix app/listen1_chrome_extension
npm start
npm test
npm run lint --prefix app/listen1_chrome_extension
npm run vendor:check --prefix app/listen1_chrome_extension
```

已有子模块修改时不要用初始化命令覆盖工作。Windows 临时工具链准备及验证命令见[测试指南](tests/README.md)。

| 命令                                       | 范围                                                |
| ------------------------------------------ | --------------------------------------------------- |
| `npm run dev`                              | 跨平台 Node 启动脚本，不提供热更新                  |
| `npm run dist`                             | 当前宿主默认目标，`--publish never`                 |
| `npm run dist:win`                         | Windows NSIS、7z；x64、arm64                        |
| `npm run dist:win:test`                    | 明确只构建 x64，输出 `dist/windows-test`，不发布    |
| `npm run dist:mac`                         | macOS DMG：x64、arm64、universal；配置最低 macOS 13 |
| `npm run dist:linux`                       | x64、arm64；tar.gz、AppImage、deb                   |
| `npm run dist:linux64` / `dist:linuxArm64` | 单架构 Linux                                        |
| `npm test`                                 | Node 行为测试，包含子模块测试                       |
| `npm run test:electron`                    | 隔离 profile 的 Electron 页面与桌面能力回归         |
| `npm run test:online`                      | 游客在线搜索、分页和 5% 音量播放；单独记录外部失败  |

32 位 Windows/Linux 和 Linux armv7l 目标已移除。Windows 以 10 及以上为运行基线，macOS 最低 13；本轮实测范围以报告为准，配置架构不是兼容性认证。

CI 使用 checkout/setup-node v7，依次安装、行为测试、lint、vendor 校验后构建。普通 push 不发布，原有 `v` 标签发布入口保留；本轮没有触发 CI、提交、推送或发布。根 Prettier 双引号，子模块单引号，ESLint 已迁移 flat config，保留旧有效规则，不全仓格式化。

## 5. 已知限制与维护依据

- 六个平台在线状态按具体样本、账号和网络分别记录；搜索有结果不等于能播放。
- AngularJS 1.8.3 仍有已知审计问题；保留框架的决定不表示这些问题已修复。
- 定制 forge 保留原始文件，已做加密测试向量对比，尚不能证明与上游所有行为等价。
- 更新下载、真实登录、安装/升级/卸载、多显示器、其他系统和扩展需要各自环境验证。
- 主仓库与子模块应分别检查差异；原有用户修改不得因此次更新而回滚。

## 6. AI 操作规则

本节是维护约束，不声称仓库已经存在对应的自动化强制检查。

1. **先确认工作范围。** 阅读任务涉及的入口、调用方、配置及就近 AGENTS.md；先检查主仓库和子模块的 `git status`、差异。已有未提交工作按用户工作处理，不覆盖、回滚或顺手整理。能够通过仓库查明的问题先查代码；无法确认且会影响准确性或实现选择的问题再提出澄清。
2. **按仓库边界修改。** 桌面系统能力放在桌面层，共享音乐业务按子模块文档维护。不要把子模块替换成普通目录或为了取最新代码而自动使用 `--remote`。只有任务需要记录新的子模块版本且对应内容已经提交时，才更新父仓库指针；提交、推送、标签及发布按任务授权处理。
3. **控制变更范围。** 遵守所在目录的格式配置，只格式化相关文件。不要把文档或局部修复扩展成全仓格式化、依赖升级、锁文件重写或框架迁移。依赖变更应落在正确的包及锁文件中；第三方库更新须说明来源、版本和影响并保留许可信息。
4. **联查通信双方。** 修改 IPC 时核对发送方、接收方、参数和窗口生命周期；尤其注意歌词对象中的 `tlyric` 与悬浮窗通道 `currentLyricTrans` 的区别。不要只改一端，或向页面回调传递不需要的 Electron 内部对象。
5. **审视新增权限。** 新增或调整窗口、IPC、URL/Cookie 处理时明确所需来源、通道和参数范围；不能仅因旧代码较宽松而继续扩大权限。改变现有配置时说明对登录、本地文件和共享页面的影响，并选择相应验证。
6. **保护持久化数据与凭据。** 修改存储键、字段或导入导出格式时核对旧数据读取及迁移需求。使用可丢弃的数据验证恢复与卸载；不得删除用户配置、音乐或现有备份来完成一般验证，也不得把 Cookie、令牌或真实备份内容写入代码、文档和日志示例。
7. **按影响面验证。** 桌面改动注意 Windows、macOS、Linux 的已有分支；不能只以本机结果宣称全部平台通过。静态检查、人工操作和在线服务验证分别报告；既有失败、环境阻塞和本次引入的问题分别说明，不为消除无关错误而扩大修复。
8. **保持文档可核验。** 行为描述以实现和生效配置为依据，注释、历史 README 或残留代码不能单独证明能力。架构、命令、通信边界变化时同步更新对应文档；不自行发明固定分支名、提交格式、审批层级或覆盖率指标。

## 7. 按变更选择验证

以下是验证方法，不表示这些检查已经运行，也不要求每次改动都构建全部平台。

| 变更类型                    | 最小相关验证                                                                                          |
| --------------------------- | ----------------------------------------------------------------------------------------------------- |
| 仅文档                      | 检查链接、目录、命令及事实来源；对改动的 Markdown 单独运行 Prettier 检查。                            |
| 主进程 / preload / 音频工具 | 对对应 JS 执行 `node --check`；启动桌面应用并验证受影响链路。语法通过不等于 Electron API 或功能通过。 |
| 窗口、托盘、快捷键          | 启动、关闭隐藏、托盘唤回、第二实例、退出；播放/暂停/切歌及状态同步。                                  |
| 悬浮歌词                    | 歌曲标题、原文与翻译、开关、样式、拖动结束、鼠标穿透；涉及边界时检查多显示器与缩放场景。              |
| 本地音频                    | 有/无标签、有/无 `.lrc`、歌词编码异常和损坏音频的返回及界面表现；已有曲目路径仍能读取。               |
| 登录 / 网络 / 代理          | 受影响平台的请求、登录回调和 Cookie；系统、直连、自定义代理及重启后的配置。记录平台和验证条件。       |
| 打包配置                    | 针对修改目标核对脚本、资源和版本，进行相关平台构建；需要发布时另核对标签条件和更新源。                |

已安装根目录开发依赖时，可在根目录直接检查这两份维护文档，Prettier 会按文件查找各自配置：

```sh
node node_modules/prettier/bin/prettier.cjs --check AGENTS.md app/listen1_chrome_extension/AGENTS.md
```

结束任务前分别查看两个仓库的状态与差异，确认只包含预期改动。子模块中的文件需要在子模块仓库独立纳入版本管理；父仓库显示子模块有改动，不代表已保存其中的文件。交付说明应包含改动内容、验证结果、未验证范围和相关的既有差异。
