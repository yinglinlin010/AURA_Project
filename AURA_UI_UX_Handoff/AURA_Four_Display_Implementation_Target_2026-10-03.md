# AURA 四螢幕實作目標與驗收

日期：2026-10-03。範圍：中控、副駕、後座、互動車窗；Cluster 請使用同目錄既有補充規格。

## 1. 使用順序

先讀 `docs/product/AURA_MASTER_SPEC_2026-10-02.md` 第 61、64 節、`AURA_UI_UX_Handoff/CODEX_INSTRUCTIONS.md`，再讀本文件與各螢幕 final 參考圖。若規格衝突，Master Spec 的安全、權限、資料契約優先；視覺依 final 圖與本次明確補充需求。不要以通用 dashboard 或全畫面生成圖片替代真實 UI 元件。

互動預覽：`AURA_UI_UX_Handoff/previews/four-display/index.html`。下載該資料夾後可直接開啟，不需 npm、後端或外部 API。原始照片裁切為本地 WebP 素材；文字、按鈕、數值、狀態與交互均由 HTML/CSS/JS 組成。照片素材用於參考預覽，正式導航需要真實地圖元件與來源標示。

## 2. 四螢幕構成

| 螢幕 | 參考圖 | 比例與結構 | 本次可操作內容 |
|---|---|---|---|
| Center | `02_center_display_final.jpg` | 16:9；左約 35% 旅程、右約 65% 導航；底部橘色操作區 | 旅程資訊、導航／廣播／空調／電話詳情、同意或略過提案 |
| Passenger | `03_passenger_display_final.jpg` | 16:9；左分類導覽、右主圖與三張地點卡 | 分類、切換地點、查看示例繞路時間、提議停靠、等待與結果回饋 |
| Rear | `04_rear_display_final.jpg` | 4:3；2×2 四格固定角色 | 模擬媒體、後座溫度／風量／同步、通話請求、休息提案、預覽亮度 |
| Window | `05_interactive_window_final.jpg` | 4:3；環境視野為主、薄資訊帶 | 時間／天氣／方向／能源示例；AURA 狀態、離線與安全優先狀態 |

參考圖完整路徑沿用 `AURA_UI_UX_Handoff` 內既有資產位置；Codex 應先搜尋檔名再檢視，不猜測路徑或重畫素材。照片裡的道路、餐廳與讀值都是預覽 fixture，不代表真實 API 結果或已選定的車型。

## 3. 視覺約束

- 保留 final 圖的深灰霧面底、橘色重點、明確分區與資訊密度。不要任意加入玻璃模糊、大面積光暈、圓角卡片或改成一般 SaaS 面板。
- 正式文字、刻度、圖示與動態數值用 DOM／SVG／Canvas 元件；圖像只承載環境與照片。圖示採單一 SVG 系統，尺寸、線粗與橘色語意一致。
- Center 與 Passenger 原生以 16:9 驗收；Rear 與 Window 以 4:3 驗收。窄螢幕預覽可重排，不把手機堆疊版當成實車原生佈局。
- Window 的場景圖是本地預覽背景；實際車窗裝置保留外部視野，不能將照片、卡片或測試控制覆蓋整面玻璃。
- 多停靠點使用摘要／詳情策略，避免旅程列表溢出。預覽顯示最新新增停靠與其餘已同意停靠摘要；完整資料仍保留於共享狀態。

## 4. 共用狀態與決策

四個螢幕應是同一個狀態的不同呈現。沿用現有 `apps/web-simulator/src/App.tsx`、gateway、schema 與事件模型，不新增四套互相不相容的旅程或 AURA 狀態。

預覽 demonstrator 使用共享本地狀態展示以下流程；它不取代 production ActionGate，也不授權實車操作：

1. 副駕或後座建立提案，旅程保持原樣。
2. NORMAL 時，中控呈現來源、示例影響與同意／略過。
3. 駕駛同意後才新增模擬停靠，ETA 與乘客回饋同步。
4. 略過不改路線；相同待處理提案不重複送出，相同已加入停靠不重複新增。
5. HIGH 時提案延後，收起旅程與非必要操作，只保留導航和安靜邊緣提示。
6. CRITICAL 時安全資訊優先，提案繼續延後；回到 NORMAL 才恢復決策卡。
7. 斷網保留本地示例與狀態，顯示 OFFLINE，不把 fixture 說成線上查詢結果。

