@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set "TASKNAME=BingRewardsAuto"
set "RUNTIME=%~1"
if "%RUNTIME%"=="" set "RUNTIME=09:30"
set "RUNNER=%~dp0run.bat"

net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo  [!] 当前不是管理员权限，Windows 不允许注册计划任务。
  echo      请关掉本窗口，右键本文件 - 选择"以管理员身份运行"。
  echo.
  echo      ^(不注册计划任务也能用：登录自启动已经装好了，
  echo       每次登录后 3 分钟自动跑一次，同一天只会跑一次。^)
  echo.
  pause
  exit /b 1
)

schtasks /Delete /TN "%TASKNAME%" /F >nul 2>&1
schtasks /Create /TN "%TASKNAME%" /TR "\"%RUNNER%\"" /SC DAILY /ST %RUNTIME% /RL LIMITED /F
if errorlevel 1 (
  echo.
  echo  [x] 注册失败。请把上面的错误信息发给开发者。
  echo.
  pause
  exit /b 1
)

echo.
echo  [OK] 计划任务已注册
echo       任务名：%TASKNAME%
echo       时间：  每天 %RUNTIME%
echo       命令：  %RUNNER%
echo.
schtasks /Query /TN "%TASKNAME%" /FO LIST
echo.
echo  立即测试一次：  schtasks /Run /TN "%TASKNAME%"
echo  删除该任务：    schtasks /Delete /TN "%TASKNAME%" /F
echo  改时间：        用管理员权限再运行本文件并带上时间，例如：register-task-admin.bat 08:15
echo.
pause
