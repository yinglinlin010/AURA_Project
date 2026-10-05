# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.

## 五屏模擬按鍵

主入口（未指定 `demo`）支援中控導航選項、模擬廣播與電話、前後座空調、後座媒體、呼叫駕駛、設定，以及餐廳分類篩選與停靠提案。中控操作會遵守駕駛負荷與安全警示限制；停靠提案經 Gateway 和駕駛核准後才加入共享行程。

空調、音量、亮度設定與呼叫通知使用同源瀏覽器儲存同步，保留至「設定 → 恢復模擬設定」。這些資料不屬於 Core 車輛狀態，不會跨裝置同步。瀏覽器禁止儲存時，控制仍可在當前畫面使用，但不保存、不跨分頁同步。

媒體僅模擬播放時間、曲目、音量與播放模式，無音訊；電話不會撥出；亮度為模擬設定，不控制螢幕；導航選項不重新計算地圖。餐廳資料為示例。真實車輛、媒體與通訊服務仍需要 adapter。

在專案根目錄執行按鍵回歸檢查：

```sh
npm exec --package=playwright -- playwright install chromium
npm exec --package=playwright -- node scripts/check-ui-controls.mjs
```

檢查會建置 Core，啟動不保存資料、不連外部 provider 的獨立 Gateway 與 Vite，驗證按鍵操作、跨分頁空調同步、駕駛高負荷限制、停靠核准及 Gateway 中斷，再關閉測試服務。可用 `AURA_UI_BROWSER_PATH` 指定既有 Chromium 執行檔。

## 真實模型旅程說明（Gemini + Ollama）

在根目錄執行 `npm run start:journey` 啟動不保存資料的 Hybrid 示範主機。它以 `AURA_JOURNEY_AI=hybrid`、`AURA_LOCAL_MODEL=qwen3:4b` 為預設，只使用已安裝的模型，不下載模型。Gemini 金鑰由後端環境變數 `GEMINI_API_KEY` 讀取，不放入前端；雲端模型預設 `gemini-3.5-flash-lite`，可用 `GEMINI_JOURNEY_MODEL` 覆寫。

若 8081 已被其他 Demo 使用，可另開兩個終端：

```sh
# 根目錄：模型主機
AURA_COMPETITION_PORT=8198 npm run start:journey
```

```sh
# 根目錄：Web UI
VITE_AURA_WS_PORT=8198 npm run dev --prefix apps/web-simulator -- --host 127.0.0.1 --port 5198
```

開啟 `http://127.0.0.1:5198/`，在底部控制台按「正常負荷」，於中控輸入「沿途餐廳」並按「建議」。介面顯示實際模型、處理耗時、回覆及回退原因。仍須按「送交駕駛確認」並取得同意，才會加入行程。

- `AURA_JOURNEY_AI=local`：只呼叫本機 Ollama。
- `AURA_JOURNEY_AI=gemini`：只呼叫 Gemini，離線時明確顯示不可用。
- `AURA_JOURNEY_AI=hybrid`：在線優先 Gemini，缺金鑰、認證／配額／模型錯誤或逾時則改用 Ollama；離線或連線受限直接走本機。
- `AURA_JOURNEY_AI=off`：不呼叫模型。一般 `npm run start` 必須明確設定 `AURA_JOURNEY_AI`，且具備旅程依據來源（現有示例來源需 `AURA_SIMULATED_JOURNEY_RECOMMENDATION=true`）。原 `start:competition` 不會預設啟用模型。

本地 Ollama 僅允許 loopback HTTP 位址，拒絕遠端主機和重新導向。模型輸出經 JSON 驗證，只能解釋原本由本地評分器選出的候選；不新增地點、不修改證據或核准操作。雲端失敗且本地也失敗時，保留確定性規則建議，顯示模型不可用。

**資料邊界：模型呼叫是真實的，但這個示範主機的起終點、餐廳、繞路、停車與天氣仍是明確標示的 fixture。模型說明不屬於即時外部資料。** 「設為離線」只模擬 Core 連線狀態；驗證真正離線需切斷外網並保留本機／區域網路。雲端功能要有有效金鑰並實測成功後，才能展示為成功的雲端增強。

相關文件：[Gemini 結構化輸出](https://ai.google.dev/gemini-api/docs/generate-content/structured-output)、[Ollama Generate API](https://docs.ollama.com/api/generate)。
