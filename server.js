const express=require("express");
const cors=require("cors");
const fs=require("fs");
const path=require("path");
const bcrypt=require("bcryptjs");
const jwt=require("jsonwebtoken");
const multer=require("multer");

const app=express();
app.use(cors());
app.use(express.json({limit:"2mb"}));
app.use(express.urlencoded({extended:true}));

const PORT=process.env.PORT||3000;
const JWT_SECRET=process.env.JWT_SECRET||"change-this-secret";
const ADMIN_MOBILE=process.env.ADMIN_MOBILE||"01700000000";
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD||"ChangeMe123!";

const DATA_DIR=path.join(__dirname,"data");
const UPLOAD_DIR=path.join(__dirname,"uploads");
const DB_FILE=path.join(DATA_DIR,"database.json");
fs.mkdirSync(DATA_DIR,{recursive:true});
fs.mkdirSync(UPLOAD_DIR,{recursive:true});

const emptyDb={
  users:[], balances:[], matches:[], match_players:[],
  transactions:[], winnings:[], support_messages:[],
  announcements:[]
};
function loadDb(){
  try{
    if(!fs.existsSync(DB_FILE)){fs.writeFileSync(DB_FILE,JSON.stringify(emptyDb,null,2));}
    const db=JSON.parse(fs.readFileSync(DB_FILE,"utf8"));
    for(const k of Object.keys(emptyDb)) if(!Array.isArray(db[k])) db[k]=[];
    return db;
  }catch(e){return JSON.parse(JSON.stringify(emptyDb));}
}
let db=loadDb();
function saveDb(){fs.writeFileSync(DB_FILE,JSON.stringify(db,null,2));}
function nextId(list){return list.length?Math.max(...list.map(x=>Number(x.id)||0))+1:1;}
function getBalance(uid){
  let b=db.balances.find(x=>x.user_id===uid);
  if(!b){b={user_id:uid,gaming_balance:0,winning_balance:0};db.balances.push(b);saveDb();}
  return b;
}
function tokenFor(payload){return jwt.sign(payload,JWT_SECRET,{expiresIn:"30d"});}
function auth(req,res,next){
  const h=req.headers.authorization||"";
  if(!h.startsWith("Bearer ")) return res.status(401).json({message:"Login required"});
  try{req.user=jwt.verify(h.slice(7),JWT_SECRET);next();}
  catch(e){return res.status(401).json({message:"Invalid or expired token"});}
}
function adminAuth(req,res,next){
  const h=req.headers.authorization||"";
  if(!h.startsWith("Bearer ")) return res.status(401).json({message:"Admin login required"});
  try{
    const p=jwt.verify(h.slice(7),JWT_SECRET);
    if(p.role!=="admin") return res.status(403).json({message:"Admin only"});
    req.admin=p;next();
  }catch(e){return res.status(401).json({message:"Invalid admin token"});}
}
function tx(user_id,type,amount,status="approved",meta={}){
  const t={id:nextId(db.transactions),user_id,type,amount:Number(amount),status,created_at:new Date().toISOString(),...meta};
  db.transactions.push(t);return t;
}
const storage=multer({dest:UPLOAD_DIR});
app.use("/uploads",express.static(UPLOAD_DIR));

app.get("/api/health",(req,res)=>res.json({ok:true,service:"ludo-master",time:new Date().toISOString()}));

/* USER AUTH */
app.post("/api/auth/register",async(req,res)=>{
  const {name,mobile,password}=req.body;
  if(!name||!mobile||!password)return res.status(400).json({message:"Name, mobile and password required"});
  if(db.users.some(u=>u.mobile===mobile))return res.status(409).json({message:"Mobile already registered"});
  const id=nextId(db.users), hash=await bcrypt.hash(password,10);
  const user={id,name,mobile,password:hash,referral_code:(String(name).replace(/[^a-z0-9]/gi,"").slice(0,5)||"USER").toUpperCase()+id,blocked:false,created_at:new Date().toISOString()};
  db.users.push(user);db.balances.push({user_id:id,gaming_balance:0,winning_balance:0});saveDb();
  res.json({token:tokenFor({id,role:"user"}),user:{id,name,mobile,referral_code:user.referral_code}});
});
app.post("/api/auth/login",async(req,res)=>{
  const {mobile,password}=req.body;const u=db.users.find(x=>x.mobile===mobile);
  if(!u||u.blocked||!(await bcrypt.compare(password,u.password)))return res.status(401).json({message:"Invalid login or account blocked"});
  res.json({token:tokenFor({id:u.id,role:"user"}),user:{id:u.id,name:u.name,mobile:u.mobile,referral_code:u.referral_code}});
});
app.get("/api/user/profile",auth,(req,res)=>{
  const u=db.users.find(x=>x.id===req.user.id); if(!u)return res.status(404).json({message:"User not found"});
  res.json({user:{id:u.id,name:u.name,mobile:u.mobile,referral_code:u.referral_code}});
});
app.get("/api/user/balance",auth,(req,res)=>res.json(getBalance(req.user.id)));

