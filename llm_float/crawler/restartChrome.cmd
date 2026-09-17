@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo [1/4] 正在关闭 Web 项目 (web.py / 端口 8000)...
powershell -Command "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Where-Object { $_.CommandLine -like '*web.py*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" 2>nul
for /f "tokens=5" %%p in ('netstat -ano ^| findstr :8000 ^| findstr LISTENING') do taskkill /f /pid %%p >nul 2>&1
timeout /t 1 /nobreak >nul
echo       [OK] Web 已停止。

echo [2/4] 正在关闭所有 Chrome 进程...
taskkill /f /im chrome.exe >nul 2>&1
timeout /t 1 /nobreak >nul

set "UserData=%LOCALAPPDATA%\Google\Chrome\User Data_9222"
set "ChromePath=C:\Program Files\Google\Chrome\Application\chrome.exe"

echo [3/4] 正在以调试模式(9222)启动 Chrome...
start "" "%ChromePath%" ^
--remote-debugging-port=9222 ^
--remote-allow-origins=* ^
--user-data-dir="%UserData%"

timeout /t 2 /nobreak >nul
echo.
echo [检测] 检查端口 9222 是否在监听...
netstat -ano | findstr :9222 >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] 端口 9222 已成功占用，Chrome 调试模式运行中。
) else (
    echo [WARN] 端口 9222 未检测到，Chrome 可能启动失败，请重试。
)
echo.

echo ==============================================
echo Web 控制台：   http://127.0.0.1:8000
echo 启动 qwenpaw： python -u -m qwenpaw app 2>&1
echo ==============================================
echo.

echo [4/4] 启动 Web 项目 (web.py)，日志输出在本窗口，Ctrl+C 停止...
echo       Web 控制台： http://127.0.0.1:8000
echo.
set "PyPath=C:\Users\admin\.conda\envs\py310\python.exe"
if not exist "%PyPath%" set "PyPath=python"
"%PyPath%" web.py
