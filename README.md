# MUS Prompt（mus-prompt）· 配乐提示词点选生成器

> 2026-11-11 起，产品名由「配乐提示词生成器 / score-prompt-generator」更名：界面窗口标题显示 `MUS Prompt`，源码仓目录与 GitHub 仓为 `mus-prompt`。

从库内 `6-资产-R/00-模板/06-配乐生成模板/` 的 md 真源只读派生词表，界面点选后导出 1 条 `-Suno.md` 并跑静态自检。**不写库内文件、不生成音频。**

2026-11-11 起接入 S0 题材分流与 S1.5 四字段：中国模板（默认、取向卡已验收）与世界模板（待实测验收）各带受控词表与 10 张取向卡，无卡命中时不生成成品。

同日开放 AI 接入：`scripts/cli.py` 与 `scripts/mcp_server.py`（stdio／HTTP）复用同一渲染引擎；AI 可自动解析取向卡并落盘成品，但写入范围锁在 `state/` 下。

2026-11-13 起改为**双页**：原界面整块成为 **SOP 一**（题材分流 + 取向卡点选），新增 **SOP 二**（词条点选生成器，底层逻辑仿本机 MATRIX WAVE 提示词生成器）与**设置页**（页面名称、数据路径、CLI 与 MCP 接入）。三个页面名称可在设置页改，落在本机运行态 `state/ui.json`，不进源码仓。

2026-11-19 起缩为**两页**：删除旧的 SOP 一（题材分流 + 取向卡），原 SOP 二 词条点选页改名为 **SOP 一**，与**设置页**并列。界面只剩一条出口：词条点选 → 参数 → 中英提示词 → 导出 `-Suno.md`。旧页脚本留档 `src/renderer/sop1.js.bak-20261119-removed`，`build/data.js` 派生数据保留给 CLI 使用，不再参与界面。

> 当前状态：**预览版，界面仍在完善**。本仓是开发中的源码，不是可交付成品；可双击试用的打包版在 `D:/Ai-Files/Tools/Exe/`。

## 目录

```text
mus-prompt/
├── src/main/main.js            主进程：真窗口、契约校验、IPC（两页 + 词表 + 令牌 + 导出）、可选探针
├── src/preload/preload.js      白名单动作桥接，界面拿不到 fs
├── src/renderer/               界面：index.html + app.js（两页导航）/ sop2.js / settings.js（旧 sop1.js 留档 .bak-20261119-removed）
├── assets/icons/app.ico             应用图标
├── config/config.example.json  配置模板（不含本机实值）
├── config/sop2-vocab.json      SOP 一 词表（唯一真源，整份可替换；文件名沿用 sop2）
├── config/electron-home.txt    本机 Electron 运行时位置（一行，忽略）
├── scripts/build.py            只读解析库内 md，派生 build/data.js + build/manifest.json
├── scripts/render.py           点选配置 -> S1.5 取向卡 -> 七层字段 -> 1 条 -Suno.md -> 静态自检
├── scripts/cli.py              无界面 CLI：状态、词表、取向卡解析、落盘（与界面同一引擎）
├── scripts/mcp_server.py       MCP：stdio + Streamable HTTP/旧版 SSE（本机或私网）
├── scripts/launch.cmd          启动器（定位外部 electron，不内嵌运行时）
├── tests/smoke-launch.cmd      真启动冒烟
├── docs/adr/                   布局与架构决策
├── docs/plan-sop2-settings.md  双页化实施计划与阶段进度
├── build/                      派生数据与打包产物（忽略）
└── STRUCTURE.md                目录契约：顶层分区表与落点路由表
```

## 运行

运行时二进制不入库（约 369MB，可由本机缓存重建）。任选一条：

```bash
# 甲：双击启动（推荐）—— 运行时已解压在构建环境区
scripts\launch.cmd

# 启动器查找顺序：环境变量 P85_ELECTRON_HOME > config\electron-home.txt > %LOCALAPPDATA%\electron\44.9.3
# 本机当前：D:\Ai-Files\Tools\BuildEnv\electron-44.9.3（已写入 config\electron-home.txt，该文件不入库）
# 该目录可由缓存 zip 重建：%LOCALAPPDATA%/electron/Cache/<hash>/electron-v44.9.3-win32-x64.zip

# 乙：标准 npm 工程
npm install
npm start
```

命令行开关（供无人值守验收）：

- `--capture=<绝对路径>`：窗口内容经 `BrowserWindow.capturePage()` 落 PNG（窗口内渲染，非系统截屏）
- `--auto-export`：加载后自动走「点选 → 导出 → 自检」
- `--quit-after`：自动流程结束即退出
- `--probe=<绝对路径>`：加载后 dump 两页结构、SOP 一 生成状态与渲染进程报错到 JSON（截图不可用时的验收路径）

```bash
# 冒烟：不依赖截图的 DOM 断言
"MUS Prompt.exe" --probe=D:\tmp\probe.json --quit-after
```

## 两页结构

