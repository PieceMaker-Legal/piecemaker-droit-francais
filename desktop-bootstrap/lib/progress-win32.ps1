param(
  [Parameter(Mandatory = $true)][string] $StatusPath,
  [int] $ParentPid = 0
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$text = [System.Drawing.Color]::FromArgb(55, 65, 81)
$muted = [System.Drawing.Color]::FromArgb(107, 114, 128)
$bg = [System.Drawing.Color]::White

$form = New-Object System.Windows.Forms.Form
$form.Text = 'PieceMaker'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $true
$form.StartPosition = 'CenterScreen'
$form.ClientSize = New-Object System.Drawing.Size(480, 176)
$form.BackColor = $bg
$form.TopMost = $true
$form.ShowInTaskbar = $true

function New-Label([string] $value, [int] $y, [int] $height, [int] $size, [bool] $bold, $color) {
  $label = New-Object System.Windows.Forms.Label
  $label.Text = $value
  $label.Location = New-Object System.Drawing.Point(22, $y)
  $label.Size = New-Object System.Drawing.Size(436, $height)
  $style = if ($bold) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
  $label.Font = New-Object System.Drawing.Font('Segoe UI', $size, $style)
  $label.ForeColor = $color
  $label.BackColor = $bg
  $form.Controls.Add($label) | Out-Null
  return $label
}

New-Label 'Installation de PieceMaker' 16 24 12 $true $text | Out-Null
$version = New-Label '' 40 18 9 $false $muted
$step = New-Label 'Demarrage...' 64 22 10 $false $text
$detail = New-Label '' 86 18 9 $false $muted
$footer = New-Label 'Cela peut prendre plusieurs minutes.' 148 18 9 $false $muted

$bar = New-Object System.Windows.Forms.ProgressBar
$bar.Location = New-Object System.Drawing.Point(22, 118)
$bar.Size = New-Object System.Drawing.Size(436, 12)
$bar.Style = 'Continuous'
$bar.Minimum = 0
$bar.Maximum = 100
$bar.Value = 0
$form.Controls.Add($bar) | Out-Null

$doneAt = [datetime]::MinValue
$failed = $false

function Test-Alive([int] $id) {
  if ($id -le 0) { return $true }
  try {
    Get-Process -Id $id -ErrorAction Stop | Out-Null
    return $true
  } catch {
    return $false
  }
}

function Read-Status {
  try {
    if (-not (Test-Path -LiteralPath $StatusPath)) { return $null }
    return (Get-Content -LiteralPath $StatusPath -Raw -Encoding UTF8 | ConvertFrom-Json)
  } catch {
    return $null
  }
}

function Fail-Install([string] $message) {
  $script:failed = $true
  $step.Text = 'Installation interrompue'
  $detail.Text = $message
  $footer.Text = 'Vous pouvez fermer cette fenetre.'
  $bar.Value = 0
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 400
$timer.Add_Tick({
  if ($failed) { return }
  if ($doneAt -ne [datetime]::MinValue) {
    if (((Get-Date) - $doneAt).TotalMilliseconds -ge 2500) {
      $timer.Stop()
      $form.Close()
    }
    return
  }

  $status = Read-Status
  $parent = $ParentPid
  if ($status -and $status.pid) { $parent = [int]$status.pid }
  if (-not $status) {
    if (-not (Test-Alive $parent)) { Fail-Install "L'installation s'est interrompue." }
    return
  }

  if ($status.version) { $version.Text = [string]$status.version }
  if ($status.step) { $step.Text = [string]$status.step }
  if ($null -ne $status.detail) { $detail.Text = [string]$status.detail }
  $total = [math]::Max(1, [int]($status.total))
  $current = [math]::Max(0, [int]($status.current))
  $ratio = [int][math]::Floor(100 * $current / $total)
  if ($ratio -gt 100) { $ratio = 100 }
  $bar.Value = $ratio

  if ($status.state -eq 'done') {
    $bar.Value = 100
    $footer.Text = 'Installation terminee.'
    $script:doneAt = Get-Date
  } elseif ($status.state -eq 'failed') {
    $message = [string]$status.error
    if (-not $message) { $message = "L'installation a echoue." }
    Fail-Install $message
  } elseif (-not (Test-Alive $parent)) {
    Fail-Install "L'installation s'est interrompue."
  }
})

$form.Add_Shown({
  $form.Activate()
  $timer.Start()
  $delay = New-Object System.Windows.Forms.Timer
  $delay.Interval = 1000
  $delay.Add_Tick({
    $form.TopMost = $false
    $delay.Stop()
    $delay.Dispose()
  })
  $delay.Start()
})

$form.Add_FormClosed({
  $timer.Stop()
  $timer.Dispose()
})

[void][System.Windows.Forms.Application]::Run($form)
