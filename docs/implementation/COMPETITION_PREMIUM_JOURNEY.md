# Premium Journey 實作與差距報告 — 2026-10-05

依據根目錄 `AURA_PACT_FILM_PRODUCTION_MASTER.md` 的競賽故事，沿用 AURA CoreRuntime、Action Gate、Consent Manager、Shared State/Event Bus、HmiGateway 和現有 Scenario Runner。既有 AURA／PACT／Android 入口與原有未提交修改保留。

## 本地執行

兩個 terminal，cwd 為專案根目錄：

```sh
npm run start:competition
```

```sh
VITE_AURA_WS_PORT=8081 npm run dev --prefix apps/web-simulator -- --host 127.0.0.1 --port 5178
```

開啟 `http://127.0.0.1:5178/?demo=premium-journey`。競賽 host 綁定 loopback 8081，不載入 SQLite、外部 provider 或語音服務。原 host 的 8080 不受影響。Reset 指令只有明確啟用且沒有 Journey/Task persistence 的 runtime 接受，且只允許 Center；不清除正常 host 的持久化資料。

操作：RESET → Smart Window ADD TO JOURNEY（或 Director JOURNEY REQUEST）→ LOAD NORMAL → Center ACCEPT → CLOUD OFFLINE → Rear QUIET MODE → CLOUD RESTORE → Rear RESUME。

RESET 設定模擬 high load、online、40 km/h。Window 提案經 window-tablet，Director 的 Rear VIP 提案經 rear-tablet；兩者都只能提出需要 Center consent 的共享行程變更。KEEP ROUTE 不更新 Journey，Window 顯示拒絕結果且可以再次提出。切換表面按鈕可錄製單屏，收起 Demo Director 可隱藏工程資訊。

## 需求對照

| 項目 | 原有基礎／本次結果 |
| --- | --- |
| P0 reuse | 延用既有架構；未另建決策引擎。 |
| P1 scenario | 新增 `scenarios/competition-premium-journey.yaml`，使用現有 schema，時間點對應影片。 |
| P2 shared state | 原有 journey、proposal、driver、connectivity，加上 `rearExperience` 的 mode／liveJourney／source／決策 trace；不另建 state store。Rear VIP 是此 fixture 的乘員設定，不代表真實 occupant sensing。 |
| P3/P4 decisions | premium-journey 提案在 HIGH 時 DEFER，NORMAL 時 ASK，Center approve 後 EXECUTE。其他既有流程保留 ROUTE 語意。請求保存於 activeProposals，沒有計時自動批准。 |
| P5 consent | Center ACCEPT／KEEP ROUTE；Rear/Window 不取得駕駛 authority。 |
| P6 capability | 模擬雲端 Live Journey Intelligence 在非 online 時 unavailable；本地權限、策略、負荷、行程及 Rear mode 操作繼續。fixture arrival/status 不是實際 live traffic provider。 |
| P7/P8 Quiet | Rear-only mode command、本地 EXECUTE；Rear/Window 減量、700 ms 淡化；reconnect 保留 quiet 並 available_but_held；Rear Resume 後 presented。 |
| P9 displays | 新競賽呈現入口依角色顯示；Passenger 維持被動。這是功能與錄影基礎 UI，尚非正式五屏 Hero HMI／實體裝置驗收。 |
| P10 observatory | 工程區呈現目前決策、resource/authority、load/connectivity、reason/trace。policy decision 保存至 proposal snapshot；Rear decision 帶 timestamp/trace，選取較新決策。這是結構化狀態，不是 chain-of-thought。 |
| P11 director | RESET、JOURNEY REQUEST、LOAD HIGH/NORMAL、DRIVER ACCEPT、CLOUD OFFLINE、QUIET MODE、CLOUD RESTORE、RESUME。可手動重複；尚未加可選 AUTO PLAY。 |

## 驗證證據

- `npm test` 通過：175 個 Node tests、14 個 Python tests、evaluation registry/schema hash validation。
- `premium-journey.test.ts` 在同一 runtime 重設並重播完整 scenario 三次，逐一驗證 domain event 與 shared state 的正式 schema；每次確認 reconnect 仍 quiet + available_but_held、Journey 只有一站，Resume 後 presented。
- 本地 Backend build、Web production build 通過。
- 現有五個獨立 Node process client harness 通過（13 transport tests、五角色 reconnect）；不是五個實體裝置。
- Chrome 最終八步流程確認 RESET、Window DEFER、NORMAL ASK、Center ACCEPT、offline unavailable、Quiet local EXECUTE、restore held、Resume presented。全部經真實 local Gateway，不使用 UI 計時模擬決策。
- 桌面／390×844 手機 viewport 做過畫面檢查；手機 document clientWidth/scrollWidth 均為 390；viewport override 已恢復。
- Impeccable source review 找到並修正 Quiet fade、Window 來源、拒絕後重試及 X-Ray 決策選取問題；reviewer 的獨立瀏覽器綁定不可用，因此視覺檢查由主執行者完成。
- [Scenario evidence](evidence/competition-premium-journey-2026-10-05.json)；完整測試紀錄在 `artifacts/premium-journey/tests.log`（本地 artifact）。

介面延續現有 matte charcoal #1c1c1e／slate #2c2c2e／bone text #f2f2f2／sand #e5dacc／orange focus #ff5a00；44 px controls、方形 panel、desktop 五角色 grid、手機堆疊及 reduced-motion。未修改原 HMI 視覺權威或重寫 DESIGN 系統。

## 尚待影片製作

Luxury Cabin master、正式 Hero HMI 的構圖整合、各鏡頭 screen recordings、旁白、音樂、字幕、DaVinci project/compositing/export 尚未產出。這份交付證明 fixture 下的決策與呈現流程，不代表 72 秒影片已完成。

Cloud outage/recovery、車速／driver load、Donghu 與 ETA 為模擬。未驗證真實雲端服務、實車感知、硬體座艙控制、五個獨立實體 displays 或 Android 新競賽入口。沒有 production 部署、發布、提交或推送。
