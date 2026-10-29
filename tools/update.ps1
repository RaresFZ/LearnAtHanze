# Launcher self-update. Dot-sourced by launch.ps1 (after lah-common.ps1); plain ASCII, Windows PowerShell 5.1.
#
# What it does: compares this copy with the newest commit on GitHub's main branch and, only after a yes, brings it up to date.
#   git clone (.git folder):  git pull --ff-only. Git itself refuses (and changes nothing) when your edits are in the way.
#   ZIP copy (no .git):       downloads the ZIP of that commit and copies the files over. .lah-install.json remembers the hash of every
#                             file it wrote, so a file you edited that the update would also change is detected and the whole update is refused.
# Rules: never without asking; never when the app is running; any network problem while checking is silent and the check never takes
# longer than $CheckSeconds in total; progress lives in the browser, so nothing here can touch it; never touches "exams studies/",
# *.log, .git or .lah-* files; nothing is created outside this folder (scratch work is in .lah-update/, backups in .lah-backup/).
# Environment (all optional): LAH_NO_UPDATE=1 (skip everything), LAH_UPDATED=1 (set by the launcher after an update), LAH_UPDATE_ANSWER=y|n
# (answer the question without a window), LAH_UPDATE_VERBOSE=1 (say why a check was skipped). Tests only: LAH_REPO, LAH_API, LAH_ZIP_URL
# (with {sha}), LAH_GIT_URL.

$Repo        = if ($env:LAH_REPO) { $env:LAH_REPO } else { 'RaresFZ/LearnAtHanze' }
$ApiBase     = if ($env:LAH_API) { $env:LAH_API.TrimEnd('/') } else { 'https://api.github.com' }
$ZipUrlTpl   = if ($env:LAH_ZIP_URL) { $env:LAH_ZIP_URL } else { "https://github.com/$Repo/archive/{sha}.zip" }
$GitUrl      = if ($env:LAH_GIT_URL) { $env:LAH_GIT_URL } else { "https://github.com/$Repo.git" }
$Branch      = 'main'
$StateFile   = Join-Path $Root '.lah-install.json'
$WorkDir     = Join-Path $Root '.lah-update'
$CheckSeconds = 4
$script:CheckDeadline = $null

function Write-Verbose2([string]$Text) { if ($env:LAH_UPDATE_VERBOSE) { Write-Host "[update] $Text" -ForegroundColor DarkGray } }

<# GET a GitHub API url and return the parsed JSON, or $null on ANY problem. Runs in its own runspace so a hung connection or DNS lookup
   cannot hold the launcher longer than the time left of the overall check budget. #>
function Get-Json([string]$Path) {
    $left = if ($script:CheckDeadline) { ($script:CheckDeadline - (Get-Date)).TotalMilliseconds } else { 4000 }
    if ($left -lt 300) { return $null }
    $ps = [powershell]::Create()
    [void]$ps.AddScript({
        param($u)
        $ErrorActionPreference = 'Stop'
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        (Invoke-WebRequest $u -UseBasicParsing -TimeoutSec 6 -Headers @{ 'User-Agent' = 'LearnAtHanze-launcher'; 'Accept' = 'application/vnd.github+json' }).Content
    }).AddArgument("$ApiBase$Path")
    $h = $ps.BeginInvoke()
    try {
        if (-not $h.AsyncWaitHandle.WaitOne([int]$left)) { [void]$ps.BeginStop($null, $null); Write-Verbose2 "timed out: $Path"; return $null }
        $text = ($ps.EndInvoke($h) | Out-String)
        $ps.Dispose()
        return ($text | ConvertFrom-Json)
    } catch {
        Write-Verbose2 "$Path : $($_.Exception.Message)"
        return $null
    }
}

function Invoke-Git([string[]]$GitArgs) {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $script:GitExe
    $psi.Arguments = (($GitArgs | ForEach-Object { if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ } }) -join ' ')
    $psi.WorkingDirectory = $Root
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $psi.EnvironmentVariables['GIT_TERMINAL_PROMPT'] = '0'      # never wait for a password
    $p = [System.Diagnostics.Process]::Start($psi)
    $errTask = $p.StandardError.ReadToEndAsync()
    $out = $p.StandardOutput.ReadToEnd()
    $p.WaitForExit()
    return @{ Code = $p.ExitCode; Out = $out.Trim(); Err = $errTask.Result.Trim() }
}

