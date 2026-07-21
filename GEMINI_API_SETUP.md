# Gemini 後端 API 設定

這個專案已新增後端 API Route：

```text
POST /api/gemini-polish
```

用途：

- 主報告完成本機排盤後，自動接收十神數量、質變標籤、合沖、大運流年與風水交集
- 回傳完整版的情境化串聯分析，以及快速版的客戶關鍵字摘要
- 接收報告草稿或客戶提問
- 用 Gemini 1.5 Flash 潤飾後回傳 JSON 或文章
- API Key 放在後端環境變數，不放在 `index.html`

主報告不把姓名與出生日期送給 Gemini；本機精算結果與老師原始觀點仍是判斷依據。若 API 暫時失敗，網頁會保留本機完整版與快速版，不會卡在載入畫面。同一命盤同一年度會使用版本化快取，避免重複消耗免費額度。

## 需要設定的環境變數

在 Vercel Project Settings → Environment Variables 新增：

```text
GEMINI_API_KEY=你的 Google AI Studio API Key
```

可選：

```text
GEMINI_MODEL=gemini-3.5-flash
ALLOWED_ORIGIN=https://aichi0121.github.io
```

如果只是自己測試，`ALLOWED_ORIGIN` 可以先不設定。

## 如果整個網站部署到 Vercel

不需要改前端，網站會直接呼叫：

```text
/api/gemini-polish
```

## 如果前端仍放在 GitHub Pages

GitHub Pages 不能執行 `/api` 後端，因此前端已預設改為呼叫：

```text
https://mingli-paipan.vercel.app/api/gemini-polish
```

一般使用不需要再設定。只有未來更換 Vercel 網址時，才需要在瀏覽器 console 覆寫：

```js
localStorage.setItem(
  'doris_gemini_api_route',
  'https://新的-vercel 網址.vercel.app/api/gemini-polish'
);
location.reload();
```

之後前端就會改呼叫 Vercel 的 API。

要取消：

```js
localStorage.removeItem('doris_gemini_api_route');
location.reload();
```

## API Request 格式

```json
{
  "mode": "polish",
  "outputType": "json",
  "tags": {
    "chart": {
      "dayMaster": "戊土",
      "strength": {"label": "身強"},
      "tenGodCounts": {"正財": 2, "食神": 1},
      "transformedTags": [],
      "combinationTags": []
    }
  },
  "tone": "專業、口語、清楚"
}
```

問答模式：

```json
{
  "mode": "chat",
  "tags": {},
  "reportDraft": "目前命盤報告內容",
  "history": [],
  "question": "這個客戶今年工作要注意什麼？"
}
```

## API Response 格式

```json
{
  "ok": true,
  "model": "gemini-3.5-flash",
  "outputType": "json",
  "text": "{...}",
  "json": {
    "summary": "全盤串聯總結",
    "keywords": [],
    "career": {},
    "wealth": {},
    "health": {},
    "relationship": {},
    "annual": {},
    "fengShui": {},
    "teacherFriendlyScript": ""
  },
  "finishReason": "STOP"
}
```

## 重要提醒

不要把 `GEMINI_API_KEY` 寫進 `index.html`、README 或 GitHub。

前端不提供 API Key 輸入欄位；所有 Gemini 請求都經由 Vercel 後端，避免金鑰出現在瀏覽器或 GitHub 原始碼中。
