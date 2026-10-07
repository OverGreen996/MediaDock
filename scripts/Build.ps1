$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
$taskCompiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
Push-Location (Join-Path $taskRoot 'native')
try {
    & $taskCompiler /nologo /optimize+ /target:exe /reference:System.Web.Extensions.dll /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /out:MediaDockHost.exe MediaDockHost.cs
    if ($LASTEXITCODE -ne 0) { throw '本機助手編譯失敗。' }
} finally { Pop-Location }
$taskStage = Join-Path $taskRoot 'dist\MediaDock'
New-Item -ItemType Directory -Force -Path $taskStage | Out-Null
foreach ($taskName in @('extension','native','scripts')) {
    $taskTo = Join-Path $taskStage $taskName
    New-Item -ItemType Directory -Force -Path $taskTo | Out-Null
    Get-ChildItem -LiteralPath (Join-Path $taskRoot $taskName) -File | Copy-Item -Destination $taskTo -Force
    if ($taskName -eq 'extension') { Copy-Item -LiteralPath (Join-Path $taskRoot 'extension\icons') -Destination $taskTo -Recurse -Force }
}
foreach ($taskName in @('Install.cmd','Update.cmd','Uninstall.cmd','README.md','THIRD-PARTY.md','VALIDATION.md','package.json')) { Copy-Item -LiteralPath (Join-Path $taskRoot $taskName) -Destination $taskStage -Force }
if (Test-Path -LiteralPath (Join-Path $taskRoot 'docs')) { Copy-Item -LiteralPath (Join-Path $taskRoot 'docs') -Destination $taskStage -Recurse -Force }
$taskTests = Join-Path $taskStage 'tests'
New-Item -ItemType Directory -Force -Path $taskTests | Out-Null
Get-ChildItem -LiteralPath (Join-Path $taskRoot 'tests') -File | Where-Object { $_.Extension -ne '.exe' } | Copy-Item -Destination $taskTests -Force
# Windows PowerShell 5.1 needs a BOM for non-ASCII script text.
foreach ($taskScript in Get-ChildItem -LiteralPath (Join-Path $taskStage 'scripts') -Filter '*.ps1') {
    [IO.File]::WriteAllText($taskScript.FullName, [IO.File]::ReadAllText($taskScript.FullName), (New-Object Text.UTF8Encoding $true))
}
$taskZip = Join-Path $taskRoot 'dist\MediaDock-Windows.zip'
Compress-Archive -Path $taskStage -DestinationPath $taskZip -Force
Write-Host "發布包：$taskZip"