<# Which version is this copy? Mode: git (a clone), zip (no .git; Sha is $null when this copy was not made by the updater), none (git missing). #>
function Get-LocalVersion {
    if (Test-Path (Join-Path $Root '.git')) {
        $g = Get-Command git -ErrorAction SilentlyContinue
        if (-not $g) { return @{ Mode = 'none'; Why = 'This folder is a git clone, but git was not found on your PATH.' } }
        $script:GitExe = $g.Source
        $sha = Invoke-Git @('rev-parse', 'HEAD')
        if ($sha.Code -ne 0) { return @{ Mode = 'none'; Why = 'git could not read this folder.' } }
        $br  = (Invoke-Git @('rev-parse', '--abbrev-ref', 'HEAD')).Out
        $log = (Invoke-Git @('log', '-1', '--format=%cs')).Out
        return @{ Mode = 'git'; Sha = $sha.Out; Date = $log; Branch = $br }
    }
    if (Test-Path $StateFile) {
        try {
            $st = Get-Content $StateFile -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($st.commit) { return @{ Mode = 'zip'; Sha = [string]$st.commit; Date = [string]$st.date; HasManifest = [bool]$st.files } }
        } catch { }
    }
    return @{ Mode = 'zip'; Sha = $null; Date = $null; HasManifest = $false }
}

function Format-Version($v) {
    if ($v.Mode -eq 'none') { return 'unknown' }
    if (-not $v.Sha) { return 'unknown (this copy was not installed by the updater)' }
    $t = $v.Sha.Substring(0, 7)
    if ($v.Date) { $t += " ($($v.Date))" }
    return $t
}

function Format-Commit($c) {
    $msg = ([string]$c.commit.message -split "`n")[0].Trim()
    if ($msg.Length -gt 100) { $msg = $msg.Substring(0, 97) + '...' }
    return "$($c.sha.Substring(0, 7))  $msg"
}

<# Is there something newer on GitHub? Returns $null (up to date, or the answer is not known: stay silent) or
   @{ Latest; LatestDate; Status; Commits (newest first); Ahead } #>
function Get-UpdateInfo($local) {
    $script:CheckDeadline = (Get-Date).AddSeconds($CheckSeconds)
    $latest = Get-Json "/repos/$Repo/commits/$Branch"
    if (-not $latest -or -not $latest.sha) { return $null }
    $info = @{ Latest = [string]$latest.sha; LatestDate = ([string]$latest.commit.committer.date).Substring(0, 10); Status = 'ahead'; Commits = @($latest); Ahead = 1 }
    if ($local.Mode -eq 'none') { return $null }
    if (-not $local.Sha) { return $info }                          # a ZIP copy of unknown age: the newest commit is all we can show
    if ($local.Sha -eq $info.Latest) { return $null }
    $cmp = Get-Json "/repos/$Repo/compare/$($local.Sha)...${Branch}?per_page=100"
    if (-not $cmp) { return $null }      # also when GitHub does not know our commit (unpublished work of the developer): nothing to offer
    if ($cmp.status -eq 'identical' -or $cmp.status -eq 'behind') { return $null }
    $info.Status = [string]$cmp.status                             # ahead | diverged
    $info.Ahead = [int]$cmp.ahead_by
    $list = @($cmp.commits)
    [array]::Reverse($list)
    if ($list.Count -gt 0) { $info.Commits = $list }
    return $info
}

