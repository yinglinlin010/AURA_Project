# AURA — Automotive AI Cockpit UI/UX Design Spec

## STEP 1: AURA UX Design Philosophy
**What:** AURA 的底層設計哲學，指導所有資訊的呈現與互動邏輯。
**Why:** 確保 AURA 是一個專注於駕駛安全、具備空間感知能力的「旅程伴侶」，而非單純的科技展示。

1. **Restrained Intelligence (克制的智慧):**
   AI 是輔助者而非主導者。在跨螢幕互動中採用「獨立焦點轉移 (Discrete Focus Shift)」，避免花俏的跨螢幕動畫干擾駕駛。UI 優先服務安全與認知負載。
2. **Journey-Centric, Not App-Centric (以旅程為軸):**
   打破傳統車機以 App 為單位的邏輯（地圖、天氣、音樂各自獨立）。AURA 根據時間軸（例如：晚餐 -> 停車 -> 飲料 -> 飯店）動態重組資訊，呈現「今天的 Journey」。
3. **Glanceable & Context-Adaptive (一瞥即知與情境自適應):**
   資訊密度與駕駛當前的認知負載成反比。Cluster 與 Center Display 必須達到 1-2 秒內可讀的標準。遇到高壓情境，非安全資訊立即退讓。
4. **Ambient & Transparent (沈浸與通透):**
   將 AURA 的實體存在感（AI Presence）與實體環境融合（特別是側邊智慧車窗），運用路徑、流動與抽象幾何的視覺語言，營造 Calm & Premium 的質感。

---

## STEP 2: Five Display Information Architecture
**What:** 定義五個螢幕各自的職責、資訊層級與互動邊界。
**Why:** 確保「ONE AI」在不同角色（駕駛、副駕、後座）與情境下，提供最精確的資訊量，避免 Center 成為聊天視窗或 Cluster 出現不必要的干擾。

### 01 — CLUSTER (Driver)
*   **Role:** Critical Driving Context & Safety (極簡駕駛與安全核心)
*   **Information Priority:**
    1. Safety Warnings (後方障礙、急煞警告 - 最高優先級)
    2. Immediate Driving Context (時速、檔位)
    3. Immediate Navigation (120m 後右轉)
    4. Minimal AI Status (極短的 AI 狀態，如「停車輔助已啟動」)
*   **Interaction:** 唯讀 (Read-only)，最大化 Glanceability。絕對禁止長文字與對話紀錄。

### 02 — CENTER DISPLAY (Driver / Front Cabin)
*   **Role:** Journey Decision Surface (旅程決策中樞)
*   **Information Priority:**
    1. Vehicle Context & Navigation Flow
    2. AI Action Confirmation (副駕/後座傳來的提案，以 Action Card 呈現)
    3. Parking Visualization (啟動輔助時)
*   **Interaction:** 決策型互動 (Accept, Skip, Confirm)。不顯示長篇推理，AI 的建議直接轉化為具體按鈕與狀態。

### 03 — FRONT PASSENGER DISPLAY (Front Passenger)
*   **Role:** Rich Exploration & Planning (深度探索與旅程規劃)
*   **Information Priority:**
    1. AI Conversation & POI Search (如：找火鍋、飲料店)
    2. Recommendation Comparison (評分、繞路時間、停車難易度對比)
    3. Journey Impact (新增地點對總行程的影響)
*   **Interaction:** 對話式、沉浸式瀏覽。允許處理複雜的 AI 意圖，並轉化為具體方案發送給 Center。

### 04 — REAR DISPLAY (Rear Passenger)
*   **Role:** Trip Participation (旅程參與及娛樂)
*   **Information Priority:**
    1. Destination Exploration (搜尋附近景點/飲食)
    2. Journey Timeline (檢視當前行程進度)
    3. Entertainment
*   **Interaction:** 提案制 (Proposal-only)。可搜尋並送出請求，但無權直接修改駕駛路線，必須經過 Driver Consent。

### 05 — INTERACTIVE WINDOW (Smart Side Window)
*   **Role:** Ambient Context & AI Presence (環境感知與 AI 載體)
*   **Information Priority:**
    1. AURA AI State (IDLE, LISTENING, THINKING 等抽象狀態)
    2. Ambient Info (Time, Weather)
    3. Environmental integration (結合車窗外真實風景的通透呈現)
