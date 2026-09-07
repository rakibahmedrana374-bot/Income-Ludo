const express = require("express");
const cors = require("cors");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const fs = require("fs");
const Database = require("better-sqlite3");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret-in-render";

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
const upload = multer({ dest: uploadsDir });

const db = new Database(path.join(__dirname, "ludo.sqlite"));
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  mobile TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  referral_code TEXT UNIQUE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS balances (
  user_id INTEGER PRIMARY KEY,
  gaming_balance REAL NOT NULL DEFAULT 0,
  winning_balance REAL NOT NULL DEFAULT 0,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Upcoming',
  entry_fee REAL NOT NULL DEFAULT 0,
  prize REAL NOT NULL DEFAULT 0,
  max_players INTEGER NOT NULL DEFAULT 2,
  time TEXT NOT NULL DEFAULT '---',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS match_players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(match_id, user_id),
  FOREIGN KEY(match_id) REFERENCES matches(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  method TEXT,
  amount REAL NOT NULL,
  transaction_id TEXT,
  number TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS winnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  match_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  screenshot TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS support_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
`);

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ success: false, message: "Login required" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ success: false, message: "Invalid or expired token" });
  }
}

function makeReferralCode(name, id) {
  return (String(name).replace(/[^a-z0-9]/gi, "").slice(0, 5).toUpperCase() || "USER") + id;
}

app.get("/api/health", (req, res) => res.json({ success: true, message: "Ludo Master backend is running" }));

// Simple registration/login endpoints for the frontend/backend integration.
app.post("/api/auth/register", async (req, res) => {
  const { name, mobile, password } = req.body;
  if (!name || !mobile || !password) return res.status(400).json({ success:false, message:"Name, mobile and password are required" });
  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const info = db.prepare("INSERT INTO users (name,mobile,password_hash) VALUES (?,?,?)").run(name,mobile,passwordHash);
    const id = info.lastInsertRowid;
    const referral = makeReferralCode(name, id);
    db.prepare("UPDATE users SET referral_code=? WHERE id=?").run(referral,id);
    db.prepare("INSERT INTO balances (user_id) VALUES (?)").run(id);
    const token = jwt.sign({ id, mobile }, JWT_SECRET, { expiresIn: "30d" });
    res.json({ success:true, token });
  } catch (e) {
    res.status(400).json({ success:false, message:e.message.includes("UNIQUE") ? "Mobile already registered" : "Registration failed" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { mobile, password } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE mobile=?").get(mobile);
  if (!user || !(await bcrypt.compare(password || "", user.password_hash))) {
    return res.status(401).json({ success:false, message:"Invalid mobile or password" });
  }
  const token = jwt.sign({ id:user.id, mobile:user.mobile }, JWT_SECRET, { expiresIn:"30d" });
  res.json({ success:true, token });
});

app.get("/api/user/profile", auth, (req,res) => {
  const user = db.prepare("SELECT name,mobile,referral_code FROM users WHERE id=?").get(req.user.id);
  res.json(user || {});
});

app.get("/api/user/balance", auth, (req,res) => {
  const row = db.prepare("SELECT gaming_balance,winning_balance FROM balances WHERE user_id=?").get(req.user.id) || {};
  res.json(row);
});

app.get("/api/matches", auth, (req,res) => {
  const rows = db.prepare(`
    SELECT m.*,
      (SELECT COUNT(*) FROM match_players mp WHERE mp.match_id=m.id) AS players
    FROM matches m ORDER BY m.id DESC
  `).all();
  res.json({ matches: rows });
});

app.post("/api/matches/:id/join", auth, (req,res) => {
  const match = db.prepare("SELECT * FROM matches WHERE id=?").get(req.params.id);
  if (!match) return res.status(404).json({ success:false, message:"Match not found" });
  const count = db.prepare("SELECT COUNT(*) c FROM match_players WHERE match_id=?").get(match.id).c;
  if (count >= match.max_players) return res.status(400).json({ success:false, message:"Match is full" });
  if (match.status.toLowerCase() !== "upcoming") return res.status(400).json({ success:false, message:"Match is not open" });
  const bal = db.prepare("SELECT gaming_balance FROM balances WHERE user_id=?").get(req.user.id);
  if ((bal?.gaming_balance || 0) < match.entry_fee) return res.status(400).json({ success:false, message:"Insufficient gaming balance" });
  try {
    const tx = db.transaction(() => {
      db.prepare("INSERT INTO match_players (match_id,user_id) VALUES (?,?)").run(match.id, req.user.id);
      db.prepare("UPDATE balances SET gaming_balance=gaming_balance-? WHERE user_id=?").run(match.entry_fee, req.user.id);
      db.prepare("INSERT INTO transactions (user_id,type,amount,status) VALUES (?,?,?,'approved')").run(req.user.id,"match_entry",match.entry_fee);
    });
    tx();
    res.json({ success:true });
  } catch(e) {
    res.status(400).json({ success:false, message:e.message.includes("UNIQUE") ? "Already joined" : "Join failed" });
  }
});

app.post("/api/deposit", auth, (req,res) => {
  const { method, amount, transaction_id } = req.body;
  const n = Number(amount);
  if (!method || !n || n <= 0 || !transaction_id) return res.status(400).json({success:false,message:"Invalid deposit details"});
  db.prepare("INSERT INTO transactions (user_id,type,method,amount,transaction_id,status) VALUES (?,?,?,?,?,'pending')")
    .run(req.user.id,"deposit",method,n,transaction_id);
  res.json({success:true});
});

app.post("/api/withdraw", auth, (req,res) => {
  const { method, number, amount } = req.body;
  const n = Number(amount);
  if (!method || !number || !n || n <= 0) return res.status(400).json({success:false,message:"Invalid withdrawal details"});
  const bal = db.prepare("SELECT winning_balance FROM balances WHERE user_id=?").get(req.user.id);
  if ((bal?.winning_balance || 0) < n) return res.status(400).json({success:false,message:"Insufficient winning balance"});
  db.transaction(() => {
    db.prepare("UPDATE balances SET winning_balance=winning_balance-? WHERE user_id=?").run(n,req.user.id);
    db.prepare("INSERT INTO transactions (user_id,type,method,amount,number,status) VALUES (?,?,?,?,?,'pending')")
      .run(req.user.id,"withdraw",method,n,number);
  })();
  res.json({success:true});
});

app.get("/api/transactions", auth, (req,res) => {
  res.json({ transactions: db.prepare("SELECT type,method,amount,transaction_id,number,status,created_at FROM transactions WHERE user_id=? ORDER BY id DESC").all(req.user.id) });
});

app.post("/api/winning", auth, upload.single("screenshot"), (req,res) => {
  const { match_id, room_id } = req.body;
  if (!match_id || !room_id || !req.file) return res.status(400).json({success:false,message:"Match ID, Room ID and screenshot are required"});
  db.prepare("INSERT INTO winnings (user_id,match_id,room_id,screenshot) VALUES (?,?,?,?)")
    .run(req.user.id,match_id,room_id,req.file.filename);
  res.json({success:true});
});

app.post("/api/support", auth, (req,res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({success:false,message:"Message লিখুন"});
  db.prepare("INSERT INTO support_messages (user_id,message) VALUES (?,?)").run(req.user.id,message);
  res.json({success:true});
});

// Basic admin seed helpers are intentionally not exposed as public admin APIs.
// Create initial tournaments directly in the database or add an authenticated admin layer later.
app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req,res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, () => console.log(`Ludo Master server running on port ${PORT}`));
