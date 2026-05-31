@echo off
REM Expenzo Setup Script for Windows
REM This script sets up the Expenzo application by installing dependencies

echo.
echo ===============================================
echo  Expenzo - Setup Installation Script (Windows)
echo ===============================================
echo.

REM Check if Python is installed
echo Checking Python installation...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python 3 is not installed or not in PATH
    echo Please install Python 3.9 or higher from https://www.python.org/downloads/
    pause
    exit /b 1
)
for /f "tokens=2" %%i in ('python --version 2^>^&1') do set PYTHON_VERSION=%%i
echo [OK] Python %PYTHON_VERSION% found
echo.

REM Check if Node.js is installed
echo Checking Node.js installation...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)
for /f %%i in ('node --version') do set NODE_VERSION=%%i
echo [OK] Node.js %NODE_VERSION% found
echo.

REM Install backend dependencies
echo Installing Python backend dependencies...
if exist "requirements.txt" (
    pip install -r requirements.txt
    if %errorlevel% equ 0 (
        echo [OK] Backend dependencies installed
    ) else (
        echo [ERROR] Failed to install backend dependencies
        pause
        exit /b 1
    )
) else (
    echo [ERROR] requirements.txt not found
    pause
    exit /b 1
)
echo.

REM Setup environment file
echo Setting up environment configuration...
if not exist ".env" (
    if exist ".env.example" (
        copy ".env.example" ".env"
        echo [WARNING] .env file created from .env.example
        echo Please edit .env with your actual credentials:
        echo   - SUPABASE_URL
        echo   - SUPABASE_KEY
        echo   - GOOGLE_API_KEY
    )
) else (
    echo [OK] .env file exists
)
echo.

REM Install frontend dependencies
echo Installing frontend dependencies...
cd expenzo-client
call npm install
if %errorlevel% equ 0 (
    echo [OK] Frontend dependencies installed
) else (
    echo [ERROR] Failed to install frontend dependencies
    cd ..
    pause
    exit /b 1
)
cd ..
echo.

echo ===============================================
echo  Setup Complete!
echo ===============================================
echo.
echo Next steps:
echo 1. Edit .env with your Supabase and Google API credentials
echo 2. Start backend:   python main.py
echo 3. Start frontend:  cd expenzo-client ^&^& npm start
echo.
echo For detailed instructions, see README.md
echo.
pause
