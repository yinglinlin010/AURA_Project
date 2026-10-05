# 工程師第一輪交付 — 2026-10-04

使用者確認沿用目前已完成的 UI 與工作規劃。七位既有 Orca 工程師先查閱 GitHub 任務並回報計畫，由協調者審查後派發實作。Run：`run_d7f44584d3d3`。

基準分支：`codex/aura-v1-integration`，HEAD `f5b6d211a7d2a53cd33924e06a5a775f80332251`。以下結果針對包含本輪修改的未提交工作樹，不能當作此 SHA 或 GitHub main 已有的能力。

| Issue | 職位與交付 | 驗收與限制 |
| --- | --- | --- |
| [#2](https://github.com/yinglinlin010/AURA_Project/issues/2) | 儀表與跨螢幕前端：獨立單角色 transport、測試與 CLI | 13 個定向測試通過；協調者隔離 Gateway 的五個獨立 Node 程序註冊／快照／重連通過。不代表五台實體螢幕或獨立瀏覽器 UI；現有 hook 未重構。 |
| [#3](https://github.com/yinglinlin010/AURA_Project/issues/3) | 核心後端：明確啟用、隔離 ledger 的模擬任務恢復 | 14 個相關定向測試通過；預設拒絕缺證據的恢復、未知結果須對帳。僅 Host simulator，無 live authority 或 HMI 逐次來源標記。 |
| [#4](https://github.com/yinglinlin010/AURA_Project/issues/4) | Android：debug-only loopback WebView 容器 | XML 靜態檢查通過。缺 JDK／Gradle，未建置 APK、未安裝；SDK 存在。不含 Android 語音或實機驗收。 |
| [#5](https://github.com/yinglinlin010/AURA_Project/issues/5) | 中控與行程：隔離 Gateway 主線驗收腳本 | 7 個案例通過；Passenger 路線預覽不新增停靠，Rear 提案由 Center 同意。僅 headless／模擬來源證據。詳見 [journey.md](journey.md)。 |
| [#6](https://github.com/yinglinlin010/AURA_Project/issues/6) | 語音：停止後 250ms 升級終止直接子程序、取消後防晚發結果 | 12 個定向測試通過；不保證任意 wrapper 後代／繼承 pipe 或硬即時期限。未錄音、未測實體麥克風。 |
| [#7](https://github.com/yinglinlin010/AURA_Project/issues/7) | 本機 AI：資料／工件 readiness preflight | 8 個測試通過；五套資料、sealed status、人工內容／權利審核與模型參數都須符合。本地 manifest 正確被阻擋，沒有 benchmark、訓練或批准資料。詳見 [model.md](model.md)。 |
| [#8](https://github.com/yinglinlin010/AURA_Project/issues/8) | 可靠性：CI 重播報告 artifact 留存 | YAML 設定檢查與 3 個 Python helper 測試通過；遠端上傳需後續推送的新 CI 才能驗證。詳見 [reliability.md](reliability.md)。 |

## 協調者整合驗收

- `npm test`：135 個 Node tests、3 個 Python helper tests 通過，evaluation registry valid（0 cases／pending，不允許 benchmark claim）。
- `npm run build`：通過。
- `npm --prefix apps/web-simulator run build`：通過。首次因 browser tsconfig 包含 Node 測試失敗；協調者在 `tsconfig.app.json` 排除 `src/**/*.test.ts`，保留獨立 Node 測試後重跑通過。
- `python3 -B -m unittest discover -s evaluation -p 'test_check_readiness.py'`：8 個 readiness tests 通過。
- `python3 scripts/scenario_reliability.py --repetitions 3 --report /tmp/aura-agent-wave1-scenarios-20261004.json`：9 scenarios × 3、27 runs、0 failed checks。
- 五個独立 Node client 程序連接協調者建立的 loopback port 0 Gateway，各自完成 welcome、snapshot、explicit reconnect；未連使用中的 HMI Gateway。臨時協調腳本 `/tmp/aura-coordinator-transport-smoke.mjs`，使用 transport 工程師的隔離編譯輸出 `/tmp/aura-transport-check.5pZA7w`；此路徑是本輪臨時證據，不是可攜帶建置工件。
- `git diff --check`：通過。

本輪不修改既有 App／Cluster 視覺與使用者個人檔，不提交或推送程式。GitHub 任務保持開啟，待程式整合與相應的遠端／裝置證據。

## 下一步依賴

獨立 browser UI client 接線、Android 建置環境及安裝驗證、可信 live 恢復證據、麥克風／播放與網路測試仍需後續切片。人工資料內容與權利審查、警告解除語意及 live 停車介面不可由本輪模擬或測試代替。
