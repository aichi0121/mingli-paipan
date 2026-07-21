# mingli-paipan
命理排盤系統

## Gemini 後端 API

本專案已新增：

```text
POST /api/gemini-polish
```

它會接收前端送來的八字 Tag、報告草稿或問答內容，透過後端環境變數 `GEMINI_API_KEY` 呼叫 Gemini 1.5 Flash，再把潤飾後的文章或 JSON 回傳給前端。

重要：

- 不要把 Gemini API Key 寫進 `index.html`
- 不要把 API Key 上傳到 GitHub
- 若網站仍放在 GitHub Pages，`/api` 不會執行，需要另外部署到 Vercel
- 詳細設定看 [GEMINI_API_SETUP.md](./GEMINI_API_SETUP.md)
