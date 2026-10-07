$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
$taskManifest = Join-Path $taskRoot 'test-output\runtime\native\com.mediadock.downloader.json'
$taskHost = Join-Path $taskRoot 'test-output\runtime\native\MediaDockHost.exe'
$taskJson = @{ name='com.mediadock.downloader'; description='MediaDock isolated test'; path=$taskHost; type='stdio'; allowed_origins=@('chrome-extension://fhjcedbbonnlkilcklhodjejolannode/') } | ConvertTo-Json
[IO.File]::WriteAllText($taskManifest, $taskJson, (New-Object Text.UTF8Encoding $false))
$taskKey = 'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.mediadock.downloader'
$taskExisted = Test-Path -LiteralPath $taskKey
$taskPrior = if ($taskExisted) { (Get-Item -LiteralPath $taskKey).GetValue('') } else { $null }
try {
    New-Item -Path $taskKey -Force | Out-Null
    Set-Item -LiteralPath $taskKey -Value $taskManifest
    Push-Location $taskRoot
    try { node tests/native-browser-smoke.mjs; if ($LASTEXITCODE -ne 0) { throw 'Native messaging browser test failed.' } }
    finally { Pop-Location }
} finally {
    if ($taskExisted) {
        if ($null -eq $taskPrior) { (Get-Item -LiteralPath $taskKey).DeleteValue('', $false) }
        else { Set-Item -LiteralPath $taskKey -Value $taskPrior }
    } elseif (Test-Path -LiteralPath $taskKey) { Remove-Item -LiteralPath $taskKey -Force }
}