*   **Interaction:** 被動感知與語音觸發。以通透、微動態 (subtle animation) 為主，不阻礙真實視線。


## STEP 3: Cross-display Interaction Model
**What:** 跨螢幕的資訊流動與「Driver Consent (駕駛授權)」機制。
**Why:** 確保「乘客參與」不會干擾「駕駛控制」，並維持 Handoff 的高效與低干擾。

**核心互動模型：**
1. **發起 (Proposal):** 副駕或後座在自己的螢幕上進行複雜搜尋與 AI 互動，選定目標（如：加入飲料店）。
2. **傳遞 (Discrete Focus Shift):** 不使用花俏的跨螢幕動畫。資訊在發起端收合，準備無縫送往中控。
3. **接收與授權 (Center Action Card):**
   * 若駕駛負載為 **Normal**，Center 直接顯示精簡版 Action Card（如：`XX飲料店 +4 min [加入] [略過]`）。
   * 若駕駛負載為 **High**，Center 僅在邊緣顯示 **「微型提示 (Micro Indicator)」**（無文字的極簡光點或圖示），等待駕駛安全時點擊展開。
4. **執行與同步 (Journey Update):** 駕駛點擊 [加入] 後，Center 更新總體 Journey Timeline，Cluster 同步更新下一筆導航指示，發起端螢幕顯示「已加入行程」。

---

## STEP 4: Driver Cognitive Load Model
**What:** UI 資訊密度隨駕駛情境自動縮放的自適應系統 (Context-Adaptive UI)。
**Why:** 確保在任何駕駛情境下，AURA 始終遵守 Safety Priority，避免視覺與認知過載。

**負載四級定義：**
1. **LOW (靜止、自動停車、長途無車巡航):**
   * 允許顯示：豐富的 Journey Timeline 預覽、音樂封面、副駕/後座的複雜提案 Action Card。
2. **NORMAL (一般市區行駛):**
   * 允許顯示：核心導航指示、當前路況、立即到來的 Action Card。隱藏過度裝飾性的 UI 面板。
3. **HIGH (複雜交流道、大雨、視線不良):**
   * 允許顯示：僅保留核心導航 (Lane Guidance) 與車輛狀態。
   * 系統行為：所有新進提案（Handoff）強制轉為 **Micro Indicator**，延後處理。UI 進入極度純淨的收合模式。
4. **CRITICAL (突發障礙物、急煞車、後方逼車):**
   * 允許顯示：100% Safety UI (如：`WARNING 0.4m`)。
   * 系統行為：Cluster 與 Center 強制接管，隱藏導航以外的一切資訊。AI 視覺實體立即轉為安全警告狀態。


## STEP 5: AURA AI Presence Model
**What:** AURA 作為一個 AI 實體的視覺表現與 7 種核心狀態設計。
**Why:** 賦予 AURA 獨特的性格（不幼態、不高調），並透過視覺狀態讓使用者瞬間理解 AI 當下的運作階段。

**核心視覺隱喻：空間流體 / 光徑 (Spatial Fluid / Light Path)**
不使用擬人化或發光球體。AURA 是一束具有實體空間感、柔和邊緣的光束或絲帶，隱喻「道路與旅程」。
*   **IDLE (待機):** 極度克制。如同一條遙遠的公路，呈現緩慢、平靜的單一微弱光徑流動，主要存在於 Interactive Window。
*   **LISTENING (聆聽):** 空間聚焦。光徑會向發聲者（如正駕駛或副駕駛）的方向彎曲、匯聚，產生輕微的亮度提升，表示「我正在注意你」。
*   **THINKING (思考):** 處理中。多條光徑開始交織、重疊，猶如路線在進行複雜運算，呈現柔和但高頻的脈動。
*   **SPEAKING (說話):** 互動回饋。光徑隨語音的抑揚頓挫進行溫暖的寬度擴張與收縮 (responsive motion)。
*   **EXECUTING (執行):** 指向性流動。光徑快速流向被控制的 UI 區塊（例如流向地圖更新路徑，或流向某個 Action Card）。
*   **OFFLINE (離線/Local Mode):** 降級指示。光徑停止脈動與流動，轉為平穩、低飽和的實線，並帶有 Subtle 的「Local Mode」靜態標記。
*   **WARNING (警告):** 立即讓位。光徑瞬間褪去柔和感，轉變為銳利、高對比的幾何折線（如紅色/橘色括號或箭頭），直接指向危險來源或提示區塊。