| 页面 | 干什么 | 数据来源 | 产物 |
| --- | --- | --- | --- |
| SOP 一 | 词条点选（12 条分类条）→ 参数 → 句式合成；提示词下方带只读**中文对照** | 本仓 `config/sop2-vocab.json`（结构校验，不含在 data.js 内） | `state/exports/<用途>-<情绪>-Suno.md`（含中文对照段） |
| 设置 | 页面改名、路径只读显示、CLI 命令、MCP 配置与令牌 | 主进程按本机 `config.local.json` 读值 | `state/ui.json`（页面名） |

**SOP 一 的底层逻辑**（仿 MATRIX WAVE 提示词生成器）：`fields[]` 字段定义表驱动分类条（用途→时代背景→场景→情绪→空间氛围→镜头感→乐器→节奏→调式→配乐结构→制作→结尾，尾部固定「乐器组合 Packs」「一键模板」）；词条多选、`single` 维度单选互换；右侧 = 当前选择 + 参数（BPM／时长／循环／强制无人声／适合对白）+ 提示词；句式骨架固定（`Instrumental only, no vocals, no lyrics.` → 用途句 → 情绪/氛围句 → 乐器句 → 镜头+制作+节奏+BPM 句 → 结构+结尾+时长句 → 循环/对白 → 无人声收束句），词条只填槽位。

**换词表**：整份替换 `config/sop2-vocab.json` 即可（`fields` / `packs` / `templates` / `dialogue_usages`），JS 里没有任何词条常量；启动时结构校验会挡住断链（模板引用了不存在的维度或词条、字段缺 id、词条英文重复）。

**中文对照（只读）**：英文提示词下方按同一骨架、同一分支条件逐行生成中文，词条取 `cn`、参数取实名（BPM／时长／循环／对白／人声限制），分「总述／用途·时代·场景／情绪·氛围／乐器／律动·制作·参数／结构与时长／循环／对白友好／人声限制」九行；`cn` 只用于界面，不参与句式合成。复制与导出仍只用英文——导出 `.md` 时中文另起「## 中文对照（只读，不进 Style 栏）」一段，避免混进 Suno 的 Style 栏。手改英文后该块标为「仅作对照」，不再声称与英文逐句对应。

**导出路径与一键跟过去**：SOP 一「导出 .md」旁有一条路径条（默认显示 `…\state\exports`，完整路径在悬停提示里），点路径或旁边「打开目录」即在资源管理器里跳过去；导出成功后路径条换成产物文件名，一点就定位到那个文件（`shell.showItemInFolder`）。路径只有主进程一个真源（`state/exports`），渲染进程只交文件名，`export:reveal` 用 `basename` 归一后再校验仍在导出目录内，别的路径开不了壳。

## AI 接入（CLI / MCP）

界面、CLI、MCP 共用 `scripts/render.py`；取向卡由引擎解析，AI 无需也无法自带卡字段。无卡命中时 `resolve` 返回 `NO_CARD`，`render` 在落盘前拦截。

```bash
# CLI（在仓根执行）
python scripts/cli.py status
python scripts/cli.py templates
python scripts/cli.py fields --template nrta-cn-drama
python scripts/cli.py cues --bucket 01-日常温情
python scripts/cli.py schema > selection.schema.json
python scripts/cli.py resolve --selection selection.json
python scripts/cli.py render --selection selection.json --name 场次01
python scripts/cli.py render --selection - --name 场次01   # 从 stdin 读，UTF-8
```

```bash
# MCP：stdio（AI 客户端拉起）
python scripts/mcp_server.py --stdio

# MCP：HTTP（默认仅本机）
python scripts/mcp_server.py --http --host 127.0.0.1 --port 8790

# MCP：局域网（需放行防火墙私网入站；必须带 Bearer）
python scripts/mcp_server.py --http --host 0.0.0.0 --port 8790
```

HTTP 端点为 `POST /mcp`（Streamable HTTP；`Accept: text/event-stream` 时回 SSE）、`GET /sse` + `POST /messages?session_id=`（旧版 SSE）、`GET /health`（同样要令牌）。令牌来源优先级：环境变量 `MUS_MCP_TOKEN` > `--token-file` 指定文件 > `config/mcp.token` 自动生成。默认拒绝非私网客户端；只有显式 `--allow-public` 才放行。

AI 自动落盘只写 `state/exports/`、`state/requests/`、`state/selfchecks/`；文件名强制 `-Suno.md`，同名自动在 `-Suno` 前加序号，不覆盖。CLI 与 MCP 都在写入前跑同一套选择校验与取向卡闸门。

## 配置

| 文件 | 作用 | 是否入库 |
| --- | --- | --- |
| `config/config.example.json` | 模板与默认值（含 `mcp` 段） | 是 |
| `config/sop2-vocab.json` | SOP 一 词表（字段／词条／乐器组合／一键模板） | 是 |
| `config/config.local.json` | 本机实值：Python 解释器、`state_home`、可选的 `sop2_vocab` 改指 | 否（已忽略） |
| `config/mcp.token` | MCP 局域网令牌，首次启动自动生成 | 否（已忽略） |

环境变量优先级高于文件：`P85_PYTHON`、`P85_STATE_HOME`、`MUS_MCP_TOKEN`。界面与业务代码不含写死用户名或库根绝对路径。

