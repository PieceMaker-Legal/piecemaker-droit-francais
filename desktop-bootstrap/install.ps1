#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$repo = if ($env:PIECEMAKER_REPO) { $env:PIECEMAKER_REPO } else { 'PieceMaker-Legal/piecemaker-droit-francais' }
$bootstrapHome = if ($env:PIECEMAKER_BOOTSTRAP_HOME) { $env:PIECEMAKER_BOOTSTRAP_HOME } else { Join-Path $env:USERPROFILE '.piecemaker\bootstrap' }
$nodeChannel = if ($env:PIECEMAKER_NODE_CHANNEL) { $env:PIECEMAKER_NODE_CHANNEL } else { 'latest-v22.x' }
$minNodeMajor = 22

function Say([string] $message) { Write-Host "== $message" -ForegroundColor Cyan }
function Fail([string] $message) { Write-Host "!! $message" -ForegroundColor Red; exit 1 }

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  Fail 'Ce script installe PieceMaker sur Windows. Sur macOS, utilisez install.sh.'
}

$nodeArch = if ([Environment]::Is64BitOperatingSystem) {
  if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'arm64' } else { 'x64' }
} else { Fail 'Windows 64 bits est requis.' }

New-Item -ItemType Directory -Force -Path $bootstrapHome | Out-Null

Say 'Recherche de la derniere version publiee de PieceMaker...'
$tag = if ($env:PIECEMAKER_TAG) { $env:PIECEMAKER_TAG } else {
  (Invoke-RestMethod -UseBasicParsing -Uri "https://api.github.com/repos/$repo/releases/latest").tag_name
}
if (-not $tag) { Fail "Impossible de determiner la derniere version publiee de $repo." }
Say "Version retenue : $tag"

$srcDir = Join-Path $bootstrapHome "src\$tag"
if (-not (Test-Path $srcDir)) {
  Say 'Telechargement des sources...'
  $archive = Join-Path $bootstrapHome "$tag.zip"
  Invoke-WebRequest -UseBasicParsing -Uri "https://codeload.github.com/$repo/zip/refs/tags/$tag" -OutFile $archive
  $staging = Join-Path $bootstrapHome "unpack-$tag"
  Remove-Item -Recurse -Force $staging -ErrorAction SilentlyContinue
  Expand-Archive -Path $archive -DestinationPath $staging -Force
  $extracted = Get-ChildItem -Directory $staging | Select-Object -First 1
  New-Item -ItemType Directory -Force -Path (Split-Path $srcDir) | Out-Null
  Move-Item -Path $extracted.FullName -Destination $srcDir
  Remove-Item -Recurse -Force $staging, $archive -ErrorAction SilentlyContinue
}

$nodeBin = $null
$systemNode = Get-Command node -ErrorAction SilentlyContinue
if ($systemNode) {
  try {
    $major = [int](& $systemNode.Source -p 'process.versions.node.split(".")[0]')
    if ($major -ge $minNodeMajor) { $nodeBin = $systemNode.Source }
  } catch {
    $nodeBin = $null
  }
}

if (-not $nodeBin) {
  Say 'Installation d''un Node.js dedie (aucune modification du systeme)...'
  $shasums = (Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/$nodeChannel/SHASUMS256.txt").Content
  $match = [regex]::Match($shasums, "node-v[0-9.]+-win-$nodeArch\.zip")
  if (-not $match.Success) { Fail 'Impossible de determiner la version de Node.js a telecharger.' }
  $nodeName = $match.Value -replace '\.zip$', ''
  $nodeDir = Join-Path $bootstrapHome "toolchain\$nodeName"
  if (-not (Test-Path (Join-Path $nodeDir 'node.exe'))) {
    $nodeZip = Join-Path $bootstrapHome $match.Value
    Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/$nodeChannel/$($match.Value)" -OutFile $nodeZip
    Expand-Archive -Path $nodeZip -DestinationPath (Join-Path $bootstrapHome 'toolchain') -Force
    Remove-Item -Force $nodeZip -ErrorAction SilentlyContinue
  }
  $nodeBin = Join-Path $nodeDir 'node.exe'
}

Say "Node.js utilise : $nodeBin ($(& $nodeBin -v))"

$env:PATH = "$(Split-Path $nodeBin);$env:PATH"
$env:PIECEMAKER_SRC_DIR = $srcDir
$env:PIECEMAKER_TAG = $tag
$env:PIECEMAKER_BOOTSTRAP_HOME = $bootstrapHome

& $nodeBin (Join-Path $srcDir 'desktop-bootstrap\lib\install.mjs') @args
exit $LASTEXITCODE
