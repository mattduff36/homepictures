@echo off
setlocal EnableExtensions
title HomePictures camera-safe Tailscale installer

rem Public launcher. This file has no passwords, auth keys, camera URLs, or share links.
rem It downloads the auditable Install-CCTV-Tailscale.ps1 and runs it with -File.

if /I "%~1"=="__ELEVATED__" goto :run

net session >nul 2>&1
if %errorlevel%==0 goto :run

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "try { Start-Process -FilePath '%~f0' -Verb RunAs -ArgumentList '__ELEVATED__' | Out-Null } catch { exit 1 }"
if errorlevel 1 (
  echo.
  echo The Windows administrator prompt was declined or failed. No changes were made.
  echo.
  pause
  exit /b 1
)
exit /b 0

:run
set "SCRIPT_NAME=Install-CCTV-Tailscale.ps1"
set "SCRIPT_URL=https://cctv.mpdee.uk/Install-CCTV-Tailscale.ps1"
set "RETURN_URL=https://cctv.mpdee.uk/setup"
set "LOCAL_PS1=%~dp0%SCRIPT_NAME%"
set "PS1=%TEMP%\hp-cctv-install-%RANDOM%%RANDOM%.ps1"
set "CLEANUP_PS1=1"

if exist "%LOCAL_PS1%" (
  set "PS1=%LOCAL_PS1%"
  set "CLEANUP_PS1=0"
) else (
  curl.exe -fsS --proto =https --max-redirs 0 "%SCRIPT_URL%" -o "%PS1%"
  if errorlevel 1 goto :download_fail
  findstr /C:"HomePictures camera-safe Tailscale installer" "%PS1%" >nul
  if errorlevel 1 goto :download_fail
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -ReturnUrl "%RETURN_URL%" -ReturnFlag "installed"
set "ERR=%ERRORLEVEL%"
if "%CLEANUP_PS1%"=="1" if exist "%PS1%" del /f /q "%PS1%" >nul 2>&1
exit /b %ERR%

:download_fail
echo.
echo Could not download the installer script from the Camera Access site.
echo Open https://cctv.mpdee.uk/setup and try again.
echo.
if exist "%PS1%" del /f /q "%PS1%" >nul 2>&1
pause
exit /b 1
