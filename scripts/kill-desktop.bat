@echo off
REM ============================================================
REM kill-desktop.bat
REM Kill OpenCode.exe (uppercase, desktop) processes ONLY.
REM Will NOT touch opencode.exe (lowercase, the CLI serve).
REM Use this when the desktop is conflicting with CLI serve.
REM ============================================================

echo Killing OpenCode.exe (desktop) processes...

taskkill /IM OpenCode.exe /F

if %ERRORLEVEL%==0 (
  echo.
  echo [OK] OpenCode.exe (desktop) processes killed.
  echo [INFO] opencode.exe (lowercase CLI serve on port 4096) NOT touched.
) else (
  echo.
  echo [WARN] taskkill returned %ERRORLEVEL%. No processes killed (already dead?).
  echo [INFO] This is normal if no OpenCode.exe (desktop) processes were running.
)

echo.
pause
