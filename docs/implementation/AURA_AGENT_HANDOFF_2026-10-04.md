# AURA 工作交接 — 2026-10-04

## 接手指令

使用者最初授權第 1 階段「文件同步與盤點」，後要求交接給較省 token 的模型；該階段已完成。使用者其後已授權製作完整專案，可沿現行 Master Spec 與執行計畫接續必要實作，不必在第 1 階段後再次等待授權。保留既有盤點作為歷史快照，接手者應從下方最新實作進度繼續，不重做已完成盤點。

使用者已澄清：原方向文件 `/Users/yinglin/.codex/attachments/8a9dcef8-344b-402f-9b82-306f49d21d54/AURA_AI_Project_Direction_and_Execution_Plan.md` 是最終討論的主要依據，其產品方向需整合進現行 Master Spec；依照原文件，該文件本身不是另一份 Master Spec。曾提供的 Codex Usage 網址已在登入後查看，顯示帳號使用量分析，未含 AURA 規格，不可當作產品方向文件。

本文件是進度交接，不是另一份 Master Spec。初次交接只完成唯讀盤點及文件同步，當時沒有修改功能或在該次同步後執行測試。其後已開始功能實作與檢查，詳見文末最新進度；歷史盤點不代表目前工作樹仍有相同缺口。

## 授權與限制

- 本地讀取、可逆修改、臨時 worktree、必要定向測試預設授權。大量刪除、生產資料／部署、付款、對外發送、權限／密鑰變更需先批准；平台限制仍適用。
- 初次交接範圍僅文件同步與盤點；目前完整專案的本地必要實作與檢查已獲授權。使用者後續明確授權整合完成後由主執行者提交並推送；「尚未提交或推送」只代表初稿記錄當下的狀態，最終交付狀態以目前分支與最新 Git 紀錄為準。
- 保留所有既有未提交修改，不把工作樹內容描述成 main 已整合。
- 初次交接時的截圖重申上述風險邊界；其後完整專案授權已擴大功能實作範圍，未解除對外與高風險操作的批准要求。

## 已核對 Git 狀態

2026-10-04 透過 `git status`、`git log`、`git ls-remote` 及已登入的 `gh api` 唯讀確認：

