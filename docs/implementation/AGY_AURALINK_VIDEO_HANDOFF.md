# Agy 接續：AuraLink 東華大學錄影 UI

## 使用者最新授權

以新版產品定位、VIP/MaaS 客群、指窗→飛屏→盲區接力、五屏硬體及 AAOS/CDC 方向取代衝突舊方向。使用者要求規劃後直接實作，最新優先「先做出能生影片的 UI」，照片在網上尋找，token不足交 Agy。影片背景東華大學。

參考：`/Users/yinglin/Downloads/gemini-code-1791126047679.md`（20頁簡報）；`/Users/yinglin/Downloads/gemini-code-1791126690262.md`（2:55影片分鏡）。

## 具體交付

獨立 `?demo=dong-hwa` 錄影模式，保留正常五屏 UI。可操作、可重置、可隱藏導演控制的四幕：校園五屏總覽；東湖選取→飛屏提案→Center確認後行程更新；WAN離線→模擬調光及離線景點文字；恢復→模擬盲區Window/Cluster警示。本地state模式不需Gateway，也不錄音、不呼叫provider。清楚但克制保留DEMO/SIMULATED與照片來源。不製造172ms、100%可用、ASIL認證或真感知宣稱。Fly-screen動畫由操作觸發，不是冒充實測的定時影片。

## 照片已完成

`apps/web-simulator/src/assets/dong-hwa/campus-panorama.jpg`：1920×576東湖湖畔校園全景。
`campus-lake.jpg`：1920×1439湖畔校園航拍。
已下載並實際看過。作者國立東華大學，Commons頁為 attribution-only/GWOIA；來源見同目錄ATTRIBUTION.md。UI及錄影片尾保留署名與來源；照片不是即時相機。

## Ownership：不要撞檔

目前 Run `run_49f53ac45622` coordinator 是 term_633ee949-d0f8-4020-92c8-b6ae71263281；Agy不是該run消費者，不可冒用coordinator或覆寫其binding。

- 前端：term_9483697b-f432-4e5d-99eb-95959e3460ad，task_c2b8b3d4e990，dispatch ctx_5d07625021cb。原live Window plan已退回，請轉為錄影模式。它持有App.tsx。Agy可先只建立新 `DongHwaDemo.tsx`、`DongHwaDemo.css`（default export），與必要純demo helper；**不要編輯App.tsx/CSS/既有hook**。通知前端由它import並於入口render；入口需不啟動正常Gateway hook。
- 後端：term_0531ab3c-8bec-4c00-8778-533d580141ab，task_9a105fbe97a9，dispatch ctx_21baf32b0a8d。五檔plan已批准：core-runtime.ts、hmi-gateway.ts、新window authority test、check-dong-hwa-flow.mjs、dong-hwa-flow.md。Window窄提案、Cluster read-only、voice role限制與隔離五role驗收；Agy勿動这些。

前一輪 run_79577f6b641f四項已完成且retained：browser單角色入口9tests/build/離線DOM；voice25tests；可靠性13transport+5process/8readiness/7journey；Android11tests，缺JDK17/Gradle8.9，APK未build。報告在docs/implementation/agent-work/。全專案仍大量未提交修改。保留stage Android、既有UI、Ting-Ting/artifacts/run_review.sh；不reset/clean/stash/git add/commit/push/deploy。

## 設計／完成驗收

沿用Tactile Slate：matte charcoal/slate、warm sand、orange，critical才red；現有UI是固定視覺權威。Impeccable context已跑（缺root PRODUCT/DESIGN，但現有world存在）；讀`.agents/skills/impeccable/reference/craft-floor.md`，不再問使用者選案。UI完成在隔離/tmp typecheck/build，瀏覽器檢查1920×1080及一般筆電，四幕操作、reset/keyboard/reduced motion/隱藏控制，確認圖片成功與文字無截斷。一次batched inspect+最多一次修正確認，不要無限polish。保留可錄影網址與操作说明，無影片生成完成宣稱，尚未錄製影片。
