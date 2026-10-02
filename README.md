# AURA Project

AURA 的產品規格、架構設計與實作紀錄集中在 [`docs/`](docs/README.md)。

## 專案目錄

- `apps/`：可執行應用，包括 core host 與 web simulator
- `packages/`：核心領域邏輯與 runtime
- `adapters/`：語音、地圖、天氣、持久化與模擬器介面卡
- `contracts/`：協定與情境資料契約
- `scenarios/`：模擬情境
- `scripts/`：開發與示範腳本
- `AURA_UI_UX_Handoff/`：HMI 設計交接文件與參考圖片

## 目前已完成進度 (Completed Features)

根據目前的開發與驗證進度，專案已完成以下核心基礎架構與模擬情境：

### 1. 核心通訊與 HMI 閘道器
- **HMI Gateway 與 Event Bus**: 完成支援五大邏輯客戶端 (Cluster, Center, Passenger, Rear, Interactive Window) 的 WebSocket 連線，確保跨螢幕狀態同步。
- **連線與復原 (Load-aware & HMI Recovery)**: 實作負載感知的呈現解析以及重連策略，確保離線或連線不穩時能平滑恢復畫面與狀態。

### 2. 智慧路由與外部服務介接
- **Gemini Live 語音整合**: 實作語音即時連線生命週期管理 (Voice live connection lifecycle)，支援安全的連線中斷、逾時處理與狀態復原。
- **混合 AI 代理與本機退回 (Hybrid AI & Fallback)**: 支援基於意圖的路由分發，在離線或無雲端支援情況下自動退回本機模型 (如 Ollama) 處理確定性指令。
- **情境與行程推薦 (Journey Recommendation)**: 支援 POI 探索、路線規劃及乘客推薦情境的模擬與處理。

### 3. 行動安全與權限管控 (Action Gate & Safety)
- **Action Gate 與同意管理器 (Consent Manager)**: 凡涉及車輛安全或行程變更的操作，皆需經由嚴格的權限驗證及中控台同意 (Center Consent) 方可放行。
- **共享狀態與情境可靠性 (Shared Presence)**: 實作統一且具備權限隔離的共享狀態樹，禁止各顯示端進行非授權的狀態越權竄改。

### 4. 情境模擬與自動化驗證
- **情境模擬器 (Scenario Runner)**: 支援透過 YAML 定義檔快速測試複雜情境，包含駕駛高認知負載自動延遲提示 (Cognitive Load Deferral)、離線接續 (Offline Continuity)、語音干擾 (Barge-in) 及合成停車引導等功能。
- **可靠性測試**: 加入自動化場景重播驗證機制，並整合於文件以保存驗證結果。

## 本機 Ollama 候選模型（Phase 6）

Core Host 會先用確定性 cabin 命令比對器；只有設定 `AURA_LOCAL_MODEL` 才會呼叫 Ollama。模型輸出仍須通過嚴格 schema、Core proposal 驗證和 Action Gate／Consent。未設定模型時不會載入或下載模型。模型拒答或不可用時依現有路由回退。

先確認 Ollama 已啟動且模型已安裝，再從專案根目錄執行：

```sh
export AURA_LOCAL_MODEL=qwen3:4b
# 選用：預設為 http://localhost:11434
# export OLLAMA_HOST=http://localhost:11434
# 選用：預設逾時 5000 ms
# export AURA_LOCAL_MODEL_TIMEOUT_MS=5000
npm run start
```

這會把該模型當成本機候選器，不代表模型已微調或通過評估。教師模型產生的資料須保留來源並經逐筆人工審查，才能納入訓練集；訓練使用可微調的 Hugging Face base checkpoint，Ollama GGUF 權重不能直接當作 SFTTrainer 的訓練底模。設定、資料審查和學生微調進度見 [`AURA_TEACHER_STUDENT_MODEL_PLAN.md`](docs/architecture/AURA_TEACHER_STUDENT_MODEL_PLAN.md)。
