# AURA Display Grid & Layout Structure
*Supplemental layout notes for Master Spec Section 64 and the final five HMI images. Follow the images if proportions or composition differ.*

## 共通排版原則 (Global Layout Rules)
- **Hairline Grids:** 畫面區塊不使用 margin 留白與陰影來區隔，而是全部貼齊，並使用 `1px 實線 (Hairline)` 切割。
- **Kinetic Panels:** 需要跳出對話框或通知時，不可使用懸浮 (Floating) 覆蓋，必須採用實體面板的物理滑動 (Sliding) 擠壓現有版面，或於專屬 Grid 內展開。

---

## 1. Cluster / 數位儀表板 (比例 8:3)
**角色限制：** 僅限最高優先級安全、即時導航、車速。禁止聊天或複雜選單。
**佈局 (3 Column Grid)：**
*   **[Left Zone] 25%:** 車輛基礎狀態 (檔位、電量/油量、頭燈)。
*   **[Center Zone] 50%:** 視覺重心。採用極大字體 (High-contrast typography) 顯示當下時速與下一筆導航 (Turn-by-Turn)。
*   **[Right Zone] 25%:** **安全與 AURA 優先干預區**。平時為空白消光灰 (Matte Charcoal)；當觸發 AEB 或最高級別 AURA 警示時，此區塊會瞬間切換為 `Signal Red` 或 `Industrial Orange` 實體色塊。

---

## 2. Center Display / 中控主螢幕 (比例 16:9, Touch)
**角色限制：** 駕駛決策中心。
**佈局 (Split Layout)：**
*   **[Left Column] 35% - Vertical Journey Timeline (垂直時間軸)：** 
    這是 Center 的靈魂。一條貫穿上下的垂直軌道。
    *   固定顯示：起點、目前位置、下一個停靠點、終點。
    *   **AURA Handoff 區：** 當後座傳來提案，會在時間軸邊緣滑出橘色卡榫 (Micro Indicator)；駕駛同意後，該節點會像實體積木一樣「嵌」入這條時間軸。
*   **[Right Column] 65% - Dynamic Task Area (動態任務區)：**
    *   *Default:* 3D / 2D 地圖。
    *   *Action State:* 當 AURA 提出停車輔助或路徑建議時，下方 50% 的面板會**物理向上推擠**，顯示高對比的文字選項與確認按鈕 (Consent Buttons)。

---

## 3. Front Passenger / 副駕螢幕 (比例 16:9, Touch)
**角色限制：** 探索、複雜資訊比較、豐富對話。
**佈局 (Editorial 2-Column Grid)：**
*   **[Left Column] 40% - AURA Thread (對話流)：**
    捨棄氣泡對話框 (Chat Bubbles)。採用雜誌專欄 (Editorial Column) 排版。使用左對齊、粗細字體對比的段落來呈現 AI 的分析與回覆。
*   **[Right Column] 60% - Rich Media & Comparison (豐富資訊面板)：**
    顯示多張照片、多間餐廳的 Grid 比較表。這裡允許水平滑動 (Horizontal Scroll)，方便乘客探索細節。

---

## 4. Rear Display / 後座娛樂與參與螢幕 (比例 4:3, Touch)
**角色限制：** 乘客行程參與、發起提案給駕駛。
**佈局 (4-Quadrant / Tile Grid)：**
採用大面積的塊狀磁磚設計 (Tiles)，方便後座在車輛震動時盲操作。
*   **[Top Row] 50%:** 目前旅程進度概覽 / 媒體播放器。
*   **[Bottom Row] 50%:** 兩個巨大的 Action Tiles。
    *   *Tile 1:* "尋找沿途停靠點" (觸發 POI 搜尋)。
    *   *Tile 2:* "調整後座環境" (冷氣/座椅)。
    *   操作後，不會直接改變車輛路線，而是產生一條 `ADD_TRIP_STOP` 提案發送至 Center Display 的時間軸。

---

## 5. Interactive Window / 智慧車窗 (比例 4:3, Touch)
**角色限制：** 空間環境、不干擾視野的輕量資訊。
**佈局 (Edge-Aligned Widgets)：**
*   **[Center Canvas] 80%:** 必須保持穿透或顯示極簡的環境色彩 (Ambient state)。
*   **[Bottom Edge] 20%:** AURA 的狀態列與環境數據。以極小的 `Bone White` 字體，排版於畫面最下緣（例如：`24°C | RAIN | ETA 14:30`）。當 AURA 在思考時，只有邊緣的極細橘線會產生長度變化，絕不遮擋車窗視野。
