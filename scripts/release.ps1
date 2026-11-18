#requires -Version 7.0
<#
.SYNOPSIS
    One-command release: version bump, changelog section, checks, commit, tag, push.

.DESCRIPTION
    Run from a clean checkout of main that matches origin/main. The script
      1. refuses a dirty tree, a branch other than main, a main that differs
         from origin/main, an existing tag, a version that does not go up, an
         empty "Unreleased" changelog section, an origin that is not
         https://github.com/rennerdo30/orrery, and an author or committer
         identity that is not a GitHub noreply address;
      2. sets the version in Cargo.toml and Cargo.lock;
      3. moves the "Unreleased" notes of CHANGELOG.md into a "## X.Y.Z" section;
      4. runs cargo fmt --check, clippy and the tests (unless -SkipTests);
      5. commits "Release X.Y.Z", tags vX.Y.Z (annotated);
      6. pushes HEAD to main and the tag, both with explicit refs.
    The tag push starts .github/workflows/release.yml, which builds the
    packages and prepares a DRAFT GitHub release. Publishing the draft and the
    crates.io upload stay the owner's yes (docs/RELEASING.md).

    -DryRun changes nothing: it runs every check that does not write, reports
    what the script would refuse, and prints the planned edits.

.EXAMPLE
    ./scripts/release.ps1 -Version 0.1.0 -DryRun
.EXAMPLE
    ./scripts/release.ps1 -Version 0.1.0
