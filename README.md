<div align="center">

<img src="extension/icons/128.png" width="64" alt="MediaDock 圖示">

# MediaDock

**點開目前影片，選畫質，存到你要的位置。**

繁體中文媒體下載擴充功能 · Windows 10／11 x64 · Edge／Chrome 127+

**[下載 Windows 安裝包](https://github.com/OverGreen996/MediaDock/releases/download/v0.3.0/MediaDock-Windows.zip)** · [版本與校驗值](https://github.com/OverGreen996/MediaDock/releases/tag/v0.3.0) · [驗證紀錄](VALIDATION.md)

擴充功能 **0.3.0** ／ 本機助手 **0.2.1**

</div>

- **YouTube、Bilibili**：自動解析目前影片 → 選畫質 →「下載並選擇儲存位置」→ Windows 另存新檔。
- **YouTube 頁面按鈕**：一般播放頁在「分享」旁顯示「下載」；Shorts 放在分享操作列。點一下開啟同一個下載面板。配色跟隨 YouTube，切換影片會更新，不會重複加入按鈕。
- **其他網站**：自動掃描頁面 → 列出影片／音訊／HLS／DASH → 選一個來源 → 選儲存位置。
- 接近瀏覽器原生樣式的精簡面板、淺色／深色模式。MP3、格式、字幕及 Bilibili 登入狀態收在「更多選項」。

## 介面預覽

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/popup-dark.png">
  <img src="docs/images/popup-light.png" width="368" alt="MediaDock 畫質選擇面板">
</picture>

YouTube 的操作列：

![分享旁的 MediaDock 下載按鈕](docs/images/youtube-button.png)

面板截圖使用固定測試資料；按鈕由真實 Edge 擴充功能注入測試頁。實際影片畫質以當下解析結果為準。

## 安裝（Windows 10／11 x64）

1. [下載 MediaDock-Windows.zip](https://github.com/OverGreen996/MediaDock/releases/download/v0.3.0/MediaDock-Windows.zip)，解壓縮後開啟 `MediaDock` 資料夾，雙擊 `Install.cmd`。第一次會下載 yt-dlp、FFmpeg、Deno，從官方 GitHub Release 取得並驗證 SHA-256。無須管理員、Python 或 Node.js。
2. 在 `edge://extensions` 或 `chrome://extensions` 開啟「開發人員模式」，選「載入解壓縮」。選擇 `%LOCALAPPDATA%\MediaDock\extension`。
3. 固定 MediaDock 到工具列，開啟影片頁後點圖示。重新整理 YouTube 頁面，便會出現「下載」按鈕。

安裝包的 SHA-256 見 [Release 校驗檔](https://github.com/OverGreen996/MediaDock/releases/download/v0.3.0/SHA256SUMS.txt)。

升級至 0.3.0：解壓新版包後重新執行 `Install.cmd`，再於擴充功能頁按重新載入，並重新整理已開啟的 YouTube 頁面。新版需要 YouTube 網站存取權，以顯示頁面按鈕與讀取當前影片網址。0.2 需要新版助手提供驗證；0.2.1 助手另補上直式影片的寬高資訊，0.3.0 仍使用此版助手。0.1 助手會被阻擋並提示更新。`Update.cmd` 用於更新下載工具。

本機助手只透過 Native Messaging 和本擴充功能連線，不開 HTTP 服務。安裝在 `%LOCALAPPDATA%\MediaDock`，只登記目前使用者的 Chrome／Edge NativeMessagingHosts。固定擴充功能 ID：`fhjcedbbonnlkilcklhodjejolannode`。

本機下載的儲存視窗可能使擴充功能面板收起；下載仍會開始，重新點圖示可看下載紀錄。Windows 檔案對話框會在覆寫既有檔案前詢問。關閉面板不會中斷；關閉瀏覽器或重載／停用擴充功能會中斷本機下載。最多同時兩個本機下載。

## 掃描其他網站

一般網站只在開啟面板或按「重新掃描」時掃描，沒有常駐內容腳本。YouTube 是頁面按鈕的例外：只在 www.youtube.com 執行輕量腳本，按鈕安裝後僅觀察操作列內部及其祖先的直接子節點，沒有定時輪詢，也不在頁面載入時啟動助手或解析影片。先播放影片通常可取得更多來源。若未找到，按「啟用串流偵測」並授權，重新載入或播放影片，再重新掃描。偵測只記錄啟用的分頁，來源清單最多 60 項；停止偵測會清除清單。只有這個選用功能需要所有網站讀取權限，網站內不同 CDN 的媒體請求需要此權限。

所有新下載均使用本機助手與 Windows 儲存對話框，包含一般 MP4／WebM／音訊及 HLS／DASH。來源需要 Referer 時會傳送所在頁面的網址。支援 Vimeo、Dailymotion、Twitch、TikTok、Instagram、Facebook、X、抖音、優酷、騰訊影片、AcFun、Niconico、SoundCloud 的網域辨識；其他網站仍先列出掃描資源，也可按「解析此頁的平台影片」呼叫 yt-dlp 查詢實際支援及畫質。網域辨識成功不表示該影片一定可下載；解析失敗會停用下載，不猜測成功。

DRM、blob 本身、網站反爬、地區限制、需驗證或帳號未授權的影片可能無法保存；網站格式會變動，請執行 `Update.cmd` 更新工具。

## 正確內容與可播放驗證

解析時記錄來源 URL、影片 ID、解析器及片長；下載時再次比對影片 ID、分集與解析後的頁面 URL。FFprobe 確認影音串流、畫質與來源片長，片長允許 2 秒的 metadata／編碼誤差。MP4 若採不相容的影音編碼，會轉成 H.264 8-bit／AAC；MKV 保留原編碼。接著 FFmpeg 完整解碼全部影像與音訊，檢查錯誤及是否到達片尾，通過後計算 SHA-256 並存入本機下載紀錄。驗證失敗不交付檔案，也不覆寫原先的同名檔案。

下載紀錄會顯示「完整影音驗證中」，通過後才顯示「驗證完成」。舊版下載紀錄沒有驗證資料時顯示「已儲存 · 未驗證」。完整解碼一次只進行一個工作，使用兩個執行緒與較低程序優先權；長影片、4K 或需要相容轉檔時會額外花時間。

這些檢查確認的是所選來源與媒體完整性；無法替使用者判斷每個網頁資源是否為主片、廣告或預告，也不能保證所有播放器。來源不提供片長時，紀錄會保留 `durationMatched: false`，不假稱已核對來源片長。實測範圍與來源見 `VALIDATION.md`。

YouTube 使用公開影片解析。Bilibili 登入狀態是選用功能，只讀取 Bilibili Cookie，暫存於僅目前使用者可讀取的資料夾；工作結束刪除，非正常結束的暫存於下次助手啟動清除。Cookie 不寫入下載紀錄、不送到雲端。Bilibili 分 P 請開啟要下載的那一 P；不批次下載播放清單。直播暫不支援。請下載你有權保存的媒體。

畫質選單根據當下解析結果列出；來源未提供的 2K／4K 不會憑空增加。Shorts 直式影片顯示短邊畫質及實際寬高，例如「1080p · 1080 × 1482」；下載及驗證仍採用該格式的實際尺寸。預設選擇不超過 1080p 的可用畫質，也可手動選最高畫質。若要保留來源原始影音編碼，於「更多選項」選 MKV；MP4 必要時會重新編碼以增加播放相容性，並非永遠無損。

2026-10-07 實測指定的 Bilibili 公開影片，不帶登入 Cookie 也能下載完整 1080p；不能推論每支影片都相同。登入網站後若仍缺少畫質，可在同一瀏覽器的面板勾選「使用 Bilibili 登入狀態」並授權。登入其他瀏覽器不會自動共用帳號。

## 已實測的下載

| 來源 | 實際檔案 | 結果 |
|---|---|---|
| YouTube 1440p | 2560 × 1440 · MKV／VP9／Opus | 來源核對、完整解碼、Edge 播放通過；未重新編碼 |
| YouTube 4K | 3840 × 2160 · MKV／VP9／Opus | 來源核對、完整解碼、Edge 播放通過；未重新編碼 |
| YouTube Shorts 最高可用畫質 | 2160 × 2964 · MP4／H.264／AAC | 來源核對、完整解碼、Edge 播放通過；經相容轉檔 |
| Bilibili 公開影片 | 1920 × 1080 · MP4／H.264／AAC | 未帶登入 Cookie，完整下載及上述驗證通過 |

Edge 播放測試包含開頭、片中跳轉與片尾。另有 **13 項核心測試、21 項影音驗證案例**，以及真實 MV3、Native Messaging、Windows 儲存視窗與 YouTube 按鈕測試。

Chrome 正式版、會員畫質與其他平台的真實下載尚未全面實測。上述是指定來源的結果，不能保證所有網站與播放器。完整來源、方法與限制見 [VALIDATION.md](VALIDATION.md)。

## 資源使用與隱私

無第三方字型、框架、遙測或雲端服務。影片查詢回傳標題、片長、畫質及核對所需的來源識別資訊。公開影片解析結果短暫快取三分鐘；本機助手無工作時 30 秒退出。一般網站掃描不啟動本機助手。下載紀錄與驗證摘要僅本機保存，最多 100 項；清除只移除紀錄，不刪下載檔案。

執行 `Uninstall.cmd` 可移除本機助手與註冊，下載檔案保留。再由瀏覽器移除擴充功能。

## 開發

原始碼在 `extension/`、`native/`；不需要前端建置。Windows .NET Framework C# 編譯器用於建立本機助手；Node.js 用於執行開發測試：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Build.ps1
node --test tests/core.test.mjs
```

UI 測試需要 Playwright 與已安裝的 Edge。本次使用 Playwright 1.62.1；也可透過 `CODEX_NODE_MODULES` 指定包含該套件的 node_modules。

```powershell
npm install --no-save --package-lock=false playwright@1.62.1
npm run test:ui
npm run test:youtube-button
```

`scripts/Install.ps1 -ToolsOnly -TargetRoot <測試資料夾>` 只準備下載工具，不修改登錄。測試流程與實測限制見 [VALIDATION.md](VALIDATION.md)，工具來源與授權見 [THIRD-PARTY.md](THIRD-PARTY.md)。測試影片、瀏覽器資料、Cookie 與暫存檔不包含在儲存庫或發行包。

實作依據：[Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)、[開啟擴充面板](https://developer.chrome.com/docs/extensions/reference/api/action#method-openPopup)、[Edge Native Messaging](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/native-messaging)、[yt-dlp](https://github.com/yt-dlp/yt-dlp)、[YouTube EJS 執行環境](https://github.com/yt-dlp/yt-dlp/wiki/EJS)。
