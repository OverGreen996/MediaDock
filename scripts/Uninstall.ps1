$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'MediaDock'))
foreach ($taskBrowser in @('Google\Chrome','Microsoft\Edge')) {
    $taskKey = "HKCU:\Software\$taskBrowser\NativeMessagingHosts\com.mediadock.downloader"
    if (Test-Path -LiteralPath $taskKey) { Remove-Item -LiteralPath $taskKey -Force }
}
# Preserve downloaded media and the unpacked extension. Only remove this app's native tools.
foreach ($taskName in @('native','cache','licenses')) {
    $taskPath = [IO.Path]::GetFullPath((Join-Path $taskRoot $taskName))
    if (-not $taskPath.StartsWith($taskRoot.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw '移除路徑不符合預期。' }
    if (Test-Path -LiteralPath $taskPath) { Remove-Item -LiteralPath $taskPath -Recurse -Force }
}
Write-Host '本機助手已移除，下載檔案仍保留。請到瀏覽器擴充功能頁面移除 MediaDock。'
