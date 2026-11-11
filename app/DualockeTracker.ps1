# Dualocke Tracker - vigila la partida del emulador y la sube al repositorio cada vez que guardas.
# (Sin acentos a proposito: PowerShell 5 los lee mal en archivos sin BOM.)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName Microsoft.VisualBasic
[System.Windows.Forms.Application]::EnableVisualStyles()
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repo     = 'ZJaviiZ/Dualocke'
$WebUrl   = 'https://zjaviiz.github.io/Dualocke/'
$SaveSize = 445440
$Title    = 'Dualocke Tracker'
$Dir      = Split-Path -Parent $MyInvocation.MyCommand.Path
$CfgPath  = Join-Path $Dir 'config.json'

$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'DualockeTrackerMutex', [ref]$created)
if (-not $created) { exit }

function Msg($text, $icon = 'Information') { [void][System.Windows.Forms.MessageBox]::Show($text, $Title, 'OK', $icon) }
function Save-Config { ($cfg | ConvertTo-Json) | Set-Content -Path $CfgPath -Encoding UTF8 }

# ---------- configuracion ----------
$cfg = @{ player = ''; token = ''; savePath = ''; emulator = ''; lastHash = '' }
if (Test-Path $CfgPath) {
  try { $o = Get-Content -Raw -Path $CfgPath | ConvertFrom-Json; foreach ($p in $o.PSObject.Properties) { $cfg[$p.Name] = [string]$p.Value } } catch {}
}

function Find-Save {
  $found = @()
  foreach ($emu in 'Citra', 'Azahar', 'Lime3DS', 'Mandarine') {
    $root = Join-Path $env:APPDATA "$emu\sdmc\Nintendo 3DS"
    if (Test-Path $root) {
      $found += Get-ChildItem -Path $root -Recurse -Filter 'main' -File -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -like '*\title\00040000\001b5000\data\00000001\main' }
    }
  }
  if ($found.Count -gt 0) { return ($found | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName }
  return ''
}
function Find-Emulator {
  $c = @(
    (Join-Path $env:LOCALAPPDATA 'Citra\nightly\citra-qt.exe'), (Join-Path $env:LOCALAPPDATA 'Citra\canary\citra-qt.exe'),
    (Join-Path $env:ProgramFiles 'Azahar\azahar.exe'), (Join-Path $env:LOCALAPPDATA 'Programs\Azahar\azahar.exe'),
    (Join-Path $env:ProgramFiles 'Lime3DS\lime3ds.exe'), (Join-Path $env:LOCALAPPDATA 'Lime3DS\lime3ds.exe')
  )
  foreach ($p in $c) { if (Test-Path $p) { return $p } }
  return ''
}

if (-not $cfg.player) {
  $n = [Microsoft.VisualBasic.Interaction]::InputBox('Tu nombre de jugador (solo letras y numeros):', $Title, $env:USERNAME)
  $n = ($n -replace '[^A-Za-z0-9_-]', '')
  if (-not $n) { exit }
  $cfg.player = $n
}
if (-not $cfg.token) {
  $t = [Microsoft.VisualBasic.Interaction]::InputBox('Pega la clave de acceso del repositorio (empieza por github_pat_):', $Title, '')
  $t = $t.Trim()
  if (-not $t) { exit }
  $cfg.token = $t
}
if (-not $cfg.savePath -or -not (Test-Path $cfg.savePath)) {
  $cfg.savePath = Find-Save
  if (-not $cfg.savePath) {
    Msg 'No encuentro la partida de Ultra Sol. Elige el archivo "main" de tu partida en la ventana siguiente.' 'Warning'
    $dlg = New-Object System.Windows.Forms.OpenFileDialog
    $dlg.Title = 'Elige el archivo main de la partida'; $dlg.Filter = 'Partida (main)|main|Todos|*.*'; $dlg.InitialDirectory = $env:APPDATA
    if ($dlg.ShowDialog() -ne 'OK') { exit }
    $cfg.savePath = $dlg.FileName
  }
}
if ($cfg.emulator -eq '') {
  $cfg.emulator = Find-Emulator
  if (-not $cfg.emulator) {
    $r = [System.Windows.Forms.MessageBox]::Show('Quieres que el tracker abra el emulador automaticamente? Si dices que si, elige su .exe en la ventana siguiente.', $Title, 'YesNo', 'Question')
    if ($r -eq 'Yes') {
      $dlg = New-Object System.Windows.Forms.OpenFileDialog
      $dlg.Title = 'Elige el ejecutable del emulador'; $dlg.Filter = 'Programas|*.exe'
      if ($dlg.ShowDialog() -eq 'OK') { $cfg.emulator = $dlg.FileName }
    }
    if (-not $cfg.emulator) { $cfg.emulator = 'none' }
  }
}
Save-Config

