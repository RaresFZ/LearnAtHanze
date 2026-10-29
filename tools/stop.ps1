# Stops LearnAtHanze cleanly: asks the running server to quit (POST /api/quit). The server first ends any live game and
# closes the phone port, then exits. It never kills a process by itself, so another program on the port is never touched.
# -Force: do not ask for confirmation when a live game is running.   Environment: PORT (default 3737), NO_PAUSE=1.
param([switch]$Force)
. "$PSScriptRoot\lah-common.ps1"

$s = Get-AppState
if ($s.State -eq 'free') { Write-Host 'LearnAtHanze is not running.'; exit 0 }
if ($s.State -eq 'other') {
    Show-Problem "Port $Port is used by a program that is not LearnAtHanze, so nothing was stopped."
    exit 1
}

if ($s.Live -and -not $Force) {
    Write-Host 'A live game is running. Stopping now ends it for every player and closes the phone port.' -ForegroundColor Yellow
    Write-Host 'Press Y to stop anyway, any other key to cancel.'
    try { $k = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown') } catch { Write-Host 'Cannot ask here. Run again with -Force to stop anyway.'; exit 1 }
    if ($k.Character -ne 'y' -and $k.Character -ne 'Y') { Write-Host 'Cancelled, LearnAtHanze keeps running.'; exit 0 }
}

try {
    Invoke-WebRequest "$Base/api/quit" -Method POST -ContentType 'application/json' -Body '{}' -UseBasicParsing -TimeoutSec 5 | Out-Null
} catch {
    Show-Problem "LearnAtHanze did not accept the stop request (an older copy that is still running?). Close its window, or end the node.exe process of LearnAtHanze in Task Manager."
    exit 1
}

$deadline = (Get-Date).AddSeconds(10)
while ((Get-Date) -lt $deadline) {
    if ((Get-AppState).State -ne 'ours') {
        Write-Host 'LearnAtHanze stopped.'
        if ($s.Live) { Write-Host 'The live game was ended and the phone port is closed.' }
        exit 0
    }
    Start-Sleep -Milliseconds 150
}
Show-Problem 'LearnAtHanze was asked to stop but still answers. Try again in a moment.'
exit 1
