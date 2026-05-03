@echo off
REM =========================================================================
REM  Media Wall — PyInstaller Build Script
REM
REM  Builds a single-file .exe that bundles the Flask app, static assets,
REM  and templates. The resulting executable lives in dist/media_wall.exe.
REM
REM  Prerequisites:
REM    pip install pyinstaller
REM
REM  Usage:
REM    cd media_wall
REM    build.bat
REM =========================================================================

echo.
echo ===================================
echo   Building Media Wall executable
echo ===================================
echo.

REM Run PyInstaller from the media_wall directory
python -m PyInstaller ^
    --onefile ^
    --name media_wall ^
    --icon media_wall.ico ^
    --add-data "templates;templates" ^
    --add-data "static;static" ^
    --hidden-import tkinter ^
    --hidden-import tkinter.filedialog ^
    --hidden-import tkinter.messagebox ^
    --noconfirm ^
    media_wall.py

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo BUILD FAILED — see errors above.
    pause
    exit /b 1
)

echo.
echo ===================================
echo   Build complete!
echo ===================================
echo.
echo   Output: dist\media_wall.exe
echo.
echo   To use:
echo     1. Copy dist\media_wall.exe anywhere you like
echo     2. Double-click it
echo     3. Pick your media folder when prompted
echo     4. Done — your browser will open automatically
echo.
pause
