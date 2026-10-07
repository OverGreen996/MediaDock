# 0.4.0 驗證紀錄

2026-10-07，Windows x64、已安裝的 Edge（Chromium）、MediaDock 0.4.0 MV3。產品執行下載、影音合併及完整解碼的部分均在瀏覽器內完成，沒有呼叫本機助手、FFmpeg、yt-dlp、Node.js 或外部下載服務。Node.js／Playwright 只作為測試控制工具；FFmpeg 只用於建立下述人工測試媒體。

## 實際公開影片

以下使用真正的 Edge 擴充面板、service worker、offscreen 文件及媒體 Worker，經實際平台 API／CDN 下載、瀏覽器內封裝、全部影音解碼、計算 SHA-256，再由 Chrome downloads API 保存。平台導航頁以同網址的簡單 HTML 測試頁代替；API 和媒體回應沒有模擬。測試瀏覽器獨立且未登入，不能視為使用者目前 Edge 帳號的測試。

| 來源 | 儲存檔案 | 完整解碼／實際播放 |
|---|---|---|
| YouTube `a9LDPn-MO4I`，1440p | 2560 × 1440，MP4／VP9／AAC，60.0468 秒，47,879,911 bytes | 通過；1,500 影格，影音均完整解碼 |
| 同影片，2160p | 3840 × 2160，MP4／VP9／AAC，60.0468 秒，107,174,837 bytes | 通過；1,500 影格，影音均完整解碼 |
| Shorts `18NGQq7p3LY` | 2160 × 2964，MP4／VP9／AAC，3.3669 秒，6,644,839 bytes | 通過；199 影格，直向尺寸保持不變 |
| Bilibili `BV15z4y1U7HS`，CID `295330409` | 480p，MP4／H.264／AAC，634.5660 秒，75,557,171 bytes | 通過；19,036 影格，影音均完整解碼 |

全部保留原始編碼，沒有轉檔或升頻。Bili 的影像顯示寬度因像素長寬比約為 853，高度為 480。HTML video 的容器片長讀值約 634.7 秒，完整解碼的影音片長為 634.5660 秒。平台影片標題包含 4K／8K 不代表本次實際提供該畫質；只依當下可用格式列出及驗證。

另以全新的 Edge 播放器讀取**上述真正儲存的檔案**：再次從磁碟串流計算 SHA-256，確認與瀏覽器驗證結果相同；測試開頭播放、10%／40%／80% 跳轉，以及片尾自然結束，四檔均通過，沒有播放器媒體錯誤。没有改換檔案或容器。播放畫面已人工檢視，測試輸出留在被忽略的 `test-output/pure/`，不發布影片與設定檔。

| 檔案 | SHA-256 |
|---|---|
| YouTube 1440p | `b36cc9267f904962c6c40917b37e2f4b5d5dead9ef1bd6af9487fb19b576f4b9` |
| YouTube 2160p | `698d55b294707ae5220af5c6a95d24e3e4fca89c501284ec0b14742d7534049c` |
| Shorts | `ef99b8b51e4b443b9b0f23c971e799cb04334b8db988c5562cbeb217138422b6` |
| Bilibili 480p | `eca3694df0a0035e471d5cfe19ec71b15f7622ac66bb83b1bd572e5e1bc0bbbd` |

## 受控媒體與介面

