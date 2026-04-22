@echo off
REM Launch AlgoWorld in Brave kiosk mode
REM Tries common Brave install locations

set "FILE=%~dp0web\index.html"

if exist "%LOCALAPPDATA%\BraveSoftware\Brave-Browser\Application\brave.exe" (
    start "" "%LOCALAPPDATA%\BraveSoftware\Brave-Browser\Application\brave.exe" --kiosk --disable-pinch --overscroll-history-navigation=0 "%FILE%"
) else if exist "%PROGRAMFILES%\BraveSoftware\Brave-Browser\Application\brave.exe" (
    start "" "%PROGRAMFILES%\BraveSoftware\Brave-Browser\Application\brave.exe" --kiosk --disable-pinch --overscroll-history-navigation=0 "%FILE%"
) else (
    echo Brave not found in default locations.
    echo Opening in default browser instead...
    start "" "%FILE%"
)