/* USER MATCHES */
app.get("/api/matches",auth,(req,res)=>{
  res.json(db.matches.map(m=>({...m,players:db.match_players.filter(p=>p.match_id===m.id).length})));
});
app.post("/api/matches/:id/join",auth,(req,res)=>{
  const m=db.matches.find(x=>x.id===Number(req.params.id));
  if(!m)return res.status(404).json({message:"Match not found"});
  if(m.status!=="upcoming")return res.status(400).json({message:"Match is not open"});
  if(db.match_players.some(p=>p.match_id===m.id&&p.user_id===req.user.id))return res.status(400).json({message:"Already joined"});
  const count=db.match_players.filter(p=>p.match_id===m.id).length;
  if(count>=Number(m.max_players))return res.status(400).json({message:"Match full"});
  const b=getBalance(req.user.id);if(Number(b.gaming_balance)<Number(m.entry_fee))return res.status(400).json({message:"Insufficient gaming balance"});
  b.gaming_balance-=Number(m.entry_fee);
  db.match_players.push({id:nextId(db.match_players),match_id:m.id,user_id:req.user.id,joined_at:new Date().toISOString()});
  tx(req.user.id,"match_entry",m.entry_fee,"approved",{match_id:m.id});
  saveDb();res.json({message:"Joined successfully"});
});

/* USER MONEY */
app.post("/api/deposit",auth,(req,res)=>{
  const {method,amount,transaction_id}=req.body;
  if(!method||!Number(amount)||Number(amount)<=0||!transaction_id)return res.status(400).json({message:"Invalid deposit"});
  db.transactions.push({id:nextId(db.transactions),user_id:req.user.id,type:"deposit",amount:Number(amount),method,transaction_id,status:"pending",created_at:new Date().toISOString()});
  saveDb();res.json({message:"Deposit submitted"});
});
app.post("/api/withdraw",auth,(req,res)=>{
  const {method,number,amount}=req.body;
  if(!method||!number||!Number(amount)||Number(amount)<=0)return res.status(400).json({message:"Invalid withdrawal"});
  const b=getBalance(req.user.id);if(Number(b.winning_balance)<Number(amount))return res.status(400).json({message:"Insufficient winning balance"});
  b.winning_balance-=Number(amount);
  db.transactions.push({id:nextId(db.transactions),user_id:req.user.id,type:"withdraw",amount:Number(amount),method,number,status:"pending",created_at:new Date().toISOString()});
  saveDb();res.json({message:"Withdrawal submitted"});
});
app.get("/api/transactions",auth,(req,res)=>res.json(db.transactions.filter(t=>t.user_id===req.user.id).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))));
app.post("/api/winning",auth,storage.single("screenshot"),(req,res)=>{
  if(!req.body.match_id||!req.body.room_id||!req.file)return res.status(400).json({message:"Match, room and screenshot required"});
  db.winnings.push({id:nextId(db.winnings),user_id:req.user.id,match_id:Number(req.body.match_id),room_id:req.body.room_id,screenshot:"/uploads/"+path.basename(req.file.path),status:"pending",created_at:new Date().toISOString()});
  saveDb();res.json({message:"Winning submitted"});
});
app.post("/api/support",auth,(req,res)=>{
  if(!req.body.message)return res.status(400).json({message:"Message required"});
  db.support_messages.push({id:nextId(db.support_messages),user_id:req.user.id,message:req.body.message,reply:"",status:"open",created_at:new Date().toISOString()});
  saveDb();res.json({message:"Support message sent"});
});

/* ADMIN AUTH */
app.post("/api/admin/login",(req,res)=>{
  const {mobile,password}=req.body;
  if(mobile!==ADMIN_MOBILE||password!==ADMIN_PASSWORD)return res.status(401).json({message:"Invalid admin login"});
  res.json({token:tokenFor({role:"admin",mobile}),admin:{mobile}});
});

