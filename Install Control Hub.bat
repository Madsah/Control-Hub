@echo off
setlocal
title Install Control Hub
cd /d "%~dp0"

rem Control Hub installer. Also used for every update: Control Hub downloads the new version from GitHub and
rem starts THIS file from it with /update, so the newest installer always does the installing.
rem
rem It builds Control Hub Service and the Control Hub app with the C# compiler that comes with Windows,
rem keeps the installed version in "previous" (for "Go back"), installs for your user (no admin needed),
rem adds a Start menu shortcut, starts the service, copies the panel code to Control Hub (the widget's starter in
rem iCUE loads it from there, so iCUE is only opened when the starter itself changed) and runs the install step
rem of any project in the projects folder. If building fails, nothing is changed.

set "MODE=%~1"
set "DEST=%LOCALAPPDATA%\Programs\Control Hub"
set "BUILD=%TEMP%\ControlHubBuild"
if /i "%MODE%"=="/update" title Updating Control Hub

set "CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC%" set "CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe"
if not exist "%CSC%" (
  echo Could not find the .NET Framework 4 compiler on this PC.
  echo Turn on ".NET Framework 4.8 Advanced Services" in "Turn Windows features on or off", then try again.
  pause
  exit /b 1
)

set "REFS=/r:System.dll /r:System.Core.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll /r:System.Web.Extensions.dll /r:Microsoft.CSharp.dll /r:System.Security.dll /r:System.Xml.dll /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll"

echo.
echo [1/6] Building Control Hub Service...
if exist "%BUILD%" rmdir /s /q "%BUILD%"
mkdir "%BUILD%"
"%CSC%" /nologo /codepage:65001 /target:winexe /platform:x64 /optimize+ /out:"%BUILD%\Control Hub Service.exe" /win32icon:shared\ControlHub.ico /win32manifest:service\app.manifest /resource:shared\ControlHub.ico,ControlHub.ico %REFS% service\src\*.cs
if errorlevel 1 goto failed

echo.
echo [2/6] Building Control Hub...
"%CSC%" /nologo /codepage:65001 /target:winexe /platform:x64 /optimize+ /out:"%BUILD%\Control Hub.exe" /win32icon:shared\ControlHub.ico /win32manifest:hub\app.manifest /resource:shared\ControlHub.ico,ControlHub.ico %REFS% hub\src\*.cs
if errorlevel 1 goto failed

echo.
echo [3/6] Installing to %DEST% ...
taskkill /im "Control Hub.exe" /f >nul 2>nul
taskkill /im "Control Hub Service.exe" /f >nul 2>nul
taskkill /im "Control Panel Helper.exe" /f >nul 2>nul
timeout /t 2 /nobreak >nul
if not exist "%DEST%" mkdir "%DEST%"
rem Keep the installed version, so Control Hub can go back to it.
if exist "%DEST%\Control Hub Service.exe" (
  if exist "%DEST%\previous" rmdir /s /q "%DEST%\previous"
  mkdir "%DEST%\previous"
  copy /y "%DEST%\Control Hub Service.exe" "%DEST%\previous\" >nul
  copy /y "%DEST%\Control Hub.exe" "%DEST%\previous\" >nul
  if exist "%DEST%\version.json" copy /y "%DEST%\version.json" "%DEST%\previous\" >nul
)
copy /y "%BUILD%\Control Hub Service.exe" "%DEST%\" >nul
if errorlevel 1 goto copyfailed
copy /y "%BUILD%\Control Hub.exe" "%DEST%\" >nul
if errorlevel 1 goto copyfailed
copy /y "version.json" "%DEST%\" >nul
copy /y "Restore previous version.bat" "%DEST%\" >nul
if not exist "%DEST%\projects.json" copy /y "projects.json" "%DEST%\" >nul
if not exist "%DEST%\update.json" copy /y "update.json" "%DEST%\" >nul

