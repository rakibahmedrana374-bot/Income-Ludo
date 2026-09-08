const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || "change-this-secret";

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({extended:true}));

const dataDir = path.join(__dirname,"data");
const uploadDir = path.join(__dirname,"uploads");
fs.mkdirSync(dataDir,{recursive:true});
fs.mkdirSync(uploadDir,{recursive:true});

const dbFile = path.join(dataDir,"database.json");
const blank = {
  users:[], balances:[], matches:[], match_players:[],
  transactions:[], winnings:[], support_messages:[]
};

if(!fs.existsSync(dbFile))
  fs.writeFileSync(dbFile,JSON.stringify(blank,null,2));

let db;
try { db=JSON.parse(fs.readFileSync(dbFile,"utf8")); }
catch { db=JSON.parse(JSON.stringify(blank)); }

function save(){ fs.writeFileSync(dbFile,JSON.stringify(db,null,2)); }
function id(a){ return a.length ? Math.max(...a.map(x=>Number(x.id)||0))+1 : 1; }

function auth(req,res,next){
  const h=req.headers.authorization||"";
  const token=h.startsWith("Bearer ")?h.slice(7):null;
  if(!token) return res.status(401).json({success:false,message:"Login required"});
  try { req.user=jwt.verify(token,SECRET); next(); }
  catch { res.status(401).json({success:false,message:"Invalid or expired token"}); }
}

function balance(uid){
  let b=db.balances.find(x=>Number(x.user_id)===Number(uid));
  if(!b){ b={user_id:uid,gaming_balance:0,winning_balance:0}; db.balances.push(b); save(); }
  return b;
}

function generateUserCode(){
  let code;
  do { code=String(Math.floor(100000 + Math.random()*900000)); }
  while(db.users.some(u=>u.user_code===code));
  return code;
}

function referral(name,uid){
  const n=String(name||"").replace(/[^a-z0-9]/gi,"").slice(0,5).toUpperCase()||"USER";
  return n+uid;
}

const storage=multer.diskStorage({
  destination:(req,file,cb)=>cb(null,uploadDir),
  filename:(req,file,cb)=>{
    const ext=path.extname(file.originalname||"").toLowerCase();
    cb(null,Date.now()+"-"+Math.random().toString(36).slice(2)+ext);
  }
});
const upload=multer({storage});

// Health
app.get("/api/health",(req,res)=>res.json({
  success:true,
  message:"Ludo Master backend is running"
}));

// Auth
app.post("/api/auth/register",async(req,res)=>{
  const {name,mobile,password}=req.body;
  if(!name||!mobile||!password)
    return res.status(400).json({success:false,message:"Name, mobile and password are required"});
  if(db.users.some(u=>u.mobile===mobile))
    return res.status(400).json({success:false,message:"Mobile already registered"});

  const uid=id(db.users);
  const hash=await bcrypt.hash(password,10);
  db.users.push({id:uid,name,mobile,password_hash:hash,user_code:generateUserCode(),referral_code:referral(name,uid),created_at:new Date().toISOString()});
  db.balances.push({user_id:uid,gaming_balance:0,winning_balance:0});
  save();

  const token=jwt.sign({id:uid,mobile},SECRET,{expiresIn:"30d"});
  const createdUser=db.users.find(u=>Number(u.id)===Number(uid));
  res.json({success:true,token,user_code:createdUser.user_code});
});

app.post("/api/auth/login",async(req,res)=>{
  const {mobile,password}=req.body;
  const u=db.users.find(x=>x.mobile===mobile);
  if(!u||!(await bcrypt.compare(password||"",u.password_hash)))
    return res.status(401).json({success:false,message:"Invalid mobile or password"});
  res.json({success:true,token:jwt.sign({id:u.id,mobile:u.mobile},SECRET,{expiresIn:"30d"})});
});

// User
app.get("/api/user/profile",auth,(req,res)=>{
  const u=db.users.find(x=>Number(x.id)===Number(req.user.id));
  if(!u) return res.status(404).json({success:false,message:"User not found"});
  if(!u.user_code){ u.user_code=generateUserCode(); save(); }
  res.json({name:u.name,mobile:u.mobile,user_code:u.user_code,referral_code:u.referral_code});
});

app.get("/api/user/balance",auth,(req,res)=>res.json(balance(req.user.id)));

// Matches
app.get("/api/matches",auth,(req,res)=>{
  const matches=db.matches.map(m=>({
    ...m,
    players:db.match_players.filter(p=>Number(p.match_id)===Number(m.id)).length
  }));
  res.json({matches});
});