/* ADMIN DASHBOARD */
app.get("/api/admin/dashboard",adminAuth,(req,res)=>{
  const pending=db.transactions.filter(t=>t.status==="pending").length+db.winnings.filter(w=>w.status==="pending").length;
  const gaming=db.balances.reduce((s,b)=>s+Number(b.gaming_balance||0),0);
  const winning=db.balances.reduce((s,b)=>s+Number(b.winning_balance||0),0);
  res.json({users:db.users.length,matches:db.matches.length,gaming_balance:gaming,winning_balance:winning,pending_requests:pending,deposit_pending:db.transactions.filter(t=>t.type==="deposit"&&t.status==="pending").length,withdraw_pending:db.transactions.filter(t=>t.type==="withdraw"&&t.status==="pending").length,winning_pending:db.winnings.filter(w=>w.status==="pending").length});
});

/* ADMIN USERS */
app.get("/api/admin/users",adminAuth,(req,res)=>{
  const q=String(req.query.q||"").toLowerCase();
  const out=db.users.filter(u=>!q||u.name.toLowerCase().includes(q)||u.mobile.includes(q)).map(u=>({...u,password:undefined,balance:getBalance(u.id)}));
  res.json(out);
});
app.post("/api/admin/users/:id/block",adminAuth,(req,res)=>{
  const u=db.users.find(x=>x.id===Number(req.params.id));if(!u)return res.status(404).json({message:"User not found"});
  u.blocked=!u.blocked;saveDb();res.json({message:u.blocked?"User blocked":"User unblocked",blocked:u.blocked});
});
app.post("/api/admin/users/:id/balance",adminAuth,(req,res)=>{
  const b=getBalance(Number(req.params.id));const type=req.body.type;
  const amount=Number(req.body.amount);
  if(!["gaming","winning"].includes(type)||!Number.isFinite(amount))return res.status(400).json({message:"Invalid balance update"});
  if(type==="gaming")b.gaming_balance+=amount;else b.winning_balance+=amount;
  tx(Number(req.params.id),"admin_balance_adjustment",amount,"approved",{balance_type:type});
  saveDb();res.json({message:"Balance updated",balance:b});
});

/* ADMIN DEPOSITS/WITHDRAWS */
app.get("/api/admin/transactions",adminAuth,(req,res)=>{
  res.json(db.transactions.map(t=>({...t,user:db.users.find(u=>u.id===t.user_id)?.name||"Unknown",mobile:db.users.find(u=>u.id===t.user_id)?.mobile||""})).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)));
});
app.post("/api/admin/transactions/:id/action",adminAuth,(req,res)=>{
  const t=db.transactions.find(x=>x.id===Number(req.params.id));if(!t)return res.status(404).json({message:"Transaction not found"});
  if(t.status!=="pending")return res.status(400).json({message:"Already processed"});
  const action=req.body.action;if(!["approve","reject"].includes(action))return res.status(400).json({message:"Invalid action"});
  const b=getBalance(t.user_id);
  if(t.type==="deposit"&&action==="approve")b.gaming_balance+=Number(t.amount);
  if(t.type==="withdraw"&&action==="reject")b.winning_balance+=Number(t.amount);
  t.status=action==="approve"?"approved":"rejected";t.processed_at=new Date().toISOString();saveDb();
  res.json({message:"Transaction "+t.status,balance:b});
});

/* ADMIN MATCHES */
app.get("/api/admin/matches",adminAuth,(req,res)=>res.json(db.matches.map(m=>({...m,players:db.match_players.filter(p=>p.match_id===m.id).length})).sort((a,b)=>b.id-a.id)));
app.post("/api/admin/matches",adminAuth,(req,res)=>{
  const {title,entry_fee,prize,max_players,time,status="upcoming",room_id=""}=req.body;
  if(!title||Number(entry_fee)<0||Number(prize)<0||Number(max_players)<1)return res.status(400).json({message:"Invalid match data"});
  const m={id:nextId(db.matches),title,entry_fee:Number(entry_fee),prize:Number(prize),max_players:Number(max_players),time:time||"",status,room_id,created_at:new Date().toISOString()};
  db.matches.push(m);saveDb();res.json(m);
});
app.put("/api/admin/matches/:id",adminAuth,(req,res)=>{
  const m=db.matches.find(x=>x.id===Number(req.params.id));if(!m)return res.status(404).json({message:"Match not found"});
  for(const k of ["title","time","status","room_id"])if(req.body[k]!==undefined)m[k]=req.body[k];
  for(const k of ["entry_fee","prize","max_players"])if(req.body[k]!==undefined)m[k]=Number(req.body[k]);
  saveDb();res.json(m);
});
app.delete("/api/admin/matches/:id",adminAuth,(req,res)=>{
  const id=Number(req.params.id);const m=db.matches.find(x=>x.id===id);if(!m)return res.status(404).json({message:"Match not found"});
  db.matches=db.matches.filter(x=>x.id!==id);db.match_players=db.match_players.filter(x=>x.match_id!==id);saveDb();res.json({message:"Match deleted"});
});