# ---------- icono en la bandeja ----------
$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = [System.Drawing.SystemIcons]::Shield
$tray.Text = "$Title - $($cfg.player)"
$tray.Visible = $true
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$status = $menu.Items.Add('Conectado. Esperando a que guardes...'); $status.Enabled = $false
[void]$menu.Items.Add('-')
$mWeb = $menu.Items.Add('Abrir la web del Dualocke'); $mWeb.Add_Click({ Start-Process $WebUrl })
$mExit = $menu.Items.Add('Salir'); $mExit.Add_Click({ $tray.Visible = $false; [System.Windows.Forms.Application]::Exit() })
$tray.ContextMenuStrip = $menu
$tray.Add_DoubleClick({ Start-Process $WebUrl })
function Notify($text, $icon = 'Info') { $tray.ShowBalloonTip(4000, $Title, $text, $icon) }

# ---------- subida ----------
function Upload-Save([byte[]]$bytes) {
  $ts = [DateTime]::UtcNow.ToString("yyyy-MM-dd'T'HH-mm-ss'Z'")
  $url = "https://api.github.com/repos/$Repo/contents/saves/$($cfg.player)/$ts.sav"
  $body = @{ message = "Partida de $($cfg.player) ($ts)"; content = [Convert]::ToBase64String($bytes) } | ConvertTo-Json
  $headers = @{ Authorization = "Bearer $($cfg.token)"; 'User-Agent' = 'DualockeTracker'; Accept = 'application/vnd.github+json' }
  [void](Invoke-RestMethod -Method Put -Uri $url -Headers $headers -Body $body -ContentType 'application/json')
}

$script:seenStamp = 0
$script:doneStamp = 0
$script:nextTry = [DateTime]::MinValue
$script:lastError = ''

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 3000
$timer.Add_Tick({
  try {
    if ([DateTime]::UtcNow -lt $script:nextTry) { return }
    $fi = New-Object System.IO.FileInfo($cfg.savePath)
    if (-not $fi.Exists -or $fi.Length -ne $SaveSize) { return }
    $stamp = $fi.LastWriteTimeUtc.Ticks
    if ($stamp -eq $script:doneStamp) { return }
    if ($stamp -ne $script:seenStamp) { $script:seenStamp = $stamp; return }   # espera a que el emulador termine de escribir
    $fs = [System.IO.File]::Open($cfg.savePath, 'Open', 'Read', 'ReadWrite')
    try { $bytes = New-Object byte[] $SaveSize; $read = $fs.Read($bytes, 0, $SaveSize) } finally { $fs.Close() }
    if ($read -ne $SaveSize) { return }
    $sha = [System.Security.Cryptography.SHA1]::Create()
    $hash = [BitConverter]::ToString($sha.ComputeHash($bytes)) -replace '-', ''
    if ($hash -ne $cfg.lastHash) {
      Upload-Save $bytes
      $cfg.lastHash = $hash
      Save-Config
      $status.Text = 'Ultima subida: ' + (Get-Date).ToString('HH:mm:ss')
      Notify 'Partida subida correctamente.'
    }
    $script:doneStamp = $stamp
    $script:lastError = ''
  } catch {
    $m = $_.Exception.Message
    if ($m -match '401') { $m = 'La clave de acceso no es valida o ha caducado. Borra config.json y vuelve a abrir el tracker.' }
    elseif ($m -match '403|404') { $m = 'La clave no tiene permiso para escribir en el repositorio.' }
    $status.Text = 'Error: reintentando...'
    if ($m -ne $script:lastError) { Notify ("No se ha podido subir la partida. " + $m) 'Warning'; $script:lastError = $m }
    $script:nextTry = [DateTime]::UtcNow.AddSeconds(30)
  }
})
$timer.Start()

# ---------- abrir el emulador ----------
if ($cfg.emulator -and $cfg.emulator -ne 'none' -and (Test-Path $cfg.emulator)) {
  $name = [System.IO.Path]::GetFileNameWithoutExtension($cfg.emulator)
  if (-not (Get-Process -Name $name -ErrorAction SilentlyContinue)) { Start-Process -FilePath $cfg.emulator -WorkingDirectory (Split-Path -Parent $cfg.emulator) }
}
Notify "Conectado como $($cfg.player). Cada vez que guardes, la partida se sube sola."
[System.Windows.Forms.Application]::Run()
$tray.Dispose()
$mutex.ReleaseMutex()
