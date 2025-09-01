@echo off
echo Starting IWIZ Inventory Management Backend in Development Mode...
echo.

cd /d "%~dp0"
echo Current directory: %CD%
echo.

echo Installing dependencies if needed...
npm install

echo.
echo Starting development server with nodemon...
npm run dev

echo.
echo Development server stopped.
pause
