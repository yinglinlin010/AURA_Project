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
