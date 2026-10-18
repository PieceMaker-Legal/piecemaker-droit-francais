$ErrorActionPreference = 'Stop'
$installer = Get-ChildItem -LiteralPath $PSScriptRoot -Filter 'PieceMaker-Test-MAJ-*-win-x64.exe' | Select-Object -First 1
if (-not $installer) { throw 'Installateur de test absent. Extraire tout le ZIP avant de lancer ce fichier.' }
$application = Join-Path $env:LOCALAPPDATA 'Programs\PieceMaker Test MAJ\PieceMakerTestMAJ.exe'
if (-not (Test-Path -LiteralPath $application)) {
  $installation = Start-Process -FilePath $installer.FullName -ArgumentList '/S' -Wait -PassThru
  if ($installation.ExitCode -ne 0) { throw "Installation impossible : $($installation.ExitCode)" }
}
if (-not (Test-Path -LiteralPath $application)) { throw "Application de test introuvable : $application" }
$env:NODE_EXTRA_CA_CERTS = Join-Path $PSScriptRoot 'localhost.crt'
$env:ELECTRON_RUN_AS_NODE = '1'
try {
  & $application (Join-Path $PSScriptRoot 'feed.mjs') $application
} finally {
  Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
}
