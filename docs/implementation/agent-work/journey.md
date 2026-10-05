# 行程流程 Headless Gateway 驗收

Issue：[AURA #5](https://github.com/yinglinlin010/AURA_Project/issues/5)。
審查基準：`codex/aura-v1-integration`，GitHub／本地 HEAD
`f5b6d211a7d2a53cd33924e06a5a775f80332251`；不是 main。
權威產品規格：Master Spec §61.16、§61.31。
UI 沿用使用者確認的目前工作區版本；本切片不修改 UI 或重新定義畫面比例。

## 變更與執行

本切片只新增兩個檔案：

- `scripts/check-journey-flow.mjs`：獨立 Gateway 行程合約驗收。
- `docs/implementation/agent-work/journey.md`：本文件。

從 repository 執行：

```sh
node scripts/check-journey-flow.mjs
# 選擇一個尚不存在、位於工作區外的輸出路徑：
node scripts/check-journey-flow.mjs --report /tmp/aura-journey-flow.json
```

需要已安裝 Node >=20 與根目錄 npm dependencies（TypeScript、ws 等）。
腳本不安裝套件、不需要 provider 憑證，不連線既有 Core Host。
使用 OS 暫存目錄生成 isolated tsconfig、ESM package metadata 與 node_modules
連結，只編譯 Gateway／fixture 及其相依來源；不寫共用 `dist`、`dist-test`、
UI build 輸出或 package scripts。
每個案例建立獨立 Runtime 和 `127.0.0.1`／port 0 Gateway，註冊
Center、Front Passenger、Rear 三個 WebSocket 客戶端。
提案、負荷回報、同意及推薦都走 protocol 入口，沒有直接注入 Runtime 提案。
完成或失敗都關閉自建 socket／Gateway 並刪除本次自建暫存編譯目錄。

stdout 是 JSON 摘要，記錄模擬範圍、起訖時間、每個案例結果與失敗堆疊；
不輸出憑證或真實使用者資料。
全部通過 exit 0，編譯、斷言、逾時或報告寫入失敗 exit 非零；
錯誤參數 exit 2。
`--report` 限工作區外，使用 exclusive create，不覆寫已有報告。
編譯 timeout 60 秒、socket 開啟及訊息等待 timeout 各 3 秒。

## 驗收條件與既有證據

| 腳本案例 | 斷言 |
| --- | --- |
| Passenger route preview | `SHOW_INFORMATION` 經 Passenger 提案、Center approve 完成／decline 拒絕，兩者均不新增 stop |
| Rear stop／Center 權限 | `ADD_TRIP_STOP` 經 Rear 提案；Passenger／Rear approve 和 decline 被拒絕且 shared state 不變；Center approve 新增一次，同 command ID 重送為 replay；另一提案 decline 不變更 stops |
| HIGH 負荷 | 提案 deferred；LOW 釋放但 stops 不變；再次 HIGH 後 approve 仍 deferred、舊同意失效；NORMAL 後重新 approve 才新增 stop |
| 未知負荷 | 無初始負荷時 deferred、reason 為 `DRIVER_LOAD_UNAVAILABLE`；後續釋放、舊同意失效及重新 approve 與 HIGH 案例一致 |
| 主線有用追問 | 平衡候選 fixture 讓偏好影響排序，Gateway 回 `clarification_required`；age／disability／mobilityNeed／dropoffPreference 保持 unknown，沒有 proposal 或 state mutation；明確偏好後才回 proposal，提交後 decline 不新增 stop |
| 主線現有 fixture | 原有 fixture 加明確偏好，推薦證據 simulated／fresh／帶時間戳且要求 Center consent；乘客／Rear 推薦請求被拒絕；Center 推薦不自行變更 state，提案提交去重後 approve 新增推薦的一站 |
| 缺來源 | 沒有 evidence source 時回 `WHOLE_JOURNEY_EVIDENCE_SOURCE_UNAVAILABLE`，shared state 不變 |

成功、拒絕和負荷案例亦透過三角色 resync snapshot 比對 shared Journey stops。
`exactly once` 的證據限定本次 Runtime 生命期、同 command ID 重送；不宣稱跨重啟去重。

既有來源佐證：

- `apps/core-host/test/hmi-gateway-center-consent.test.ts`：角色綁定、Center 同意、拒絕與去重；其既有提案以 Runtime 直接注入。
- `apps/core-host/test/hmi-gateway-journey-recommendation.test.ts`：棄權、角色拒絕、推薦不直接修改行程、拒絕與去重。
- `packages/core-runtime/test/action-gate-load.test.ts`：負荷延後、釋放和舊同意失效。
- `packages/core-runtime/test/journey-recommender.test.ts`：主線上下車／充電來源、偏好、有用追問與 unknown facts。
- 本地 `apps/web-simulator/src/App.tsx`：Passenger 是 route preview，Rear 是 simulated stop；本次僅閱讀、不修改。

## 模擬來源與限制

所有輸入都是本地 fixture，沒有 Mapbox／充電／POI／停車 API 請求。
**Passenger route-preview wire fixture 的 `source: api`、Mapbox provider 名称，是
既有 Runtime 合約強制的測試欄位值，不是實際 provider 證據。**
summary、place label、attribution 與 JSON 報告均明確標記 SIMULATED；
`https://example.invalid/simulated-fixture` 只作 attribution 字串，不被請求。
不能把此案例描述成真實 provider 驗證，也不修改 Runtime 合約以接受新的來源值。

主線追問案例使用從現有 fixture 取得的 trip／identity，另建兩個分數平衡的模擬候選，
刻意讓下車偏好改變排序；其中 nearbyCharging 空陣列只是已知無附近充電的測試輸入。
該案例證明 Gateway 追問分支，不宣稱是未修改 fixture 的自然結果。
另外獨立案例使用未修改的 `SimulatedJourneyRecommendationEvidenceSource` 驗證主線
明確偏好後的提案、來源與 Center commit。
fixture 更新時間戳只是測試資料刷新，不是 provider freshness refresh。

此驗收不涵蓋：UI 點擊、文字／圖像／視覺驗收、瀏覽器 WebSocket hook、
真實 API／充電可用性、硬體車輛、自動停車效果、三台實體螢幕、語音、
跨重啟持久化／恢復、TTL 到期或網路復原。
沒有決定或測試安全警告解除／替換語意。
本切片不修改 Runtime、UI、package scripts 或既有測試；
若後续验收揭露產品缺陷，回報協調者另行批准修復。

## 本次實際結果

2026-10-04 執行：

```sh
node scripts/check-journey-flow.mjs --report /tmp/aura-journey-flow-dispatch-bc5f8eb7-r3.json
```

exit 0，7 個案例全部通過；報告起訖 UTC
`2026-10-04T12:19:45.638Z` 至 `2026-10-04T12:19:47.289Z`。
此命令實際完成獨立 TypeScript 編譯和自建 Gateway 驗收。
初期兩輪腳本開發檢查失敗分別來自 register 多送未允許欄位、
route-preview fixture 不符合既有 Mapbox 合約；已只修正本腳本，未修改產品程式。
沒有執行全量 npm test、共用建置或 UI／視覺驗收；既有交接中的測試結果不算本輪實測。
