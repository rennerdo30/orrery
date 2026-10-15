# Opens each file with Orrery (read-only), logs result, screenshots, closes only the PID it started.
param([string]$Exe = "$PSScriptRoot\..\dist\orrery.exe", [string]$OutDir = "$env:TEMP\orrery-smoke", [Parameter(ValueFromRemainingArguments)][string[]]$Files)
$Exe = (Resolve-Path $Exe).Path; New-Item -ItemType Directory -Force $OutDir | Out-Null
foreach ($f0 in $Files) { $f = (Resolve-Path $f0).Path
  $n = [IO.Path]::GetFileNameWithoutExtension($f)
  $log = Join-Path $OutDir "$n.log"; $png = Join-Path $OutDir "$n.png"
  Remove-Item $log, $png -ErrorAction SilentlyContinue
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $p = Start-Process -FilePath $Exe -ArgumentList @("`"$f`"", "--log", "`"$log`"", "--screenshot", "`"$png`"") -PassThru
  if (-not $p.WaitForExit(30000)) { try { $p.Kill() } catch {} ; "TIMEOUT $f" }
  "{0} ({1} ms): {2}" -f $n, $sw.ElapsedMilliseconds, ((Get-Content $log -ErrorAction SilentlyContinue) -join ' | ')
}
