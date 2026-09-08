# Ludo Master — Render Ready

## Files
- `index.html` — frontend
- `server.js` — Node.js/Express backend
- `package.json` — Render dependencies/start command
- `.env.example` — environment variable example
- `data/` — JSON database is created automatically
- `uploads/` — winning screenshots are stored here

## Render
Build Command:
```text
npm install
```

Start Command:
```text
npm start
```

Environment Variable:
```text
JWT_SECRET=your-long-random-secret
```

## Test
After deployment open:
```text
https://YOUR-SERVICE.onrender.com/api/health
```

It should return:
```json
{"success":true,"message":"Ludo Master backend is running"}
```

The frontend is served from `/` and uses the same Render service for `/api/...`.

IMPORTANT:
This JSON database is suitable for testing/demo deployment. Local files on some Render plans can be lost after service replacement/redeploy. For a real money app, use a persistent database and proper admin/security controls.


## Login System
A login/registration gate is enabled. The main app interface is hidden until a valid account session is established; the existing JWT-protected profile API validates the session.
