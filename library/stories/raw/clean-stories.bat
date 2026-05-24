@echo off
echo.
echo  Sinverse Story Cleaner
echo  ----------------------
echo.

cd /d "%~dp0"

node ..\..\clean-story.js . ..\
if %errorlevel% neq 0 (
  echo.
  echo  Something went wrong. Make sure Node.js is installed.
  pause
  exit /b 1
)

echo.
echo  Cleaned files are in library\stories\
echo  You can now add them to library.json
echo.
pause