#>
[CmdletBinding()]
param(
    # X.Y.Z or X.Y.Z-pre.N (a prerelease tag becomes a GitHub prerelease).
    [Parameter(Mandatory, Position = 0)]
    [ValidatePattern('^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$')]
    [string]$Version,

    [switch]$DryRun,

    # Skip the test run (fmt and clippy still run). Release CI runs the tests again.
    [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repo
$tag = "v$Version"
$utf8 = [System.Text.UTF8Encoding]::new($false)

# Problems found in dry-run mode are reported and collected; otherwise they stop the script.
$problems = [System.Collections.Generic.List[string]]::new()
function Fail([string]$Message) {
    if ($DryRun) { $problems.Add($Message); Write-Host "WOULD REFUSE: $Message" -ForegroundColor Yellow }
    else { throw $Message }
}
function Invoke-Git {
    $out = & git @args
    if ($LASTEXITCODE -ne 0) { throw "git $($args -join ' ') failed" }
    $out
}

# --- Preconditions -----------------------------------------------------------
# Check the remote before the first network call and before anything is pushed.
$originUrl = (Invoke-Git remote get-url origin).Trim()
if ($originUrl -notmatch '^https://github\.com/rennerdo30/orrery(\.git)?$') {
    Fail "origin is '$originUrl', not https://github.com/rennerdo30/orrery (a release is pushed only to the public repository)."
}
Invoke-Git fetch origin --quiet | Out-Null

if (Invoke-Git status --porcelain) { Fail 'The working tree is not clean (commit or remove changes first).' }

$branch = (Invoke-Git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -ne 'main') { Fail "Releases are cut from main; this is '$branch'." }

$head = (Invoke-Git rev-parse HEAD).Trim()
$remote = (Invoke-Git rev-parse origin/main).Trim()
if ($head -ne $remote) { Fail "HEAD ($($head.Substring(0,7))) is not origin/main ($($remote.Substring(0,7)))." }

if (Invoke-Git tag --list $tag) { Fail "Tag $tag already exists locally." }
if (Invoke-Git ls-remote --tags origin "refs/tags/$tag") { Fail "Tag $tag already exists on origin." }

# The commit (author) and the annotated tag (committer) both carry an identity.
$ident = (Invoke-Git var GIT_AUTHOR_IDENT).Trim()
$committer = (Invoke-Git var GIT_COMMITTER_IDENT).Trim()
foreach ($who in @(@('author', $ident), @('committer', $committer))) {
    if ($who[1] -notmatch '<[^>]*@users\.noreply\.github\.com>') {
        Fail "The $($who[0]) identity is not a public GitHub noreply address (set GIT_AUTHOR_* and GIT_COMMITTER_* in the environment; this script never writes Git config)."
    }
}

# --- Versions and changelog (in memory first) --------------------------------
$tomlPath = Join-Path $repo 'Cargo.toml'
$lockPath = Join-Path $repo 'Cargo.lock'
$logPath = Join-Path $repo 'CHANGELOG.md'
$toml = [IO.File]::ReadAllText($tomlPath)
$lock = [IO.File]::ReadAllText($lockPath)
$log = [IO.File]::ReadAllText($logPath)

$pkg = [regex]::Match($toml, '(?ms)^\[package\]\s*\r?\n.*?^version = "([^"]+)"')
if (-not $pkg.Success) { throw 'No version in the [package] table of Cargo.toml.' }
$current = $pkg.Groups[1].Value

function Parse-Version([string]$v) {
    $m = [regex]::Match($v, '^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$')
    [pscustomobject]@{ Core = [version]"$($m.Groups[1].Value).$($m.Groups[2].Value).$($m.Groups[3].Value)"; Pre = $m.Groups[4].Value }
}
$old = Parse-Version $current
$new = Parse-Version $Version
$goesUp = if ($new.Core -ne $old.Core) { $new.Core -gt $old.Core }
          elseif ($new.Pre -eq $old.Pre) { $false }
          elseif (-not $new.Pre) { $true }          # 0.2.0 ranks above 0.2.0-beta.1
          elseif (-not $old.Pre) { $false }
          else { [string]::CompareOrdinal($new.Pre, $old.Pre) -gt 0 }
# The first release has nothing to go up from: Cargo.toml still says 0.1.0 and may be released as is,
# or as a prerelease of it (0.1.0-rc.1, the dry run in docs/RELEASING.md).
$firstRelease = -not (Invoke-Git tag --list 'v*')
if (-not $goesUp -and -not ($firstRelease -and $new.Core -eq $old.Core)) {
    Fail "Version $Version does not go up from $current."
}

$unreleased = [regex]::Match($log, '(?ms)^## Unreleased[ \t]*\r?\n(.*?)(?=^## |\z)')
if (-not $unreleased.Success) { throw 'CHANGELOG.md has no "## Unreleased" section.' }
if ([string]::IsNullOrWhiteSpace($unreleased.Groups[1].Value)) { Fail 'The Unreleased section of CHANGELOG.md is empty.' }
if ($log -match "(?m)^## $([regex]::Escape($Version))[ \t]*$") { Fail "CHANGELOG.md already has a section for $Version." }

$newToml = [regex]::Replace($toml, '(?ms)(^\[package\]\s*\r?\n.*?^version = ")[^"]+(")', "`${1}$Version`${2}", 1)
$newLock = [regex]::Replace($lock, '(?m)(^name = "orrery-viewer"\r?\nversion = ")[^"]+(")', "`${1}$Version`${2}", 1)
if ($newLock -eq $lock -and $current -ne $Version) { throw 'Could not find the orrery-viewer entry in Cargo.lock.' }
$body = $unreleased.Groups[1].Value
$newLog = $log.Remove($unreleased.Index, $unreleased.Length).Insert($unreleased.Index, "## Unreleased`n`n## $Version`n$body")

# --- Plan / dry run ----------------------------------------------------------
Write-Host "orrery-viewer release $current -> $Version (tag $tag)"
Write-Host "  base: $($head.Substring(0,7)) on $branch; identity: $($ident -replace ' \d+ [+-]\d{4}$', '')"
Write-Host '  Cargo.toml : version line'
Write-Host '  Cargo.lock : orrery-viewer entry'
Write-Host "  CHANGELOG  : Unreleased notes -> '## $Version'"
Write-Host '  checks     : cargo fmt --check; cargo clippy --all-targets --locked -D warnings;' $(if ($SkipTests) { '(tests skipped)' } else { 'cargo test --locked' })
Write-Host "  git        : commit 'Release $Version'; tag -a $tag"
Write-Host "  push       : git push origin HEAD:refs/heads/main ; git push origin refs/tags/$tag"
if ($DryRun) {
    if ($problems.Count) { Write-Host "Dry run: $($problems.Count) problem(s) above would stop a real run." -ForegroundColor Yellow }
    else { Write-Host 'Dry run: nothing would stop a real run. Nothing was changed.' }
    exit 0
}

# --- Real run ----------------------------------------------------------------
[IO.File]::WriteAllText($tomlPath, $newToml, $utf8)
[IO.File]::WriteAllText($lockPath, $newLock, $utf8)
[IO.File]::WriteAllText($logPath, $newLog, $utf8)

try {
    & cargo fmt --all --check
    if ($LASTEXITCODE) { throw 'cargo fmt --check failed' }
    & cargo clippy --all-targets --locked -- -D warnings
    if ($LASTEXITCODE) { throw 'cargo clippy failed' }
    if (-not $SkipTests) {
        & cargo test --locked
        if ($LASTEXITCODE) { throw 'cargo test failed' }
    }
} catch {
    Write-Host 'Checks failed; restoring the edited files.' -ForegroundColor Red
    Invoke-Git checkout -- Cargo.toml Cargo.lock CHANGELOG.md | Out-Null
    throw
}

Invoke-Git add Cargo.toml Cargo.lock CHANGELOG.md | Out-Null
Invoke-Git commit -m "Release $Version" | Out-Null
Invoke-Git tag -a $tag -m "Orrery $Version" | Out-Null

# Explicit refs only; no -u, no force.
Invoke-Git push origin HEAD:refs/heads/main
Invoke-Git push origin "refs/tags/$tag"
Write-Host "Pushed $tag. CI builds the packages and prepares a DRAFT release; publishing it is the owner's yes."
