$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
$taskManifest = Get-Content -LiteralPath (Join-Path $taskRoot 'extension\manifest.json') -Raw | ConvertFrom-Json
$taskStage = Join-Path $taskRoot ('dist\MediaDock-' + $taskManifest.version)
$taskResolvedStage = [IO.Path]::GetFullPath($taskStage)
$taskDistRoot = [IO.Path]::GetFullPath((Join-Path $taskRoot 'dist')) + [IO.Path]::DirectorySeparatorChar
if (-not $taskResolvedStage.StartsWith($taskDistRoot, [StringComparison]::OrdinalIgnoreCase)) { throw '發布路徑超出 dist。' }
if (Test-Path -LiteralPath $taskResolvedStage) { Remove-Item -LiteralPath $taskResolvedStage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $taskStage | Out-Null
# The shipped bundle is already built. End users need no Node, package manager or installer.
Copy-Item -Path (Join-Path $taskRoot 'extension\*') -Destination $taskStage -Recurse -Force
foreach ($taskName in @('README.md','THIRD-PARTY.md','VALIDATION.md')) { Copy-Item -LiteralPath (Join-Path $taskRoot $taskName) -Destination $taskStage -Force }
$taskPackagedReadme = Join-Path $taskStage 'README.md'
$taskReadmeText = [IO.File]::ReadAllText($taskPackagedReadme).Replace('src="extension/icons/128.png"', 'src="icons/128.png"')
[IO.File]::WriteAllText($taskPackagedReadme, $taskReadmeText, (New-Object Text.UTF8Encoding $false))
Copy-Item -LiteralPath (Join-Path $taskRoot 'licenses') -Destination $taskStage -Recurse -Force
Copy-Item -LiteralPath (Join-Path $taskRoot 'docs') -Destination $taskStage -Recurse -Force
if (Get-ChildItem -LiteralPath $taskStage -Recurse -File | Where-Object { $_.Extension -in @('.exe','.cmd','.ps1','.bat') }) { throw '純擴充發布包不能包含安裝器或執行檔。' }
$taskZip = Join-Path $taskRoot 'dist\MediaDock-Extension.zip'
Compress-Archive -Path $taskStage -DestinationPath $taskZip -Force
$taskHash = (Get-FileHash -LiteralPath $taskZip -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText((Join-Path $taskRoot 'dist\SHA256SUMS.txt'), "$taskHash  MediaDock-Extension.zip`n", (New-Object Text.UTF8Encoding $false))
Write-Host "純擴充發布包：$taskZip"
Write-Host "SHA256：$taskHash"
