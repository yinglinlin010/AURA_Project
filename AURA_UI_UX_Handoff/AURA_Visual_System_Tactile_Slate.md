# AURA Visual System: Tactile Slate

## 1. 核心視覺美學 (Core Aesthetics)
- **Digital Craft (數位工藝):** 介面不應感覺像是懸浮的像素，而應具有物理重量。致敬德國百靈 (Braun) 的工業設計與瑞士字體排印學 (Swiss Typography)。
- **Editorial Journey (編排式旅程):** 徹底捨棄 APP Icon 邏輯。旅程資訊如同高階旅遊雜誌或高鐵時刻表，依賴強烈的粗細對比與實線 (Hairlines) 切割畫面。
- **No Glow, No Glass:** 嚴格禁止使用毛玻璃 (Frosted Glass)、發光漸層 (Neon Glow) 與投影 (Drop Shadow)。

## 2. 顏色系統 (Color Tokens)
色彩靈感來自汽車內裝的頂級實體材質與自然礦物，所有色彩皆為**消光 (Matte)** 質感。

*   **Background (底盤):** 
    *   `Matte Charcoal` (#1C1C1E) - 用於全域背景，深邃但不死黑。
*   **Surface (面板與卡片):** 
    *   `Slate Gray` (#2C2C2E) - 次級資訊區塊。
    *   `Warm Sand` (#E5DACC) - 需要強烈關注的白皮書級別區塊。
*   **Typography (字體顏色):** 
    *   `Bone White` (#F2F2F2) - 主要文字。
    *   `Asphalt Text` (#8E8E93) - 輔助文字。
*   **AURA & Action (智能與動作):** 
    *   `Industrial Orange` (#FF5A00) - 取代一般的 AI 藍/紫色。用於 AURA 的狀態指示與最關鍵的 Action Button。極具機械感與警示感。
*   **Safety (安全絕對優先):** 
    *   `Signal Red` (#FF3B30) - 僅在 Critical 狀態下使用。

## 3. 排版與網格 (Typography & Grid)
*   **Grid System:** 採用極度嚴格的 8pt Grid System。所有卡片、文字對齊必須完美貼齊網格，產生建築般的穩定感。
*   **Typography:** 採用 x-height 較高、切線銳利的無襯線字體（如 Helvetica Now, Roboto Flex 或自訂字體）。
    *   *ETA / 速度:* 使用超大字級與 `Bold` 字重。
    *   *分隔線:* 廣泛使用 1px 的實心直線 (Hairline Rules) 來區分資訊，取代傳統卡片的留白間距。

## 4. AURA Presence (AI 實體的機械化表現)
在 Tactile Slate 的框架下，AURA 不再是一束流動的光。AURA 的 7 種狀態轉化為**「介面版塊的物理推擠與排版重組 (Kinetic Layout)」**：
*   **IDLE:** 完美的靜態網格，無任何多餘動畫。
*   **LISTENING:** 畫面特定區塊（如時間軸底層）像實體抽屜般向下滑動 20px，露出下層亮橘色的 `Industrial Orange` 指示條，表示麥克風開啟。
*   **THINKING:** 橘色指示條出現猶如機械指針跳動般的節奏變化。
*   **EXECUTING:** 行程節點以「蓋章」或「翻頁」的硬朗動態，直接嵌入垂直時間軸。

## 5. 跨螢幕 Handoff UI 表現
當後座 Proposal 送達中控 (Center Display) 時：
*   **High Load (微型提示):** 不使用發光點。而是在畫面邊緣的網格線上，滑出一個 4x12px 的 `Industrial Orange` 實體色塊，安靜地卡在軌道上。
*   **Normal Load (卡片展開):** 該橘色色塊沿著軌道滑動至對應的旅程時間點，並向左橫向展開為一塊邊緣銳利的 Action Panel，內部以黑底白字清晰排版 `[XX 飲料店] [繞路 +5 min]` 與實心按鈕。
