LUDO MASTER - RENDER READY

UPLOAD THESE FILES TO GITHUB ROOT:
index.html
server.js
package.json
.env.example
public/index.html
data/.gitkeep
uploads/.gitkeep

RENDER:
Build Command: npm install
Start Command: npm start

Environment:
JWT_SECRET = make-a-long-random-secret

TEST:
https://YOUR-RENDER-SERVICE.onrender.com/api/health

IMPORTANT:
This version deliberately does NOT use better-sqlite3, so node-gyp/native SQLite build errors are avoided.

The server serves index.html from the project root and also public/index.html, preventing the previous ENOENT public/index.html error.
