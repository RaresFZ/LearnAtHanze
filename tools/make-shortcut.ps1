# Creates a LearnAtHanze shortcut (with the paper-cutout icon) that starts the app with one double-click.
# Default place: your Desktop. Nothing else is touched, and an existing shortcut with the same name is replaced.
#   powershell -ExecutionPolicy Bypass -File tools\make-shortcut.ps1                 -> Desktop\LearnAtHanze.lnk
#   ... -IncludeStop                                                                  -> also Desktop\Stop LearnAtHanze.lnk
#   ... -Folder "C:\Some\Folder"                                                      -> put them there instead (e.g. the Start menu folder)
# Remove them later by deleting the .lnk files. The shortcuts point at THIS copy of the project: if you move the folder, run this again.
param(
    [string]$Folder = [Environment]::GetFolderPath('Desktop'),
    [switch]$IncludeStop
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$icon = Join-Path $root 'tools\icon\LearnAtHanze.ico'
if (-not (Test-Path $icon)) { throw "Icon not found: $icon (run: node tools\pack-ico.mjs)" }
if (-not (Test-Path $Folder -PathType Container)) { throw "Folder not found: $Folder" }

function New-Shortcut([string]$Name, [string]$Target, [string]$Text, [int]$Window) {
    $path = Join-Path $Folder "$Name.lnk"
    $sh = New-Object -ComObject WScript.Shell
    $l = $sh.CreateShortcut($path)
    $l.TargetPath = $Target
    $l.WorkingDirectory = $root
    $l.IconLocation = "$icon,0"
    $l.Description = $Text
    $l.WindowStyle = $Window          # 7 = minimized: the launcher's console only flashes in the taskbar; problems show as a message box
    $l.Save()
    Write-Host "Created $path"
}

New-Shortcut 'LearnAtHanze' (Join-Path $root 'LearnAtHanze.bat') 'Start LearnAtHanze and open it in the browser' 7
if ($IncludeStop) { New-Shortcut 'Stop LearnAtHanze' (Join-Path $root 'Stop LearnAtHanze.bat') 'Stop LearnAtHanze (ends a running live game, closes the phone port)' 1 }