---

## STEP 6: Visual Design Direction
**What:** AURA 的總體視覺風格與美學定義。
**Why:** 確保介面質感符合 Premium, Calm, Spatial 的要求，避免落入廉價科幻 (Sci-fi) 或泛用 Android App 的俗套。

*   **Theme (主題性格):** Calm, Intelligent, Premium, Spatial, Automotive。
*   **Color & Lighting (色彩與光影):** 拒絕高飽和的 Cyberpunk 霓虹 RGB。採用與自然與都市光影呼應的色系（如：晨曦暖白、柏油深灰、琥珀色 AI 光徑）。背景深度與色調必須能隨日夜、天氣自動融合適應。
*   **Typography (字體設計):** 採用高對比、極具辨識度的無襯線字體，嚴格針對車載環境 (Glanceability) 優化字距與行高。禁止使用純粹為科技感而犧牲閱讀性的裝飾字體。
*   **Material 3 變體 (Surface & Depth):** 繼承 Material 3 的操作與層級邏輯，但大幅減少傳統的「卡片陰影 (Drop shadows)」。採用「空間透明度 (Spatial Opacity)」與「微磨砂玻璃 (Subtle Frosted Glass)」來區分資訊層級，絕對避免過度堆疊 (Card inside card inside card)。
*   **Journey-Centric Decor (旅程裝飾抽象化):** 將道路標線、路牌等實體元素「抽象化」。不使用寫實的地圖圖示，而是運用幾何色塊與排版節奏，在平面介面中暗示空間方向感與旅程進度 (Route Progression)。


## STEP 7: Design Tokens
**What:** 建構介面的基礎視覺原子 (Colors, Typography, Surfaces)。
**Why:** 建立系統化、可延伸的設計規範，確保跨五螢幕的一致性與頂級質感。

