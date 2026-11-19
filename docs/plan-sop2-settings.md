---
type: 实施计划
title: mus-prompt 双页化 + SOP 二 + 设置页（MCP/CLI 入口）
created: 2026-11-13
updated: 2026-11-13
status: 进行中
domain: 软件工程
stack: 桌面应用Electron
tags: [计划, SOP二, 提示词生成器, MCP, CLI, 设置页]
source: 2026-11-13 人类指令「此项目继续更新，添加两个页面」；SOP 二 参照本机 MATRIX WAVE 提示词生成器的底层逻辑
---

# 双页化 + SOP 二 + 设置页 · 实施计划

## 一、目标（人类原话拆解）

1. 现有页面定名 **SOP 一**；新增页面 **SOP 二**；再加一个承载 MCP/CLI 的 **设置页**。三个页面名称都可改（人类暂未定名，先给默认名）。
2. **SOP 二** 仿写本机 `D:\MATRIX WAVE-win32-x64` 的提示词生成器**底层逻辑**（不是抄界面像素，是抄数据驱动方式与句式合成规则）。
3. 该软件的 **MCP 与 CLI** 能力，收进**设置页**展示与调用（现在只存在于 cmd 脚本和 README，界面里看不见）。
4. 「词分类条看不清就先做能看见的模板，后面我给词表」——先交付**结构完整、词表可替换**的种子版。

## 二、对 MATRIX WAVE 的逆向结论（要仿的底层逻辑）

从 `resources\app\static\index.html`（前端，778 KB 单行）+ `static\ai_data.json` 读出：

| 层 | 它的做法 | 本仓对应实现 |
| --- | --- | --- |
| 字段定义表 `FIELD_DEF` | 每个维度声明 `{label, data|ref, single, grouped}` | `config/sop2-vocab.json` 的 `fields[]`，同一套声明式口径 |
| 分类条 `MODE_FIELDS.bgm` | 用途→时代背景→场景→情绪→空间氛围→镜头感→乐器→节奏→调式→配乐结构→制作→结尾，尾部固定追加「乐器组合 Packs」「一键模板」 | 分类条由 `fields` 顺序生成，`packs`/`templates` 常驻尾部 |
| 词条交互 | 词条 chip 多选；`single` 维度（调式、配乐结构）单选互相顶替；跨字段搜索；`on` 态高亮 | 同 |
| 右侧三块 | 当前选择（按类分组、可逐条删/整类清）→ 参数（BPM、时长、循环、强制无人声、适合对白）→ 提示词框（可编辑、可复制、可重置） | 同，字段顺序与参数一致 |
| 句式合成 `formatBGM()` | 固定句 1「Instrumental only, no vocals, no lyrics.」→ 用途句（含 a/an、set in、during）→ 情绪+氛围句 → 乐器句「Featuring …」→ 镜头+制作+节奏+「around N BPM」句 → 配乐结构+结尾+时长句 → 循环句 → 对白友好句 → 无人声收束句 | 1:1 复刻句式骨架，词条只从词表取，不自由输入 |
| 一键模板 `templates` | 模板 = 一批 `sel` + bpm + loop + dialogue，点击即灌入左侧选择 | 同 |
| 乐器组合 `packs` | 名称 → 逗号分隔乐器串，点击批量加入乐器维度 | 同 |
| 词表真源 | `ai_data.json`（外部软件内置） | `config/sop2-vocab.json`（本仓唯一真源，可整份替换） |

**分类条可读性核查**：截图里 14 个分类名可辨认（用途 Usage / 时代背景 Era·Setting / 场景 Scene / 情绪 Mood / 空间氛围 Atmosphere / 镜头感 Motion / 乐器 Instruments / 节奏 Rhythm / 调式 Key / 配乐结构 BGM Structure / 制作 Production / 结尾 Ending / 乐器组合 Packs / 一键模板）。只有「用途」下的 15 条词条可辨认，其余维度词条被折叠，故本轮词表用 MATRIX WAVE 内置 BGM 词表做**种子**，并留「整份替换」口子。

## 三、约束（不许破的既有契约）

