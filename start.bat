@echo off
cd /d "%~dp0"
node scripts\launch.js start
if errorlevel 1 pause
