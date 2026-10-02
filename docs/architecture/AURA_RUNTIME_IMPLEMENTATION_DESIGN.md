# AURA Runtime Implementation Design

**狀態：** 目前實作對照文件；架構拓樸與介面章節仍包含目標設計
**依據：** `../product/AURA_MASTER_SPEC_2026-10-02.md`；第 61–64 節為準
**範圍：** runtime 模組、資料契約、共享狀態、政策、傳輸、provider adapter、開發順序
**排除：** HMI 畫面、版面、視覺樣式與 UI 程式碼

目前 repository 已包含 TypeScript core、WebSocket gateway、scenario simulator 與 web simulator。此文件同時記錄目標架構及已落地範圍；下方現況描述只涵蓋可由 repository 證實的實作，不代表完整五角色 HMI 或量產整合已完成。

HMI 視覺來源是使用者指定的 [Antigravity 五螢幕圖與交接規格](../../AURA_UI_UX_Handoff/CODEX_INSTRUCTIONS.md)；本底層設計不重定義或覆蓋其畫面。

## 目前落地範圍

- `apps/core-host/src/main.ts` 建立 `CoreRuntime`、載入 display registry，並啟動 `HmiGateway`；Gateway 透過 WebSocket 驗證註冊、command、snapshot 與 event。`apps/web-simulator/src/core/useAuraCommand.ts` 在同一瀏覽器頁面建立兩個註冊連線：`center-main` / `main-computer` 與 `front-passenger-main` / `main-computer`。這兩個 client identity 不等於五個獨立執行的 HMI client。
- `apps/web-simulator/src/App.tsx` 顯示五個 Section 64 角色視覺預覽及獨立的 Developer Control Console。Control Console 透過 Center 連線送出車速與認知負荷報告；共享車速更新 Cluster 預覽。Passenger 可送出以 Center 為目標、需同意的 `ADD_TRIP_STOP` proposal，Center 透過 consent command 批准或拒絕；兩端以 snapshots 和 proposal/status/consent/journey events 顯示共享狀態。`journey.stop.added` 事件更新 Center journey。Rear、Window 及路線/地點內容仍主要是本地或示意呈現，不代表五個畫面都已完成 live state sync。
- Control Console 可報告車速及 `low`、`normal`、`high`、`critical` 認知負荷；Core 將未觀測負荷表示為 `currentLoad` 缺席，confidence 為獨立 metadata。`packages/core-domain/src/action-gate.ts` 使 secondary proposal 在 high/critical 負荷時延後，負荷回到 normal/low 時重新評估。
- Scenario Runner（`adapters/simulator/src/cli.ts`、`scenario.ts`）使用相同 `CoreRuntime` signal/command intake，不是視覺 Control Console。
- Gateway 與 Core Runtime 已由 core host 接通；host 在 `main.ts` 建立 Voice Runtime 與 intelligence stack。Browser Center 使用 `AudioWorklet` 擷取並重採樣為 16 kHz、單聲道 signed 16-bit PCM，透過 `voice.start` / `voice.stop` 與二進位音訊 frame 連接 Gateway；UI 消費 voice status、transcript、error，並播放 Gateway 回傳的 provider PCM。host 預設使用 mock speech adapter，只有環境設定為 live 且提供 Gemini key 時才選 live Gemini adapter；此 browser 路徑不代表車載硬體音訊整合或已驗證延遲/品質。
- `Gemma2BOfflineSimulator` 只做確定性文字規則匹配，不執行本機模型推論。Places、routing、weather、SQLite journey adapters 有實作，但 `createExternalAdapterStack()` 目前未由 host 啟動流程呼叫；不可描述成已接入完整 provider stack。Camera/perception 與 offline/cloud continuity 也不是目前證實已整合的 runtime 能力。

## 1. 設計目標

- 一個權威 AURA runtime 協調所有邏輯顯示器。
- Domain 規則不依賴顯示框架或裝置版面。
- Command 請求變更；Event 記錄已發生的事實。
- AI 只能提出結構化建議；確定性政策與同意流程決定是否執行。
- 模擬、即時、衍生與快取資料共用 signal 契約，並保留來源差異。
- 網路中斷時降低能力但保留任務與旅程；恢復後不重複已執行的效果。
- 真正會變動的外部或平台依賴才設 interface 與 adapter。
- Scenario replay 使用和正式 runtime 相同的 command、signal、policy 與 state 路徑。

