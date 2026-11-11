# 变更记录

> 2026-11-09 建立。按时间倒序记录提交；版本号以 `package.json` 的 `version` 为唯一真源，发布标签以 `git tag` 为准。建立前的逐版说明未单独保留，回溯以 `git log` 为唯一来源。

| 日期 | 提交 | 说明 |
| --- | --- | --- |
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
