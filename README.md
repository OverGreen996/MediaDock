<div align="center">
<img src="extension/icons/128.png" width="64" alt="MediaDock 圖示">

# MediaDock YouTube

**選畫質，下載，選擇儲存位置。**

Edge／Chrome 127+ · 繁體中文 · 0.5.0 開發版

[開發中原始碼](https://github.com/OverGreen996/MediaDock/tree/codex/fix-platform-sources) · [驗證紀錄](VALIDATION.md)
</div>

本版依使用者需求改為 **只支援 YouTube 一般影片及 Shorts**。已移除 Bilibili、其他網站掃描、串流監看、僅音訊與進階設定。只保留影片、畫質、下載與紀錄。

**0.5.0 正在驗證 YouTube 403 修復，尚未發布正式更新。舊版 0.4.0 的 ZIP 仍有已回報的 403 問題，不能將重裝舊版當成修復。成功讀到串流開頭不代表整支下載成功；最新結果以 [驗證紀錄](VALIDATION.md) 為準。**

## 安裝

從上方開發分支下載原始碼並解壓，在 `edge://extensions` 或 `chrome://extensions` 啟用「開發人員模式」，選「載入解壓縮」，選擇直接包含 `manifest.json` 的 資料夾（原始碼為 `extension/`，測試 ZIP 為 `MediaDock-0.5.0/`）。同一擴充升級後請重新載入並重新整理 YouTube 頁面。

這是手動載入版，瀏覽器仍需上述步驟。下載引擎已包含在擴充中；使用者無須安裝 Node.js、Python、FFmpeg、yt-dlp 或本機助手。固定擴充 ID：`fhjcedbbonnlkilcklhodjejolannode`。

## 使用

1. 開啟 YouTube 播放頁或 Shorts，先播放主影片，等待播放驗證完成。
2. 點 MediaDock 圖示，或影片「分享」旁的下載按鈕。Shorts 的按鈕在分享操作列。
3. 選畫質並按下載。播放器驗證尚未就緒時，面板會等待；仍失敗可在主影片正常播放後重新讀取。
4. 等完整下載、合併及影音驗證通過，瀏覽器才會跳出「另存新檔」。

關閉面板仍會繼續工作，重新開啟可查看進度與取消。請保持瀏覽器開啟；重新載入、停用或移除擴充會中斷工作。一次最多兩項。影音串流寫入瀏覽器暫存，合併後完整解碼至片尾；大型影片需要額外時間及暫存空間，SABR 下載約需要兩倍影片大小的暫存。

預設選擇來源提供且不超過 1080p 的畫質。可選最高品質、1440p／4K（依當下來源），保存原始編碼與 Shorts 尺寸，不升頻、不悄悄降畫質。優先保留目前播放器的音軌；依影音編碼保存成 MP4 或 WebM，播放器須支援該編碼。

## YouTube 專用下載方式

讀取目前播放頁的影片資料，先檢查直接媒體與同影片、同畫質 HLS 備援；沒有可用來源時，再嘗試播放器的 SABR 串流，核對影片 ID、來源與選定影音格式，沿用該影片的播放驗證資料。網站回傳 403 或播放驗證被拒絕時，會報錯並停止，不提供不完整檔案儲存。

下載完成後核對來源 ID、實際畫質與片長；影像及聲音必須完整解碼至片尾，並計算 SHA-256。這些檢查能拒絕截斷檔案，但不能保證平台永遠允許下載。直播、直播回放、DRM 與受保護付費內容暫不支援。

## 權限與隱私

網站權限僅限 `www.youtube.com`、`youtubei.googleapis.com` 與 `*.googlevideo.com`。`scripting` 讀取目前 YouTube 播放器資料，`webRequest` 讀取該分頁的指定播放請求；播放驗證資料短暫保留記憶體，不寫入下載紀錄、不匯出。沒有 Cookie API、全網站權限、本機訊息權限或外部下載伺服器。標頭調整只作用於擴充自己的 YouTube 請求，不修改網站播放器。

媒體暫存在瀏覽器私有檔案系統，完成或取消後清理；中斷留下的暫存於下次工作清理。紀錄保留最近 100 項，可從面板清除。請保存你有權下載的內容。

## 開發與測試

開發者才需要 Node.js 與 pnpm：

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm test:ui
pnpm test:youtube-button
pnpm test:fixtures
```

真實串流測試透過 `tests/browser-live.mjs --real-page` 使用實際 YouTube 頁面與獨立 Edge 設定檔。`tests/pure-playback.mjs` 再讀取真正儲存的檔案，核對磁碟 SHA-256、跳轉和片尾播放。測試控制工具不隨使用者下載包發行。依賴與完整授權見 [THIRD-PARTY.md](THIRD-PARTY.md)。
