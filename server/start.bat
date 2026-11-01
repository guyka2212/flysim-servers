@echo off
rem Starts the FPV Sim server.   start.bat          asks for the port
rem                               start.bat 25580    on that port
rem                               start.bat gui      also opens the admin window
cd /d "%~dp0"
title FPV Sim server
set "NODE=node"
if exist "%~dp0runtime\node.exe" set "NODE=%~dp0runtime\node.exe"
"%NODE%" flysim-server.mjs %*
echo.
echo Server stopped.
pause