echo.
echo [4/6] Start menu shortcut and starting Control Hub Service...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Programs') + '\Control Hub.lnk'); $s.TargetPath=$env:DEST + '\Control Hub.exe'; $s.WorkingDirectory=$env:DEST; $s.Description='Control Hub'; $s.Save()" >nul 2>nul
if errorlevel 1 echo Couldn't make the Start menu shortcut. You can still open Control Hub from the tray icon.
start "" "%DEST%\Control Hub Service.exe"

echo.
echo [5/6] The panel...
rem Control Hub keeps its own copy of the panel code; the widget's starter in iCUE loads it from there.
robocopy "widget" "%DEST%\widget" /MIR /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 echo Couldn't copy the panel code to Control Hub. The panel keeps using its own built-in copy.
rem iCUE only needs the widget again when the starter itself changed (index.html, manifest.json, boot.js).
set "STARTER="
set "OLDSTARTER="
set "WIDGETOK="
for /f "delims=" %%H in ('powershell -NoProfile -Command "(Get-FileHash -Algorithm SHA256 widget\index.html,widget\manifest.json,widget\scripts\boot.js | ForEach-Object { $_.Hash }) -join ''"') do set "STARTER=%%H"
if exist "%DEST%\starter.hash" set /p OLDSTARTER=<"%DEST%\starter.hash"
if defined STARTER if /i "%STARTER%"=="%OLDSTARTER%" (
  echo The panel is updated through Control Hub. Nothing to do in iCUE.
  goto afterwidget
)
call :widget
if defined WIDGETOK if defined STARTER (>"%DEST%\starter.hash" echo %STARTER%)
:afterwidget

echo.
echo [6/6] Projects...
set "ANYPROJ="
for /d %%P in ("projects\*") do if exist "%%P\install.bat" call :project "%%P"
if not defined ANYPROJ echo Nothing extra to install.

echo.
if /i "%MODE%"=="/update" (echo Control Hub is updated.) else (echo Done! Control Hub Service is running in the tray, by the clock.)
start "" "%DEST%\Control Hub.exe"
rmdir /s /q "%BUILD%" >nul 2>nul
echo.
if /i "%MODE%"=="/update" (
  echo This window closes by itself in 15 seconds.
  timeout /t 15 >nul
) else (
  pause
)
exit /b 0

rem ---------------------------------------------------------------- the panel widget
:widget
where icuewidget >nul 2>nul
if errorlevel 1 (
  echo Installing Corsair's iCUE Widget CLI ^(one time^)...
  call npm install -g icuewidget-cli
)
call icuewidget validate widget
if errorlevel 1 goto widgetfailed
call icuewidget package widget
if errorlevel 1 goto widgetfailed
set "PKG="
for /f "delims=" %%F in ('powershell -NoProfile -Command "Get-ChildItem -Recurse -Filter *.icuewidget | Sort-Object LastWriteTime | Select-Object -Last 1 -ExpandProperty FullName"') do set "PKG=%%F"
if not defined PKG goto widgetfailed
echo Opening the new widget in iCUE. Click there to update it.
start "" "%PKG%"
set "WIDGETOK=1"
exit /b 0
:widgetfailed
echo.
echo The widget couldn't be packed automatically, see above. Control Hub itself is installed and running.
echo Send Claude a screenshot of the messages above.
exit /b 0

rem ---------------------------------------------------------------- a project's own install step
rem Any folder projects\NAME with an install.bat is installed together with Control Hub.
rem It gets the Control Hub program folder as its first argument.
:project
set "ANYPROJ=1"
echo Installing %~nx1...
call "%~1\install.bat" "%DEST%"
if errorlevel 1 echo %~nx1 reported a problem, see above. Control Hub itself is fine.
exit /b 0

:failed
echo.
echo The build failed, so nothing was changed. Your current version keeps working.
echo Please take a screenshot of everything above, or copy it, and send it to Claude.
pause
exit /b 1

:copyfailed
echo.
echo Couldn't copy the new files into %DEST%.
echo Is Control Hub still open? Close it and run this again.
pause
exit /b 1
