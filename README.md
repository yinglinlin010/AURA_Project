# AURA Project

AURA 的產品規格、架構設計與實作紀錄集中在 [`docs/`](docs/README.md)。

## 可操作的座艙系統

預設 Web 介面已接入 OpenStreetMap、實際路線、跨座位照片與字幕，以及「過半＋駕駛同意」投票。啟動、語音與本機 AI 設定見 [座艙操作指南](docs/implementation/FUNCTIONAL_CABIN.md)。

## 專案目錄

- `apps/`：可執行應用，包括 core host 與 web simulator
- `packages/`：核心領域邏輯與 runtime
- `adapters/`：語音、地圖、天氣、持久化與模擬器介面卡
- `contracts/`：協定與情境資料契約
- `scenarios/`：模擬情境
- `scripts/`：開發與示範腳本
- `AURA_UI_UX_Handoff/`：HMI 設計交接文件與參考圖片

產品方向與實作狀態請先看 [文件索引](docs/README.md)、[Master Spec §61.31](docs/product/AURA_MASTER_SPEC_2026-10-02.md#6131-product-direction-update-2026-10-04) 與 [需求稽核](docs/implementation/AURA_COMPETITION_V1_REQUIREMENTS_AUDIT.md)。

## 已有實作證據（含模擬路徑）

以下列出可在 repository 找到的核心程式與模擬流程；項目存在不代表完成產品驗收、實體設備整合或真實服務驗證。各項證據與限制見需求稽核。

### 1. 核心通訊與 HMI 閘道器
- **HMI Gateway 與 Event Bus**: Gateway 設定五個邏輯顯示角色；自動化測試及單一瀏覽器模擬涵蓋多連線事件與重連，並不代表五個實體顯示器。
- **連線與復原**: 有負載政策、重連和連線狀態邏輯；離線 continuity 的自動化情境使用模擬 provider／訊號，真實網路及服務恢復未驗證。

### 2. 智慧路由與外部服務介接
- **Gemini Live 語音整合**: 實作語音即時連線生命週期管理 (Voice live connection lifecycle)，支援安全的連線中斷、逾時處理與狀態復原。
- **混合 AI 路由**: 有確定性本機命令、可選 Ollama 候選器與雲端 adapter 路由；不代表已訓練的 AURA 模型或完整離線任務恢復。
- **情境與行程推薦**: 有模擬推薦及 Mapbox 搜尋／路線預覽接線；即時 provider 結果、充電點與下車空間資料尚未完成驗證。

### 3. 行動安全與權限管控 (Action Gate & Safety)
- **Action Gate 與同意管理器**: 有角色權限、Center 行程確認、高負荷延後及確定性 safety supervisor 邏輯；依各 action policy 決定是否需要同意。
- **共享狀態與 Presence**: Core Runtime 管理共享狀態、事件與顯示角色；乘員私有任務資料的完整顯示投影仍待定義。

### 4. 情境模擬與自動化驗證
- **情境模擬器**: YAML scenarios 覆蓋高負荷延後、模擬離線 continuity、語音 mock 路徑及合成停車指導。
- **可重播檢查**: 有 scenario replay 紀錄；它驗證確定性模擬行為，不等於產品可靠度或延遲量測。

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


## PACT 多乘員協調 Demo

依據 [PACT v2 規格](docs/product/PACT_AI_Negotiation_Cabin_v2.md) 新增獨立的模擬 MVP。
Web 入口為 `http://127.0.0.1:5173/?demo=pact`；Android `PactActivity` 內嵌介面與本機引擎，無需開發伺服器。
包括三乘員顯示、五種決策、空調衝突協調、注意力負荷、駕駛確認、離線核心與可自動播放的 Demo。
啟動、建置、驗證與功能限制見 [PACT 實作紀錄](docs/implementation/PACT_MVP.md)。
