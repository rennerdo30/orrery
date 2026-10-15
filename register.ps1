# Registers Orrery for the current user (HKCU only, no admin).
# Adds: ProgID Orrery.Model, Applications\orrery.exe (so it shows as "Orrery" in Open with),
# and Orrery.Model under OpenWithProgids for .fbx, .glb and .gltf.
# It does NOT set the default app: Windows protects that with a hash (UserChoice).
# One-time step: right-click a model file > Open with > Choose another app > Orrery > Always.
# Default exe: orrery.exe next to this script (release zip), else dist\orrery.exe, else target\release\orrery.exe
# (after `cargo build --release`); or pass -Exe <path>. The registry stores the exe's path, so keep it in place.
param([string]$Exe = '')
$ErrorActionPreference = 'Stop'
if (-not $Exe) {
  $Exe = @('orrery.exe', 'dist\orrery.exe', 'target\release\orrery.exe') | ForEach-Object { Join-Path $PSScriptRoot $_ } | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $Exe) { throw 'orrery.exe not found. Run: cargo build --release   (or pass -Exe <path>)' }
}
$Exe = (Resolve-Path $Exe).Path
$progId = 'Orrery.Model'
$exts = '.fbx', '.glb', '.gltf'
$classes = 'HKCU:\Software\Classes'

function Set-Default($path, $value) {
  New-Item -Path $path -Force | Out-Null
  Set-ItemProperty -Path $path -Name '(default)' -Value $value
}

Set-Default "$classes\$progId" 'Orrery 3D model'
Set-Default "$classes\$progId\DefaultIcon" "`"$Exe`",0"
Set-Default "$classes\$progId\shell" 'open'
Set-Default "$classes\$progId\shell\open" 'Open with Orrery'
Set-Default "$classes\$progId\shell\open\command" "`"$Exe`" `"%1`""

$app = "$classes\Applications\orrery.exe"
Set-Default $app ''
Set-ItemProperty -Path $app -Name 'FriendlyAppName' -Value 'Orrery'
Set-Default "$app\DefaultIcon" "`"$Exe`",0"
Set-Default "$app\shell\open\command" "`"$Exe`" `"%1`""
New-Item -Path "$app\SupportedTypes" -Force | Out-Null
foreach ($e in $exts) { Set-ItemProperty -Path "$app\SupportedTypes" -Name $e -Value '' }

foreach ($e in $exts) {
  $k = "$classes\$e\OpenWithProgids"
  New-Item -Path $k -Force | Out-Null
  New-ItemProperty -Path $k -Name $progId -PropertyType String -Value '' -Force | Out-Null
}

Add-Type -Namespace Win32 -Name Shell -MemberDefinition '[System.Runtime.InteropServices.DllImport("shell32.dll")] public static extern void SHChangeNotify(int e, uint f, System.IntPtr a, System.IntPtr b);'
[Win32.Shell]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)  # SHCNE_ASSOCCHANGED
Write-Host "Registered Orrery ($Exe) for $($exts -join ', ')."
Write-Host 'Make it the default once: right-click a model file > Open with > Choose another app > Orrery > Always.'
