# Removes exactly what register.ps1 added (HKCU only).
$ErrorActionPreference = 'Stop'
$progId = 'Orrery.Model'
$exts = '.fbx', '.glb', '.gltf'
$classes = 'HKCU:\Software\Classes'

foreach ($e in $exts) {
  $k = "$classes\$e\OpenWithProgids"
  if (Test-Path $k) { Remove-ItemProperty -Path $k -Name $progId -ErrorAction SilentlyContinue }
}
foreach ($k in "$classes\$progId", "$classes\Applications\orrery.exe") {
  if (Test-Path $k) { Remove-Item -Path $k -Recurse -Force }
}

Add-Type -Namespace Win32 -Name Shell -MemberDefinition '[System.Runtime.InteropServices.DllImport("shell32.dll")] public static extern void SHChangeNotify(int e, uint f, System.IntPtr a, System.IntPtr b);'
[Win32.Shell]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
Write-Host 'Unregistered Orrery. If it was chosen as default for a type, Windows falls back on its own.'
