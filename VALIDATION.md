# 驗證紀錄

2026-10-07，MediaDock 擴充功能 0.3.0／本機助手 0.2.1，Windows x64，Node 24.21、Edge（Chromium）、.NET Framework 4.x。高畫質下載以 0.2.0 原生下載管線完成，0.2.1 補上尺寸資訊後重新完整驗證相同檔案及 SHA-256。

| 項目 | 結果 |
|---|---|
| 核心邏輯 13 項測試 | 通過；包含來源授權、Cookie 邊界、取消、分頁偵測、多平台網域界線、驗證中的紀錄保留及舊助手阻擋。YouTube 頁面只能要求開啟面板，不能直接解析／下載／讀 Cookie；只接受目前活動視窗的頂層影片頁，拒絕 iframe、其他擴充與已切換的影片 |
| YouTube 內嵌下載按鈕 | 已透過連線瀏覽器讀取真實一般影片及 Shorts 分享按鈕 DOM，選用目前的操作列結構。實際 Edge MV3 搭配測試頁驗證：分享旁插入、淺深色、真實滑鼠點擊開啟真實擴充 popup、拒絕頁面合成 click、操作列整段替換後復原、SPA 切換不重複、回首頁移除、Shorts 垂直操作列。截圖明確標示為測試頁，沒有宣稱已在使用者目前瀏覽器安裝 |
| Edge 真實 MV3 載入 | 通過，擴充 ID 與打包 manifest 相符 |
| Edge 真實 Native Messaging | 通過，暫時註冊測試助手、啟動及 framing 回應，結束後恢復登錄 |
| 面板流程 | 通過；自動解析、畫質選擇、Bilibili 當前分 P URL、其他網站列出來源、選擇來源、空白／缺助手狀態 |
| 介面視覺與可操作性 | 淺色／深色截圖已檢查；無橫向溢出，原生下拉選單、鍵盤 focus、收起的進階設定、減少動態效果 |
| Windows 另存新檔 | 真實 WinForms SaveFileDialog 選擇路徑及取消均通過；測試用 Win32／UI Automation，不添加產品測試後門 |
| 本機實際 MP4／MP3 | 通過；W3Schools Big Buck Bunny 10 秒範例下載及轉檔，來源 ID 核對與完整影音解碼 |
| 檔名與原始檔保護 | 中文、空格、百分號路徑通過；同名 MP3 轉檔不改動既有 MP4；故意注入錯誤來源 ID 的真實下載會失敗，原檔 hash 不變；暫存清理通過 |
| YouTube 公開影片 | `YE7VzlLtp-4` 360p：H.264／AAC，596.521 秒；來源片長 597 秒。ID 比對成功，全片 14,315 影格及音訊完整解碼，Edge 實際播放與跳轉通過 |
| Bilibili 公開影片 | `BV15z4y1U7HS` 360p：H.264／AAC，634.533 秒；來源片長 634.566 秒。ID 比對成功，全片 19,036 影格及音訊完整解碼，Edge 實際播放與跳轉通過 |
| YouTube 1440p／4K | `a9LDPn-MO4I`，2560 × 1440 及 3840 × 2160，MKV／VP9／Opus，60.021 秒、各 1,500 影格；未重新編碼，來源 ID 與片長核對、全片影音解碼及 Edge 實際播放通過。標題雖寫 8K，本次只提供至 4K，不宣稱可下載 8K |
| YouTube Shorts 最高可用畫質 | `18NGQq7p3LY`，2160 × 2964，MP4／H.264／AAC，3.367 秒、199 影格；來源解析片長約 3 秒。MP4 經相容轉檔，尺寸保持不變；來源核對、完整解碼與 Edge 播放通過 |
| Bilibili 未登入 1080p | `BV15z4y1U7HS`，1920 × 1080，MP4／H.264／AAC，634.533 秒、19,036 影格。未帶任何帳號 Cookie，完整下載、來源核對、全片影音解碼及 Edge 播放通過；這是單支影片結果，不能當成全部影片的登入規則 |
| Shorts 畫質標示 | 真實原生解析回傳寬高；面板測試確認 1080 × 1482 顯示為 1080p、2160 × 2964 顯示為 2160p／4K，預設為 1080p，選擇 4K 時傳入實際高度 2964 |
| 影音驗證 21 項案例 | 通過；有效 MP4／MP3、假 MP4 登入頁、空檔、錯誤片長／畫質、音訊冒充影片、截斷尾部、容器完整但後段 packet 損壞、缺音訊、相容 MP4 轉換、正確／錯誤 ID、分集與來源 URL，以及兩平台 360p 和四個高畫質實際下載檔的再次驗證與 hash 比對 |
| MP4 相容編碼 | MPEG-4 Part 2 測試檔自動轉為 H.264 8-bit／AAC，重新解析及完整解碼通過；正常 H.264／AAC 免轉檔 |
| 多平台辨識 | Vimeo、Dailymotion、Twitch、TikTok、Instagram、X、騰訊影片網域與偽造網域單元測試通過；Vimeo 的選用解析按鈕與畫質流程由 fixture 驗證 |
| Vimeo 真實來源解析 | `1084537` 本次發生 TLS 連線錯誤；列為未通過，不宣稱已成功下載 |
| 來源網址有效性 | YouTube 重測曾遇 403，失敗時原檔 hash 不變；加入所選格式的有效性預檢後，兩平台重新下載與完整驗證成功 |
| 工具安裝 | 官方 Release 下載及 SHA-256 驗證通過，4 個工具執行成功；Windows PowerShell 5.1 腳本使用 UTF-8 BOM |

