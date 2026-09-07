const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_THIS_IN_RENDER";

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const DATA_DIR = path.join(__dirname, "data");
const UPLOAD_DIR = path.join(__dirname, "uploads");
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const DB_FILE = path.join(DATA_DIR, "database.json");
const initialDB = {
  users: [],
  balances: [],
  matches: [],
  match_players: [],
  transactions: [],
  winnings: [],
  support_messages: []
};

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(initialDB, null, 2));
  }
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
    fs.writeFileSync(DB_FILE, JSON.stringify(initialDB, null, 2));
    return JSON.parse(JSON.stringify(initialDB));
  }
}
let db = loadDB();

function saveDB() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function nextId(items) {
  return items.length ? Math.max(...items.map(x => Number(x.id) || 0)) + 1 : 1;
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({success:false,message:"Login required"});
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({success:false,message:"Invalid or expired token"});
  }
}

function getBalance(userId) {
  let b = db.balances.find(x => Number(x.user_id) === Number(userId));
  if (!b) {
    b = {user_id:userId, gaming_balance:0, winning_balance:0};
    db.balances.push(b);
    saveDB();
  }
  return b;
}

function makeReferral(name, id) {
  const clean = String(name || "").replace(/[^a-z0-9]/gi,"").slice(0,5).toUpperCase() || "USER";
  return clean + id;
}

const storage = multer.diskStorage({
  destination: (req,file,cb) => cb(null,UPLOAD_DIR),
  filename: (req,file,cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    cb(null, Date.now()+"-"+Math.random().toString(36).slice(2)+ext);
  }
});
const upload = multer({storage});

// Health check
app.get("/api/health",(req,res) => {
  res.json({success:true,message:"Ludo Master backend is running"});
});

// AUTH
app.post("/api/auth/register", async (req,res) => {
  const {name,mobile,password} = req.body;
  if (!name || !mobile || !password)
    return res.status(400).json({success:false,message:"Name, mobile and password are required"});

  if (db.users.some(u => u.mobile === mobile))
    return res.status(400).json({success:false,message:"Mobile already registered"});

  const id = nextId(db.users);
  const password_hash = await bcrypt.hash(password,10);

  db.users.push({
    id,name,mobile,password_hash,
    referral_code:makeReferral(name,id),
    created_at:new Date().toISOString()
  });
  db.balances.push({user_id:id,gaming_balance:0,winning_balance:0});
  saveDB();

  const token = jwt.sign({id,mobile},JWT_SECRET,{expiresIn:"30d"});
  res.json({success:true,token});
});

app.post("/api/auth/login", async (req,res) => {
  const {mobile,password} = req.body;
  const user = db.users.find(u => u.mobile === mobile);

  if (!user || !(await bcrypt.compare(password || "",user.password_hash)))
    return res.status(401).json({success:false,message:"Invalid mobile or password"});

  const token = jwt.sign({id:user.id,mobile:user.mobile},JWT_SECRET,{expiresIn:"30d"});
  res.json({success:true,token});
});

// USER
app.get("/api/user/profile",auth,(req,res) => {
  const u = db.users.find(x => Number(x.id) === Number(req.user.id));
  if (!u) return res.status(404).json({success:false,message:"User not found"});
  res.json({name:u.name,mobile:u.mobile,referral_code:u.referral_code});
});

app.get("/api/user/balance",auth,(req,res) => {
  res.json(getBalance(req.user.id));
});

// MATCHES
app.get("/api/matches",auth,(req,res) => {
  const matches = db.matches.map(m => ({
    ...m,
    players:db.match_players.filter(p => Number(p.match_id) === Number(m.id)).length
  }));
  res.json({matches});
});

