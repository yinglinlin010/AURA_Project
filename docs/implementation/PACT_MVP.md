# PACT MVP — 可安裝的離線 Android Demo

依據 [PACT AI Negotiation Cabin v2](../product/PACT_AI_Negotiation_Cabin_v2.md)，完成第一版模擬 MVP。
Android Automotive API 34 模擬器已完成 APK 安裝、離線冷啟動與完整七步 Demo 驗證。

## 直接使用

已產出 [PACT-debug.apk](../../artifacts/pact/PACT-debug.apk)，模擬器上也已安裝。
Launcher 可選 PACT；明確啟動指令：

```sh
adb install -r artifacts/pact/PACT-debug.apk
adb shell am start -n com.aura.automotive/.PactActivity
```

`PactActivity` 使用 WebViewAssetLoader 載入 APK 內嵌的 HTML／JS／CSS；不需要電腦、Vite、Core Host、adb reverse 或網路。
它阻擋外部導覽、網路資源回退與 Web 權限要求，且關閉 file/content access。
使用 HTTPS appassets origin 的做法遵循 [Android 本機內容文件](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content)。

Web 開發入口仍為 `http://127.0.0.1:5173/?demo=pact`：

```sh
npm run dev --prefix apps/web-simulator -- --host 127.0.0.1
```

原 AURA 入口與 `BaselineActivity` 保留。PACT 同時可打包為獨立 Web 介面：

```sh
npm run build:pact --prefix apps/web-simulator
# 輸出：apps/web-simulator/dist-pact/pact.html
```

## Demo 操作

點「自動播放 Demo」啟動約 90 秒展示；每 12 秒推進，安全後等待駕駛同意或拒絕，再繼續。
也可手動逐步操作；暫停後點「繼續播放 Demo」會從目前步驟接續。「重設 Demo」會停止計時並重設所有模擬設定。

1. Driver 導航、副駕餐廳、後座娛樂，各自在對應螢幕。
2. 駕駛 21°C、副駕 25°C，偵測空調衝突並以分區解決。
3. 複雜路口使負荷達 80%；Focus Mode 隱藏駕駛的空調與 HUD 控制。
4. 副駕修改目的地，輸出 DEFER，不打斷駕駛。
5. 負荷降低後輸出 ASK；只在駕駛同意後套用導航。
6. 切換離線並執行後座空調。
7. 恢復 ONLINE 情境，不自動批准任何需求。

可另外操作單區空調、車速、道路複雜度、視線離路、HMI 任務數，及未授權 HUD 拒絕情境。

## 本輪協商與任務管理

「單區協商情境」建立駕駛 21°C、副駕要求 25°C 的共享空調衝突。駕駛可提出 23°C 折衷，提案轉到副駕螢幕；副駕接受後才套用。副駕可保留原需求或撤回；注意力負荷過高時，已同意的折衷仍等待安全後執行。

同一乘員對同一類資源的新需求會取代舊需求。需求本人或駕駛可撤回待處理需求，舊確認無法恢復已撤回或取代的任務。空調狀態或分區能力變更會使過期提案失效，避免舊同意覆蓋新設定。

「任務管理」顯示待處理、已套用、已拒絕、已撤回與已取代狀態；駕駛可查看全部，其他乘員只查看自己的任務。

## 規格對照

| MVP 項目 | 完成內容 |
| --- | --- |
| Android HMI | 可安裝 APK、內嵌獨立 WebView HMI、車載短螢幕排版 |
| Driver / Passenger / Rear | 三個可操作的邏輯顯示區域 |
| Vehicle Context | 車速、複雜度、gaze、HMI 任務與分區能力模擬 |
| Intent Parsing | 本機中文／部分英文指令分類，未知或越界拒絕 |
| Role / Permission | 導航／全車空調需駕駛確認，其他乘員不能改 HUD |
| Conflict Detection | 空調差異偵測，分區同時滿足，單區共享需協商 |
| Policy / Arbitration | 五種決策、影響範圍、路由對象、理由與衝突紀錄 |
| Attention Load | 本機啟發式計算；70% 以上 Focus Mode；安全後重新評估延後需求 |
| Offline / Online | APK 可離線冷啟動；本機仲裁不依賴網路；雲端增強為明確標示的模擬 |
| 完整 Demo | 七步手動／自動流程，確認、拒絕、暫停、接續及重設 |

