# CI 與 scenario replay 證據

本紀錄依 issue #8 的核准範圍補上 CI replay 報告留存，不改動 UI、scenario script 或既有交接文件。

## 已核對的整合基準

- 分支：`codex/aura-v1-integration`；SHA：`f5b6d211a7d2a53cd33924e06a5a775f80332251`。`main` 不是本次基準。
- [CI run 37200053343](https://github.com/yinglinlin010/AURA_Project/actions/runs/37200053343) 在 2026-10-04 成功；其遠端 log 記錄 118 個 Node tests、3 個 Python tests 通過，以及 Core Host 與 Web Simulator build 成功。
- Evaluation registry validation 為 valid，但仍是 `draft_pending_review`、0 cases，`benchmark_claim_allowed: false`。
- 該 run 的 replay 為 9 scenarios × 1 次 fresh-process execution，9 runs、0 failed checks；這是既有遠端紀錄，不是本次本地重跑結果。
- 該 run 的 artifacts API 回傳 `total_count: 0`；報告當時只寫入 runner 的 `/tmp/aura-scenario-ci.json`，無法由 artifact 取回完整逐次證據。
- 既有 `docs/implementation/evidence/scenario-reliability-2026-10-03.json` 是 revision `ddde54ae33a845bf743ad16862048555e5c331a0` 的歷史 9 × 3／27 runs、0 failures，不能替代最新 SHA 的三次重播證據。既有交接的 111 tests／尚無遠端 CI 描述屬較早紀錄。

## 本次補正

`.github/workflows/ci.yml` 在 replay 後使用 `actions/upload-artifact@v4` 留存 JSON；第二輪擴充後 artifact 名稱為 `aura-reliability-${{ github.sha }}-${{ github.run_attempt }}`，保存 14 日。

`if: always()` 讓失敗路徑仍可上傳已產生的報告；`if-no-files-found: warn` 讓前置安裝、build 或報告產生失敗時保留原有錯誤，不因缺檔另報上傳失敗。沒有 artifact 仍代表沒有完整報告證據，不能解讀為 replay 通過；原 replay 步驟的失敗狀態不會被上傳步驟改成成功。

維持 `--repetitions 1`，不改 scenario harness、測試或交接文件。修改檔案完整清單：

- `.github/workflows/ci.yml`
- `docs/implementation/agent-work/reliability.md`（新增）

## 定向驗收與後續整合驗收

本次只檢查 YAML 結構、留存設定、文件中的 SHA／run／數量與差異空白，並執行既有 Python helper unit tests：

```sh
git diff --check -- .github/workflows/ci.yml
python3 -B -m unittest discover -s scripts -p 'test_scenario_reliability.py'
```

本次不執行 `npm test`、`npm run build` 或 scenario replay；`npm run scenario:reliability` 隱含 build，會寫入共用 `dist`，完整整合驗收由協調者統一排程。Python unit tests 只涵蓋輸出解析、UUID 正規化與拒絕失敗／缺漏 assertions，不是 scenario execution 證據。

推送需另行授權；後續獲准推送觸發新 CI 後，由協調者核對新 run 的上傳步驟與 artifact，再下載報告：

```sh
gh run view NEW_RUN_ID --repo yinglinlin010/AURA_Project --log
gh api repos/yinglinlin010/AURA_Project/actions/runs/NEW_RUN_ID/artifacts
gh run download NEW_RUN_ID --repo yinglinlin010/AURA_Project --name aura-reliability-NEW_SHA-NEW_ATTEMPT --dir ISOLATED_REPORT_DIRECTORY
```

將上述參數換成實際值，使用新的隔離下載目錄；確認 artifact 未過期、名稱綁定該 run 的 SHA／attempt，JSON 的 `repository.revision` 等於該 run 的 `head_sha`、`repetitions_per_scenario: 1`、`scenario_count: 9`、`execution_count: 9`、`failed_checks: 0`、`checks_passed: true`，且逐筆 run 均通過。9 scenarios 是本次基準數量，未來新增情境時須依當次維護清單核對。

遠端 artifact 上傳／下載目前尚未實測，須等待後續獲准推送的新 CI；14 日到期後仍需重新執行獲得新證據。

## 證據界線

單次 replay 證明該次 simulator 的宣告 expectations 通過，不能證明跨次確定性。既有 fingerprint 以正規化後的 expectation outcome 為範圍，也不代表完整 runtime state 相同。

上述紀錄不證明產品可靠性、實車控制、live provider、模型品質、實體五屏／Android 裝置、真實麥克風／喇叭、first-response 或 barge-in latency。`process_elapsed_ms` 是程序耗時，不能當作產品延遲 benchmark；遵守 Master Spec §61.19–61.20 與產品方向修訂的證據界線。

## 第二輪：可攜帶獨立 transport 與 readiness 驗收

Issue #11 的基準是第一輪未提交工作樹，不是 GitHub `f5b6d21` 已包含這些成果。核准修改的完整檔案清單：新增 `scripts/check-independent-clients.mjs`、修改 `.github/workflows/ci.yml` 與本文件；未改 transport、API、readiness 或 journey 實作。

依協調者對新版 AuraLink 初審簡報規劃的相容性確認，此切片僅提供基礎 CI／transport 驗收，非新簡報全部成果；沒有驗證幾何感知、盲區接力、模型或性能聲明，也不更動核心架構。

新腳本自行解析 repository root，在 OS 暫存目錄編譯 transport／13 tests、既有 CLI smoke 與 HmiGateway 依賴，不寫共用 `dist`／`dist-test`。它先執行 13 tests，再建立 `127.0.0.1` port 0 的隔離 HmiGateway／CoreRuntime（無 provider），啟動五角色各一 Node process，驗證兩次 ready、身份、快照及 explicit reconnect。這是既有真實 Gateway 合約上的模擬 smoke，不連使用中的 host、不執行控制命令、不存 raw snapshot。報告只保存 revision／dirty、PID、角色、session／sequence 與檢查 metadata。

編譯、測試與 probe 子程序有期限／輸出上限；失敗或 SIGINT／SIGTERM 時終止並等待子程序，關閉 Gateway、刪除專用 temp。報告只接受工作區外新檔、以 exclusive write 防覆寫；程序或清理失敗以非零退出。輸出 `cleanup: true` 表示本次 finally 清理完成，不保證 SIGKILL 或作業系統崩潰時能執行 finally。

CI 新增以下可攜帶命令，並將兩份新 JSON 與既有 scenario JSON 一併留存：

```sh
node scripts/check-independent-clients.mjs --report /tmp/aura-independent-clients-ci.json
python3 -B -m unittest discover -s evaluation -p 'test_check_readiness.py'
node scripts/check-journey-flow.mjs --report /tmp/aura-journey-ci.json
```

readiness 的 8 項 fixture tests 使用 mocked `jsonschema`，只證明已宣告案例的 blocker 邏輯，不能替代真 schema validation、人工內容／權利批准或正式模型 readiness。CI 保留既有真 registry validator，但不要求目前 draft manifest 的 `check_readiness.py` 退出 0；其正確阻擋不是本 CI 的失敗條件。journey 的 7 checks 是 headless 模擬合約驗收，不是畫面或 live 路線來源。

本輪實際定向驗證：13 transport tests、五個不同 PID 的 CLI welcome／snapshot／reconnect、8 readiness fixture tests、7 journey checks 均通過；沒有執行 npm build／npm test／scenario replay。首次 smoke 結果解析曾把成功後的 disconnect metadata 當作最後結果，已改為核對唯一 result record 並重跑通過。新腳本語法、YAML 設定、錯誤參數／工作區報告拒絕、SIGTERM 失敗與清理亦做定向檢查；後續協調者仍需整合驗收。

本地驗收使用 OS 暫存目錄中的唯一報告路徑（既有檔案會拒絕覆寫）；新遠端 CI 尚未觸發，artifact 的上傳／下載仍未實測。未來下載後還需確認獨立程序報告 `status: passed`、`cleanup: true`、13 tests passed、五個不同 PID 且每角色兩次 ready，journey 報告為七項 passed；不要將 dirty 工作樹報告解讀成 GitHub SHA 已交付的證據。