- `renderer` 不碰 fs、不内嵌词表副本；词表经 IPC 从 main 读取（沿用 STRUCTURE.md 依赖方向 `renderer → preload → main`）。
- SOP 一 的 S0 题材分流 / S1.5 四字段 / 取向卡 / `render.py` 导出 / 自检 / CLI / MCP 全部保持原样可用。
- 主进程只做 IPC 与文件读写；不写界面逻辑。
- 便携包 `D:\Ai-Files\Tools\Exe\10-MUS Prompt（配乐提示词生成）\mus-prompt\` 与源码仓同步（该包由源码仓直接打包）。

## 四、阶段与产物

| 阶段 | 内容 | 产物 | 验收 |
| --- | --- | --- | --- |
| **P1 应用骨架** | 顶部三页导航 + 页面切换；原单页内容整块迁成「SOP 一」；页面名称默认值 + 持久化 | `src/renderer/index.html`、`app.js`、`sop1.js`（原 `renderer.js` 平移）、`style.css` 增补；`main.js` 增 `ui:load`/`ui:save`；`preload.js` 白名单 | 三页可切；SOP 一 原有导出仍 PASS；改名后重启仍生效 |
| **P2 SOP 二** | 词表数据文件；分类条 + 词条点选 + 跨字段搜索；当前选择 / 参数 / 提示词三块；`formatBGM` 句式合成；一键模板 + 乐器组合；复制与重置 | `config/sop2-vocab.json`、`src/renderer/sop2.js`；`main.js` 增 `sop2:load` | 14 分类条齐全；点选实时改变提示词；模板灌入正确；复制可用 |
| **P3 设置页** | 页面名称编辑；数据与路径（vault_root、数据版本、哈希、校验态）；CLI 命令清单按 `scripts/cli.py` 真实子命令；MCP stdio / 本机 HTTP / 局域网 HTTP 配置与 `config/mcp.token` 查看；一键复制 | `src/renderer/settings.js`；`main.js` 增 `mcp:info` | 命令与本机脚本实际一致；令牌可查看；复制可用 |
| **P4 收口** | SOP 二 产物导出 `.md`（`state/exports`，不覆盖）；冒烟：真窗口启动 + 截图核对 + SOP 一 自动导出 PASS；同步便携包；`README`/`CHANGELOG`/版本号/`SHA256SUMS.txt` | `main.js` 增 `sop2:export`；文档与包 | 双击 exe 可启动；截图三页正常；哈希表与实际文件一致 |

## 五、词表替换口子（等人类给正式词表时）

- 只需要替换 `config/sop2-vocab.json` 一份文件：`fields[]`（id / 中英名 / 是否单选 / 是否分组 / 词条 `[中文, 英文]`）、`packs[]`、`templates[]`。
- 代码里不出现任何词条常量；新增维度、删维度、改词条都不动 JS。
- 词表文件里写 `version` 与 `source`，替换后界面状态栏直接显示新版本。

## 六、进度

- [x] **P1 应用骨架**（2026-11-13 完成）— `renderer.js` 平移为 `sop1.js`；`index.html` 改成 `topbar(pagenav) + page-sop1 / page-sop2 / page-settings`；`app.js` 管切页与改名；`main.js` 增 `ui:load` / `ui:save`（写 `STATE_ROOT/ui.json`，名长上限 12）；`preload` 白名单加 `loadUi` / `saveUi`。验收：探针 `activePage=page-sop1`、三页存在、改名保存后重载仍生效。
- [x] **P2 SOP 二**（2026-11-13 完成）— `config/sop2-vocab.json`（schema `mus-sop2-vocab-v1`，version `2026-11-13-01`，12 字段 / 15·61·28·24·20·17·58·8·9·10·12·9 词条 / 12 组乐器组合 / 6 个模板 / 5 条对白用途）；`sop2.js` 整文件 IIFE（首版因经典脚本共享全局词法作用域报 `Identifier 'esc' has already been declared`）；`formatPrompt()` 复刻 `formatBGM` 骨架并在节奏之后补 `in <keymode>`（MATRIX WAVE 原版选了调式却不输出）；`main.js` 增 `sop2:load`（字段 id、词条 `en` 唯一性、模板 sel 引用必须存在）与 `sop2:export`（强制 `-Suno.md`，同名序号插在 `-Suno` 前，不覆盖）。验收：探针 `vocab=词表 2026-11-13-01 · 12 类`，导出反馈「已导出：历史剧配乐-神秘-Suno.md」，落盘 740 字节。
- [x] **P3 设置页**（2026-11-13 完成）— `settings.js`（IIFE）三段：页面名称编辑（保存/恢复默认即时生效）、9 行数据与路径（appRoot / musRoot / 库根 / 数据版本与哈希 / python / stateRoot / exportDir / 词表 / 令牌，均带存在性）、8 条 CLI 命令（按 `cli.py` 真实子命令拼）、5 行 MCP 配置（stdio cmd / 本机 HTTP / 局域网 / Bearer 头 / 令牌文件）；`main.js` 增 `app:info`、`mcp:token`（仅点「查看令牌」时读）、`clipboard:write-text`。验收：探针 `settings.infoRows=9 / cliRows=8 / mcpRows=5`，`firstRow=2026-11-13-02`。
- [x] **P4 收口与同步**（2026-11-13 完成，截图核对一项未做）— 派生数据重建（见下「既有回归」）；`README.md`（仓内与包内）补三页结构、SOP 二 底层逻辑、换词表口子与 `--probe`；`CHANGELOG.md` 增 2026-11-13 条；`package.json` version `0.1.0 → 0.2.0`；`SHA256SUMS.txt` 按新包重算；源码 `src/`、`config/`、`scripts/`、`build/` 全量同步进便携包。

### 验收证据（2026-11-13）

| 项 | 结果 | 证据 |
| --- | --- | --- |
| 启动契约 | `status=已载入`，首行数据版本 `2026-11-13-02` | `D:\My-Temporary\_scratch\probe-p4.json` |
| 渲染进程报错 | `consoleErrors=0` | 同上 |
| SOP 一 导出冒烟 | `PASS=35 FAIL=0`，产物 `01-界面点选-Suno.md` | `resources\app\state\selfcheck.json` |
| SOP 二 导出 | 反馈「已导出：历史剧配乐-神秘-Suno.md」，740 字节 | `D:\My-Temporary\_scratch\p85-state\exports\` |
| 三页 DOM | 三 tab、三 page、激活态、设置页 9/8/5 行齐全，页面名默认「SOP 一／SOP 二／设置」 | `probe-p4.json`、`probe-p4b.json` |
| 像素级版面核对 | **未做**：本机 `capturePage()` 恒报 `UnknownVizError`（含 `--disable-gpu`）；桌面截屏两次授权均未通过（pip 口令授权被关闭、main 授权超时） | 以 DOM 断言替代，见上 |

### 既有回归（本轮发现并修复）

库内 `6-资产-R/00-模板/06-配乐生成模板/共享层/01-情绪框架.md` 于 2026-11-12 改版（八桶改用论文 8 类），桶表头由「桶位｜象限｜轴｜目标情绪状态｜戏剧功能」改为「桶位｜论文类·角度｜目标情绪状态｜覆盖词｜数｜戏剧功能」，`scripts/build.py` 的 `pick(et, "桶位", "象限", "目标情绪状态")` 报 `KeyError: 未找到表头`，派生数据无法重建，SOP 一 启动即 `加载失败`（本次改动前就已如此）。

修法：按新表头取值，`论文类·角度` 拆成兼容字段 `quadrant` / `axis`，新增 `words` / `count`，`dramatic` 取第 6 列，并加「八桶不是 8 行」断言。重建结果：`BUILD_OK 2026-11-13-02`（BUCKETS 8 / RUSSELL28 28 / MOOD15 15 / CUE13 28 / THEMES 2×(10 卡)）。

### 仍未决（等人类给输入）

1. **三页正式名称**：人类明确「暂时没想好名称」，现用默认「SOP 一／SOP 二／设置」，设置页可自行改，改完即时生效、重启保留。
2. **SOP 二 正式词表**：人类说「后面我给你提供」。现为 MATRIX WAVE 内置 BGM 词表种子，`config/sop2-vocab.json` 的 `source` 已注明来源；替换只需覆盖这一份文件，代码零改动。
3. **git 提交**：本轮改动全部留在工作区未提交（仓内另有本次之前就存在的未提交项：`README.md` 修改、`assets/icon.ico` 删除、`assets/icons/` 未跟踪）。

> 阶段完成后回写本节勾选与本阶段验收结论。
