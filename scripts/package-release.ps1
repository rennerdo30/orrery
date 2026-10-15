# Builds the release exe (--locked) and writes release\orrery-<version>-windows-x64.zip
# containing orrery.exe, LICENSE, THIRD_PARTY_NOTICES, README.md, register.ps1, unregister.ps1.
# register.ps1 works from the unzipped folder (the exe sits next to it). Prints the SHA256.
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location $root
try {
  $version = (Select-String -Path Cargo.toml -Pattern '^version\s*=\s*"([^"]+)"' | Select-Object -First 1).Matches[0].Groups[1].Value
  cargo build --release --locked
  if ($LASTEXITCODE -ne 0) { throw 'cargo build failed' }
  $name = "orrery-$version-windows-x64"
  $stage = Join-Path $root "release\$name"
  if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
  New-Item -ItemType Directory -Force $stage | Out-Null
  Copy-Item target\release\orrery.exe $stage
  foreach ($f in 'LICENSE', 'THIRD_PARTY_NOTICES', 'README.md', 'register.ps1', 'unregister.ps1') { Copy-Item $f $stage }
  $zip = Join-Path $root "release\$name.zip"
  if (Test-Path $zip) { Remove-Item -Force $zip }
  Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip
  Remove-Item -Recurse -Force $stage
  $sha = [Security.Cryptography.SHA256]::Create()
  $fs = [IO.File]::OpenRead($zip)
  try { $hash = ([BitConverter]::ToString($sha.ComputeHash($fs)) -replace '-', '').ToLower() } finally { $fs.Dispose() }
  Write-Host "Package: $zip"
  Write-Host "SHA256:  $hash"
} finally { Pop-Location }
