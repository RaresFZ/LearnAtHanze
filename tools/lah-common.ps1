# Shared by launch.ps1 and stop.ps1 (LearnAtHanze.bat and "Stop LearnAtHanze.bat" call those).
# Plain ASCII on purpose: Windows PowerShell 5.1 reads scripts without a byte order mark in the local code page.
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Port = if ($env:PORT) { [int]$env:PORT } else { 3737 }
$Base = "http://127.0.0.1:$Port"      # probes and the stop request
$Url  = "http://localhost:$Port"      # what the browser opens (progress is stored per address, so always "localhost")

<#
  Who is on the port? Read-only: it only asks /api/live/status, which only LearnAtHanze answers with an "active" field.
    ours  = LearnAtHanze is running (Live = a live game is hosted right now)
    other = something else answers, or accepts the connection but does not answer
    free  = nothing listens
#>
function Get-AppState {
    try {
        $r = Invoke-WebRequest "$Base/api/live/status" -UseBasicParsing -TimeoutSec 3
        try {
            $j = $r.Content | ConvertFrom-Json
            if ($null -ne $j -and $null -ne $j.PSObject.Properties['active']) { return @{ State = 'ours'; Live = [bool]$j.active } }
        } catch { }
        return @{ State = 'other' }
    } catch {
        $ex = $_.Exception
        if ($ex.Response) { return @{ State = 'other' } }                       # an HTTP error status: someone answered
        if ($ex -is [System.Net.WebException] -and $ex.Status -eq [System.Net.WebExceptionStatus]::ConnectFailure) { return @{ State = 'free' } }
        if ($ex.Message -match 'refused|No connection could be made|actively refused') { return @{ State = 'free' } }
        return @{ State = 'other' }
    }
}

<# A problem the person must see, even when started from a minimized shortcut: console text plus a message box. NO_PAUSE=1 (tests) skips the box. #>
function Show-Problem([string]$Text) {
    Write-Host ''
    Write-Host $Text -ForegroundColor Yellow
    if ($env:NO_PAUSE) { return }
    try {
        Add-Type -AssemblyName System.Windows.Forms
        [void][System.Windows.Forms.MessageBox]::Show($Text, 'LearnAtHanze')
    } catch {
        Read-Host 'Press Enter to close'
    }
}