- 本地分支：`codex/aura-v1-integration`。
- 本地 HEAD、GitHub main、整合分支、remote HEAD：`7808eb3dc83a2c15847dc7d633536cb503951dde`。
- HEAD 提交時間：2026-10-03 07:48:19 +0800。
- HMI 交接分支 `codex/cluster-reference-handoff-20261003`：`56cfffc451071366d5157c86385a9033f622a03b`。
- [PR #1](https://github.com/yinglinlin010/AURA_Project/pull/1) 為 open，`merged: false`，head 為上述交接 SHA。
- 本地及祖先未找到實際 AGENTS.md，採用使用者在對話提供的風險邊界。交接分支有 AGENTS.md，尚未合併，不能假稱本地已存在。

開始時已有修改：`adapters/voice/{gemini-live-voice-adapter.ts,index.ts,mock-gemini-voice-streaming-adapter.ts}`、`apps/core-host/src/intelligence.ts`、`apps/core-host/test/{gemini-live-connect.test.ts,hmi-gateway-mock-voice.test.ts}`、`docs/implementation/AURA_COMPETITION_V1_REQUIREMENTS_AUDIT.md`、`ml/aura_distill/data/dataset_cli.py`、`packages/core-runtime/src/{tracing.ts,voice-runtime.ts}`。

已有未追蹤檔：`Ting-Ting`、`adapters/voice/local-whisper-voice-adapter.ts`、`apps/core-host/test/{intelligence-local-mode.test.ts,local-whisper-voice-adapter.test.ts}`、`docs/implementation/LOCAL_VOICE_ADAPTER.md`、`run_review.sh`。勿刪除或覆寫。

## 已確認的產品方向

AURA 是理解人與情境、協調車內既有功能的智慧座艙 AI。自動停車為第一整合場景，手動停車指導是補充。AURA 不自行生成轉向／煞車／加速控制；既有系統執行可行且授權的動作，Safety Supervisor／Action Gate／Consent 仍是必要邊界。

三項優先能力：最少必要追問、協助時機判斷、中斷後任務恢復。主線需求是「找方便媽媽下車、附近可以充電的位置」，不能從「媽媽」推定年齡、疾病或輪椅需要。流程涵蓋候選／來源／未知、乘員提案與駕駛確認、高負荷延後、斷網與條件變更、恢复重驗、既有停車能力確認及結果回報、後續充電／步行任務。

## 初次交接時的文件同步清單（歷史快照，已完成同步）

以下保留當時的問題與工作要求；不能當作目前待辦重新執行。

1. 修訂既有 `docs/product/AURA_MASTER_SPEC_2026-10-02.md`，勿建立第二份主規格。開頭及 §0／§2／§61.1 仍以 driving companion、novice parking 入口描述；§61.13 手動指導與 §61.23 舊 Demo 需標明方向變更。同步三項能力、主線、任務資料語意與驗收要求，勿捏造 API／門檻。
2. 明確處理 §61.24 的 `real autonomous parking` 排除與新方向：保留禁止 AURA 自製實車控制；可規劃協調授權既有系統，尚未接車時標示模擬。記錄對 §61.25 frozen roadmap 的影響及依賴，勿宣称已自動重排原路線。
3. 更新 `docs/product/PRODUCT.md`：目前仍將 novice parking 當入口，且部分能力描述落後。保留 Android／裝置屬目標、五角色與視覺／安全規則。
4. 更新 `docs/architecture/AURA_RUNTIME_IMPLEMENTATION_DESIGN.md` 的過時現況：L14–19、約 L304／L311 仍說只有兩個 logical sockets、無 offline integration 或無外部 adapter host wiring。實際已有五 logical sockets、模擬離線路由、可選 Ollama、Mapbox search/route preview 與 Journey persistence。目標設計不可當成完成證據。
5. 更新 `docs/architecture/AURA_FRONTEND_ARCHITECTURE.md` 的過時 active-warning、voice mode、provider／offline 描述。`AURA_SYSTEM_PROTOCOL.md` 很短且稱 safety event 是 AEB engagement；應核對實際 contracts，避免宣稱實車 AEB。
6. 更新 `docs/implementation/AURA_COMPETITION_V1_REQUIREMENTS_AUDIT.md`：保留開始時的語音相關 diff（73 Node tests、local voice generated-audio smoke 等）；追加本次盤點與最新方向。舊段落約 L462 說 Phase10 無 executed scenario，與歷史報告矛盾，應區分已有模擬紀錄與未驗證真實恢復。不得把歷史測試寫成本次跑過。
7. 更新 `README.md`、`docs/README.md`、`AURA_UI_UX_Handoff/CODEX_INSTRUCTIONS.md` 入口，連結權威規格、原方向文件的可攜帶副本（若需要可原樣保存並註明來源）、盤點／交付紀錄。根 README 目前「已完成」用詞過強，需限定證據範圍。
8. 交付文件差異、實作缺口、第 2 階段最小任務及驗收條件，依原方向文件第 11 節報告。本次沒有畫面變更，不宣稱視覺驗證。

## HMI 交接已唯讀核對

公開 raw URL 回 404；已登入 `gh api` 能讀取私有儲存庫。固定 SHA 查閱範例：

```sh
gh api 'repos/yinglinlin010/AURA_Project/contents/AGENTS.md?ref=56cfffc451071366d5157c86385a9033f622a03b' -H 'Accept: application/vnd.github.raw+json'
gh api 'repos/yinglinlin010/AURA_Project/contents/AURA_UI_UX_Handoff/AURA_Cluster_Implementation_Target_2026-10-03.md?ref=56cfffc451071366d5157c86385a9033f622a03b' -H 'Accept: application/vnd.github.raw+json'
```

已讀 Cluster target：FL／FR／RL／RR 四個獨立胎壓、位置標籤與 bar 單位；缺值不可複製鄰輪。車固定中央，無左右搖擺／yaw／裝飾上下晃動；道路標線隨速度移動，0 速／暫停停止，尊重 reduced motion。Cluster 8:3 且唯讀，開發控制放 Console。RPM／Power 不可從車速推導實車資料；未選定車型或動力種類，靜態數值都是示例。原圖保留其他視覺權威，安全及高負荷政策保留。

遠端 AGENTS 另指向 `AURA_UI_UX_Handoff/AURA_Four_Display_Implementation_Target_2026-10-03.md` 與 `previews/four-display/index.html`，本次尚未讀。需要時唯讀核對；不要為取文件切分支或合併 PR。其規則保留原比例、角色同意與負荷政策；preview state 不替代 ActionGate，Window 示例未選定動力種類。

## 初次實作盤點結果（歷史快照，行號為盤點時）

此表記錄功能實作前的基礎與缺口；文末進度已更新部分項目，其餘仍按實際證據判定。

| 領域 | 已有基礎 | 缺口／證據限制 |
| --- | --- | --- |
| Runtime／Gateway | `core-runtime.ts:78,128,153,240`、`event-bus.ts:14,50,90` 有 reducer、sequence、去重與有界 replay；`hmi-gateway.ts:388,411,444` 有註冊、sender/session 驗證與 reconnect | 去重與 event history 是 process-memory，未證明重啟後不重複效果；完整 snapshot 尚无乘員私有任務欄位投影 |
| 任務資料 | `contracts/protocol/src/types.ts:126` ActiveTask 僅 running/interrupted/completed 等；`:151` Journey 僅 stops；proposal 使用 consentGranted boolean | 缺原目標、分類條件、task/方案版本、候選 TTL、版本／範圍／到期綁定授權、cancel/timeout/resume/retry、結果對帳 |
| 追問／推薦 | `journey-recommender.ts:84,173` 有来源/15分鐘 age／缺資料棄權；`hmi-gateway.ts:306` 自然語句入口 | 無追問與條件保存／去重流程；fixture 仍是餐廳，未支援上下車空間＋充電 |
| 時機／恢復 | `action-gate.ts:51` 有高負荷延後；`presentation-resolver.ts:28` 有資訊密度；runtime safety 可 abort 任務 | `core-runtime.ts:668` 釋放 deferred 沿用 consentGranted，缺候選 TTL／授權版本重驗；完整恢復非僅連線不清空 state |
| 持久化 | `main.ts:27` 已載入／寫入 Journey；`journey-persistence.ts:9,32` 保存 Place IDs | 不保存完整任務／pending proposal／授權／action ledger，重啟 stop/proposal ID 重新生成 |
| 安全 | ActionGate 禁止 generic WARN/urgent、Center journey consent、deterministic supervisor | clear 有 protocol/reducer 形狀（`reducer.ts:114`），缺 runtime clear producer；解除／第二警告替換需規格決定 |
| 五螢幕 | `App.tsx:326,357` 五視覺角色、同頁五 logical sockets；Gateway 發布 presence | 不是五個獨立呈現客戶端或實體裝置驗收，Rear／Window 多為靜態內容 |
| 語音 | browser AudioWorklet PCM／播放／stop；mock、Gemini、未提交 local Whisper mode | local RMS VAD 有實作，busy 時忽略 PCM，wake 未接；真實 mic→STT→意圖→播報→停止／插話／延遲未驗證 |
| 模型 | 可選 Ollama、deterministic fallback；已有 qwen3:4b 三 probe 歷史 smoke | 無訓練完 AURA 模型、正式 benchmark／目標裝置效能；Gemma2B simulator 名稱不代表模型推論 |
| Mapbox | `hmi-gateway.ts:224,265` search/route preview；Passenger 提案→Center | live provider 未驗證，無充電／上下車空間可信資料與完整導航；temporary-only provider 資料須保留現有權利限制 |
| 攝影機／停車 | synthetic perception、deterministic parking assessment；`core-runtime.ts:292` 強制 SHOW_GUIDANCE simulator-only | 無真實 camera、既有自動停車 capability／feasibility／start／interrupt／query／completion adapter |
| 離線／設備 | `main.ts:56` 可選 HTTP HEAD monitor；router、YAML replay | 模擬恢復不等於真實 provider/network recovery；Android／AAOS／AI Box／實體五屏未驗證 |

另外發現：Console speed/load 標示模擬，但 `core-runtime.ts:457,473` 将來源標為 sensor。第 1 階段記錄缺口，不偷偷修程式。

歷史證據：`docs/implementation/evidence/scenario-reliability-2026-10-03.json` 記錄 revision `ddde54ae…`、9 YAML × 3 = 27 runs／0 failed，只能證明 local simulation fresh-process reproducibility。`LOCAL_VOICE_ADAPTER.md:39` 有 whisper.cpp 1.9.4/base + macOS TTS 的生成音訊 smoke（首字辨識錯、132340 bytes output），不等於真實 microphone／speaker 或準確率量測。本次未執行任何測試／provider／畫面驗證。

## 初次交接的第 2 階段建議（歷史方案，已開始實作）

沿用 protocol → Runtime → reducer → EventBus → Gateway，先擴充一個可恢復主線任務及 action ledger，用確定性模擬 executor。第一個實作切片可先完成「保存原目標與分類條件、版本化方案／授權、取消後不恢復」，再按依賴補暫停／恢复、TTL 重驗、未知結果對帳及重啟防重。完整階段仍須滿足原方向文件要求；不要一次承諾所有介面／模型／攝影機／live 停車。

驗收包含：取消／拒絕／逾時後不復活；單條件修改保留其他條件且舊授權失效；過期或車況／能力改變先重驗；unknown 結果先查詢；重複／亂序／重連／重啟不重複完成；錯誤角色拒絕且 state 不變；安全警告不被普通流程延後；來源與時間誠實標示。

## 最新實作進度 — 2026-10-04

- **任務生命週期與 SQLite：** `ActiveTask` 現在可保存結構化目標、條件、步驟、暫停原因、版本與有界 action ledger；Runtime 支援 progress update、cancel、resume 和 action 結果對帳。取消後同一 ID 不可復活；重啟時 running 轉為 interrupted，不自動重試。恢復需要注入的 `revalidateTask` 證明候選、能力、授權與已知結果仍有效；Core Host 尚未接入可證明這些條件的真實資料源，因此 host resume 會 fail closed。SQLite task store 使用 7 日保留、欄位 allowlist 與同步持久化；不保存原始語句或 provider payload。
- **Action Gate 與停車 simulator：** deferred proposal 釋放不沿用先前 consent，需重新確認。新增 in-memory simulated parking adapter 與 Runtime coordinator，綁定 Center consent、任務／方案／能力版本及期限；未知結果在明確查詢結果對帳前阻止新動作／resume。這是合約與模擬執行器，沒有 live 車輛命令或實車驗證。
- **失敗回復與 action ledger：** 若 coordinator 恢復 parking action 後 task-store 寫入失敗，adapter 會回滾成 paused，保持可重試且與 ledger 一致；proposal 的 task 無法持久化建立時會轉為 rejected，不留在 executing。單一 `actionId` 不可由不同 idempotency key 再登記，避免 HMI 手動 simulator receipt 冒用 adapter action。
- **上下車與充電主線：** 模擬推薦來源及 scorer 支援上下車便利與附近充電 evidence；來源保持 `simulated`，缺資料保留未知。Web Simulator 對「媽媽下車＋附近充電」詢問入口接近／乘客下車空間是否影響排序，不推定年齡或身體需求。偏好只附於本次請求，尚非跨重啟的追問記憶。
- **協助時機：** `assistance-timing.ts` 依緊急度、價值、打斷成本、負荷、乘客授權與敏感度做確定性 defer/offer/suppress 分類；敏感內容只回傳延後分類，不攜帶內容。`apps/web-simulator` 有明確標示 simulator-only 的本地預覽面板；它不送 protocol command、不授權動作，也不將乘客授權輸入接到真實呈現路徑。Runtime/HMI 尚無可信的分類與 handoff 權限來源。
- **HMI 任務隱私：** Center 的 task snapshot 可見目標、條件、步驟、暫停原因與 action ledger；其他角色的快照、更新 fanout 與 replay 只見狀態摘要，interrupt/cancel reason 降為 `TASK_STATE_CHANGED`。測試涵蓋五角色、重播與重連快照。
- **訊號來源：** Developer/Simulator Console 的 vehicle telemetry 與 cognitive-load report 現由 Runtime 標為 `simulated`；真實感測資料必須由可信 adapter ingestion，不可經一般 HMI 命令自稱為 sensor。
- **語音與資料審查：** 保留既有 local Whisper adapter 與 voice routing／trace 改動；dataset review CLI 加入退出與抽樣雙人複審。唯讀 agent 審查確認 local mode 不在失敗時切換 cloud/mock；adapter 使用 `shell: false`、有 subprocess timeout 與輸出上限、在 cleanup 路徑移除暫存目錄。語音測試是 fake process／生成音訊的限定證據，未驗證實車艙麥克風與播放；資料人工內容／權利覆核仍待進行。
- **本輪驗證（2026-10-04 更新）：** 最終 `npm test` 通過 111 個 Node tests、3 個 Python tests 與 evaluation registry validation；根 TypeScript build 與 `apps/web-simulator` build 均通過。`npm run scenario:reliability -- --repetitions 3 --report /private/tmp/aura-v1-scenario-report.json` 通過 9 個 scenarios × 3 次 fresh-process replay（27 runs，0 failures）。這些是本地合約／模擬檢查，不是視覺驗收、真實來源、實體裝置或效果量測證據。
- **新增整合：** HMI Gateway 對 proposal live fanout、replay 與 snapshot 做 requester／target 角色投影；乘員接收提案仍需要 protocol 未提供的明確 handoff grant，Runtime/EventBus 內部也仍保存完整 proposal。Center-only task command 已接上生命週期 API，無 revalidation 證據時拒絕 resume。Web Simulator 新增 Center 任務控制與 action ledger 檢視。Scenario DSL 在同一 Runtime 中覆蓋 task start、safety interrupt、unknown reconciliation、模擬 revalidation resume 與 completion/idempotency；revalidation fixture 僅限 simulator。
- **多 agent 進度：** Orca Run `run_16a1c0a13049` 的 Antigravity 語音 adapter 審查已完成，報告位於本機 Gemini scratch path（未納入 repo）；另兩個 Antigravity 任務正在新增 simulation-only assistance timing 預覽與更新此實作稽核文件。完成後須檢視它們的 diff，並重新跑受影響 build／測試。

仍待具體證據或外部決定：host 可用的 fresh revalidation data source、runtime/HMI 端有權限的協助時機資料來源、跨重啟追問偏好、真實麥克風與播放中打斷、攝影機 observable cues、live 上下車／充電與地圖資料、既有自動停車系統能力及結果介面、真實斷網／provider 恢復、獨立呈現客戶端及 Android／AI Box／目標設備、正式 benchmark 與使用者比較。安全警告解除／替換語意仍需明確產品決定；資料內容／權利人工批准、使用者關聯資料保存與刪除政策，以及任何部署、對外發布或憑證變更，仍遵守各自批准界線。
