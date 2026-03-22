@echo off
cd /d "%~dp0"

:: Check for venv, create if missing
if not exist ".venv\Scripts\activate.bat" (
    echo Creating virtual environment...
    python -m venv .venv
    call .venv\Scripts\activate.bat
    echo Installing dependencies...
    pip install -r requirements.txt
) else (
    call .venv\Scripts\activate.bat
)

:: Load .env variables if file exists
if exist ".env" (
    for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
        if not "%%A"=="" if not "%%A:~0,1%"=="#" set "%%A=%%B"
    )
)

echo.
echo Starting ineedtodo.it locally...
echo Open http://localhost:8000 in your browser
echo Close this window to stop the server.
echo.

python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
pause