app.post("/api/matches/:id/join",auth,(req,res)=>{
  const m=db.matches.find(x=>Number(x.id)===Number(req.params.id));
  if(!m) return res.status(404).json({success:false,message:"Match not found"});
  const players=db.match_players.filter(x=>Number(x.match_id)===Number(m.id));
  if(players.some(x=>Number(x.user_id)===Number(req.user.id)))
    return res.status(400).json({success:false,message:"Already joined"});
  if(players.length>=Number(m.max_players))
    return res.status(400).json({success:false,message:"Match is full"});
  if(String(m.status).toLowerCase()!=="upcoming")
    return res.status(400).json({success:false,message:"Match is not open"});

  const b=balance(req.user.id), fee=Number(m.entry_fee)||0;
  if(Number(b.gaming_balance)<fee)
    return res.status(400).json({success:false,message:"Insufficient gaming balance"});

  b.gaming_balance=Number(b.gaming_balance)-fee;
  db.match_players.push({id:id(db.match_players),match_id:m.id,user_id:req.user.id,joined_at:new Date().toISOString()});
  db.transactions.push({id:id(db.transactions),user_id:req.user.id,type:"match_entry",amount:fee,status:"approved",created_at:new Date().toISOString()});
  save();
  res.json({success:true});
});

// Deposit
app.post("/api/deposit",auth,(req,res)=>{
  const {method,amount,transaction_id}=req.body, n=Number(amount);
  if(!method||!n||n<=0||!transaction_id)
    return res.status(400).json({success:false,message:"Invalid deposit details"});
  db.transactions.push({id:id(db.transactions),user_id:req.user.id,type:"deposit",method,amount:n,transaction_id,status:"pending",created_at:new Date().toISOString()});
  save(); res.json({success:true});
});

// Withdraw
app.post("/api/withdraw",auth,(req,res)=>{
  const {method,number,amount}=req.body, n=Number(amount);
  if(!method||!number||!n||n<=0)
    return res.status(400).json({success:false,message:"Invalid withdrawal details"});
  const b=balance(req.user.id);
  if(Number(b.winning_balance)<n)
    return res.status(400).json({success:false,message:"Insufficient winning balance"});
  b.winning_balance=Number(b.winning_balance)-n;
  db.transactions.push({id:id(db.transactions),user_id:req.user.id,type:"withdraw",method,amount:n,number,status:"pending",created_at:new Date().toISOString()});
  save(); res.json({success:true});
});

// History
app.get("/api/transactions",auth,(req,res)=>{
  res.json({transactions:db.transactions.filter(x=>Number(x.user_id)===Number(req.user.id)).sort((a,b)=>b.id-a.id)});
});

// Winning
app.post("/api/winning",auth,upload.single("screenshot"),(req,res)=>{
  const {match_id,room_id}=req.body;
  if(!match_id||!room_id||!req.file)
    return res.status(400).json({success:false,message:"Match ID, Room ID and screenshot are required"});
  db.winnings.push({id:id(db.winnings),user_id:req.user.id,match_id,room_id,screenshot:req.file.filename,status:"pending",created_at:new Date().toISOString()});
  save(); res.json({success:true});
});

// Support
app.post("/api/support",auth,(req,res)=>{
  const {message}=req.body;
  if(!message) return res.status(400).json({success:false,message:"Message লিখুন"});
  db.support_messages.push({id:id(db.support_messages),user_id:req.user.id,message,created_at:new Date().toISOString()});
  save(); res.json({success:true});
});

// Serve BOTH root and public files.
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname,"public")));

app.get("/",(req,res)=>{
  const root=path.join(__dirname,"index.html");
  const pub=path.join(__dirname,"public","index.html");
  res.sendFile(fs.existsSync(root)?root:pub);
});

// Never crash because a missing static file is requested.
app.use((req,res)=>{
  if(req.path.startsWith("/api/"))
    return res.status(404).json({success:false,message:"API endpoint not found"});
  const root=path.join(__dirname,"index.html");
  const pub=path.join(__dirname,"public","index.html");
  if(fs.existsSync(root)) return res.sendFile(root);
  if(fs.existsSync(pub)) return res.sendFile(pub);
  res.status(404).send("index.html not found");
});

app.listen(PORT,"0.0.0.0",()=>console.log(`Ludo Master server running on port ${PORT}`));
