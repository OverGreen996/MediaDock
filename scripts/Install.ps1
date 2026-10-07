param([switch]$RefreshTools, [switch]$ToolsOnly, [string]$TargetRoot)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = 'SilentlyContinue'
$taskSource = Split-Path $PSScriptRoot -Parent
if (-not $TargetRoot) { $TargetRoot = Join-Path $env:LOCALAPPDATA 'MediaDock' }
$taskTarget = [IO.Path]::GetFullPath($TargetRoot)
$taskTools = Join-Path $taskTarget 'native\tools'
$taskCache = Join-Path $taskTarget 'cache'
if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { throw '此安裝包支援 Windows 10／11 x64。' }
New-Item -ItemType Directory -Force -Path $taskTools,$taskCache | Out-Null

function Get-Release([string]$Repo, [string]$Tag = 'latest') {
    $taskUrl = if ($Tag -eq 'latest') { "https://api.github.com/repos/$Repo/releases/latest" } else { "https://api.github.com/repos/$Repo/releases/tags/$Tag" }
    return Invoke-RestMethod -Uri $taskUrl -Headers @{ 'User-Agent' = 'MediaDock-Installer/0.1'; 'Accept' = 'application/vnd.github+json' } -TimeoutSec 60
}
function Get-Asset($Release, [string]$Name) {
    $taskAsset = @($Release.assets | Where-Object { $_.name -eq $Name })
    if ($taskAsset.Count -ne 1) { throw "官方發行版本找不到 $Name。請稍後重試。" }
    return $taskAsset[0]
}
function Fetch-Asset($Asset, [string]$Out) {
    if ($Asset.browser_download_url -notmatch '^https://github\.com/(yt-dlp/yt-dlp|yt-dlp/FFmpeg-Builds|denoland/deno)/releases/download/') { throw '下載來源不符合預期。' }
    $taskPart = $Out + '.part'
    Write-Host "下載 $($Asset.name)…"
    if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
        & curl.exe --fail --location --retry 3 --connect-timeout 30 --output $taskPart $Asset.browser_download_url
        if ($LASTEXITCODE -ne 0) { throw "下載失敗：$($Asset.name)。重新執行安裝即可重試。" }
    } else { Invoke-WebRequest -UseBasicParsing -Uri $Asset.browser_download_url -OutFile $taskPart -TimeoutSec 600 }
    $taskDigest = [string]$Asset.digest
    if ($taskDigest -notmatch '^sha256:([a-fA-F0-9]{64})$') { throw "官方未提供 $($Asset.name) 的 SHA-256，已停止安裝。" }
    $taskExpected = $Matches[1]
    if ((Get-FileHash -LiteralPath $taskPart -Algorithm SHA256).Hash -ne $taskExpected) { throw "檔案驗證失敗：$($Asset.name)。請重試。" }
    Move-Item -LiteralPath $taskPart -Destination $Out -Force
}