app.post("/api/matches/:id/join",auth,(req,res) => {
  const match = db.matches.find(m => Number(m.id) === Number(req.params.id));
  if (!match) return res.status(404).json({success:false,message:"Match not found"});

  const players = db.match_players.filter(p => Number(p.match_id) === Number(match.id));
  if (players.some(p => Number(p.user_id) === Number(req.user.id)))
    return res.status(400).json({success:false,message:"Already joined"});
  if (players.length >= Number(match.max_players))
    return res.status(400).json({success:false,message:"Match is full"});
  if (String(match.status).toLowerCase() !== "upcoming")
    return res.status(400).json({success:false,message:"Match is not open"});

  const fee = Number(match.entry_fee) || 0;
  const balance = getBalance(req.user.id);
  if (Number(balance.gaming_balance) < fee)
    return res.status(400).json({success:false,message:"Insufficient gaming balance"});

  balance.gaming_balance = Number(balance.gaming_balance) - fee;
  db.match_players.push({
    id:nextId(db.match_players),
    match_id:match.id,
    user_id:req.user.id,
    joined_at:new Date().toISOString()
  });
  db.transactions.push({
    id:nextId(db.transactions),
    user_id:req.user.id,
    type:"match_entry",
    amount:fee,
    status:"approved",
    created_at:new Date().toISOString()
  });
  saveDB();
  res.json({success:true});
});

// DEPOSIT
app.post("/api/deposit",auth,(req,res) => {
  const {method,amount,transaction_id} = req.body;
  const n = Number(amount);
  if (!method || !n || n <= 0 || !transaction_id)
    return res.status(400).json({success:false,message:"Invalid deposit details"});

  db.transactions.push({
    id:nextId(db.transactions),
    user_id:req.user.id,
    type:"deposit",
    method,
    amount:n,
    transaction_id,
    status:"pending",
    created_at:new Date().toISOString()
  });
  saveDB();
  res.json({success:true});
});

// WITHDRAW
app.post("/api/withdraw",auth,(req,res) => {
  const {method,number,amount} = req.body;
  const n = Number(amount);
  if (!method || !number || !n || n <= 0)
    return res.status(400).json({success:false,message:"Invalid withdrawal details"});

  const balance = getBalance(req.user.id);
  if (Number(balance.winning_balance) < n)
    return res.status(400).json({success:false,message:"Insufficient winning balance"});

  balance.winning_balance = Number(balance.winning_balance) - n;
  db.transactions.push({
    id:nextId(db.transactions),
    user_id:req.user.id,
    type:"withdraw",
    method,
    amount:n,
    number,
    status:"pending",
    created_at:new Date().toISOString()
  });
  saveDB();
  res.json({success:true});
});

// HISTORY
app.get("/api/transactions",auth,(req,res) => {
  const transactions = db.transactions
    .filter(x => Number(x.user_id) === Number(req.user.id))
    .sort((a,b) => Number(b.id)-Number(a.id));
  res.json({transactions});
});

// WINNING
app.post("/api/winning",auth,upload.single("screenshot"),(req,res) => {
  const {match_id,room_id} = req.body;
  if (!match_id || !room_id || !req.file)
    return res.status(400).json({success:false,message:"Match ID, Room ID and screenshot are required"});

  db.winnings.push({
    id:nextId(db.winnings),
    user_id:req.user.id,
    match_id,
    room_id,
    screenshot:req.file.filename,
    status:"pending",
    created_at:new Date().toISOString()
  });
  saveDB();
  res.json({success:true});
});

// SUPPORT
app.post("/api/support",auth,(req,res) => {
  const {message} = req.body;
  if (!message)
    return res.status(400).json({success:false,message:"Message লিখুন"});

  db.support_messages.push({
    id:nextId(db.support_messages),
    user_id:req.user.id,
    message,
    created_at:new Date().toISOString()
  });
  saveDB();
  res.json({success:true});
});

// Serve the frontend from the project ROOT.
// This avoids the previous public/index.html ENOENT problem.
app.use(express.static(__dirname));

app.get("/",(req,res) => {
  res.sendFile(path.join(__dirname,"index.html"));
});

app.listen(PORT,"0.0.0.0",() => {
  console.log(`Ludo Master server running on port ${PORT}`);
});
