rem @echo off
rem starts or restars webserver

taskkill /f /im node.exe > NUL
set BINPATH=%~dp0..\node_bin
cd /d %~dp0
start cmd /k %BINPATH%\node server.js

