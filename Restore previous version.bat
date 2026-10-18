@echo off
setlocal
title Go back to the previous Control Hub version
cd /d "%~dp0"

rem Puts back Control Hub and Control Hub Service as they were before the last update.
rem Settings, logins and the panel layout are not touched (they live in %APPDATA%\ControlHub).

if not exist "previous\Control Hub Service.exe" (
  echo There is no previous version to go back to.
  pause
  exit /b 1
)
taskkill /im "Control Hub.exe" /f >nul 2>nul
taskkill /im "Control Hub Service.exe" /f >nul 2>nul
timeout /t 2 /nobreak >nul
copy /y "previous\Control Hub Service.exe" "%~dp0" >nul
if errorlevel 1 goto failed
copy /y "previous\Control Hub.exe" "%~dp0" >nul
if errorlevel 1 goto failed
if exist "previous\version.json" copy /y "previous\version.json" "%~dp0" >nul
start "" /D "%~dp0." "%~dp0Control Hub Service.exe"
start "" /D "%~dp0." "%~dp0Control Hub.exe"
echo Done: the previous version is back.
timeout /t 6 >nul
exit /b 0

:failed
echo Couldn't put the previous version back. Close Control Hub and try again.
pause
exit /b 1
