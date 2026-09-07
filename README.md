# Ludo Master — Render Fixed Version

## কেন এই version
আগের version-এ `better-sqlite3` ছিল। এটি native module হওয়ায় Render build-এ `node-gyp`/compiler error হয়েছে। এই version-এ `better-sqlite3` সম্পূর্ণ বাদ দেওয়া হয়েছে।

Database এখন `data/database.json`-এ রাখা হবে, তাই extra native build dependency নেই।

## Render settings

Build Command:
```bash
npm install
```

Start Command:
```bash
npm start
```

Environment Variable:
```text
JWT_SECRET=একটি-দীর্ঘ-random-secret
```

## গুরুত্বপূর্ণ
এই backend আপনার বর্তমান `index.html`-এর `/user/...`, `/matches`, `/deposit`, `/withdraw`, `/transactions`, `/winning`, `/support` path-এর সাথে compatibility routes দিয়েছে।

তবে production app-এর জন্য Render-এর persistent disk/database ব্যবহার করা ভালো। Free web service restart/redeploy হলে local JSON/uploads স্থায়ী নাও থাকতে পারে।

## Test
Deploy হওয়ার পর:
```text
https://YOUR-RENDER-SERVICE.onrender.com/api/health
```
এ গেলে JSON-এ backend running দেখাবে।