實測工具：yt-dlp `2026.08.19`、FFmpeg `N-127226-gdc234edb2c-20261006`、Deno `2.9.7`。

測試限定：沒有讀取真實帳號 Cookie；Bilibili 登入功能驗證的是明確授權、網域過濾、Cookie 檔格式及清理設計，沒有測試會員專屬畫質。沒有測試所有網站、DRM、直播、全部字幕或完整播放清單。Chrome 正式版未安裝，沒有本機實測；Edge 已實測。串流偵測、HLS／DASH 分類與 DOM 掃描以測試頁及事件資料驗證，公開平台影音合併則以真實下載驗證。其他平台能否下載以該來源實際解析結果為準，不把網域標籤當成成功測試。

使用者表示已登入 Bilibili，並要求開啟網址。已開啟同一測試影片，但連線的 Codex 內建瀏覽器頁首顯示「登入」，播放器亦顯示登入提示；此瀏覽器沒有共用使用者其他瀏覽器的帳號。因此未宣稱測過該帳號登入後的 1080p／會員畫質。

播放檢查：Edge 從實際本機下載檔串流讀取，測試開頭播放、跳轉至 60／240／500 秒及片尾自然結束；不是 popup 模擬。`test-output/verified-content.png` 是播放檔案所抽取的畫面。完整解碼負責檢查全部影音；瀏覽器播放測試是上述時間點抽查。來源 ID／URL 與片長比對不能替使用者判斷每個頁面資源是否為所要的主片，清單中的廣告／預告需要自行選擇。

高畫質檔的 Edge 播放測試使用原下載檔，沒有替 MKV 換容器。逐一測試開頭播放、10%／40%／80% 跳轉及片尾自然結束，沒有媒體錯誤。`test-output/high-quality/report.json` 保存來源識別、格式、片長、完整解碼結果及 hash；`playback-report.json` 保存實際播放器結果，`verified-content.png` 是該檔案抽出的實際畫面。抽查不是逐幀內容辨識，全部影音完整性由完整解碼負責。

一般公開樣本為 Blender Big Buck Bunny；高畫質與 Shorts 樣本取自 yt-dlp 官方 extractor 測試網址。下載檔與匿名解析資料只在 `test-output/`，不包含於發行包。面板截圖使用固定測試資料，不代表所有影片都可提供該畫質。

## 重現

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Build.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Install.ps1 -ToolsOnly -TargetRoot test-output/runtime
Copy-Item native/MediaDockHost.exe test-output/runtime/native/
node --test tests/core.test.mjs
node tests/ui-smoke.mjs
node tests/youtube-button-smoke.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File tests/RegistrySmoke.ps1
node tests/native-smoke.mjs --live
node tests/verification-smoke.mjs
node tests/playback-smoke.mjs
node tests/high-quality-validation.mjs
node tests/native-smoke.mjs --shorts
node tests/verification-smoke.mjs
node tests/playback-smoke.mjs --high-quality
```

UI 與播放測試需要 Playwright；可透過 `CODEX_NODE_MODULES` 指定包含 Playwright 的 node_modules。下載／對話框測試需先編譯 `tests/NativeDownloadHarness.cs`、`tests/SaveDialogSmoke.cs`、`tests/VerificationHarness.cs`，將 EXE 複製至 `test-output/runtime/native/`，再執行 `download-smoke.mjs`、`dialog-smoke.mjs`、`platform-download-smoke.mjs`。VerificationHarness 的編譯需引用 System.Web.Extensions.dll。SaveDialogSmoke 的編譯需引用 Framework `WPF/UIAutomationClient.dll`、`UIAutomationTypes.dll`、`WindowsBase.dll`。對話框測試會短暫顯示測試用原生儲存視窗。先執行 MP4／MP3 及平台下載測試，再執行驗證與播放測試。
