# 第三方程式碼

MediaDock 0.5.0 的引擎與 YouTube 串流解析器為預先建置的本機 JavaScript。完整授權文字位於 `licenses/`，引擎授權摘要位於 `engine.bundle.js.LEGAL.txt`。使用者無須安裝開發套件。

| 固定版本 | 用途 | 授權與對應來源 |
|---|---|---|
| Mediabunny 1.61.3 | 媒體解析、影音合併、完整瀏覽器解碼 | MPL-2.0；[來源套件](https://registry.npmjs.org/mediabunny/-/mediabunny-1.61.3.tgz)、[完整授權](licenses/mediabunny-MPL-2.0.txt) |
| @noble/hashes 2.4.0 | 串流 SHA-256 | MIT；[來源套件](https://registry.npmjs.org/@noble/hashes/-/hashes-2.4.0.tgz)、[完整授權](licenses/noble-hashes-MIT.txt) |
| googlevideo 4.1.1 | YouTube SABR／UMP 串流、Protobuf 協定 | MIT；[上游專案](https://github.com/LuanRT/googlevideo)、[來源套件](https://registry.npmjs.org/googlevideo/-/googlevideo-4.1.1.tgz)、[完整授權](licenses/googlevideo-MIT.txt) |
| @bufbuild/protobuf 2.16.0 | googlevideo 的 Protobuf 二進位編解碼 | Apache-2.0；[來源套件](https://registry.npmjs.org/@bufbuild/protobuf/-/protobuf-2.16.0.tgz)、[完整授權](licenses/bufbuild-protobuf-Apache-2.0.txt) |

上游原始檔未修改，esbuild 僅合併與壓縮。Mediabunny 受 MPL-2.0 規範的程式碼仍依 MPL-2.0 提供，使用者可從上表取得完整對應來源。MediaDock 整合來源位於 `src/engine.js`、`src/sabr.js` 及 `extension/`；[開發分支](https://github.com/OverGreen996/MediaDock/tree/codex/fix-platform-sources) 與鎖定檔保留對應版本。

esbuild 0.28.2（MIT）及 Playwright 1.63.0（Apache-2.0）僅供開發建置與測試。測試媒體使用 FFmpeg 產生，不隨擴充發布。擴充沒有 EXE、本機助手、WASM、遠端執行腳本或安裝器。