/* ADMIN WINNINGS */
app.get("/api/admin/winnings",adminAuth,(req,res)=>res.json(db.winnings.map(w=>({...w,user:db.users.find(u=>u.id===w.user_id)?.name||"Unknown",mobile:db.users.find(u=>u.id===w.user_id)?.mobile||"",screenshot_url:w.screenshot})).sort((a,b)=>b.id-a.id)));
app.post("/api/admin/winnings/:id/action",adminAuth,(req,res)=>{
  const w=db.winnings.find(x=>x.id===Number(req.params.id));if(!w)return res.status(404).json({message:"Winning not found"});
  if(w.status!=="pending")return res.status(400).json({message:"Already processed"});
  const action=req.body.action;if(!["approve","reject"].includes(action))return res.status(400).json({message:"Invalid action"});
  if(action==="approve"){
    const m=db.matches.find(x=>x.id===w.match_id);if(!m)return res.status(400).json({message:"Match not found"});
    getBalance(w.user_id).winning_balance+=Number(m.prize||0);
    tx(w.user_id,"winning_prize",m.prize,"approved",{match_id:w.match_id,winning_id:w.id});
  }
  w.status=action==="approve"?"approved":"rejected";w.processed_at=new Date().toISOString();saveDb();res.json({message:"Winning "+w.status});
});

/* ADMIN SUPPORT */
app.get("/api/admin/support",adminAuth,(req,res)=>res.json(db.support_messages.map(s=>({...s,user:db.users.find(u=>u.id===s.user_id)?.name||"Unknown",mobile:db.users.find(u=>u.id===s.user_id)?.mobile||""})).sort((a,b)=>b.id-a.id)));
app.post("/api/admin/support/:id/reply",adminAuth,(req,res)=>{
  const s=db.support_messages.find(x=>x.id===Number(req.params.id));if(!s)return res.status(404).json({message:"Message not found"});
  s.reply=String(req.body.reply||"");s.status="replied";s.replied_at=new Date().toISOString();saveDb();res.json(s);
});

/* ANNOUNCEMENTS */
app.get("/api/announcements",(req,res)=>res.json(db.announcements.filter(a=>a.active!==false).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))));
app.get("/api/admin/announcements",adminAuth,(req,res)=>res.json(db.announcements.sort((a,b)=>b.id-a.id)));
app.post("/api/admin/announcements",adminAuth,(req,res)=>{
  if(!req.body.message)return res.status(400).json({message:"Announcement required"});
  const a={id:nextId(db.announcements),title:req.body.title||"Announcement",message:req.body.message,active:true,created_at:new Date().toISOString()};
  db.announcements.push(a);saveDb();res.json(a);
});
app.put("/api/admin/announcements/:id",adminAuth,(req,res)=>{
  const a=db.announcements.find(x=>x.id===Number(req.params.id));if(!a)return res.status(404).json({message:"Announcement not found"});
  if(req.body.title!==undefined)a.title=req.body.title;
  if(req.body.message!==undefined)a.message=req.body.message;
  if(req.body.active!==undefined)a.active=!!req.body.active;
  saveDb();res.json(a);
});
app.delete("/api/admin/announcements/:id",adminAuth,(req,res)=>{
  db.announcements=db.announcements.filter(x=>x.id!==Number(req.params.id));saveDb();res.json({message:"Announcement deleted"});
});

const publicDir=path.join(__dirname,"public");
app.use(express.static(publicDir));
app.get("/admin",(req,res)=>res.sendFile(path.join(publicDir,"admin.html")));
app.get("/",(req,res)=>res.sendFile(path.join(__dirname,"index.html")));
app.use((req,res)=>res.status(404).json({message:"Not found"}));
app.listen(PORT,"0.0.0.0",()=>console.log("Ludo Master server running on port "+PORT));
