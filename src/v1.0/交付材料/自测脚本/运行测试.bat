@echo off
chcp 65001 >nul
cd /d %~dp0
echo Running engine tests...
node test_engine.js
pause