## 2. Runtime 拓樸提案

    Five HMI clients
          ⇅ versioned JSON / WebSocket
    HMI Gateway ── Core Runtime ── Context Engine
                         │                │
                         │         Intelligence Router
                         │          ┌─────┴─────┐
                         │       Local AI    Cloud AI
                         │
              Action Gate + Safety Supervisor
                         │
                   Action Engine
                         │
             Shared State + Event Bus
                         │
         Experience Orchestrator + Display Registry
                         │
                   HMI Gateway

另外，Vehicle Simulator、Scenario Replay 與 Voice Runtime 將訊號送入 Core Runtime；Continuity Engine 管理離線準備、快取與恢復。

### 部署提案

- 在主電腦執行一個 TypeScript / Node.js core process。它是共享狀態、政策決策、任務生命週期、事件序號與 HMI Gateway 的唯一權威。
- Core 不依賴 React 或 Android。未來的 Web 參考 HMI 或 Kotlin / Jetpack Compose HMI 都是 client，透過角色投影讀取狀態。
- Gateway 是唯一網路入口。顯示器彼此不呼叫；HMI 也不直接連外部 Places、Weather 或模型 provider。
- Display Registry 由設定檔驅動。初始設定描述兩個實體裝置上的五個邏輯角色；runtime 不寫死顯示器數量。
- 初始登錄至少包含 `cluster`、`center`、`front_passenger`、`rear`、`interactive_window` 五個角色，並以 `deviceId` 將其映射到主電腦或 tablet。新增或移除角色只改設定與能力描述，不改 Core Runtime 的分支邏輯。
- Local inference 透過可設定的 Ollama adapter。模型名稱、端點與推論參數不得寫進 domain 規則。
- TypeScript / Node.js 已是目前 core host/runtime 的實作選擇；此處拓樸其餘內容仍是目標架構，不應視為所有模組均已接通。

## 3. 模組與介面

以下模組都位於 Master Spec 已凍結的 Context → Policy / Action → Shared State / Event → Experience 架構內，不新增產品子系統。

| 模組 | 職責與深度 | 主要介面／seam |
|---|---|---|
| Core Runtime | 隱藏驗證、政策、提交與發布順序；負責一個 command 的完整生命週期。 | `dispatch(command)`、`ingest(signal)`、`snapshot(displayId?)`、`subscribe(afterSequence?)` |
| Context Engine | 驗證 signal、保留來源與 freshness，產生版本化 ContextSnapshot；不診斷人的心理狀態。 | 接收 `ContextSignal`，輸出唯讀 `ContextSnapshot`。 |
| Task Runtime + Intelligence Router | 管理非同步任務、選擇 local/cloud、取消過期工作，將輸出轉成 typed proposal。 | `start(task, context, abortSignal)`，回傳任務狀態及驗證過的 `ActionProposal`。 |
| Action Gate / Policy | 以確定性規則套用優先級、角色、同意、風險、負荷與資料 freshness。 | `evaluate(proposal, currentContext) -> PolicyDecision` |
| Safety Supervisor | 在不等待 LLM 的情況下，處理模擬器／感測器的關鍵優先事件。 | `evaluateCritical(signal, currentContext) -> SafetyDecision` |
| Action Engine | 只執行 allowlist 中且已通過政策的 domain effect；以 effect id 做冪等保護。V1 不控制方向盤、煞車或加速。 | `execute(approvedAction) -> DomainEvents` |
| Shared State + Event Bus | 依序提交有效狀態轉移、增加 state revision、發布不可變事件；是共享 domain state 的唯一寫入者。 | 內部交易介面；透過 Core Runtime 對外提供 snapshot 與 event。 |
| Experience Orchestrator + Display Registry | 依事件類型、優先級、顯示角色決定狀態投影或交接對象，不管理螢幕版面。 | `targetsFor(event, registry)`、`project(snapshot, role)` |
| Continuity Engine | 管理 Predict → Prepare → Continue → Recover、快取 freshness、本機 fallback 與重連協調。 | `onConnectivity(signal)`、`prepare(taskContext)`、`recover(snapshotRevision)` |
| HMI Gateway | 驗證註冊裝置與 wire protocol、去重 commands、傳送 snapshots/events、偵測序號缺口。 | 下節定義的版本化 WebSocket 協定。 |

