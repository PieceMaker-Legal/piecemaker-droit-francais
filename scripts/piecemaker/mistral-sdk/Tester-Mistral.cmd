@echo off
cd /d "%~dp0"
"%~dp0node.exe" "%~dp0try.mjs"
set test_result=%ERRORLEVEL%
pause
exit /b %test_result%
