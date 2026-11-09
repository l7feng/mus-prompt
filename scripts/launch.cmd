@echo off
rem Launcher: resolve Electron runtime in order
rem   1) env P85_ELECTRON_HOME
rem   2) config\electron-home.txt (machine-local, gitignored, one line path)
rem   3) %LOCALAPPDATA%\electron\44.9.3
rem Runtime binaries are NOT stored in this repo (369MB, rebuildable from cache).
rem NOTE: no "if (...)" block around "set" + immediate read -- cmd expands %VAR%
rem       at parse time inside blocks and would read the stale value.
setlocal
set "REPO=%~dp0.."
if not "%P85_ELECTRON_HOME%"=="" goto run
if not exist "%~dp0..\config\electron-home.txt" goto try_localappdata
set /p P85_ELECTRON_HOME=<"%~dp0..\config\electron-home.txt"
if not exist "%P85_ELECTRON_HOME%\electron.exe" goto try_localappdata
goto run

:try_localappdata
set "P85_ELECTRON_HOME=%LOCALAPPDATA%\electron\44.9.3"
if exist "%P85_ELECTRON_HOME%\electron.exe" goto run

echo [runtime missing] electron.exe not found. How to restore:
echo   1) Extract %%LOCALAPPDATA%%\electron\Cache\^<hash^>\electron-v44.9.3-win32-x64.zip anywhere
echo   2) Put that folder path as a single line in config\electron-home.txt (machine-local, gitignored)
echo   3) Rerun this script, or run: npm install ^&^& npm start
exit /b 1

:run
start "" "%P85_ELECTRON_HOME%\electron.exe" "%REPO%" %*
exit /b 0