### Adapter seams

- **Reasoning：** 目標是讓本機與雲端 reasoning adapter 共用 proposal-only 介面。目前 host 的 local implementation 是 `Gemma2BOfflineSimulator` 確定性規則模擬，並非 Ollama 或其他 local model inference；雲端 reasoning/provider 路徑不可由 adapter 類別存在推定為完整接線。
- **Journey data：** fixture adapter 與選定的即時 Places／routing provider 共用資料契約。即時 provider 留待確認授權與競賽需求後選擇。
- **Vehicle signals：** `ScenarioVehicleAdapter` 與 simulator 使用同一 signal 契約；未來的實車 adapter 必須映射到該契約，且不屬於 Competition V1。
- **Persistence：** Scenario Runner 與 Core Runtime 使用 process-memory state；SQLite journey store 已有 adapter 實作，但 external adapter stack 尚未由 host 啟動流程呼叫。保存期限與存取規則仍待決定。
- **Speech：** Voice Runtime 與 mock/Gemini streaming adapters 已存在，core host 會建立 intelligence/voice stack；預設 mock，只有環境設定為 live 且提供 Gemini key 才選 live adapter。Browser Center 麥克風使用 AudioWorklet 和 Gateway PCM 傳輸；這不等於已完成車載麥克風、wake/VAD、車載 audio I/O 整合或延遲驗收。
- **HMI transport：** in-process caller 與 WebSocket Gateway 共用 Core Runtime 介面。網路 transport 不兼任內部 event bus。

確定性政策若沒有真正替代實作，不額外抽成可替換介面。深度應留在模組介面後方，不為每個內部 helper 增設 seam。

Core Runtime 對 Gateway 提供單一 typed interface：

```ts
interface CoreRuntimePort {
  dispatch(command: ValidatedCommand): Promise<CommandReceipt>;
  ingest(signal: ContextSignalInput<unknown>): Promise<IngestReceipt>;
  snapshot(displayId?: DisplayId): Promise<StateSnapshot>;
  subscribe(displayId: DisplayId, afterSequence?: number): AsyncIterable<RuntimeMessage>;
}

interface CommandReceipt {
  commandId: string;
  traceId: string;
  status: "RECEIVED" | "REJECTED";
  stateRevision: number;
  taskId?: string;
  reasonCode?: string;
}
```

`RECEIVED` 僅表示 command 已通過輸入驗證並被 runtime 接收；`REJECTED` 僅用於驗證或授權階段拒收。後續 policy 的 `REJECT`、同意、延後或執行，透過後續狀態與事件表達。相同 `messageId` 重送時回傳第一次的 receipt，不重做 effect。

## 4. Shared State 與資料契約

### State ownership

Core Runtime 是共享狀態唯一寫入者。共享狀態只保存跨角色需要的 domain truth：

- vehicle 與 connectivity snapshots；
- active journey、停靠點、目的地限制及路線 freshness；
- active AURA task 與 task status；
- pending actions 與 consent 狀態；
- parking context 與 active guidance 狀態；
- assistance level 及附有 confidence 的 context signals；
- 邏輯顯示器登錄資料與連線狀態。

選取分頁、展開卡片、捲動位置與本地地圖 viewport 等純顯示狀態留在 HMI client。除非操作改變 domain truth，否則不得寫入共享狀態。

### Commands 與 events

- **Command** 是未信任的請求，例如 `ProposeJourneyStop`、`ApprovePendingAction`、`DeclinePendingAction`、`RequestParkingAssistance`、`GrantParkingConsent`、`DeclineParkingConsent`、`StopSpeech`、`CancelTask`。
- **Event** 是驗證或執行後的不可變事實，例如 `journey.stop.proposed`、`action.routed`、`action.deferred`、`journey.stop.added`、`parking.guidance.started`、`assistant.speech.stopped`、`connectivity.mode.changed`。
- Provider 或模型輸出不是 command，也不是 domain event；它們先成為 typed proposal，再經過 policy。
- 純本地 HMI 操作不發布系統事件。

