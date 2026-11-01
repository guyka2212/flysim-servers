@echo off
rem FPV Sim server installer for Windows.
rem Double-click it: it makes a "FPV-Sim-Server" folder next to this file and downloads the server
rem into it, plus a private copy of Node.js if this PC does not have Node.js 18 or newer.
rem Run it again any time to update: your settings, EULA and bans are kept.
setlocal
set "REPO=https://raw.githubusercontent.com/guyka2212/flysim-servers/main/server"
set "DEST=%~dp0FPV-Sim-Server"
echo.
echo  FPV Sim server installer
echo  Installing into: %DEST%
echo.
if not exist "%DEST%" mkdir "%DEST%"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12;" ^
  "$files='flysim-server.mjs','maps.json','admin.html','start.bat','start.sh','Tunnel.md','README.md';" ^
  "foreach($f in $files){ Write-Host ('  downloading ' + $f); Invoke-WebRequest -UseBasicParsing ('%REPO%/' + $f) -OutFile (Join-Path '%DEST%' $f) }"
if errorlevel 1 (
  echo.
  echo  Download failed. Check your internet connection and try again.
  pause
  exit /b 1
)

rem Node.js: use the installed one if it is new enough, otherwise fetch a private copy.
set "NEED_NODE=1"
for /f "tokens=1 delims=v." %%a in ('node --version 2^>nul') do if %%a GEQ 18 set "NEED_NODE=0"
if exist "%DEST%\runtime\node.exe" set "NEED_NODE=0"
if "%NEED_NODE%"=="1" (
  echo.
  echo  Node.js 18+ not found: downloading a private copy into FPV-Sim-Server\runtime ...
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12;" ^
    "$v=(Invoke-RestMethod https://nodejs.org/dist/index.json | Where-Object { $_.lts } | Select-Object -First 1).version;" ^
    "$arch= if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') {'arm64'} else {'x64'};" ^
    "$name='node-'+$v+'-win-'+$arch; $zip=Join-Path $env:TEMP ($name+'.zip');" ^
    "Write-Host ('  Node.js '+$v+' ('+$arch+')'); Invoke-WebRequest -UseBasicParsing ('https://nodejs.org/dist/'+$v+'/'+$name+'.zip') -OutFile $zip;" ^
    "Expand-Archive $zip -DestinationPath $env:TEMP -Force; $rt=Join-Path '%DEST%' 'runtime';" ^
    "if (Test-Path $rt) { Remove-Item $rt -Recurse -Force }; Move-Item (Join-Path $env:TEMP $name) $rt; Remove-Item $zip"
  if errorlevel 1 (
    echo  Could not download Node.js. Install it from https://nodejs.org and run this again.
    pause
    exit /b 1
  )
)

echo.
echo  Done. Next:
echo   1. Open FPV-Sim-Server and double-click start.bat once: it makes eula.txt and server.settings.
echo   2. In eula.txt change  eula=false  to  eula=true .
echo   3. In server.settings set  Owner-user-name=  to your user name in the game.
echo   4. Run start.bat again (start.bat gui for the admin window).
echo   5. Friends outside your network: see Tunnel.md (playit.gg).
echo.
pause
