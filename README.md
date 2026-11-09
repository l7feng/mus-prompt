# score-prompt-generator · 配乐提示词点选生成器

从库内 `6-资产-R/00-模板/06-配乐生成模板/` 的 md 真源只读派生词表，界面点选后导出 1 条 `-Suno.md` 并跑静态自检。**不写库内文件、不生成音频。**

> 当前状态：**C 阶段最小可运行窗口，界面为部分实现**（完整 15 栏目界面尚未完成）。本仓是开发中的源码，不是可交付成品；打包发布留到 C 阶段收官后，成品出口为 `D:/Ai-Files/Tools/Exe/`。

## 目录

```text
score-prompt-generator/
├── src/main/main.js            主进程：真窗口、契约校验、IPC、capturePage 实拍
├── src/preload/preload.js      四个白名单动作，界面拿不到 fs
├── src/renderer/               点选界面（HTML / CSS / JS），经 IPC 只读派生数据
├── assets/icon.ico             应用图标
├── config/config.example.json  配置模板（不含本机实值）
├── config/electron-home.txt    本机 Electron 运行时位置（一行，忽略）
├── scripts/build.py            只读解析库内 md，派生 build/data.js + build/manifest.json
├── scripts/render.py           点选配置 -> 七层字段 -> 1 条 -Suno.md -> 26 项静态自检
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

## 配置

| 文件 | 作用 | 是否入库 |
| --- | --- | --- |
| `config/config.example.json` | 模板与默认值 | 是 |
| `config/config.local.json` | 本机实值：Python 解释器、`state_home` | 否（已忽略） |

环境变量优先级高于文件：`P85_PYTHON`、`P85_STATE_HOME`。界面与业务代码不含写死用户名或库根绝对路径。

## 硬约束

- 界面不内嵌词表；下拉项全部来自 `build/data.js`，由 `scripts/build.py` 从库内 md 只读派生。
- 启动校验 `data.js` 与 `manifest.json` 的 SHA256，并逐份重算 9 份库内真源；不一致即拒绝加载。
- 纯器乐锁死：歌词框 `[Instrumental]` 只读、`no vocals` 不可删、无人声开关、无歌曲结构标签。
- 导出必须落盘 `-Suno.md` 并经 `render.py` 的 26 项静态自检；不自动写回库内。
- 骨架模型 SA3／MiniMax-Music3 不出现在界面可选项中。

## 未实测边界

真窗口为 Electron `capturePage()` 窗口内捕获，未做操作系统屏幕级截图；跨机、Obsidian 渲染、其他 Agent 触发、Suno 实际生成／试听／回片均未实测。英文 Styles 为结构验证版，未调用 `suno-prompt-tool` 组织措辞，不可直接用于真实生成。完整 15 栏目界面未实现。

## 关联

- 目录契约：[STRUCTURE.md](STRUCTURE.md)｜布局依据：`6-资产-R/00-模板/07-软件项目布局模板/`
- 词表真源：`6-资产-R/00-模板/06-配乐生成模板/`
- 项目记录：`4-项目-P/85-配乐提示词生成器方案/`
