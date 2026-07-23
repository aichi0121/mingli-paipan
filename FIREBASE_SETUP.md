# Firebase 設定筆記

這個版本已經在 `index.html` 接上 Firebase Authentication 與 Firestore。

## 目前完成

- Google 登入
- 登入後同步客戶命盤資料到 Firestore
- 未登入時保留原本本機資料模式
- 角色分級：`guest`、`tester`、`admin`、`teacher`
- `tester` / `guest` 只看快速版
- `admin` / `teacher` 可看完整版
- 客戶點選快速版題目後，題目與命盤摘要會回傳到 `consultationRequests`
- `admin` 登入後可在客戶列表下方查看回傳；`teacher` 與客戶無法讀取

## 第一次使用

1. 到 Firebase Console 開啟 Authentication 的 Google 登入。
2. 到 Firestore Rules 貼上本專案的 `firestore.rules`。
3. 回到網站，用你的 Google 帳號登入一次。
4. 到 Firestore Database 找到：

```text
users/{你的 uid}
```

5. 把 `role` 欄位從：

```text
tester
```

改成：

```text
admin
```

6. 重新整理網站並再次登入，你就會看到完整版。

## 朋友試用

朋友用 Google 登入後，預設會是：

```text
role: tester
```

他們只能看到客戶快速版，不能從介面看到完整版。

## 重要提醒

目前這仍是靜態網站版本。前端可以先做權限分流，但如果要真正保護老師觀點與完整知識庫，未來需要把老師資料與 Gemini 問答移到後端，例如 Firebase Cloud Functions 或 Cloud Run。

Gemini API key 不要放進 `index.html`，也不要提交到 GitHub。
