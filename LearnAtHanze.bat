@echo off
rem One-click launcher: starts LearnAtHanze in a hidden window and opens it in your browser.
rem If it is already running it only opens the browser. Works from any location (double-click, shortcut, cmd).
rem Close it with "Stop LearnAtHanze.bat". Details: README, section "One-click launcher".
pushd "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\launch.ps1"
set "CODE=%ERRORLEVEL%"
popd
exit /b %CODE%