## 硬约束

- 界面不内嵌词表；SOP 一 的词条全部来自 `config/sop2-vocab.json`，由 `scripts/build.py` 从库内 md 只读派生后整份替换。
- 词条只有一个真源 `config/sop2-vocab.json`，经主进程 `sop2:load` 送进界面；界面里没有第二份副本。
- 2026-11-19 删除旧 SOP 一 后，界面不再读 `build/data.js`；该文件的 SHA256 校验只在 CLI 侧沿用，界面只看词表结构校验。
- 页面名称只写 `state/ui.json`，不改库内文件、不写 `config/`。
- 纯器乐锁死：歌词框 `[Instrumental]` 只读、`no vocals` 不可删、无人声开关、无歌曲结构标签。
- SOP 一 提示词只产纯配乐，收束句固定为无人声；复制与导出都走主进程 IPC，导出只写 `state/exports/` 且不覆盖同名。
- 纯器乐锁死：歌词框 `[Instrumental]` 只读、`no vocals` 不可删、无人声开关、无歌曲结构标签。
- 导出必须落盘 `-Suno.md` 并经 `render.py` 静态自检（项数以 `selfcheck.json` 为准）；S1.5 无取向卡时不生成；不自动写回库内。
- AI 接入不开放任意读路径或任意写路径：只读仓内派生数据与配置，只写 `state/` 三个子目录。
- SA3 现役、MiniMax-Music3 冻结，均不出现在界面可选项中；本应用仅产 Suno 提示词。

## 未实测边界

真窗口为 Electron `capturePage()` 窗口内捕获，未做操作系统屏幕级截图；跨机、Obsidian 渲染、其他 Agent 触发、Suno 实际生成／试听／回片均未实测。英文 Styles 为结构验证版，未调用 `suno-prompt-tool` 组织措辞，不可直接用于真实生成。完整 15 栏目界面未实现。

2026-11-13 补充边界：

- 本机（Administrator / Windows）`capturePage()` 报 `UnknownVizError`，`--capture` 不可用；本轮验收改用 `--probe` 的 DOM 断言（页结构、SOP 生成状态、设置页行数、渲染进程报错）。桌面截屏授权超时，**未做像素级版面核对**。
- SOP 一 种子词表来自本机 MATRIX WAVE 内置 BGM 词表，标在 `config/sop2-vocab.json` 的 `source` 字段；正式词表待替换后重跑一次结构与句式核对。
- `scripts/build.py` 已适配库内 `共享层/01-情绪框架.md` 的 2026-11-12 改版（桶表头由「桶位/象限/轴…」改为「桶位/论文类·角度/目标情绪状态/覆盖词/数/戏剧功能」）；`quadrant` / `axis` 字段保留为兼容字段，值为论文类与角度。
- SOP 一 的「调式」已进入句式（`in minor key`），MATRIX WAVE 原实现选了不输出，这里按可用性修正。

2026-11-14 补充边界：

- SOP 一 新增只读中文对照，验收走 `--probe` 的版面量尺（`sop2Layout`：中文块可见高度、`scrollWidth == clientWidth` 无横向溢出、标签是否被截断、`body` 是否横向溢出）与导出 `.md` 回读；**仍无操作系统屏幕级截图**——本轮切换主桌面取图被用户拒绝授权，未做像素级目视核对。
- 中文对照按词条 `cn` 与当前参数逐行生成，不做英文回译；手改英文后中文块只标「仅作对照」，两者可能不一致。
- 导出路径条与一键跳转已实测：`--probe` 里 `exportPaths`／`exportPathsAfter` 断言路径条排出来、导出后换成产物文件名，`revealGuard` 断言不存在的文件被挡住且不弹窗；真跳转另做了一次 `shell.showItemInFolder` 直测，用 COM 只读枚举资源管理器窗口，确认新窗口落在 `state\exports`（验证用的窗口随后由脚本关闭，临时分支已撤除）。

AI 接入已在本机测通 CLI 与 MCP（stdio、HTTP、SSE），局域网仅在绑定 `0.0.0.0` 后经本机私网 IP 访问验证；真实第二台设备、真实第三方 AI 客户端配置、Windows 防火墙实际放行均未实测。

## 关联

- 源码远端：<https://github.com/l7feng/mus-prompt>
- 目录契约：[STRUCTURE.md](STRUCTURE.md)｜布局依据：`6-资产-R/00-模板/07-软件项目布局模板/`
- 词表真源：`6-资产-R/00-模板/06-配乐生成模板/`
- 项目记录：`4-项目-P/85-配乐提示词生成器方案/`

2026-11-19 补充边界：

- 删除旧 SOP 一 后，界面只剩一页 SOP 一 + 设置；`--probe` 已复跑，`tabs` 为 `["SOP 一", "设置"]`、`pages` 只有 `page-sop2`／`page-settings`，无渲染进程报错。
- 本机 `capturePage()` 仍报错，网站卡片用的窗口实拍改用 Win32 `PrintWindow`（客户区、150% 缩放下按 1800 宽取图后缩到 1600），不是 `--capture`。