### Context signal

每個 signal 帶有來源與時間。Core Runtime 依時間戳與 expiry 規則推導 freshness，不單憑傳入的 freshness 標記判斷資料有效性。

```ts
type SignalSource = "sensor" | "simulated" | "api" | "derived" | "cache";
type Freshness = "fresh" | "cached" | "stale" | "unknown";

interface ContextSignalInput<T> {
  signalId: string;
  type: string;
  value: T;
  source: SignalSource;
  sourceId?: string;
  observedAt: string;  // ISO-8601 UTC
  confidence?: number; // 正規化為 [0, 1]
  expiresAt?: string;
}

interface ContextSignal<T> extends ContextSignalInput<T> {
  receivedAt: string;  // Core Runtime 指派
  freshness: Freshness; // Core Runtime 依時間與 expiry 推導
}
```

Competition V1 車輛 simulator 訊號固定標成 `source: "simulated"`。Camera/audio 推導的行為線索只能做為附有 confidence 與 expiry 的輔助訊號，不可作為診斷。

### 版本化 wire envelope

以 JSON Schema 作為 runtime wire contract，在映射到 domain types 前先驗證。TypeScript type 本身無法驗證網路輸入。下方 `WireEnvelope` 是目標設計的概念示意；目前 protocol v1 的實際 client command 是外層 `{ kind: "command", envelope: CommandEnvelope }`，註冊則是獨立的 `register` message。Web Simulator 依 `contracts/protocol/schemas/protocol.schema.json` 的實際形狀傳送。

```ts
interface WireEnvelope<T> {
  protocolVersion: 1;
  messageId: string;
  traceId: string;
  sessionId: string;
  sentAt: string;
  sender: { deviceId: string; displayId?: string };
  kind: "command" | "ack" | "event" | "snapshot" | "error" | "resync";
  sequence?: number; // event/snapshot 由 Core Runtime 指派
  payload: T;
}
```

協定不變條件：

1. Core Runtime 在同一 session 內單調增加 event sequence。
2. Command `messageId` 冪等；重送回傳原 receipt，不得重複執行 effect。
3. Client 登錄時收到 snapshot 與當前 sequence。重連或發現缺號時，先重新取得 snapshot，再套用後續事件。
4. WebSocket 順序只保證單一連線；跨重連以 sequence number 為準。
5. `ack` 表示收到並分類 command，不代表已同意或執行。
6. 未知協定版本、command type、role、無效欄位或過期 consent token 都回傳 typed error。
7. Client 不可送出 `journey.stop.added` 這類狀態變更事件；domain facts 只能由 Core Runtime 發布。

Network path 採雙向 WebSocket，處理裝置登錄、commands、acks、events、snapshots 與取消。內部 event dispatch 維持 in-process。少量 health/configuration 讀取可用 HTTP；沒有量測需求前不增加第二種 command transport。

## 5. Policy、Consent 與 effects

生成式輸出是 `ActionProposal`，永遠不是可直接執行的 effect。Proposal schema 使用 discriminated union、allowlisted action types 與受限欄位；無效或未知輸出 fail closed。

```ts
type PolicyOutcome = "EXECUTE" | "ASK" | "ROUTE" | "DEFER" | "REJECT";

interface PolicyDecision {
  outcome: PolicyOutcome;
  proposalId: string;
  reasonCode: string;
  targetDisplayId?: string;
  consentRequired: boolean;
  deferUntil?: string;
  expiresAt?: string;
  policyVersion: string;
}
```

PACT outcomes 在實作中的含義：

- `EXECUTE`：政策檢查後套用 allowlist 中可逆的 domain effect；不包含車輛控制。
- `ASK`：執行前向目前使用者徵求同意；保存 pending proposal 與 expiry。
- `ROUTE`：把 proposal 交給負責角色審核，例如 Rear → Center；交接本身不代表同意。
- `DEFER`：保留非關鍵 proposal，附上 expiry 與釋放條件，例如高負荷操作結束。過期時丟棄並發布原因事件。
- `REJECT`：拒絕執行，記錄 reason code；適當時提供簡短說明。