function Format-UpdateText($local, $info, [string]$Question) {
    $lines = @()
    $lines += "You have: $(Format-Version $local)"
    $lines += "Latest:   $($info.Latest.Substring(0, 7)) ($($info.LatestDate))"
    $lines += ''
    if (-not $local.Sha) {
        $lines += 'Latest change:'
    } else {
        $n = $info.Ahead
        $lines += "What changed ($n commit$(if ($n -ne 1) { 's' })):"
    }
    $shown = @($info.Commits | Select-Object -First 8)
    foreach ($c in $shown) { $lines += "  - $(Format-Commit $c)" }
    if ($info.Ahead -gt $shown.Count -and $local.Sha) { $lines += "  ... and $($info.Ahead - $shown.Count) more" }
    if ($Question) { $lines += ''; $lines += $Question }
    return ($lines -join "`n")
}

<# A yes/no question that is always seen (message box on top of everything). LAH_UPDATE_ANSWER answers it for tests.
   With NO_PAUSE and no answer given it is "no": nothing is ever updated without a real yes. #>
function Ask-YesNo([string]$Text, [string]$Title) {
    Write-Host ''
    Write-Host $Text
    if ($env:LAH_UPDATE_ANSWER) { return ($env:LAH_UPDATE_ANSWER -match '^[yY]') }
    if ($env:NO_PAUSE) { return $false }
    try {
        Add-Type -AssemblyName System.Windows.Forms
        $owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }
        $r = [System.Windows.Forms.MessageBox]::Show($owner, $Text, $Title, [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Question)
        return ($r -eq [System.Windows.Forms.DialogResult]::Yes)
    } catch {
        return ((Read-Host 'Update now? (y/n)') -match '^[yY]')
    }
}

# ---------------------------------------------------------------- git clone

function Update-Git($local, $info) {
    if ($local.Branch -ne $Branch) {
        return @{ Ok = $false; Text = "This clone is on the branch '$($local.Branch)', not '$Branch', so it was not updated. Switch with: git switch $Branch" }
    }
    if ($info.Status -eq 'diverged') {
        return @{ Ok = $false; Text = "You have commits of your own that are not on GitHub, so an update could not be applied cleanly. Nothing was changed. Run git pull yourself and decide how to merge." }
    }
    $r = Invoke-Git @('pull', '--ff-only', $GitUrl, $Branch)
    if ($r.Code -eq 0) { return @{ Ok = $true } }
    $why = (($r.Err + "`n" + $r.Out) -split "`n" | Where-Object { $_.Trim() } | Select-Object -First 8) -join "`n"
    if ($why -match 'overwritten|local changes|untracked working tree') {
        return @{ Ok = $false; Text = "The update was NOT applied, and nothing was changed.`n`nYou edited files in this folder that the update also changes (git's message):`n$why`n`nIf you want the update: copy your edited files somewhere safe, undo your edits (git checkout -- <file>), then start LearnAtHanze again. Until then it keeps running on your current version." }
    }
    return @{ Ok = $false; Text = "The update could not be downloaded or applied, and nothing was changed.`n`ngit said:`n$why`n`nIt keeps running on your current version." }
}

# ---------------------------------------------------------------- ZIP copy

function Get-FileSha256([string]$Path) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $fs = [System.IO.File]::OpenRead($Path)
    try { return ([BitConverter]::ToString($sha.ComputeHash($fs))).Replace('-', '').ToLower() } finally { $fs.Dispose(); $sha.Dispose() }
}

# Files an update must never touch, even if a ZIP contained them.
function Test-Protected([string]$Rel) {
    return ($Rel -match '^\.git(/|$)' -or $Rel -match '^exams studies/' -or $Rel -match '\.log$' -or $Rel -match '^\.lah-')
}

