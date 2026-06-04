@echo off
setlocal
set LOG=D:\Vibecoding\Opencode_Project\logs\test.log
set OPENCODE_EXE=C:\Users\thanx\AppData\Local\Programs\opencode\opencode.exe
if not exist D:\Vibecoding\Opencode_Project\logs mkdir D:\Vibecoding\Opencode_Project\logs

echo TEST START > "%LOG%"

start "" /B "%OPENCODE_EXE%" serve --port 4096 --hostname 0.0.0.0 --print-logs >> "%LOG%" 2>&1

echo TEST SPAWNED PID placeholder >> "%LOG%"
exit /b 0
