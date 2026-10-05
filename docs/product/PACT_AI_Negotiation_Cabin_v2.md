# PACT --- AI Negotiation Cabin

## 2026 AI 座艙感知與視覺化 Hackathon

> **One Cabin. Many People. One AI.**

## 1. 專案定位

**PACT --- Passenger-Aware Arbitration & Coordination Technology**

中文暫定：**多乘員 AI 智慧協調座艙**

PACT 是一套面向多人智慧座艙的 AI 協調系統。\
它不只是回答指令，而是判斷：

-   誰提出需求？
-   想做什麼？
-   誰有決定權？
-   現在適合處理嗎？
-   應該在哪個螢幕或區域執行？

核心概念：

> 當一台車裡有多個人、不同需求與有限共享資源時，AI
> 如何安全且合理地協調整個座艙？

------------------------------------------------------------------------

## 2. 為什麼做 PACT

常見智慧座艙多聚焦於：

-   疲勞／分心偵測
-   情緒辨識
-   車載語音助理
-   AI 導航與推薦
-   手勢控制

PACT 的差異是：

**Multi-Occupant + Conflict Resolution + Permission + Attention +
Multi-display**

不是只理解一個 Driver，而是理解整個 Cabin。

------------------------------------------------------------------------

## 3. 核心架構

``` text
Driver ──────────┐
Passenger ───────┤
Rear Passenger ──┤
Vehicle Context ─┤
Safety Context ──┘
                 ↓
              PACT
                 │
        Occupant Understanding
                 ↓
          Intent Understanding
                 ↓
         Conflict Detection
                 ↓
           Policy Engine
                 ↓
       Arbitration Engine
                 ↓
     Experience Orchestrator
                 ↓
 ┌────────┬────────┬────────┐
Driver   Center  Passenger  Rear
Display  Display   Display  Display
```

------------------------------------------------------------------------

## 4. PACT 的判斷依據

### Safety

安全與駕駛任務優先。

``` text
Safety
  >
Driving Critical
  >
Vehicle Operation
  >
Shared Task
  >
Personal Preference
  >
Entertainment
```

### Role / Permission

不同乘員擁有不同控制權。

例如：

-   副駕調整自己的空調 → `EXECUTE`
-   副駕修改全車導航 → `ASK DRIVER`
-   後座修改 Driver HUD → `REJECT`

### Scope

判斷動作影響範圍：

-   Personal
-   Zone
-   Shared
-   Driver Critical
-   Safety Critical

### Context / Attention

如果駕駛正在複雜路口或注意力負荷高，非必要資訊可以延後或轉移。

### Conflict

不同乘員需求衝突時，先尋找能同時滿足需求的方法，再進行協商。

### Preference

安全、權限與情境允許後，才考慮個人偏好。

------------------------------------------------------------------------

## 5. 決策結果

PACT 最終輸出：

  Decision    用途
  ----------- ------------------------
  `EXECUTE`   直接執行
  `ASK`       詢問有權限者
  `ROUTE`     轉給適合的人／螢幕
  `DEFER`     延後處理
  `REJECT`    拒絕不安全或無權限操作

------------------------------------------------------------------------

## 6. 代表情境

### 情境 A：空調衝突

``` text
Driver: 21°C
Passenger: 25°C
        ↓
Conflict Detected
        ↓
Dual-zone Available
        ↓
Driver Zone: 21°C
Passenger Zone: 25°C
```

**重點：AI 不選邊站，而是解決衝突。**

### 情境 B：修改導航

副駕：

> 改去這間餐廳。

PACT 判斷：

``` text
Speaker = Passenger
Resource = Navigation
Scope = Shared
Permission = Driver Confirmation
```

結果：

``` text
ASK DRIVER
```

若駕駛正在高負荷情境：

``` text
DEFER → ASK DRIVER LATER
```

### 情境 C：多人多螢幕

``` text
Navigation
→ Driver Display

Restaurant Search
→ Passenger Display

Entertainment
→ Rear Display
```

**資訊不是全部塞到中控，而是送給最適合的人。**

------------------------------------------------------------------------

## 7. Attention Engine

駕駛的注意力也視為有限資源。

輸入可包含：

-   車速
-   導航事件
-   道路複雜度
-   Driver Gaze
-   當前 HMI 任務

例如：

``` text
Attention Load = 82%
        ↓
FOCUS MODE
        ↓
Driver Display
只保留駕駛必要資訊
```

其他非必要資訊：

``` text
ROUTE → Passenger
DEFER → Later
```

------------------------------------------------------------------------

## 8. Hybrid AI

### Offline Core

斷網仍可執行：

-   Intent Classification
-   Role / Permission
-   Conflict Detection
-   Attention Engine
-   Local Commands
-   基本協調邏輯

### Cloud Enhanced

連網後增加：

-   Cloud LLM
-   複雜自然語言推理
-   多輪協商
-   餐廳／POI
-   即時天氣與路況
-   進階推薦

``` text
Offline First
     +
Cloud Enhanced
```

------------------------------------------------------------------------

## 9. Demo 主線

建議控制在約 90 秒。

### ① 多人需求

Driver 設定導航。\
Passenger 找餐廳。\
Rear Passenger 開啟娛樂。

→ 展示 Multi-user / Multi-display。

### ② 衝突

Driver 要 21°C，Passenger 要 25°C。

→ PACT 使用 Dual-zone 解決。

### ③ 高注意力負荷

進入複雜路口。

→ Driver Display 進入 Focus Mode。\
→ 餐廳資訊轉 Passenger Display。\
→ 娛樂留在 Rear Display。

### ④ 權限

Passenger 要修改目的地。

→ PACT 判斷需要 Driver 同意。\
→ 安全時才詢問 Driver。

### ⑤ Hybrid AI

拔掉網路仍能完成基本座艙協調。\
恢復網路後啟用 Cloud AI 進階服務。

------------------------------------------------------------------------

## 10. MVP

第一版只做：

-   Android HMI
-   Driver / Passenger / Rear 三個介面
-   模擬 Vehicle Context
-   Intent Parsing
-   Role / Permission
-   Conflict Detection
-   Policy Engine
-   Attention Load
-   `EXECUTE / ASK / ROUTE / DEFER / REJECT`
-   Offline / Online Mode
-   一條完整 Demo

Camera、真實車輛 CAN、完整 AAOS 整合可放第二階段。

------------------------------------------------------------------------

## 11. Pitch

### 開場

> **What happens when everyone in the car wants something different?**

### 核心

> 現在的智慧座艙正在學習如何理解一個使用者。\
> PACT 要解決的是：當一台車裡有很多人、很多需求與很多螢幕時，AI
> 如何協調整個座艙？

### Ending

> **PACT doesn't just understand commands.\
> It coordinates people, priorities and cabin resources.**

------------------------------------------------------------------------

## 12. 競賽策略

競賽實作組評分重點：

-   技術完成／可行度：35%
-   創新性：25%
-   UX/UI：20%
-   商業可行性：10%
-   Pitch：10%

因此開發優先順序：

``` text
Decision Policy
      ↓
Multi-display HMI
      ↓
Scenario Simulator
      ↓
AI / Intent
      ↓
Hybrid AI
      ↓
Demo Polish
```

**先把決策與 Demo 做完整，再增加模型複雜度。**

------------------------------------------------------------------------

## 一句話定義

> **PACT 是一套多人智慧座艙 AI
> 協調系統，依據乘員角色、權限、注意力、車輛情境與共享資源，進行需求仲裁、任務協調與跨螢幕資訊分配。**
