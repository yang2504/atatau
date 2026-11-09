@echo off
setlocal DisableDelayedExpansion
set "runtime=%~dp0runtime\node.exe"
set "server=%~dp0backend\src\server.js"
if not exist "%runtime%" (
  echo Falta runtime\node.exe junto al archivo de inicio.
  goto :incomplete
)
if not exist "%server%" (
  echo Falta backend\src\server.js junto al archivo de inicio.
  goto :incomplete
)
if not exist "%~dp0frontend\dist\index.html" (
  echo Falta la interfaz de Atatau junto al archivo de inicio.
  goto :incomplete
)
if not defined ATATAU_DB set "ATATAU_DB=%LOCALAPPDATA%\HostelAtatau\data\atatau.sqlite"
echo Iniciando Hostel Atatau...
"%runtime%" "%server%" --open
set "result=%errorlevel%"
if "%result%"=="0" exit /b 0
echo.
echo Atatau se detuvo con el codigo %result%. Revisa el mensaje de arriba.
pause
exit /b %result%

:incomplete
echo Haz clic derecho en el ZIP y elige "Extraer todo".
echo Abre Iniciar-Atatau.cmd desde la carpeta extraida, junto a runtime, backend y frontend.
pause
exit /b 1
