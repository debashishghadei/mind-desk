@echo off
rem Opens Mind Desk in its own window (Microsoft Edge app mode).
set "P=%~dp0mind-desk.html"
set "P=%P:\=/%"
start "" msedge --app="file:///%P%"
if errorlevel 1 start "" "%~dp0mind-desk.html"
