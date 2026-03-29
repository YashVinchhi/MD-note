@echo off
setlocal

cd /d "%~dp0"

echo ==============================================
echo SmartNotes: Toggle MCP Bridge startup
echo ==============================================
echo.
echo This script will ENABLE or DISABLE the MCP bridge
echo by renaming the `mcp-server` folder.
echo.

:menu
echo 1) Turn OFF startup (disable MCP bridge)
echo 2) Turn ON startup  (enable MCP bridge)
echo 3) Exit
set /p choice=Enter choice [1-3]: 
if "%choice%"=="1" goto disable
if "%choice%"=="2" goto enable
if "%choice%"=="3" goto end
echo Invalid choice. Try again.
goto menu

:disable
if not exist "mcp-server" (
    echo "mcp-server" folder not found.
    if exist "mcp-server.disabled" (
        echo Already disabled as "mcp-server.disabled".
    ) else (
        echo Nothing to do.
    )
    pause
    goto end
)
if exist "mcp-server.disabled" (
    echo Cannot disable because "mcp-server.disabled" already exists.
    echo Please rename or remove the existing folder first.
    pause
    goto end
)
rename "mcp-server" "mcp-server.disabled"
if errorlevel 1 (
    echo Failed to rename folder. Try running this script as Administrator.
) else (
    echo Startup DISABLED — folder renamed to "mcp-server.disabled".
)
pause
goto end

:enable
if not exist "mcp-server.disabled" (
    echo "mcp-server.disabled" not found.
    if exist "mcp-server" (
        echo Already enabled as "mcp-server".
    ) else (
        echo Nothing to do.
    )
    pause
    goto end
)
if exist "mcp-server" (
    echo Cannot enable because "mcp-server" already exists.
    echo Please rename or remove the existing folder first.
    pause
    goto end
)
rename "mcp-server.disabled" "mcp-server"
if errorlevel 1 (
    echo Failed to rename folder. Try running this script as Administrator.
) else (
    echo Startup ENABLED — folder renamed to "mcp-server".
)
pause
goto end

:end
endlocal
exit /b 0
