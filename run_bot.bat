@echo off
title Kick Chatbot Dashboard Server
cd /d "%~dp0"
echo ==============================================
echo   Starting Kick Multi-Account Chatbot Server
echo ==============================================
echo.
echo Opening control dashboard in your browser...
node server.js
pause
