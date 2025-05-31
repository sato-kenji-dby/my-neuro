@echo off
cd /d %~dp0
echo ��������MCP������...
"..\node\node.exe" server.js
if %ERRORLEVEL% NEQ 0 pause
exit
