# Opens each file with Orrery (read-only), logs the result, saves a screenshot and exits.
# Only the process started here is ever stopped (timeout case).
# -Lib adds an animation library after loading; -WaitMs lets animation advance before the screenshot.
param(
  [string]$Exe = "$PSScriptRoot\..\dist\orrery.exe",
  [string]$OutDir = "$env:TEMP\orrery-smoke",
  [string]$Lib = '',
  [int]$WaitMs = 0,
  [string[]]$Files
)
$Exe = (Resolve-Path $Exe).Path
New-Item -ItemType Directory -Force $OutDir | Out-Null
foreach ($f0 in $Files) {
  $f = (Resolve-Path $f0).Path
  $n = [IO.Path]::GetFileNameWithoutExtension($f)
  $log = Join-Path $OutDir "$n.log"; $png = Join-Path $OutDir "$n.png"
  Remove-Item $log, $png -ErrorAction SilentlyContinue
  $a = @("`"$f`"", '--log', "`"$log`"", '--screenshot', "`"$png`"")
  if ($Lib) { $a += @('--lib', "`"$((Resolve-Path $Lib).Path)`"") }
  if ($WaitMs) { $a += @('--wait', "$WaitMs") }
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $p = Start-Process -FilePath $Exe -ArgumentList $a -PassThru
  if (-not $p.WaitForExit(60000)) { try { $p.Kill() } catch {}; "TIMEOUT $f" }
  "{0} ({1} ms): {2}" -f $n, $sw.ElapsedMilliseconds, ((Get-Content $log -ErrorAction SilentlyContinue) -join ' | ')
}