| 測試 | 結果 |
|---|---|
| 核心邏輯 16 項 | 通過：公開網址、偽造網域、網站分類、檔名、正確 YT ID、Shorts 尺寸、CDN 白名單、精確畫質／音訊／片長、Bili BV／CID／分 P／來源 URL 綁定 |
| 訊息與儲存邊界 | 通過：一般網頁及內容腳本不能直接啟動下載，未授權来源不能下載，無驗證或外部 Blob 不可儲存；確認 `saveAs: true`，直到瀏覽器下載完成才回報完成 |
| 真實 Edge MV3／UI | 通過：固定擴充 ID、淺深色面板、畫質與直向尺寸、Bili 當前分 P、一般媒體清單、DOM 同源 iframe 掃描。一般掃描不建立媒體引擎 |
| YouTube 內嵌按鈕 | 真實 Edge MV3 測試頁通過：分享旁按鈕、淺深色、窄畫面、SPA 更新、操作列替換後復原、Shorts 操作列、真實使用者點擊開啟 popup、拒絕合成 click。頁面只能要求開啟面板，且必須是目前活動分頁的同一影片 |
| MP4／HLS／DASH | 真實瀏覽器、真正 HTTP 媒體：同一 2 秒 H.264／AAC 測試影片，三種輸入均成功封裝與保存，各完整解碼 40 影格及音訊 |
| HTML 冒充 MP4 | 失敗，訊息「來源回傳網頁或錯誤訊息，並非影片」，沒有開始儲存 |
| 截斷 MP4 | 實際切去檔案後 40%；來源片長與分段結尾不符，失敗且沒有開始儲存，不能把尚可播放的前半段當成成功 |
| 取消 | 慢速來源下載期間取消，任務終止，沒有開始儲存 |
| 閒置與暫存 | 任務結束後約 10 秒關閉 offscreen，引擎釋放，檢查瀏覽器私有檔案系統沒有殘留媒體 |
| 發布包 | 預先建置的本機 JS、完整授權；無 nativeMessaging、Cookie API 權限、安裝器、EXE 或遠端可執行程式 |

HLS／DASH 測試只證明上述受控形式有效，不表示所有網站的串流格式都支援。其他網站的選用來源權限由受控測試預先授予；權限拒絕由核心測試驗證。UI 預覽使用固定資料，不能作為平台畫質成功的證據。

自動化儲存使用 CDP 接受下載至測試目錄，沒有在桌面實際點擊原生另存新檔對話框；產品確實傳入 `saveAs: true`，此項呼叫亦有核心測試。日常使用者已登入的 Edge 設定檔安裝與帳號實測未完成，不能宣稱已在該設定檔安裝或驗證。

## 尚未驗證與限制

- **Bili 使用者已登入的 1080p、會員／4K 畫質尚未驗證。** 本次公開 API 僅回傳至 480p，不沿用 0.3 本機助手的 1080p 結果當作 0.4 的證據。
- Chrome 正式版未在本機測試；Edge 已測試。其他網站的真實下載沒有全面測試。
- DRM、加密 HLS、直播、多 Period／動態 DASH、byte range SegmentList、全部播放清單與字幕不支援。來源網站 API、登入政策與反爬可能變動。
- 瀏覽器能完整解碼的原始編碼才允許儲存；沒有全格式相容轉檔。Edge 播放通過不代表所有第三方播放器都相容。
- 原始來源的 ID、網址、片長與完整性驗證不能替使用者判斷一般網頁清單裡的廣告、預告是否為想保存的內容。

## 重現

從儲存庫根目錄，以 Node.js／pnpm 與已安裝的 Edge 執行：

```powershell
pnpm install --frozen-lockfile
pnpm run build
pnpm test
pnpm run test:ui
pnpm run test:youtube-button
pnpm run test:fixtures
```

`test:fixtures` 需另外具備開發用 FFmpeg（PATH 或 `MEDIA_DOCK_TEST_FFMPEG` 指定執行檔），在 `test-output/pure/fixtures/` 生成人工媒體。這不是使用擴充功能的必要條件。

真實來源測試會下載影片，網站／網路狀態可能令結果不同：

```powershell
pnpm run test:live -- youtube 1440
pnpm run test:live -- youtube 2160
pnpm run test:live -- shorts 2964
pnpm run test:live -- bili best
pnpm run test:playback
```

播放測試依賴前四項產生的實際檔案與報告；每個測試使用獨立設定檔，不載入使用者登入資料。打包：`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Build.ps1`。舊版 native 測試保留在 v0.3.0 的 Git 歷史，與本版結果分開。
