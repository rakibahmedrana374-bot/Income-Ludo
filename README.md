# Ludo Master — Render Backend

এই ZIP-এ আপনার দেওয়া `index.html`-কে frontend হিসেবে রেখে Node.js/Express backend যোগ করা হয়েছে।

## Structure

- `server.js` — Express API server
- `package.json` — dependencies + Render start command
- `public/index.html` — আপনার original frontend
- `uploads/` — winning screenshot upload location
- `ludo.sqlite` — প্রথমবার server চালালে database তৈরি হবে
- `.env.example` — environment variable example

## Render

Build Command:
```bash
npm install
```

Start Command:
```bash
npm start
```

অথবা:
```bash
node server.js
```

Environment Variables:
- `JWT_SECRET` = একটি শক্ত random secret

## গুরুত্বপূর্ণ

আপনার frontend-এর বর্তমান `API_BASE` এখন `YOUR_BACKEND_API_URL`। Render-এ একই service-এ frontend ও backend একসাথে চালালে এটি relative API path ব্যবহার করার জন্য পরিবর্তন করা ভালো:

```js
const API_BASE = "";
```

তাহলে `/api/...` endpoint ঠিকভাবে কাজ করবে না, কারণ বর্তমান frontend `/user/profile`-এর মতো path call করছে। তাই frontend-এর API paths `/api/...` করা অথবা server-এ `/user/...` aliases যোগ করা প্রয়োজন।

এই package-এ backend-এর `/api/...` routes রাখা হয়েছে। Deploy করার আগে frontend-এর API_BASE এবং route prefix একবার মিলিয়ে নিন।