function Update-Zip($local, $info) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $ProgressPreference = 'SilentlyContinue'          # Invoke-WebRequest is very slow in 5.1 with the progress bar
    if (Test-Path $WorkDir) { Remove-Item $WorkDir -Recurse -Force }
    New-Item -ItemType Directory -Path $WorkDir | Out-Null
    try {
        $zip = Join-Path $WorkDir 'update.zip'
        $stage = Join-Path $WorkDir 'files'
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Write-Host 'Downloading the update...'
        try { Invoke-WebRequest ($ZipUrlTpl -replace '\{sha\}', $info.Latest) -OutFile $zip -UseBasicParsing -TimeoutSec 300 -Headers @{ 'User-Agent' = 'LearnAtHanze-launcher' } }
        catch { return @{ Ok = $false; Text = "The update could not be downloaded ($($_.Exception.Message)), and nothing was changed. It keeps running on your current version." } }

        # unpack to a staging folder first, so a full disk or a bad ZIP is found before any of your files is touched
        $stageFull = [System.IO.Path]::GetFullPath($stage).TrimEnd('\') + '\'
        New-Item -ItemType Directory -Path $stage | Out-Null
        $rels = New-Object System.Collections.Generic.List[string]
        $arc = [System.IO.Compression.ZipFile]::OpenRead($zip)
        try {
            foreach ($e in $arc.Entries) {
                if ($e.FullName.EndsWith('/')) { continue }
                $i = $e.FullName.IndexOf('/')
                if ($i -lt 0) { continue }
                $rel = $e.FullName.Substring($i + 1)           # drop the top folder GitHub puts in every ZIP
                if (-not $rel -or $rel -match '(^|/)\.\.(/|$)' -or $rel.StartsWith('/') -or $rel -match '^[A-Za-z]:' -or (Test-Protected $rel)) { continue }
                $dest = [System.IO.Path]::GetFullPath((Join-Path $stage $rel))
                if (-not $dest.StartsWith($stageFull, [System.StringComparison]::OrdinalIgnoreCase)) { continue }
                [void][System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($dest))
                [System.IO.Compression.ZipFileExtensions]::ExtractToFile($e, $dest, $true)
                $rels.Add($rel)
            }
        } finally { $arc.Dispose() }
        # the Windows launchers must have CRLF line endings; a ZIP built by GitHub can hold them with LF only
        foreach ($rel in $rels) {
            if ($rel -notmatch '\.bat$') { continue }
            $f = Join-Path $stage $rel
            $b = [System.IO.File]::ReadAllBytes($f)
            if ([Array]::IndexOf($b, [byte]13) -ge 0) { continue }
            $ms = New-Object System.IO.MemoryStream
            foreach ($x in $b) { if ($x -eq 10) { $ms.WriteByte(13) }; $ms.WriteByte($x) }
            [System.IO.File]::WriteAllBytes($f, $ms.ToArray())
        }
        if ($rels.Count -lt 10 -or -not (Test-Path (Join-Path $stage 'server.js'))) {
            return @{ Ok = $false; Text = 'The downloaded file did not look like LearnAtHanze, so nothing was changed.' }
        }

        # what is different, and would any of it overwrite your own edits?
        $manifest = $null
        if (Test-Path $StateFile) { try { $st = Get-Content $StateFile -Raw -Encoding UTF8 | ConvertFrom-Json; if ($st.files) { $manifest = $st.files } } catch { } }
        $newHash = @{}; $write = New-Object System.Collections.Generic.List[string]; $conflicts = New-Object System.Collections.Generic.List[string]
        $keptEdits = @{}
        foreach ($rel in $rels) {
            $new = Get-FileSha256 (Join-Path $stage $rel)
            $newHash[$rel] = $new
            $dst = Join-Path $Root $rel
            if (-not (Test-Path -LiteralPath $dst -PathType Leaf)) { $write.Add($rel); continue }
            $cur = Get-FileSha256 $dst
            if ($cur -eq $new) { continue }
            if ($null -eq $manifest) { $write.Add($rel); continue }                      # unknown starting point: replace, but back up first
            $prop = $manifest.PSObject.Properties[$rel]
            $base = if ($prop) { [string]$prop.Value } else { $null }
            if ($base -and $cur -eq $base) { $write.Add($rel) }                          # untouched since the last update: safe to replace
            elseif ($base -and $new -eq $base) { $keptEdits[$rel] = $base }              # you edited it, the update does not change it: keep yours
            else { $conflicts.Add($rel) }                                                # you edited it and the update changes it too
        }
        if ($conflicts.Count -gt 0) {
            $list = (($conflicts | Select-Object -First 10 | ForEach-Object { "  - $_" }) -join "`n")
            return @{ Ok = $false; Text = "The update was NOT applied, and nothing was changed.`n`nYou edited files in this folder that the update also changes:`n$list`n`nIf you want the update: copy those files somewhere safe, download the newest ZIP from https://github.com/$Repo (Code > Download ZIP) and replace the files yourself, or ask whoever shared the app. Until then it keeps running on your current version." }
        }

        $backup = $null
        if ($null -eq $manifest) {
            $existing = @($write | Where-Object { Test-Path -LiteralPath (Join-Path $Root $_) -PathType Leaf })
            if ($existing.Count -gt 0) {
                $backup = Join-Path $Root (".lah-backup\" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
                foreach ($rel in $existing) {
                    $b = Join-Path $backup $rel
                    [void][System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($b))
                    Copy-Item -LiteralPath (Join-Path $Root $rel) -Destination $b
                }
            }
        }
        foreach ($rel in $write) {
            $dst = Join-Path $Root $rel
            [void][System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($dst))
            Copy-Item -LiteralPath (Join-Path $stage $rel) -Destination $dst -Force
        }

        # remember what we wrote, so the next update can tell your edits from our files
        $files = [ordered]@{}
        foreach ($rel in $rels) { $files[$rel] = $(if ($keptEdits.ContainsKey($rel)) { $keptEdits[$rel] } else { $newHash[$rel] }) }
        $state = [ordered]@{ commit = $info.Latest; date = $info.LatestDate; updatedAt = (Get-Date).ToString('s'); files = $files }
        [System.IO.File]::WriteAllText($StateFile, ($state | ConvertTo-Json -Depth 4), (New-Object System.Text.UTF8Encoding($false)))
        return @{ Ok = $true; Changed = $write.Count; Kept = $keptEdits.Count; Backup = $backup }
    } finally {
        if (Test-Path $WorkDir) { Remove-Item $WorkDir -Recurse -Force -ErrorAction SilentlyContinue }
    }
}

# ---------------------------------------------------------------- entry point for launch.ps1

<#
  Checks, asks, updates. -Running: the app is already running, so only tell (never update).
  Returns @{ Updated = $true } when files changed and the launcher should start over with the new scripts.
  Anything unexpected while only CHECKING is swallowed: the app must always start.
#>
function Invoke-UpdateFlow([switch]$Running) {
    $result = @{ Updated = $false }
    if ($env:LAH_NO_UPDATE) { return $result }
    try {
        $local = Get-LocalVersion
        Write-Host "LearnAtHanze version: $(Format-Version $local)"
        if ($local.Mode -eq 'none') { Write-Verbose2 $local.Why; return $result }
        $info = Get-UpdateInfo $local
    } catch { Write-Verbose2 "check failed: $($_.Exception.Message)"; return $result }
    if (-not $info) { return $result }

    if ($Running) {
        Show-Problem ("Update available.`n`n" + (Format-UpdateText $local $info $null) +
            "`n`nLearnAtHanze is already running, so it was not updated. To update: run Stop LearnAtHanze, then start LearnAtHanze again.")
        return $result
    }
    if (-not (Ask-YesNo (Format-UpdateText $local $info 'Update now?') 'LearnAtHanze: update available')) {
        Write-Host 'Not updating. LearnAtHanze starts on your current version.'
        return $result
    }
    try {
        $r = if ($local.Mode -eq 'git') { Update-Git $local $info } else { Update-Zip $local $info }
    } catch {
        $r = @{ Ok = $false; Text = "The update failed ($($_.Exception.Message)). Run it again; if that keeps failing, nothing is lost: your files and your progress are untouched except what was already copied." }
    }
    if (-not $r.Ok) { Show-Problem $r.Text; return $result }
    Write-Host "Updated to $($info.Latest.Substring(0, 7)) ($($info.LatestDate))." -ForegroundColor Green
    if ($r.Backup) { Write-Host "Your previous versions of the replaced files are in $($r.Backup)." }
    if ($r.Kept) { Write-Host "$($r.Kept) file(s) you edited were left as they are (the update did not change them)." }
    $result.Updated = $true
    return $result
}
