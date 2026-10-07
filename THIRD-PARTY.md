# 第三方程式碼

MediaDock 0.4.0 的媒體引擎是預先建置的瀏覽器 JavaScript，包含下列固定版本。發布包保留完整授權文字與 `extension/engine.bundle.js.LEGAL.txt`（解壓後位於根目錄）。沒有第三方執行檔、WASM、安裝器或遠端腳本。

| 套件 | 用途 | 授權／來源 |
|---|---|---|
| Mediabunny 1.61.3 | 媒體解析、串流封裝、瀏覽器影音解碼 | MPL-2.0；[上游專案](https://github.com/Vanilagy/mediabunny)、[對應版本原始碼套件](https://registry.npmjs.org/mediabunny/-/mediabunny-1.61.3.tgz)、[完整授權](licenses/mediabunny-MPL-2.0.txt) |
| @noble/hashes 2.4.0 | 串流 SHA-256 | MIT；[上游專案](https://github.com/paulmillr/noble-hashes)、[對應版本原始碼套件](https://registry.npmjs.org/@noble/hashes/-/hashes-2.4.0.tgz)、[完整授權](licenses/noble-hashes-MIT.txt) |

上游原始檔未修改；esbuild 僅進行建置、合併與壓縮。Mediabunny 受 MPL-2.0 規範的程式碼仍依 MPL-2.0 提供，收到發布包的使用者可從上表取得該版本的完整對應來源。MediaDock 自有的整合來源位於 `src/engine.js`、`extension/` 及 [v0.4.0 原始碼](https://github.com/OverGreen996/MediaDock/tree/v0.4.0)。來源與授權可獨立保存，不需要安裝套件才能使用擴充功能。

開發依賴 esbuild 0.28.2（MIT）、Playwright 1.63.0（Apache-2.0）及型別宣告不作為終端使用者程式執行。生成測試媒體時使用 FFmpeg；它只供開發測試，不隨擴充或 ZIP 發布。本版不使用舊版的 yt-dlp、Deno、FFmpeg／FFprobe 本機下載工具。
