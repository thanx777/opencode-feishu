@echo off
REM ============================================================
REM stop-serve.bat
REM Stop opencode serve (lowercase opencode.exe) started by start-serve.bat.
REM Will NOT touch OpenCode.exe (desktop).
REM ============================================================

setlocal
set PORT=4096
set SCRIPT_DIR=%~dp0
set PID_FILE=%SCRIPT_DIR%logs\serve.pid

REM 1. Try to kill by saved PID
if exist "%PID_FILE%" (
  set /p SAVED_PID=<"%PID_FILE%"
  if not "%SAVED_PID%"=="" (
    REM Verify it's opencode.exe (lowercase), not OpenCode.exe (desktop, uppercase O)
    tasklist /FI "PID eq %SAVED_PID%" /FO LIST 2>nul | findstr /I "Image Name:" | findstr /I "opencode.exe" >nul 2>&1
    if %ERRORLEVEL%==0 (
      taskkill /PID %SAVED_PID% /F >nul 2>&1
      if %ERRORLEVEL%==0 (
        echo [OK] Killed opencode serve PID=%SAVED_PID%
        del "%PID_FILE%" 2>nul
        exit /b 0
      ) else (
        echo [WARN] taskkill failed for PID=%SAVED_PID%
      )
    ) else (
      echo [INFO] Saved PID=%SAVED_PID% is not opencode.exe, ignoring (protect desktop)
      del "%PID_FILE%" 2>nul
    )
  )
)

REM 2. Fallback: kill any opencode.exe holding the port
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":%PORT% " ^| findstr "LISTENING"') do (
  tasklist /FI "PID eq %%P" /FO LIST 2>nul | findstr /I "Image Name:" | findstr /I "opencode.exe" >nul 2>&1
  if %ERRORLEVEL%==0 (
    taskkill /PID %%P /F >nul 2>&1
    if %ERRORLEVEL%==0 (
      echo [OK] Killed opencode.exe on port %PORT% PID=%%P
    )
  ) else (
    echo [WARN] Port %PORT% owner PID=%%P is NOT opencode.exe, skipped
  )
)
exit /b 0