已套用的目的地、溫度、分區能力、HUD 模擬設定保存在本機。
重新啟動取消待確認需求，避免把舊同意或注意力情境帶入新 session；損壞設定安全回復預設。

## 重現 Android 建置

JDK 17.0.20.1 與 Gradle 8.9 已下載到忽略的 `.pact-tools/`，官方下載 SHA-256 校驗通過。
沒有修改系統 Java 或 Android SDK 設定。Gradle Wrapper 已加入，並固定 Gradle 8.9 的 distribution checksum。

在專案根目錄執行：

```sh
python3 scripts/build-pact-android.py \
  --jdk-home '.pact-tools/jdk-17.0.20.1+1/Contents/Home' \
  --gradle-home '.pact-tools/gradle-native/gradle-8.9' \
  --sdk-root '/Users/yinglin/Library/Android/sdk'
```

其他電腦可改用自己的對應工具路徑，或設定 JDK 17 與 SDK 後執行 `apps/android-automotive/gradlew assembleDebug lintDebug`（cwd 為 Android 專案目錄）。
先安裝 Web 依賴：`npm ci --prefix apps/web-simulator`。
Gradle preBuild 自動建置 PACT Web、同步生成資源，再產出 `app/build/outputs/apk/debug/app-debug.apk`。
Java／Kotlin 編譯目標皆固定為 17。

## 驗證證據（2026-10-05）

- Android `assembleDebug`、`lintDebug`：BUILD SUCCESSFUL。
- lint 沒有 error；有 3 個 warning：固定相容 API 34 的 WebKit 版本、既有應用缺 icon、既有 BaselineActivity 英文 placeholder 未抽成翻譯資源。
- APK v2 簽章驗證通過；[SHA-256](../../artifacts/pact/PACT-debug.apk.sha256)、[建置紀錄](../../artifacts/pact/android-build.log)、[lint](../../artifacts/pact/android-lint.xml)。
- Automotive API 34／`emulator-5554`：飛航模式冷啟動、三乘員分配、21/25°C、Focus Mode、DEFER → ASK → EXECUTE、離線 24°C、連線情境恢復、HUD REJECT，10 項驗證通過；飛航模式已恢復原狀。
- [裝置驗證紀錄](../../artifacts/pact/android-demo-evidence.json)、[離線冷啟動截圖](../../artifacts/pact/android-offline-cold-start.png)、[Focus 截圖](../../artifacts/pact/android-focus-deferred.png)、[完成 Demo 截圖](../../artifacts/pact/android-demo-complete.png)。
- Android 新協商流程 4 項驗證通過：單區仲裁、提案未同意前不套用、雙方同意後套用 23°C、撤回保持 21°C；[協商驗證紀錄](../../artifacts/pact/android-negotiation-evidence.json)、[等待確認截圖](../../artifacts/pact/android-negotiation-pending.png)、[同意後截圖](../../artifacts/pact/android-negotiation-agreed.png)。
- Chrome 已驗證需求取代／撤回、Demo 接續播放與 390px 手機版無水平溢出。
- Web 正式建置與獨立打包建置通過；Chrome 驗證單區空調確認、設定重啟保存、自動播放等待駕駛，以及打包版 Focus Mode。
- 完整 `npm test`：172 個 Node 測試與 14 個 Python 測試通過；[測試紀錄](../../artifacts/pact/tests.log)。
- PACT 21 個核心測試覆蓋權限、恢復、防止重複確認、設定恢復、指令解析、雙方折衷同意、撤回／取代、過期提案與任務歷史。

## 範圍

這是規格第一版的模擬 MVP。三個區域不代表三個獨立實體螢幕；注意力公式未經實車安全驗證，駕駛角色由模擬介面指定。
餐廳、導航、影音、車輛控制與雲端增強均為模擬；ONLINE 按鈕是情境開關，不宣稱實際雲端連線。
Camera、CAN、完整 AAOS 多顯示器整合依規格留在第二階段。
交付 APK 是本機 debug 測試版本，未發布到商店或 production。
