@echo off
rem Abre o menu do diakolight.sh pelo Git Bash (duplo clique ou "diakolight" no cmd/PowerShell)
set "GITBASH=%ProgramFiles%\Git\bin\bash.exe"
if not exist "%GITBASH%" (
    echo Git Bash nao encontrado em "%GITBASH%"
    pause
    exit /b 1
)
"%GITBASH%" "%~dp0diakolight.sh" %*
if "%~1"=="" pause
