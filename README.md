# DebtMaster

手機版家庭欠款紀錄 app，使用 Angular、Firestore、Vercel。

## 功能

- 第一次進入用大按鈕選擇「我是淑尼」或「我是丞恩」，之後會記住。
- 首頁顯示總欠款、已還百分比、每筆欠款的還款進度。
- 丞恩可以申請貸款，淑尼可以核准或退回。
- 可以設定下個月要還多少。
- 丞恩可按「已還當月」，淑尼再按「確認收到」。
- 淑尼確認收到後，還款會依欠款建立順序自動分配到每個欠款項目。

## 開發

```bash
npm install
npm start
```

開發伺服器預設在 `http://localhost:4200`。

## Firebase 設定

把 Firebase web app 的設定填到：

```text
src/environments/firebase-config.ts
```

目前 app 使用的文件位置是：

```text
ledgers/family-ledger
```

Firebase Console 需要開啟：

- Authentication: 啟用 `Anonymous`
- Firestore Database: 建立資料庫
- Firestore Rules: 可使用 `firestore.rules`

這版的登入是為了家庭使用方便而設計的角色選擇，會存在瀏覽器的 `localStorage`。它不是身份驗證；程式會在背景使用 Firebase Anonymous Auth，讓 Firestore 至少可以限制為已登入 session 才能讀寫。

## Vercel

Vercel 設定已放在 `vercel.json`：

- Build Command: `npm run build`
- Output Directory: `dist/debt-master`
- SPA rewrite 已設定到 `index.html`
