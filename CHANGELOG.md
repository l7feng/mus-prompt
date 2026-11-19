# 变更记录

> 2026-11-09 建立。按时间倒序记录提交；版本号以 `package.json` 的 `version` 为唯一真源，发布标签以 `git tag` 为准。建立前的逐版说明未单独保留，回溯以 `git log` 为唯一来源。

| 日期 | 提交 | 说明 |
| --- | --- | --- |
| 2026-11-19 | 工作区（未提交） | 删页：去掉旧的 SOP 一（题材分流 + 取向卡），原 SOP 二 词条点选页改名 **SOP 一**，与设置页并列，页签只剩「SOP 一 / 设置」；`index.html` 删掉旧页整块与 `sop1.js` 引用（脚本留档 `sop1.js.bak-20261119-removed`），`app.js`／`main.js` 的 `PAGE_KEYS`、`DEFAULT_PAGE_NAMES`、`--probe` 断言同步收敛到两页，设置页页面名输入从三项减为两项；顶栏状态灯改由词表载入驱动（`词表已就位`／`词表异常`），不再挂在已删的契约校验上 |
| 2026-11-14 | 工作区（未提交） | 两页导出按钮旁新增**输出路径条 + 一键跟过去**：SOP 一「生成并导出」、SOP 二「导出 .md」各带一条路径（默认显示 `…\state\exports`，完整路径在悬停提示里），点路径或旁边「打开目录」即在资源管理器跳过去；导出成功后路径条换成产物文件名，一点就定位到该文件。主进程新增 `export:dir`、`export:reveal`（`shell.openPath`／`shell.showItemInFolder`，`basename` 归一后校验仍在 `state/exports` 内）；preload 增加 `exportDir`／`revealExport`；`app.js` 抽出 `mountExportPath` 供两页复用。SOP 二 的「导出 .md」由标题行移入提示词下方的按钮条。`--probe` 增加 `exportPaths`／`exportPathsAfter`／`revealGuard` 与路径条版面量尺 |
| 2026-11-14 | 工作区（未提交） | SOP 二 提示词下新增**只读中文对照**：同一句式骨架、同一分支条件逐行生成中文（总述／用途·时代·场景／情绪·氛围／乐器／律动·制作·参数／结构与时长／循环／对白友好／人声限制），词条取 `cn`、参数取实名；英文提示词与「复制」内容一字未改。导出 `.md` 追加「## 中文对照（只读，不进 Style 栏）」段；手改英文后中文块改标「仅作对照」。`--probe` 增加 `snap.cnLines/cnHead` 与 `sop2Layout`（中文块可见高度、横向溢出、标签截断、body 溢出）版面量尺 |
| 2026-11-13 | 工作区（未提交） | 双页化：原界面成为 SOP 一，新增 SOP 二（词条点选生成器，`config/sop2-vocab.json` 为唯一词表真源，句式骨架与 MATRIX WAVE 提示词生成器同构）与设置页（页面改名、路径只读、CLI 命令、MCP stdio/HTTP 与令牌查看）；主进程新增 `ui:load/save`、`sop2:load/export`、`clipboard:write-text`、`app:info`、`mcp:token`；新增 `--probe` DOM 断言验收；`scripts/build.py` 适配库内 `01-情绪框架.md` 2026-11-12 改版表头 |
| 2026-11-11 | `4bf221c` | 精简界面与导出文案：去掉契约状态栏、页脚、工程阶段与技术校验说明；标题改为「影视配乐 · Suno 提示词」，标签与提示改为平实中文，结果区只显示文件名；导出文件去掉项目阶段、哈希、来源表和自检说明，只保留条目、Styles、中文翻译与歌词框 |
| 2026-11-11 | `2499623` | 增加 AI 接入：`scripts/cli.py`（status／templates／fields／cues／schema／resolve／render）与 `scripts/mcp_server.py`（stdio、Streamable HTTP、旧版 SSE，Bearer 令牌与私网白名单）；`render.py` 增加 `--resolve-only`；AI 可自动解析取向卡，落盘限 `state/` 三子目录，无卡与自检失败即拦截 |
| 2026-11-11 | `800444f` | 接入 S0 题材分流与 S1.5：中国/世界两套模板、四字段受控词表与 20 张取向卡；无卡不生成，中国音色域覆盖时显式降级；数据版本 `2026-11-11-02` |
| 2026-11-11 | `0c38356` | 歌词框旁新增「复制 `[Instrumental]`」与「复制 `Instrumental`」两个按钮；主进程剪贴板写入只放行这两个常量，preload 增加第五个白名单动作 `copyText`，界面给出「已复制」反馈 |
| 2026-11-11 | `2b2c208` | 更名 `mus-prompt`：产品显示名 `MUS Prompt`，界面窗口标题、HTML 标题与 H1 同步；本地源码仓与 GitHub 仓改名；便携包目录、exe 与桌面快捷方式同步 |
| 2026-11-10 | `2b2c208` | 按人类听感裁决放宽非 Suno 模型闸门：SA3 放行「现役」行首、MUS-3 收录「冻结」 |
| 2026-11-09 | `b4ce335` | chore: 初始化仓库并提交现有源码 |

## 版本真源约定

- 应用版本号只写在 `package.json`，不另建 `VERSION` 文件：避免与 Electron 发行包根的 `version`（运行时版本标记）混淆，也避免产生第二份版本声明。
- 发行包根 `version` 文件的内容是 Electron 运行时版本（当前 `44.9.3`），**不是应用版本号**。
- 派生数据版本写在 `build/manifest.json` 的 `data_version`，由 `scripts/build.py` 按构建日期生成，与应用版本号互不等同。

## 2026-11-09 修复记录（非提交条目）

- 原表首行提交说明曾因编码错乱显示乱码，已按 `git log` 原文订正。
- `scripts/build.py` 的样例真源路径由 `样例/Suno-13条示例.md` 更正为磁盘真名 `样例/示例.md`（依据项目 90 治理记录与 `06-配乐生成模板/README.md`）；发行包与源码仓同步，两边 `build/` 重新派生。
- 发行包 `README.md` 的源码仓路径由不存在的 `D:/Ai-Files/Repos/GitHub/score-prompt-generator` 更正为 `D:/Ai-Files/Repos/score-prompt-generator`。
- 整包 `SHA256SUMS.txt` 重算并全量校验；变更前基线存于同批检查报告目录。
