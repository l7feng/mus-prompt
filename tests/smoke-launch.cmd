@echo off
rem 真启动冒烟：开真窗口 -> 自动点选 -> 导出 -Suno.md -> 静态自检 -> 退出。
rem 通过判据：退出码 0，且 selfcheck.json 的 failed 计数为 0。
setlocal
set REPO=%~dp0..
if "%P85_ELECTRON_HOME%"=="" (
  echo [FAIL] 未设置 P85_ELECTRON_HOME（应指向含 electron.exe 的目录）
  exit /b 2
)
if "%P85_STATE_HOME%"=="" set P85_STATE_HOME=%TEMP%\p85-smoke
if not exist "%P85_STATE_HOME%\exports" mkdir "%P85_STATE_HOME%\exports"
"%P85_ELECTRON_HOME%\electron.exe" "%REPO%" --capture="%P85_STATE_HOME%\exports\smoke-window.png" --auto-export --quit-after
echo [OK] 冒烟退出码 %ERRORLEVEL%，产物目录 %P85_STATE_HOME%

