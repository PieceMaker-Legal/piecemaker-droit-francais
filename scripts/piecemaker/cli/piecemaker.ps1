#Requires -Version 5.1
$ErrorActionPreference = 'Stop'

$AppDir = if ($env:PIECEMAKER_APP_DIR) { $env:PIECEMAKER_APP_DIR } else { Join-Path $HOME 'Documents\GitHub\piecemaker-droit-francais' }
$AppRemote = 'https://github.com/PieceMaker-Legal/piecemaker-droit-francais.git'
$Entry = 'scripts/piecemaker/cli/piecemaker.mjs'
$MinimumMajor = 20

function Get-NodeMajor([string]$NodePath) {
  try {
    $version = & $NodePath -e 'process.stdout.write(String(process.versions.node.split(".")[0]))' 2>$null
    return [int]$version
  } catch {
    return 0
  }
}

function Resolve-NodeBinary {
  $onPath = Get-Command node -ErrorAction SilentlyContinue
  if ($onPath -and (Get-NodeMajor $onPath.Source) -ge $MinimumMajor) {
    return $onPath.Source
  }

  $nvmRoot = if ($env:NVM_HOME) { $env:NVM_HOME } else { Join-Path $env:APPDATA 'nvm' }
  if (Test-Path $nvmRoot) {
    $candidates = Get-ChildItem $nvmRoot -Directory -Filter 'v*' -ErrorAction SilentlyContinue |
      Sort-Object { [version]($_.Name.TrimStart('v')) } -Descending
    foreach ($candidate in $candidates) {
      $nodeExe = Join-Path $candidate.FullName 'node.exe'
      if ((Test-Path $nodeExe) -and (Get-NodeMajor $nodeExe) -ge $MinimumMajor) {
        return $nodeExe
      }
    }
  }

  return $null
}

$NodeBin = Resolve-NodeBinary
if (-not $NodeBin) {
  Write-Error "PieceMaker : Node $MinimumMajor ou plus recent est requis et introuvable."
  exit 1
}

if (-not (Test-Path (Join-Path $AppDir '.git'))) {
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Error 'PieceMaker : git est requis pour installer le depot.'
    exit 1
  }
  Write-Host "PieceMaker : installation du depot dans $AppDir"
  New-Item -ItemType Directory -Force -Path (Split-Path $AppDir -Parent) | Out-Null
  git clone --branch main $AppRemote $AppDir
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$EntryPath = Join-Path $AppDir $Entry
if (-not (Test-Path $EntryPath)) {
  Write-Error "PieceMaker : $Entry est introuvable dans $AppDir.`nMettez le depot a jour (git -C `"$AppDir`" pull) puis relancez piecemaker."
  exit 1
}

& $NodeBin $EntryPath @args
exit $LASTEXITCODE
