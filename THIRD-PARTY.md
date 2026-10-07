# 第三方工具

發布包包含 MediaDock 原始碼及自製本機助手，不捆綁第三方執行檔。安裝器從下列官方專案 Release 下載可攜工具，使用官方提供的 SHA-256 驗證，保留壓縮包內的授權文字。

| 工具 | 用途 | 原始碼／授權 |
|---|---|---|
| yt-dlp | 網站解析、媒體下載；Windows 官方執行檔含 EJS | https://github.com/yt-dlp/yt-dlp （Unlicense；官方 Windows 打包依賴另依各自授權） |
| FFmpeg / FFprobe | 影音合併與轉檔 | https://github.com/yt-dlp/FFmpeg-Builds （選用 GPL build，來源與建置流程在專案） |
| Deno | YouTube JavaScript challenge solver 執行環境 | https://github.com/denoland/deno （MIT；依賴依各自授權） |

工具版本可使用 Update.cmd 更新。不會修改系統 PATH。下載工具的版本與可用性由上游決定。
