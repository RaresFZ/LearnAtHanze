@echo off
rem Stops LearnAtHanze cleanly: ends a running live game, closes the phone port, then exits.
rem Add -Force to skip the question that is asked when a live game is running.
pushd "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\stop.ps1" %*
set "CODE=%ERRORLEVEL%"
popd
if "%CODE%"=="0" (
  if not defined NO_PAUSE timeout /t 2 >nul
) else (
  if not defined NO_PAUSE pause
)
exit /b %CODE%
