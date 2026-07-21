# Gemini 後端 API 設定

這個專案已新增後端 API Route：

```text
POST /api/gemini-polish
```

用途：

- 接收前端傳來的八字 Tag
- 接收報告草稿或客戶提問
- 用 Gemini 1.5 Flash 潤飾後回傳 JSON 或文章
- API Key 放在後端環境變數，不放在 `index.html`

## 需要設定的環境變數

在 Vercel Project Settings → Environment Variables 新增：

```text
GEMINI_API_KEY=你的 Google AI Studio API Key
```

可選：

```text
GEMINI_MODEL=gemini-1.5-flash-latest
ALLOWED_ORIGIN=https://aichi0121.github.io
```

如果只是自己測試，`ALLOWED_ORIGIN` 可以先不設定。

## 如果整個網站部署到 Vercel

不需要改前端，網站會直接呼叫：

```text
/api/gemini-polish
```

## 如果前端仍放在 GitHub Pages

GitHub Pages 不能執行 `/api` 後端，所以需要把 API Route 部署到 Vercel，然後在瀏覽器 console 設定一次：

```js
localStorage.setItem(
  'doris_gemini_api_route',
  'https://你的-vercel 網址.vercel.app/api/gemini-polish'
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
    "dayMaster": "戊",
    "dayMasterElement": "土",
    "tenGodCounts": {
      "正財": 2,
      "食神": 1
    }
  },
  "reportDraft": "原本報告文字",
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
  "model": "gemini-1.5-flash-latest",
  "outputType": "article",
  "text": "潤飾後文字",
  "json": null,
  "finishReason": "STOP"
}
```

## 重要提醒

不要把 `GEMINI_API_KEY` 寫進 `index.html`、README 或 GitHub。

前端帳號選單中的 Gemini API Key 欄位目前保留為備援：如果後端 route 還沒部署，才需要暫時貼在自己的瀏覽器裡使用。