收到同意時，Core Runtime 以**最新 context**重新評估 policy，不能沿用慢速模型請求啟動時的舊快照。Pending action 保存 id、來源角色、proposal、policy decision、建立時間、expiry 與核准角色。

關鍵警告走本機確定性路徑：critical signal → Safety Supervisor → priority decision/event → Experience Orchestrator，不等待雲端推理，也不排在一般對話後面。專用 stop command 立即取消目前 TTS 與可取消任務，並用 task id、trace id 關聯取消結果。

## 6. Task、Voice 與 Intelligence lifecycle

### Task lifecycle

以明確狀態機代替互相矛盾的 boolean：

```text
ACCEPTED → CLASSIFIED → RUNNING_LOCAL | RUNNING_CLOUD
         → PROPOSAL_READY → POLICY_PENDING
         → AWAITING_CONSENT | ROUTED | DEFERRED | EXECUTING
         → COMPLETED | FAILED | CANCELLED | EXPIRED
```

不是每個 task 都走過所有狀態。合法轉移集中在一個 reducer；取消後才回來的 provider 結果不得重啟 task。

### Voice lifecycle

```text
IDLE → LISTENING → TRANSCRIBING → THINKING → SPEAKING → IDLE
          ↑             │            │           │
          └─────────────┴────────────┴── STOP / BARGE-IN
```

Wake detection、VAD、ASR、TTS、audio ducking 與裝置 audio I/O 都由 Voice Runtime 後方的 adapters 提供。Voice Runtime 擁有生命週期、confidence gate、取消，以及使用者開始說話時停止或讓出目前語音的規則。具體語音引擎、硬體音訊調校與延遲目標仍待決定。

目前 Web Simulator 頁首的 Center voice control 是使用者觸發的 browser microphone flow：AudioWorklet 輸出 16 kHz mono PCM，Gateway 轉送語音狀態、transcript、error 與 provider audio，browser 播放回傳 PCM。這不實作 wake-word detection 或 camera/perception，也不證明預設 mock 模式下具備雲端連線或離線語音連續性。

### Intelligence routing

- 確定性安全邏輯與簡單 typed cabin command 使用本機程式，不呼叫 LLM。
- Local reasoning 處理支援的 intent、車內 context 與離線延續。
- Cloud reasoning 在連線時增強複雜規劃與即時資料整合。
- Router 傳送最小化的 typed task context 與 abort signal。
- Adapter 回傳 schema 驗證過的 proposal 及可選回覆文字；不得發布 domain events、寫共享狀態、任意呼叫工具或指定顯示器。
- Trace 記錄 route、model/provider id、延遲、fallback 原因與 schema 結果；敏感內容需遮蔽。

## 7. Continuity 與 persistence

Connectivity 依 Master Spec 的狀態運作：`CONNECTED → PREPARING_OFFLINE → OFFLINE_CONTINUITY → CLOUD_RECOVERY → CONNECTED`。

- 外部資料保存 provenance、觀測／接收時間、expiry 與 freshness。
- 預備快取只抓目前 task 需要的路線摘要、旅程限制、相關 POI、天氣快照、任務摘要，以及使用者選擇的本機知識。
- Offline 時保留本機 voice/commands、active task、確定性 policy，以及可取得的 cached journey context。沒有即時資料時明確呈現不可用，不得捏造。
- 恢復時依 command id 與 state revision 協調、更新過期資料，僅恢復冪等工作；不得重設旅程或重播已執行效果。
- 僅保存延續任務與使用者同意的偏好所需資料。預設不保存原始麥克風音訊或 camera frame。
- SQLite 是首個 durable adapter 的提案。保存期限、刪除控制、加密與存取權限必須在保存使用者關聯資料前決定。

## 8. Observability 與 scenario 執行

每個 command 與重要狀態轉移攜帶 `traceId`、`sessionId`，適用時再帶 `taskId`、`proposalId`、`commandId`、state revision 與 event sequence。結構化記錄至少包括：

