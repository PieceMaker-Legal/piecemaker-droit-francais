@echo off
setlocal
set "APP=%LOCALAPPDATA%\Programs\PieceMaker Test MAJ\PieceMakerTestMAJ.exe"
if not exist "%APP%" (
  echo PieceMaker Test MAJ doit etre installe avant de continuer.
  pause
  exit /b 1
)
set ELECTRON_RUN_AS_NODE=1
start /wait "" "%APP%" "%~dp0activer.mjs" "%APP%"
if errorlevel 1 (
  pause
  exit /b 1
)
set ELECTRON_RUN_AS_NODE=
start "" "%APP%"
echo Fermez puis rouvrez PieceMaker Test MAJ pour voir le bouton bleu.
pause