AURA 呈現包括 IDLE、LISTENING、THINKING、SPEAKING、EXECUTING、WARNING 與衍生 OFFLINE。此預覽的安全 WARNING 優先於離線；正式實作以 Master Spec 的 canonical policy 計算，不依 UI 各自猜測。

## 5. 模擬與正式資料邊界

| 項目 | 預覽行為 | 正式接法 |
|---|---|---|
| 導航與 ETA | 原圖地圖；示例停靠分鐘相加 | 導航 adapter／gateway 回傳；標示來源、時間與降級狀態 |
| 地點探索 | 四個固定地點 fixture、示例評分與繞路 | 使用既有外部服務契約；失敗或離線顯示降級，不編造即時結果 |
| 媒體 | 播放進度、曲名、靜音狀態；沒有音訊 | 媒體 adapter；區分命令、執行結果與不可用 |
| 空調 | 本地 16–28°C、0.5°C 步進；同步前艙示例 22°C | 車況與空調契約；合法範圍由 capability 定義 |
| 通話 | 本地請求狀態；沒有麥克風或真正電話 | 通訊 adapter 與明確權限／結果 |
| 亮度 | 只改後座預覽 CSS | 裝置能力允許時經正式命令管線；否則清楚顯示不可用 |
| 車窗數值 | 固定時間、天氣、能源 fixture | telemetry／天氣／導航來源；能源元件依 powertrain capability 選擇 |

車型與動力形式尚未在本次工作中定案。車窗電量／續航只是原图樣式示範，不得據此宣稱 AURA 限定電動車。正式元件需支援 unknown／unavailable／stale，且依 ICE／EV／Hybrid capability 配置能源，不把轉速和馬達功率硬塞所有 demo。

## 6. Codex CLI 執行提示詞

```text
請在目前工作分支完成 AURA 四個非 Cluster 螢幕的實作。
先讀根 AGENTS.md、Master Spec 第 61/64 節、CODEX_INSTRUCTIONS.md、
AURA_Four_Display_Implementation_Target_2026-10-03.md，逐張檢視四個 final 圖，
並開啟 previews/four-display/index.html 理解此次互動。

先檢查現有 App.tsx、元件、gateway、schema、fixtures 和測試，直接沿用它們。
以 final 圖還原四螢幕的原生比例、位置、資訊密度、灰底與橘色語意。
將預覽的本地互動接到現有正式事件／狀態模型；提案必須經駕駛同意，
HIGH 延後、CRITICAL 安全優先、離線清楚降級。不要複製預覽 state 當正式 ActionGate。
開發測試控制全部留在獨立 Simulation Console，不出現在實車 HMI。

不要自行選定車型、導航供應商或補造 API 資料。可用既有 fixture 展示未接入項目，
但呈現來源與限制。依目前 capability/schema 支援 unavailable 與 stale。
完成後提供四螢幕原生比例截圖與 reference 比較、跨螢幕決策流程證據，
執行受影響的既有 build/check/test，報告未完成整合與不能執行的驗證。
```

## 7. 監督與驗收

每次評審先看四張原生比例截圖，再看跨螢幕流程。不要只以「按鈕可以按」判定完成。

- Center：35/65 分區、必要導航讀值、提案來源與影響、同意／略過及負荷降級。
- Passenger：分類與卡片真的改變選取；只能提案；未經同意不能改旅程。
- Rear：四個角色完整、溫度上下界與同步、媒體模擬清楚、提案經同一決策入口。
- Window：保留場景、資訊帶精簡、離線與警示可辨認、不承載複雜決策。
- 共用：同意、拒絕、重複提案、HIGH 延後與恢復、CRITICAL、offline、unknown／stale。
- 以現有 React simulator 與 gateway 整合成功作為工程完成；本預覽完成僅代表可操作的視覺／行為參考。

## 8. 本次驗證與待完成

已完成：獨立本地 HTML/CSS/JS 四螢幕、原參考圖照片素材、共享模擬提案流程、獨立測試控制。

已驗證：JavaScript 語法；用 mock DOM 執行实际事件 handler，檢查同意後更新、重複保護、拒絕保持、HIGH 延後、CRITICAL 優先、offline、溫度上下界／同步、媒體進度、分頁與分類。

待完成：正式 React/gateway/API／車輛裝置整合、正式來源與 stale/unknown schema 驗收、原生比例瀏覽器截圖對照。此環境沒有可用的瀏覽器執行檔，安裝下載失敗，因此沒有完成瀏覽器視覺驗證；不可宣稱已達像素一致或實車可用。
