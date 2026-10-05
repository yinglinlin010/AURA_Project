export function cabinError(error: unknown): string {
  const code = error instanceof Error ? error.message : String(error);
  const messages: Record<string, string> = {
    GATEWAY_DISCONNECTED: "後端尚未連線，請啟動主機或稍候重連。",
    CABIN_UNAVAILABLE: "這個主機尚未啟用新座艙功能，請啟動更新後的主機。",
    CABIN_BUSY: "這個螢幕正在處理另一項要求，請稍候。",
    CABIN_TIMEOUT: "服務回覆逾時，請確認網路後重試。",
    PERSON_NOT_PRESENT: "這位乘員不在目前名單中，請在控制器設定人數。",
    PERSON_ROLE_MISMATCH: "請在這位乘員自己的螢幕操作。",
    FRONT_PASSENGER_NOT_PRESENT: "車上沒有前座乘員，請先設定乘員人數。",
    SPEECH_NOT_RECOGNIZED: "沒有辨識到語音，請靠近麥克風重新說一次。",
    OFFLINE_SPEECH_MODEL_REQUIRED:
      "離線語音模型尚未設定，請設定 Whisper 模型後重試。",
    SPEECH_TOOL_UNAVAILABLE:
      "錄音轉換工具尚未安裝，請確認 ffmpeg／whisper-cli。",
    SPEECH_PROCESS_FAILED: "語音檔案無法處理，請重新錄音。",
    VOICE_VOTE_UNCLEAR:
      "未確認你的意思。請明確說「同意加入行程」或「不同意」。",
    NO_PENDING_CONFIRMATION: "目前沒有等待駕駛確認的行程。",
    MAP_SERVICE_REQUIRED: "尚未設定地圖搜尋服務。",
    MAP_SEARCH_BUSY: "搜尋服務忙碌，請稍候再查。",
    OFFLINE_PLACE_UNAVAILABLE:
      "離線時只能選擇已查過的地點，請恢復連線後搜尋新景點。",
    ROUTE_REQUIRES_NETWORK:
      "計算新路線需要網路；已知行程仍保留，連線後可以重試。",
    ROUTE_UNAVAILABLE: "找不到可行的汽車路線，請換一個地點。",
    TRIP_NOT_CONFIGURED: "請先在控制器設定起點與終點。",
    TRIP_PLACE_NOT_FOUND: "找不到起點或終點，請輸入更明確的公共地點名稱。",
    VOICE_TRIP_EDIT_UNCLEAR: "請明確說「刪除鯉魚潭」或「清空行程」。",
    VOICE_TRIP_EDIT_AMBIGUOUS: "有多個相似名稱，請說完整景點名稱。",
    VOTE_TIMING_INVALID: "開始時間須為0～3600秒後，期限須為10～300秒。",
    DRIVER_CONFIRMATION_ONLY: "此行程不進行投票，等待駕駛確認。",
    GPS_UNAVAILABLE: "此裝置無法提供 GPS，請使用支援定位的瀏覽器或裝置。",
    GPS_PERMISSION_REQUIRED: "無法取得定位，請允許 GPS 權限後重試。",
    NAVIGATION_ACTIVE: "導航已啟動，請先結束目前導航。",
    NAVIGATION_NOT_ACTIVE: "導航尚未啟動。",
    TRIP_EDIT_FORBIDDEN: "請由前座媽媽或駕駛面板管理行程。",
    TRIP_CHANGED: "行程已更新，請重新操作。",
    JOURNEY_STOP_NOT_FOUND: "此景點已不在行程中。",
    TRIP_BUSY: "正在計算路線，請稍候。",
    PLACE_EXPIRED: "景點資料已過期，請重新搜尋。",
    PLACE_ALREADY_IN_TRIP: "這個景點已在行程中。",
    BALLOT_ALREADY_PENDING: "已有投票進行中，請先完成這一輪。",
    BALLOT_NOT_PENDING: "這輪投票已結束，請查看結果。",
    ALREADY_VOTED: "你已經投過這一輪票。",
    BALLOT_CHANGED: "投票已改變，請對目前的提案重新確認。",
    TOO_MANY_STOPS: "目前最多支援8個停靠點。",
    IMAGE_SEARCH_REQUIRES_NETWORK: "以圖搜圖需要連網，照片仍保留，可稍後重試。",
    PHOTO_EXPIRED: "照片已確認或移除，請重新截圖。",
    GEMINI_API_KEY_MISSING: "尚未設定 Gemini 金鑰。",
    GEMINI_AUTH_FAILED: "Gemini 認證失敗，請檢查後端金鑰。",
    GEMINI_QUOTA_EXCEEDED: "Gemini 配額不足，請稍後再試。",
    GEMINI_SERVICE_BUSY: "Gemini 服務忙碌，請稍後再試。",
    AI_REQUEST_FAILED: "AI 服務未回覆，請確認網路後重試。",
    AI_RESPONSE_INVALID: "AI 回覆未通過驗證，請重試。",
    LOCAL_MODEL_UNAVAILABLE: "本地模型尚未連線，請確認 Ollama 已啟動。",
    CORE_CONSENT_NOT_APPLIED: "核心未接受這次行程確認，原路線保持不變。",
    HTTP_504: "外部地圖服務忙碌，請稍後重試。",
    NO_NEARBY_PLACES: "附近資料未找到景點，請改用地點名稱搜尋。",
    AI_NO_SUITABLE_PLACE: "目前候選沒有符合需求的景點，請改用其他需求。",
    HTTP_429: "地圖服務要求稍候再查，請稍後重試。",
    HTTP_403: "地圖服務暫時拒絕請求，請稍後重試或切換服務。",
    REQUEST_TIMEOUT: "地圖服務回覆逾時，請重試。",
    UPSTREAM_REQUEST_FAILED: "外部服務連線失敗，請檢查網路後重試。",
  };
  return (
    messages[code] ??
    `操作未完成（${/^[A-Z0-9_:-]{1,100}$/.test(code) ? code : "REQUEST_FAILED"}），請重試。`
  );
}
