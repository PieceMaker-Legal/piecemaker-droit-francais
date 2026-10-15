#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$repo = if ($env:PIECEMAKER_REPO) { $env:PIECEMAKER_REPO } else { 'PieceMaker-Legal/piecemaker-droit-francais' }
$bootstrapHome = if ($env:PIECEMAKER_BOOTSTRAP_HOME) { $env:PIECEMAKER_BOOTSTRAP_HOME } else { Join-Path $env:USERPROFILE '.piecemaker\bootstrap' }
$nodeChannel = if ($env:PIECEMAKER_NODE_CHANNEL) { $env:PIECEMAKER_NODE_CHANNEL } else { 'latest-v22.x' }
$minNodeMajor = 22

function Say([string] $message) { Write-Host "== $message" -ForegroundColor Cyan }
function Fail([string] $message) { Write-Host "!! $message" -ForegroundColor Red; throw $message }

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  Fail 'Ce script installe PieceMaker sur Windows. Sur macOS, utilisez install.sh.'
}

$nodeArch = if ([Environment]::Is64BitOperatingSystem) {
  if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'arm64' } else { 'x64' }
} else { Fail 'Windows 64 bits est requis.' }

New-Item -ItemType Directory -Force -Path $bootstrapHome | Out-Null
$bootstrapHome = (Resolve-Path -LiteralPath $bootstrapHome).ProviderPath
Set-Location -LiteralPath $bootstrapHome
[Environment]::CurrentDirectory = $bootstrapHome

Say 'Recherche de la derniere version publiee de PieceMaker...'
$releaseUrl = if ($env:PIECEMAKER_TAG -and $env:ELECTRON_FORCE_OWN_SERVER -ne '1') {
  "https://api.github.com/repos/$repo/releases/tags/$($env:PIECEMAKER_TAG)"
} else { "https://api.github.com/repos/$repo/releases/latest" }
$release = Invoke-RestMethod -UseBasicParsing -Uri $releaseUrl
$tag = $release.tag_name
if (-not $tag) { Fail "Impossible de determiner la derniere version publiee de $repo." }
if ($tag -notmatch '^v?\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$') { Fail 'Version de release invalide.' }
Say "Version retenue : $tag"

if ($args -notcontains '--build-from-source') {
  if ($nodeArch -ne 'x64') { Fail 'Le paquet Windows precompile est disponible pour x64 uniquement.' }
  $installerName = "piecemaker-droit-francais-desktop-$($tag -replace '^v', '')-win-x64.exe"
  $installerAsset = @($release.assets | Where-Object { $_.name -eq $installerName })
  $checksumAsset = @($release.assets | Where-Object { $_.name -eq "$installerName.sha256" })
  if ($installerAsset.Count -eq 1 -and $checksumAsset.Count -eq 1) {
    $installerPath = Join-Path $bootstrapHome $installerName
    $previousProgress = $ProgressPreference
    try {
      $ProgressPreference = 'SilentlyContinue'
      Say 'Telechargement de l''installateur precompile...'
      Invoke-WebRequest -UseBasicParsing -Uri $installerAsset[0].browser_download_url -OutFile $installerPath
      $expectedHash = (Invoke-WebRequest -UseBasicParsing -Uri $checksumAsset[0].browser_download_url).Content.Trim()
    } finally { $ProgressPreference = $previousProgress }
    if ($expectedHash -notmatch '^[a-fA-F0-9]{64}$' -or (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash -ne $expectedHash) {
      Fail 'Le controle d''integrite de l''installateur a echoue.'
    }
    Say 'Installation de PieceMaker...'
    $installerProcess = Start-Process -FilePath $installerPath -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
    if ($installerProcess.ExitCode -ne 0) { Fail "Installation interrompue (code $($installerProcess.ExitCode))." }
    $appDir = Join-Path $env:LOCALAPPDATA 'Programs\PieceMaker'
    $executable = Join-Path $appDir 'PieceMaker.exe'
    $appRoot = Join-Path $appDir 'resources\app.asar.unpacked'
    $prepareScript = Join-Path $appRoot 'desktop-bootstrap\lib\prepare-installed.mjs'
    if (-not (Test-Path -LiteralPath $prepareScript)) { Fail 'Le paquet installe ne contient pas la preparation initiale.' }
    $env:PIECEMAKER_SRC_DIR = $appRoot
    $env:PIECEMAKER_TAG = $tag
    $env:PIECEMAKER_REPO = $repo
    $previousRunAsNode = $env:ELECTRON_RUN_AS_NODE
    try {
      $env:ELECTRON_RUN_AS_NODE = '1'
      Say 'Preparation des certificats et des composants precompiles...'
      $prepareArguments = @('"' + $prepareScript + '"') + $args
      $prepareLog = Join-Path $bootstrapHome 'preparation.log'
      $prepareErrors = Join-Path $bootstrapHome 'preparation-errors.log'
      $prepareProcess = Start-Process -FilePath $executable -ArgumentList $prepareArguments -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput $prepareLog -RedirectStandardError $prepareErrors
      if ($prepareProcess.ExitCode -ne 0) {
        if (Test-Path -LiteralPath $prepareErrors) { Get-Content -LiteralPath $prepareErrors -Encoding UTF8 | Write-Host }
        Fail "Preparation initiale interrompue (code $($prepareProcess.ExitCode))."
      }
    } finally { $env:ELECTRON_RUN_AS_NODE = $previousRunAsNode }
    if ($args -notcontains '--no-launch') { Start-Process -FilePath $executable }
    Say 'PieceMaker est installe.'
    return
  }
  Say 'Cette ancienne release utilise encore le paquet archive.'
}

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
    $major = [int](((& $systemNode.Source -v) -replace '^v', '') -split '\.')[0]
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
$env:PIECEMAKER_REPO = $repo
$env:PIECEMAKER_BOOTSTRAP_HOME = $bootstrapHome

& $nodeBin (Join-Path $srcDir 'desktop-bootstrap\lib\install.mjs') @args
if ($LASTEXITCODE -ne 0) { throw "Installation interrompue (code $LASTEXITCODE)." }