*   **Color System:**
    *   Base: `Obsidian Black` (#0A0A0C) - 吸收環境光，不刺眼，作為純淨的底色。
    *   Surface: `Deep Asphalt` (#16161A) - 用於底層容器。
    *   AURA Active (Light Path): `Warm Amber` (#FF9F1C) / `Copper` (#E56B00) - 傳遞智能、溫暖與方向感。
    *   Safety Critical: `Alert Crimson` (#E63946) - 絕對高對比，瞬間警示。
*   **Typography:**
    *   Font Family: 無襯線幾何字體 (如 Inter 或自訂 Automotive Sans)。
    *   Weight: 導航數字與 ETA 使用 `Medium` / `SemiBold`；輔助資訊使用 `Regular`。
    *   Spacing: 字距微幅拉寬 (Tracking +2%)，確保行駛中震動時的可讀性。
*   **Surface Hierarchy (取代傳統陰影):**
    *   Level 0: Map Canvas (極暗地圖底層)。
    *   Level 1: Route Backbone (發光的旅程時間軸主幹)。
    *   Level 2: Frosted Nodes (半透明微磨砂玻璃材質的行程節點與 Action Cards)。
    *   Level 3: AURA Presence (流動的琥珀色光徑，位居最上層)。
*   **Radius:**
    *   主節點與卡片容器：`24px` (柔和但保有結構感)。
    *   內部動作按鈕：`12px`。

---

## STEP 8: Wireframe Structure
**What:** 基於「垂直旅程時間軸」的螢幕骨架佈局。
**Why:** 確保資訊架構完美對應 Journey-centric 理念，徹底摒棄 App-centric 的網格佈局。

### Center Display (The Vertical Journey Timeline)
*   **Top (0-20%): Horizon & Destination。** 顯示最終目的地、總體 ETA、結合環境光的氣象天際線。
*   **Middle (20-80%): 3D Route Backbone。** 畫面中央是由下而上延伸的粗線條路徑。
    *   *Nodes (節點):* 路線上串列著未來行程（如 `[Dinner 18:30]` -> `[Park 19:15]`）。
    *   *Inserts (安插):* AI 的提案（Action Cards）直接安插在路線預定發生的位置上，不遮擋主視線。
*   **Bottom (80-100%): Immediate Action & Micro Indicators。** AURA 光徑的發源地，以及高負載時暫存 Handoff 的邊緣微型提示區。

### Cluster (The Safety Core)
*   **Left (30%):** Speed & Gear (大字體高對比)。
*   **Center (40%):** ADAS / Lane / Immediate Obstacle (極簡線條框，無多餘裝飾)。
*   **Right (30%):** Immediate Nav (`[Turn Right 120m]`)。

### Front / Rear Display (The Exploration Canvas)
*   **Left (60%):** Rich Discovery。圖文並茂的餐廳、景點列表，與 AURA 的對話介面。
*   **Right (40%):** Journey Impact Preview。預覽這個地點若加入後，對總體時間軸的影響，並帶有巨大的 `[Send to Driver]` 提案按鈕。


## STEP 9: High-fidelity Dashboard Proposal (Text-based UI Layout)
**What:** 核心情境下的畫面具象化描述。
**Scenario:** 高壓路況下的「中途新增行程」。

**[ 畫面 1: Rear Display - 提案發起 ]**
*   **Left Canvas:** 滿版高畫質的地圖探索區。選中「XX飲料店」。
*   **Right Panel:** 
    *   標題: XX 飲料店
    *   Journey Impact: `總車程 +3 min` / `距原路線 400m`
    *   Button: 巨大的琥珀色 `[ 建議加入行程 ]`
*   **Visual state:** 點擊後，卡片向中心收合，AURA 光徑亮起，從螢幕邊緣消失 (Discrete Focus Shift)。

**[ 畫面 2: Center Display - High Load 靜默狀態 ]**
*   **Background:** Obsidian Black，極致深邃，不反光。
*   **Center:** 垂直 3D 導航線，目前專注於複雜的「五岔路口車道指引 (Lane Guidance)」。所有不必要的節點與天氣資訊皆隱藏 (Opacity 0%)。
*   **Bottom Right (Micro Indicator):** 出現一個 `12px` 的琥珀色光點 (Warm Amber)，帶著如呼吸般極其微弱的脈動，完全不干擾駕駛視線。

**[ 畫面 3: Center Display - Normal Load 卡片展開 ]**
*   **Center:** 駛離路口後，垂直旅程時間軸恢復。
*   **Timeline Insert:** 剛剛的微型光點順著 3D 路徑向上滑動，在預估到達的空間位置上，展開為「半透明微磨砂 (Frosted Glass)」的 Action Node：
    ```text
    ╭────────────────────────────────────────╮
    │  [Avatar: 後座乘客] 建議新增停靠點         │
    │  XX 飲料店 (距離 400m)                    │
    │  ETA 延遲: +3 min                        │
    │                                        │
    │  [ 略 過 ]                  [ 加 入 ]    │
    ╰────────────────────────────────────────╯
    ```

---

## STEP 10: Prototype Interaction Flow
**What:** 核心情境的時間軸與跨螢幕互動腳本，適合直接作為 Demo 或 Prototype 的實作劇本。

*   **T=00s [發起]:** 後座乘客點擊 `[建議加入行程]`。
*   **T=01s [傳遞]:** AURA 判斷駕駛正處於 High Cognitive Load（複雜路口）。
*   **T=02s [佇列]:** Center Display 右下角無聲亮起琥珀色微型光點 (Micro Indicator)。Cluster (儀表板) 毫無反應，確保 100% 駕駛專注與安全。
*   **T=15s [負載解除]:** 車輛平穩駛離路口，進入直行巡航狀態 (Normal Load)。
*   **T=16s [展開]:** Center Display 底層的 AURA 光徑 (Light Path) 輕柔流動，將光點推上垂直時間軸，展開為 Action Node。
*   **T=18s [駕駛決策]:** 駕駛一瞥 (Glanceability < 1.5s)，點擊方向盤右側實體確認鍵，或觸控 `[ 加 入 ]`。
*   **T=19s [同步與回饋]:** 
    *   **Center:** Action Node 瞬間固化為時間軸上的正式節點 `[Stop 1: XX飲料店]`。
    *   **Interactive Window:** AURA 光徑呈現一次溫暖的空間擴張 (Executing state)，隨後回歸平靜 (Idle)。
    *   **Cluster:** 右側 Navigation 面板無縫更新下一筆轉彎指示。
    *   **Rear:** 乘客螢幕顯示「駕駛已接受，路線已更新」。
