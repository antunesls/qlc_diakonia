@echo off
rem Abre o menu do diakonia.sh pelo Git Bash (duplo clique ou "diakonia" no cmd/PowerShell)
set "GITBASH=%ProgramFiles%\Git\bin\bash.exe"
if not exist "%GITBASH%" (
    echo Git Bash nao encontrado em "%GITBASH%"
    pause
    exit /b 1
)
"%GITBASH%" "%~dp0diakonia.sh" %*
if "%~1"=="" pause
