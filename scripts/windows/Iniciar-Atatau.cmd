@echo off
setlocal
cd /d "%~dp0"
if not defined ATATAU_DB set "ATATAU_DB=%LOCALAPPDATA%\HostelAtatau\data\atatau.sqlite"
echo Iniciando Hostel Atatau...
"runtime\node.exe" "backend\src\server.js" --open
if errorlevel 1 (
  echo.
  echo Si Atatau ya esta abierto, entra en http://127.0.0.1:3001.
  pause
)
