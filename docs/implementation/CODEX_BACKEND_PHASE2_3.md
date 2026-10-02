# TASK: AURA Project - Backend Phase 2 & 3 (Simulator & Action Gate)

**To:** Codex / Backend Engineering Agent
**From:** System Architect
**Reference Docs:** `../product/AURA_MASTER_SPEC_2026-10-02.md`, `../architecture/AURA_RUNTIME_IMPLEMENTATION_DESIGN.md`

## ⚠️ STRICT BOUNDARY WARNING
- **DO NOT** implement any UI, React components, or visual layouts.
- Rely on the contracts and Shared State established in Phase 0 & 1.

## 1. DISPATCH: PHASE 2 (Simulator / Scenario Source)
**Target Location:** `adapters/simulator/`, `scenarios/`

**Task Details:**
1. 建立一個 **Headless Scenario Runner (無頭劇本執行器)**。
2. 實作 YAML 解析邏輯，讀取 `scenarios/` 目錄下的測試劇本。
3. 根據劇本的時間軸 (Timeline)，向 Core Runtime 穩定發出帶有 `provenance` (來源證明) 的 `ContextSignal` 事件。
4. **驗收標準：** Runner 必須能透過 Phase 1 建立的 Intake path 注入資料，嚴禁直接修改底層狀態來「假裝」系統執行。

## 2. DISPATCH: PHASE 3 (Action Gate, Consent & Safety Supervisor)
**Target Location:** `packages/core-domain/`

**Task Details:**
實作 Master Spec 定義的核心決策大腦，必須包含以下三個核心模組：
1. **Safety Supervisor (安全監督者):**
   - 監聽所有的 ContextSignals。當遇到 `CRITICAL` 級別的安全訊號時，必須走確定性 (Deterministic) 的優先路徑，強制發布 `EXECUTE` 政策，並中斷當前所有次要任務。
2. **Action Gate (動作守門員):**
   - 評估所有的 `ActionProposal`。實作「認知負載 (Cognitive Load)」邏輯。
   - 若駕駛處於高負荷狀態 (High Load)，將次要通知判定為 `DEFER`，並附加 `deferUntil` 條件；若無負荷，則判定為 `ROUTE` 交由對應角色處理。
3. **Consent Manager (同意權管理):**
   - 處理狀態為 `AWAITING_CONSENT` 的提案，並在收到目標角色的同意訊號後，才將狀態推進至 `EXECUTING`。

## 3. OBSERVABILITY & TESTING
- 針對 `Action Gate` 與 `Safety Supervisor` 撰寫單元測試 (Unit Tests)。
- 確保每一次 Policy Outcome 都有附帶正確的 `reasonCode` 與 `traceId`。

**Completion Condition:**
回報 Scenario Runner 的啟動指令，並展示 Safety Supervisor 能成功攔截一般任務的測試結果。等待審查。
