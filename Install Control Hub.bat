@echo off
setlocal
title Install Control Hub
cd /d "%~dp0"

rem Control Hub installer: builds Control Hub Service and the Control Hub app with the C# compiler that comes
rem with Windows, installs them for your user (no admin needed), adds a Start menu shortcut, starts the service
rem and opens the updated panel widget in iCUE. If building fails, nothing is changed.

set "DEST=%LOCALAPPDATA%\Programs\Control Hub"
set "BUILD=%TEMP%\ControlHubBuild"

set "CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC%" set "CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe"
if not exist "%CSC%" (
  echo Could not find the .NET Framework 4 compiler on this PC.
  echo Turn on ".NET Framework 4.8 Advanced Services" in "Turn Windows features on or off", then try again.
  pause
  exit /b 1
)

set "REFS=/r:System.dll /r:System.Core.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll /r:System.Web.Extensions.dll /r:Microsoft.CSharp.dll /r:System.Security.dll /r:System.Xml.dll"

echo.
echo [1/5] Building Control Hub Service...
if exist "%BUILD%" rmdir /s /q "%BUILD%"
mkdir "%BUILD%"
"%CSC%" /nologo /codepage:65001 /target:winexe /platform:x64 /optimize+ /out:"%BUILD%\Control Hub Service.exe" /win32icon:shared\ControlHub.ico /win32manifest:service\app.manifest /resource:shared\ControlHub.ico,ControlHub.ico %REFS% service\src\*.cs
if errorlevel 1 goto failed

echo.
echo [2/5] Building Control Hub...
"%CSC%" /nologo /codepage:65001 /target:winexe /platform:x64 /optimize+ /out:"%BUILD%\Control Hub.exe" /win32icon:shared\ControlHub.ico /win32manifest:hub\app.manifest /resource:shared\ControlHub.ico,ControlHub.ico %REFS% hub\src\*.cs
if errorlevel 1 goto failed

echo.
echo [3/5] Installing to %DEST% ...
taskkill /im "Control Hub.exe" /f >nul 2>nul
taskkill /im "Control Hub Service.exe" /f >nul 2>nul
taskkill /im "Control Panel Helper.exe" /f >nul 2>nul
timeout /t 2 /nobreak >nul
if not exist "%DEST%" mkdir "%DEST%"
copy /y "%BUILD%\Control Hub Service.exe" "%DEST%\" >nul
if errorlevel 1 goto copyfailed
copy /y "%BUILD%\Control Hub.exe" "%DEST%\" >nul
if errorlevel 1 goto copyfailed
copy /y "version.json" "%DEST%\" >nul
if not exist "%DEST%\projects.json" copy /y "projects.json" "%DEST%\" >nul

echo.
echo [4/5] Start menu shortcut and starting Control Hub Service...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Programs') + '\Control Hub.lnk'); $s.TargetPath=$env:DEST + '\Control Hub.exe'; $s.WorkingDirectory=$env:DEST; $s.Description='Control Hub'; $s.Save()" >nul 2>nul
if errorlevel 1 echo Couldn't make the Start menu shortcut. You can still open Control Hub from the tray icon.
start "" "%DEST%\Control Hub Service.exe"

echo.
echo [5/5] Updating the panel widget in iCUE...
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
echo Opening %PKG% in iCUE - click to update the widget there.
start "" "%PKG%"
goto done

:widgetfailed
echo.
echo The widget couldn't be packed automatically (see above). Control Hub itself is installed and running.
echo You can pack it later the old way, or send Claude a screenshot of the messages above.

:done
echo.
echo Done! Control Hub Service is running in the tray (by the clock).
echo Opening Control Hub...
start "" "%DEST%\Control Hub.exe"
rmdir /s /q "%BUILD%" >nul 2>nul
echo.
pause
exit /b 0

:failed
echo.
echo The build failed, so nothing was changed. Your current version keeps working.
echo Please take a screenshot of everything above (or copy it) and send it to Claude.
pause
exit /b 1

:copyfailed
echo.
echo Couldn't copy the new files into %DEST%.
echo Is Control Hub still open? Close it and run this again.
pause
exit /b 1
