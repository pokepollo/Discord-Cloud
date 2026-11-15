@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js no esta instalado. Descargalo desde https://nodejs.org/
  pause
  exit /b 1
)

if not exist node_modules (
  echo Instalando dependencias...
  call npm install
  if errorlevel 1 (
    echo [ERROR] Fallo al instalar dependencias.
    pause
    exit /b 1
  )
)

if not exist .env (
  echo No se encontro configuracion. Iniciando asistente de consola...
  echo.
  node setup.js
  if errorlevel 1 (
    echo [ERROR] La configuracion no se completo correctamente.
    pause
    exit /b 1
  )
)

echo.
echo Iniciando Discord Cloud...
echo Abre http://localhost:3000 en tu navegador.
echo Pulsa Ctrl+C para detener el servidor.
echo.
node server.js
pause
