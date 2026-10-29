# One-click launcher: starts the LearnAtHanze server in a hidden window, waits until it answers, then opens the browser.
# If it is already running it only opens the browser. Never kills anything and never picks another port.
# Environment (all optional): PORT (default 3737), NO_OPEN=1 (do not open the browser), NO_PAUSE=1 (no message box on problems).
. "$PSScriptRoot\lah-common.ps1"

$openBrowser = -not $env:NO_OPEN
function Open-App { if ($openBrowser) { Start-Process $Url } }

$s = Get-AppState
if ($s.State -eq 'ours') {
    Write-Host "LearnAtHanze is already running at $Url."
    Open-App
    exit 0
}
if ($s.State -eq 'other') {
    Show-Problem ("Port $Port is already used by another program, so LearnAtHanze cannot start. That program did not answer like LearnAtHanze.`n`n" +
        "To find it, open PowerShell and run:`n  netstat -ano | findstr :$Port`n  tasklist /FI ""PID eq <the last number>""`n" +
        "Close that program and start LearnAtHanze again.`n`n" +
        "Please do not switch to another port: your progress is stored per address and would look empty. (If you must, see the README: PORT=4000.)")
    exit 1
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Show-Problem "Node.js was not found. Install the LTS version from https://nodejs.org (it adds node to your PATH), then start LearnAtHanze again."
    exit 1
}

$out = Join-Path $Root 'LearnAtHanze.out.log'
$err = Join-Path $Root 'LearnAtHanze.err.log'
$env:NO_OPEN = '1'      # this script opens the browser itself, once the server answers
$p = Start-Process -FilePath $node.Source -ArgumentList 'server.js' -WorkingDirectory $Root -WindowStyle Hidden `
    -RedirectStandardOutput $out -RedirectStandardError $err -PassThru

$deadline = (Get-Date).AddSeconds(20)
$ready = $false
while ((Get-Date) -lt $deadline) {
    if ($p.HasExited) { break }
    if ((Get-AppState).State -eq 'ours') { $ready = $true; break }
    Start-Sleep -Milliseconds 150
}
if (-not $ready) {
    $why = if (Test-Path $err) { (Get-Content $err -Raw) } else { '' }
    if (-not $why) { $why = if (Test-Path $out) { (Get-Content $out -Raw) } else { '' } }
    Show-Problem ("LearnAtHanze did not start" + $(if ($p.HasExited) { '.' } else { ' in time.' }) + "`n`n" + $why + "`nLog files: $out and $err")
    exit 1
}
Write-Host "LearnAtHanze started (process $($p.Id)) at $Url."
Open-App
exit 0