try {
    if (-not $ToolsOnly) {
        foreach ($taskName in @('extension','native')) {
            $taskFrom = Join-Path $taskSource $taskName
            $taskTo = Join-Path $taskTarget $taskName
            if ([IO.Path]::GetFullPath($taskFrom).TrimEnd('\') -ne [IO.Path]::GetFullPath($taskTo).TrimEnd('\')) {
                New-Item -ItemType Directory -Force -Path $taskTo | Out-Null
                Get-ChildItem -LiteralPath $taskFrom -File | Copy-Item -Destination $taskTo -Force
                if ($taskName -eq 'extension') { Copy-Item -LiteralPath (Join-Path $taskFrom 'icons') -Destination $taskTo -Recurse -Force }
            }
        }
    }
    # All executables are portable and stay under MediaDock; no PATH or admin changes.
    $taskVersions = @{}
    $taskVersionFile = Join-Path $taskTarget 'tool-versions.json'
    if (Test-Path -LiteralPath $taskVersionFile) {
        $taskPrevious = Get-Content -LiteralPath $taskVersionFile -Raw | ConvertFrom-Json
        foreach ($taskEntry in $taskPrevious.PSObject.Properties) { $taskVersions[$taskEntry.Name] = $taskEntry.Value }
    }
    foreach ($taskRepo in @('yt-dlp/yt-dlp', 'yt-dlp/FFmpeg-Builds', 'denoland/deno')) {
        $taskFiles = switch ($taskRepo) { 'yt-dlp/yt-dlp' { @('yt-dlp.exe') } 'yt-dlp/FFmpeg-Builds' { @('ffmpeg.exe','ffprobe.exe') } 'denoland/deno' { @('deno.exe') } }
        $taskMissing = @($taskFiles | Where-Object { -not (Test-Path -LiteralPath (Join-Path $taskTools $_)) })
        if (-not $RefreshTools -and -not $taskMissing.Count) { continue }
        $taskRelease = Get-Release $taskRepo
        $taskVersions[$taskRepo] = $taskRelease.tag_name
        $taskAssetName = switch ($taskRepo) { 'yt-dlp/yt-dlp' { 'yt-dlp.exe' } 'yt-dlp/FFmpeg-Builds' { 'ffmpeg-master-latest-win64-gpl.zip' } 'denoland/deno' { 'deno-x86_64-pc-windows-msvc.zip' } }
        $taskDownload = Join-Path $taskCache $taskAssetName
        Fetch-Asset (Get-Asset $taskRelease $taskAssetName) $taskDownload
        if ($taskAssetName -like '*.zip') {
            $taskExtract = Join-Path $taskCache ([guid]::NewGuid().ToString('N'))
            Expand-Archive -LiteralPath $taskDownload -DestinationPath $taskExtract
            foreach ($taskFile in $taskFiles) {
                $taskFound = @(Get-ChildItem -LiteralPath $taskExtract -Filter $taskFile -Recurse -File)
                if ($taskFound.Count -ne 1) { throw "壓縮檔中的 $taskFile 不符合預期。" }
                Copy-Item -LiteralPath $taskFound[0].FullName -Destination (Join-Path $taskTools $taskFile) -Force
            }
            # Keep third-party notices alongside downloaded binaries.
            $taskNotice = Join-Path $taskTarget ('licenses\' + $taskRepo.Replace('/','-'))
            New-Item -ItemType Directory -Force -Path $taskNotice | Out-Null
            Get-ChildItem -LiteralPath $taskExtract -Recurse -File | Where-Object { $_.Name -match 'LICENSE|COPYING|NOTICE' } | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $taskNotice -Force }
            $taskResolvedExtract = [IO.Path]::GetFullPath($taskExtract)
            if (-not $taskResolvedExtract.StartsWith([IO.Path]::GetFullPath($taskCache).TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw '清理路徑不符合預期。' }
            Remove-Item -LiteralPath $taskResolvedExtract -Recurse -Force
        } else { Copy-Item -LiteralPath $taskDownload -Destination (Join-Path $taskTools 'yt-dlp.exe') -Force }
        Remove-Item -LiteralPath $taskDownload -Force
    }
    foreach ($taskTool in @('yt-dlp.exe','ffmpeg.exe','ffprobe.exe','deno.exe')) {
        $taskCheck = Join-Path $taskTools $taskTool
        $taskArgs = if ($taskTool -like 'ff*') { '-version' } else { '--version' }
        $taskOutput = & $taskCheck $taskArgs 2>&1
        if ($LASTEXITCODE -ne 0) { throw "$taskTool 無法執行。請重試。" }
        Write-Host ($taskOutput | Select-Object -First 1)
    }
    $taskVersions | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskTarget 'tool-versions.json') -Encoding UTF8
    if ($ToolsOnly) { Write-Host "工具已備妥：$taskTools"; exit 0 }
    $taskHost = Join-Path $taskTarget 'native\MediaDockHost.exe'
    if (-not (Test-Path -LiteralPath $taskHost)) { throw '缺少本機助手。請使用完整的 MediaDock 安裝包。' }
    $taskManifest = Join-Path $taskTarget 'native\com.mediadock.downloader.json'
    $taskHostJson = @{ name='com.mediadock.downloader'; description='MediaDock media downloader'; path=$taskHost; type='stdio'; allowed_origins=@('chrome-extension://fhjcedbbonnlkilcklhodjejolannode/') } | ConvertTo-Json -Depth 4
    [IO.File]::WriteAllText($taskManifest, $taskHostJson, (New-Object Text.UTF8Encoding $false))
    foreach ($taskBrowser in @('Google\Chrome','Microsoft\Edge')) {
        $taskKey = "HKCU:\Software\$taskBrowser\NativeMessagingHosts\com.mediadock.downloader"
        New-Item -Path $taskKey -Force | Out-Null
        Set-Item -LiteralPath $taskKey -Value $taskManifest
    }
    Write-Host "`n安裝完成。" -ForegroundColor Green
    Write-Host '開啟 edge://extensions 或 chrome://extensions → 開發人員模式 → 載入解壓縮'
    Write-Host ('選擇：' + (Join-Path $taskTarget 'extension'))
    Start-Process -FilePath explorer.exe -ArgumentList ('"' + (Join-Path $taskTarget 'extension') + '"') -WindowStyle Hidden
    Write-Host '更新下載工具：執行 Update.cmd。下載檔案會存到每次選擇的位置。'
    Read-Host '按 Enter 關閉'
} catch { Write-Host ('安裝失敗：' + $_.Exception.Message) -ForegroundColor Red; exit 1 }