- 正規化輸入的來源與 freshness；
- local/cloud 路由及 provider/model version；
- policy outcome、reason code、consent 與 safety override；
- state revision 與目標 display roles；
- duration、cancellation、timeout、retry、fallback 與 reconnect 原因。

遮蔽原始音訊、完整影像、憑證與非必要個資。診斷資料不呈現在五個 HMI 角色中。

Scenario YAML 定義初始狀態、依序輸入、預期 policy outcome、domain events、目標角色與 metrics。Replay adapter 使用和 live source 相同的 `ContextSignal` 與 command 介面；不可用螢幕動畫或直接寫入預期結果來假裝系統執行。

## 9. Repository 現況

以下是目前實際存在的主要目錄；它們不表示每個 adapter 都已接入 host 執行流程。

```text
contracts/
  protocol/             # JSON Schema: commands, events, snapshots, errors
  scenarios/            # 共用 scenario schema
packages/
  core-domain/           # state、value types、reducers、policy decisions
  core-runtime/          # Core Runtime 與內部協調
adapters/                # maps、weather、persistence、simulator、voice、local
apps/
  core-host/             # process entry、設定、HMI Gateway、intelligence
  web-simulator/         # 五角色視覺預覽、Center/Passenger Gateway clients、Control Console 與 Center browser voice
scenarios/               # cognitive-load-deferral、safety-override
```

Core host 與 web simulator 已存在。Simulator 保有五個 Section 64 視覺角色，但只有 Center 與 Front Passenger 以兩個 gateway registrations 連線；Cluster 的共享車速及 Center/Passenger 的 proposal-consent-journey 路徑已接到 command/event/state 流程。其餘角色仍非獨立註冊 client，且 Rear/Window state 與多數示意路線/地點資料未整合成即時共享狀態。

## 10. 實作順序與 review gate

實作進度（此處只記錄 repository 可見的範圍）：

1. **Contracts 與 configuration：** TypeScript contracts、JSON Schema、display registry 已存在；driver load 使用 low/normal/high/critical，未觀測值由 `currentLoad` 缺席表示。
2. **Core、Event Bus、Gateway：** Core Runtime、event bus 與 WebSocket HMI Gateway 已由 `apps/core-host/src/main.ts` 接通，registry 含五個邏輯角色。Web simulator 在同頁註冊 `center-main` 與 `front-passenger-main` 兩個 client identities。
3. **Simulator：** Scenario Runner 可透過相同 Core Runtime 接收 signals/commands；Web simulator Control Console 可經 Gateway 更新車速與認知負荷，Cluster 讀取共享車速。
4. **Action / consent / safety：** proposal gate、target-role consent、defer/release 及 deterministic safety supervisor 有後端邏輯；Passenger 的 Center-targeted stop proposal、Center approve/decline、共享狀態與 journey-stop 顯示已接線。其他角色的提案/確認 UI 及完整安全事件呈現仍未全數接入。
5. **Adapters：** voice/intelligence stack 在 host 啟動時建立；places、routing、weather、SQLite journey adapters 雖已實作，外部 adapter stack 尚未由 host 啟動流程連接。

此文件描述架構與進度，沒有新增或執行測試的記錄。

## 11. 尚待決定

這些決策不阻擋架構設計，但應在對應模組落碼前完成：

1. 確認 live Places/routing/weather provider 的啟用條件、授權、錯誤處理與資料 freshness；目前 adapters 尚未接入 core host 啟動流程。
2. 在目標主電腦量測後，確認 local/cloud model 與語音延遲目標；目前 voice/intelligence stack 有 host wiring，但不能據此推定完成車載音訊部署。
3. 完成 Gateway 裝置登錄／配對與可信網路假設；目前可由 registry 註冊，未見 production pairing/authentication。
4. 儲存使用者關聯資料前，核定 SQLite journey storage 的保存期限、加密、存取與刪除規則。
5. 將 Rear/Window 與其他尚未整合的角色操作接入所需共享流程，並建立多角色 state sync 與延遲驗收基準；目前已接線的範圍限於 Center/Passenger proposal-consent-journey 路徑。
