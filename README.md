# MUS Prompt（mus-prompt）· 配乐提示词点选生成器

> 2026-11-11 起，产品名由「配乐提示词生成器 / score-prompt-generator」更名：界面窗口标题显示 `MUS Prompt`，源码仓目录与 GitHub 仓为 `mus-prompt`。

从库内 `6-资产-R/00-模板/06-配乐生成模板/` 的 md 真源只读派生词表，界面点选后导出 1 条 `-Suno.md` 并跑静态自检。**不写库内文件、不生成音频。**

2026-11-11 起接入 S0 题材分流与 S1.5 四字段：中国模板（默认、取向卡已验收）与世界模板（待实测验收）各带受控词表与 10 张取向卡，无卡命中时不生成成品。

同日开放 AI 接入：`scripts/cli.py` 与 `scripts/mcp_server.py`（stdio／HTTP）复用同一渲染引擎；AI 可自动解析取向卡并落盘成品，但写入范围锁在 `state/` 下。

> 当前状态：**预览版，界面仍在完善**。本仓是开发中的源码，不是可交付成品；可双击试用的打包版在 `D:/Ai-Files/Tools/Exe/`。

## 目录

```text
mus-prompt/
├── src/main/main.js            主进程：真窗口、契约校验、IPC、capturePage 实拍
├── src/preload/preload.js      五个白名单动作，界面拿不到 fs
├── src/renderer/               点选界面（HTML / CSS / JS），经 IPC 只读派生数据
├── assets/icon.ico             应用图标
├── config/config.example.json  配置模板（不含本机实值）
├── config/electron-home.txt    本机 Electron 运行时位置（一行，忽略）
├── scripts/build.py            只读解析库内 md，派生 build/data.js + build/manifest.json
├── scripts/render.py           点选配置 -> S1.5 取向卡 -> 七层字段 -> 1 条 -Suno.md -> 静态自检
├── scripts/cli.py              无界面 CLI：状态、词表、取向卡解析、落盘（与界面同一引擎）
├── scripts/mcp_server.py       MCP：stdio + Streamable HTTP/旧版 SSE（本机或私网）
├── scripts/launch.cmd          启动器（定位外部 electron，不内嵌运行时）
├── tests/smoke-launch.cmd      真启动冒烟
├── docs/adr/                   布局与架构决策
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
| `config/config.local.json` | 本机实值：Python 解释器、`state_home` | 否（已忽略） |
| `config/mcp.token` | MCP 局域网令牌，首次启动自动生成 | 否（已忽略） |

环境变量优先级高于文件：`P85_PYTHON`、`P85_STATE_HOME`、`MUS_MCP_TOKEN`。界面与业务代码不含写死用户名或库根绝对路径。

## 硬约束

- 界面不内嵌词表；下拉项全部来自 `build/data.js`，由 `scripts/build.py` 从库内 md 只读派生。
- 启动校验 `data.js` 与 `manifest.json` 的 SHA256，并逐份重算 11 份库内真源；不一致即拒绝加载。
- 纯器乐锁死：歌词框 `[Instrumental]` 只读、`no vocals` 不可删、无人声开关、无歌曲结构标签。
- 导出必须落盘 `-Suno.md` 并经 `render.py` 静态自检（项数以 `selfcheck.json` 为准）；S1.5 无取向卡时不生成；不自动写回库内。
- AI 接入不开放任意读路径或任意写路径：只读仓内派生数据与配置，只写 `state/` 三个子目录。
- SA3 现役、MiniMax-Music3 冻结，均不出现在界面可选项中；本应用仅产 Suno 提示词。

## 未实测边界

真窗口为 Electron `capturePage()` 窗口内捕获，未做操作系统屏幕级截图；跨机、Obsidian 渲染、其他 Agent 触发、Suno 实际生成／试听／回片均未实测。英文 Styles 为结构验证版，未调用 `suno-prompt-tool` 组织措辞，不可直接用于真实生成。完整 15 栏目界面未实现。

AI 接入已在本机测通 CLI 与 MCP（stdio、HTTP、SSE），局域网仅在绑定 `0.0.0.0` 后经本机私网 IP 访问验证；真实第二台设备、真实第三方 AI 客户端配置、Windows 防火墙实际放行均未实测。

## 关联

- 源码远端：<https://github.com/l7feng/mus-prompt>
- 目录契约：[STRUCTURE.md](STRUCTURE.md)｜布局依据：`6-资产-R/00-模板/07-软件项目布局模板/`
- 词表真源：`6-资产-R/00-模板/06-配乐生成模板/`
- 项目记录：`4-项目-P/85-配乐提示词生成器方案/`
