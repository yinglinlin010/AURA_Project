# Local voice cancellation — issues #6 and #10

本文件記錄 `codex/aura-v1-integration` 本地未提交工作樹的交付。GitHub 基準 `f5b6d211a7d2a53cd33924e06a5a775f80332251` 尚未包含兩輪修復；沒有提交、推送或部署。

## Evidence and behavior

第一輪保留 subprocess `SIGTERM → 250ms grace → 尚未退出才 SIGKILL`，等待 `close` 後移除工作目錄，保留最初的取消／逾時／輸出超限錯誤並移除 timeout、grace timer 與 abort listener。12 個既有定向測試保留。

第二輪發現候選 callback 被直接 await；即使已有 await 後的 abort 檢查，callback 忽略 AbortSignal 或永不完成仍會卡住 `interrupt()`、taskPromise 與 finally 清理。協調者批准後，改為只接受首個結算結果的候選等待：

- `interrupt()`／`close()` 立即取消 adapter 的候選等待；不發 provider_error、晚提案或 TTS。
- 每候選階段沿用現有 `processTimeoutMs`（預設 45,000ms、現有設定範圍 1–120,000ms）。這是工程等待上限，沒有新增產品延遲 SLA，也不是整個 utterance 的總期限。
- 候選逾時先 fail closed，只發一次 `LOCAL_VOICE_CANDIDATE_TIMEOUT` provider_error，再 abort 同一 task controller 通知 callback 協作取消。
- 正常完成、同步 throw、非 Promise 回傳、Promise rejection、取消及逾時均清 timer／abort listener。原 callback 的 fulfillment/rejection handlers 留著消費晚結果，已結算後忽略，不產生 unhandled rejection。
- 未配置 callback 或 callback 回傳 undefined，仍走原本的辨識內容回覆；候選失敗不切換 cloud/mock。

完整修改清單：

1. `adapters/voice/local-whisper-voice-adapter.ts`
2. `apps/core-host/test/local-whisper-voice-adapter.test.ts`
3. `docs/implementation/agent-work/voice.md`

## Actual validation

第二輪執行於 2026-10-04；編譯輸出位於獨立臨時目錄，未覆寫共用 dist／dist-test：

```sh
./node_modules/.bin/tsc -p tsconfig.test.json --outDir /tmp/aura-voice-review-6C3l2E
printf '{"type":"module"}\n' > /tmp/aura-voice-review-6C3l2E/package.json
node --test /tmp/aura-voice-review-6C3l2E/apps/core-host/test/local-whisper-voice-adapter.test.js
git diff --check -- adapters/voice/local-whisper-voice-adapter.ts apps/core-host/test/local-whisper-voice-adapter.test.ts docs/implementation/agent-work/voice.md
```

TypeScript 編譯成功；25/25 tests 通過，0 failed/skipped/cancelled（約 6.39 秒）。第二輪新增 13 個 fake callback tests：interrupt／close／timeout × 晚 resolve／晚 reject／永不完成共 9 個，另驗證同步 throw、非同步 reject、undefined 與同步 candidate。驗收包含不先 release callback 即完成取消／清理、目錄確實移除、callback signal aborted、abort listener 移除、逾時只發一次錯誤、無晚提案／TTS，並等待超过測試用 80ms 上限以確認 timer 不晚發錯誤。Node test runner 未報告 unhandled rejection。測試的 80ms 是加速邊界驗收設定，不代表產品效能數據。

第一輪既有無網路 Node child 測試再次通過，包含真實 child 忽略 SIGTERM 的 abort／timeout／output-limit、正常退出、pre-aborted 不 spawn，以及 adapter interrupt／close／timeout 清理。這些是限定本機程序及 fake callback 證據；未錄音、未呼叫模型／雲服務，未驗證實體麥克風／喇叭。

## Limits

JavaScript Promise 無法強制終止 callback 自己的背景工作；本修復結束 adapter 等待並通知協作取消。若 callback 同步阻塞 event loop，timer／abort handler 仍無法執行；不承諾硬即時期限。檔案刪除仍需等待 OS I/O，現有 rm 失敗吞錯的行為未擴充。第一輪只管理直接 child，不保證任意 wrapper 後代或被繼承 pipes。既有 UI、個人檔及其他工程師的修改全部保留。
