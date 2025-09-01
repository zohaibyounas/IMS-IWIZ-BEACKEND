@echo off
echo Starting IWIZ Inventory Management Backend...
echo.

cd /d "%~dp0"
echo Current directory: %CD%
echo.

echo Starting Node.js server...
node server.js

echo.
echo Server stopped.
pause
