# Premium Journey 功能完善與繁體中文介面

2026-10-05；目前版本 `AURA-functional-zhTW-06bf6d69a1cf`。

本輪依 `AURA_PACT_FILM_PRODUCTION_MASTER.md` 的競賽功能要求，先完善功能，**沒有錄製新影片**。r1 診斷與 r2 英文錄影保留為歷史交付，不代表目前中文介面的新錄影。

## 本輪完成

- 五個既有 Production HMI、獨立 Scenario Control、Developer Inspector、任務與介入時機工具的主要文案及可及性名稱改為繁體中文。東湖、同意、下一站、離線、靜謐與恢復資訊均為中文。品牌、標準單位、FL/FR/RL/RR、協定識別碼及 trace/reason code 保持原值。
- Scenario YAML 修正為 HIGH（9000ms）先於 Donghu request（10000ms）；首次決策為 DEFER，之後 NORMAL → ASK → explicit ACCEPT。YAML 使用原 Scenario Runner schema，與已批准的 r2 播放順序一致。
- 獨立控制頁與 Developer Inspector 共用 Core 決策觀測，顯示來源角色、意圖、資源、決定權、目前負荷、連線、決策、目標、原因碼、trace ID 與決策時間。Journey 決策來自實際 proposal.lastDecision；Rear 決策來自實際 rear.experience.changed payload。沒有決策證據時不捏造結果，不呈現 chain-of-thought。
- 手動提案按鈕改為尊重 Rear/Window 來源選單。RESET 清除本輪控制頁 trace；Window 沿用既有 point revision 重掛載機制清除局部選取狀態。
- r2 的 playback 執行順序、PACT 規則、CoreRuntime、Gateway、presentation resolver、全部 CSS 及指定影像資產雜湊保持不變。

## MASTER 功能核對

P0/P2/P3 沿用既有核心、角色/共享狀態、authority、deferred proposal 與 decision event；不另建架構。P1/P4 的 YAML 與延期釋放已對齊並加強實際事件驗證。P5 駕駛接受/維持路線及重新提案通過；行程只在接受後更新。P6 雲端 capability 與本地操作界線保留。P7/P8 靜謐、離線、本地執行、恢復後 HELD、主動 RESUME 通過。P9 五屏保持角色分工與原版面，Passenger 未新增故事功能。P10 決策觀測已接入正式獨立控制頁。P11 手動控制、RESET、來源選擇與 AUTO PLAY 保留並驗證。

這是競賽功能的 fixture/simulator 驗收，不是完整量產產品或實車驗收。ROOT MASTER §16 的舊「主要英文 UI」要求已依使用者新指示改為繁體中文；故事及技術宣稱不變。

## 驗證

- 後端：177 Node tests、14 Python tests、registry/schema validation 通過；backend build 通過。
- 前端：12 tests 通過（包含 r2 playback、延遲 HIGH 確認、手動 ACCEPT/RESUME、取消/斷線/逾時，以及觀測器證據與顯示文字不改協定值）；web build 通過。
- 現有 Scenario Runner 三次同 runtime 重播，逐次確認 DEFER → ASK → EXECUTE、NORMAL 前沒有 ASK、接受前行程未變、Quiet/HELD/Resume 正確；YAML 所有 expected checks 通過。
- 獨立 1920×1080 五屏頁面，三次實際中文按鈕流程：RESET → HIGH → Window 選取/提案 → DEFER → NORMAL/ASK → Center 接受 → Offline → Rear 靜謐 → Restore/HELD → Rear 恢復。另確認維持路線後重新提案，以及選取景點後 RESET。
- AUTO PLAY 完整一次通過；九步 trace 順序與 r2 相同。另確認 Director 手動選擇 Window 後，Core 回報的來源角色確實是 Window。
- 原生比例 Cluster 8:3、Center/Passenger 16:9、Rear/Window 4:3 通過；document 無溢出。中文五屏截圖已檢查。Impeccable scoped detector 沒有機械性告警。本輪未做視覺重設或額外美化。

## 入口與證據

原有入口保持：`http://127.0.0.1:5178/?scenario=premium-journey&control=1`。各獨立畫面使用 `?scenario=premium-journey&record=1&display=cluster-main|center-main|front-passenger-main|rear-tablet|window-tablet`；`record=1` 是原有純單屏呈現參數，不代表本輪錄製影片。Inspector 保持 `?debug=premium-journey`，只作開發工具。

驗證使用隔離的 5180/8082 主機；未中斷原有 5178/8081 demo。

`artifacts/functional-ui-zh/` 保存 revision.json、browser-verification.json、非空 gateway-events.json、scenario-run.json、backend-tests.log、frontend-tests.tap、web-build.log 及中文五屏/Center ASK 截圖。browser-harness-diagnostic.json 是早期測試腳本把拒絕後的 Window 狀態誤認為 selected 的診斷，非最終功能失敗；最終腳本及三輪驗證已通過。

## 明確保留的模擬邊界

Donghu/POI、ETA/+12 分鐘、路線圖、車速、駕駛負荷、連線與 cloud intelligence 仍為模擬。Offline 控制模擬雲端能力，不是實體斷網。媒體、HVAC、燈光、ANC、玻璃變色與車輛硬體未接入；不因中文化或觀測器而宣稱已實作。真實 POI/路線/交通 provider、乘員感測、車載部署與影片製作不在這輪功能範圍。
