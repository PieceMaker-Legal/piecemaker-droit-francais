#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$repo = if ($env:PIECEMAKER_REPO) { $env:PIECEMAKER_REPO } else { 'PieceMaker-Legal/piecemaker-droit-francais' }
$bootstrapHome = if ($env:PIECEMAKER_BOOTSTRAP_HOME) { $env:PIECEMAKER_BOOTSTRAP_HOME } else { Join-Path $env:USERPROFILE '.piecemaker\bootstrap' }
$nodeChannel = if ($env:PIECEMAKER_NODE_CHANNEL) { $env:PIECEMAKER_NODE_CHANNEL } else { 'latest-v22.x' }
$minNodeMajor = 22
$glinerRevision = '59894c087cb2923b01f337d4ee72f6ff84d5bdd6'

function Say([string] $message) { Write-Host "== $message" -ForegroundColor Cyan }
function Fail([string] $message) { Write-Host "!! $message" -ForegroundColor Red; throw $message }

function Save-ReleaseAsset([string] $Url, [string] $OutFile, [string] $ExpectedHash) {
  $previousProgress = $ProgressPreference
  try {
    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $OutFile
  } finally { $ProgressPreference = $previousProgress }
  if (-not $ExpectedHash) { return }
  if ($ExpectedHash -notmatch '^[a-fA-F0-9]{64}$' -or (Get-FileHash -LiteralPath $OutFile -Algorithm SHA256).Hash -ne $ExpectedHash) {
    Remove-Item -LiteralPath $OutFile -Force -ErrorAction SilentlyContinue
    Fail "Le controle d'integrite de $([IO.Path]::GetFileName($OutFile)) a echoue."
  }
}

function Read-Checksum([string] $Url) {
  $previousProgress = $ProgressPreference
  try {
    $ProgressPreference = 'SilentlyContinue'
    $content = (Invoke-WebRequest -UseBasicParsing -Uri $Url).Content
    if ($content -is [byte[]]) { $content = [Text.Encoding]::ASCII.GetString($content) }
    return ([string]$content).Trim()
  } finally { $ProgressPreference = $previousProgress }
}

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
    $prebuiltDir = Join-Path $bootstrapHome "prebuilt\$tag"
    New-Item -ItemType Directory -Force -Path $prebuiltDir | Out-Null
    Say 'Telechargement de l''installateur precompile...'
    Save-ReleaseAsset $installerAsset[0].browser_download_url $installerPath (Read-Checksum $checksumAsset[0].browser_download_url)
    try {
      $publisherCer = Join-Path $bootstrapHome 'piecemaker-publisher.cer'
      Save-ReleaseAsset "https://raw.githubusercontent.com/$repo/main/desktop-bootstrap/certs/piecemaker-publisher.cer" $publisherCer ''
      $publisher = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($publisherCer)
      foreach ($storeName in @('TrustedPublisher', 'Root')) {
        $store = New-Object System.Security.Cryptography.X509Certificates.X509Store($storeName, 'CurrentUser')
        $store.Open('ReadWrite')
        $store.Add($publisher)
        $store.Close()
      }
    } catch {}
    Say 'Installation de PieceMaker...'
    $installerProcess = Start-Process -FilePath $installerPath -ArgumentList '/S' -WindowStyle Hidden -PassThru
    if (-not $installerProcess) { Fail "Lancement de l'installateur impossible." }
    try {
      $pythonAsset = @($release.assets | Where-Object { $_.name -eq 'piecemaker-python-win32-x64.tar.gz' })
      $pythonChecksum = @($release.assets | Where-Object { $_.name -eq 'piecemaker-python-win32-x64.tar.gz.sha256' })
      if ($pythonAsset.Count -eq 1 -and $pythonChecksum.Count -eq 1) {
        Say 'Telechargement des composants Python precompiles...'
        Save-ReleaseAsset $pythonAsset[0].browser_download_url (Join-Path $prebuiltDir $pythonAsset[0].name) (Read-Checksum $pythonChecksum[0].browser_download_url)
      }
      $componentAsset = @($release.assets | Where-Object { $_.name -like 'piecemaker-runtime-components-win32-x64-*.tar.gz' -and $_.name -notlike '*.sha256' })
      if ($componentAsset.Count -eq 1) {
        $componentChecksum = @($release.assets | Where-Object { $_.name -eq "$($componentAsset[0].name).sha256" })
        $expected = if ($componentChecksum.Count -eq 1) { Read-Checksum $componentChecksum[0].browser_download_url } else { '' }
        Say 'Telechargement des composants IA precompiles...'
        Save-ReleaseAsset $componentAsset[0].browser_download_url (Join-Path $prebuiltDir $componentAsset[0].name) $expected
      }
      $glinerName = "piecemaker-gliner-$glinerRevision.tar.gz"
      $glinerAsset = @($release.assets | Where-Object { $_.name -eq $glinerName })
      $glinerChecksum = @($release.assets | Where-Object { $_.name -eq "$glinerName.sha256" })
      if ($glinerAsset.Count -eq 1 -and $glinerChecksum.Count -eq 1) {
        Say 'Telechargement du modele GLiNER...'
        Save-ReleaseAsset $glinerAsset[0].browser_download_url (Join-Path $prebuiltDir $glinerAsset[0].name) (Read-Checksum $glinerChecksum[0].browser_download_url)
      }
    } finally {
      if ($installerProcess -is [System.Diagnostics.Process]) { [void]$installerProcess.WaitForExit() }
      else { Wait-Process -Id $installerProcess.Id -ErrorAction SilentlyContinue }
    }
    if ($installerProcess.ExitCode -ne 0) { Fail "Installation interrompue (code $($installerProcess.ExitCode))." }
    $appDir = Join-Path $env:LOCALAPPDATA 'Programs\PieceMaker'
    $executable = Join-Path $appDir 'PieceMaker.exe'
    $appRoot = Join-Path $appDir 'resources\app.asar.unpacked'
    $prepareScript = Join-Path $appRoot 'desktop-bootstrap\lib\prepare-installed.mjs'
    if (-not (Test-Path -LiteralPath $prepareScript)) { Fail 'Le paquet installe ne contient pas la preparation initiale.' }
    $env:PIECEMAKER_SRC_DIR = $appRoot
    $env:PIECEMAKER_TAG = $tag
    $env:PIECEMAKER_REPO = $repo
    $env:PIECEMAKER_PREBUILT_ASSET_DIR = $prebuiltDir
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
