const express=require("express");
const cors=require("cors");
const fs=require("fs");
const path=require("path");
const bcrypt=require("bcryptjs");
const jwt=require("jsonwebtoken");
const multer=require("multer");

const app=express();
const PORT=process.env.PORT||3000;
const SECRET=process.env.JWT_SECRET||"change-this-secret";
const ADMIN_MOBILE=process.env.ADMIN_MOBILE||"01700000000";
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD||"ChangeMe123!";

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({extended:true}));

const dataDir=path.join(__dirname,"data");
const uploadDir=path.join(__dirname,"uploads");
fs.mkdirSync(dataDir,{recursive:true});
fs.mkdirSync(uploadDir,{recursive:true});
const dbFile=path.join(dataDir,"database.json");

const blank={
  users:[],balances:[],matches:[],match_players:[],transactions:[],
  winnings:[],support_messages:[],
  settings:{announcement:"স্বাগতম Ludo Master-এ ❤️"}
};

let db;
if(!fs.existsSync(dbFile)) fs.writeFileSync(dbFile,JSON.stringify(blank,null,2));
try{db=JSON.parse(fs.readFileSync(dbFile,"utf8"));}catch{db=JSON.parse(JSON.stringify(blank));}
for(const k of Object.keys(blank)) if(db[k]===undefined) db[k]=JSON.parse(JSON.stringify(blank[k]));

function save(){fs.writeFileSync(dbFile,JSON.stringify(db,null,2))}
function id(a){return a.length?Math.max(...a.map(x=>Number(x.id)||0))+1:1}
function now(){return new Date().toISOString()}
function auth(req,res,next){const h=req.headers.authorization||"";const t=h.startsWith("Bearer ")?h.slice(7):null;if(!t)return res.status(401).json({success:false,message:"Login required"});try{req.user=jwt.verify(t,SECRET);next()}catch{return res.status(401).json({success:false,message:"Invalid or expired token"})}}
function adminAuth(req,res,next){const h=req.headers.authorization||"";const t=h.startsWith("Bearer ")?h.slice(7):null;if(!t)return res.status(401).json({success:false,message:"Admin login required"});try{const a=jwt.verify(t,SECRET);if(a.role!=="admin")throw Error();req.admin=a;next()}catch{return res.status(401).json({success:false,message:"Invalid admin token"})}}
function balance(uid){let b=db.balances.find(x=>Number(x.user_id)===Number(uid));if(!b){b={user_id:Number(uid),gaming_balance:0,winning_balance:0};db.balances.push(b);save()}return b}
function referral(name,uid){const n=String(name||"").replace(/[^a-z0-9]/gi,"").slice(0,5).toUpperCase()||"USER";return n+uid}

const storage=multer.diskStorage({destination:(req,file,cb)=>cb(null,uploadDir),filename:(req,file,cb)=>{const ext=path.extname(file.originalname||"").toLowerCase();cb(null,Date.now()+"-"+Math.random().toString(36).slice(2)+ext)}});
const upload=multer({storage});

app.get("/api/health",(req,res)=>res.json({success:true,message:"Ludo Master backend is running"}));

app.post("/api/auth/register",async(req,res)=>{
 const {name,mobile,password}=req.body;
 if(!name||!mobile||!password)return res.status(400).json({success:false,message:"Name, mobile and password are required"});
 if(db.users.some(u=>u.mobile===mobile))return res.status(400).json({success:false,message:"Mobile already registered"});
 const uid=id(db.users),hash=await bcrypt.hash(password,10);
 db.users.push({id:uid,name,mobile,password_hash:hash,referral_code:referral(name,uid),created_at:now()});
 db.balances.push({user_id:uid,gaming_balance:0,winning_balance:0});save();
 res.json({success:true,token:jwt.sign({id:uid,mobile},SECRET,{expiresIn:"30d"})});
});
app.post("/api/auth/login",async(req,res)=>{
 const {mobile,password}=req.body,u=db.users.find(x=>x.mobile===mobile);
 if(!u||!(await bcrypt.compare(password||"",u.password_hash)))return res.status(401).json({success:false,message:"Invalid mobile or password"});
 res.json({success:true,token:jwt.sign({id:u.id,mobile:u.mobile},SECRET,{expiresIn:"30d"})});
});
app.get("/api/user/profile",auth,(req,res)=>{const u=db.users.find(x=>Number(x.id)===Number(req.user.id));if(!u)return res.status(404).json({success:false,message:"User not found"});res.json({name:u.name,mobile:u.mobile,referral_code:u.referral_code})});
app.get("/api/user/balance",auth,(req,res)=>res.json(balance(req.user.id)));

app.get("/api/matches",auth,(req,res)=>res.json({matches:db.matches.map(m=>({...m,players:db.match_players.filter(p=>Number(p.match_id)===Number(m.id)).length}))}));
app.post("/api/matches/:id/join",auth,(req,res)=>{
 const m=db.matches.find(x=>Number(x.id)===Number(req.params.id));if(!m)return res.status(404).json({success:false,message:"Match not found"});
 const ps=db.match_players.filter(x=>Number(x.match_id)===Number(m.id));
 if(ps.some(x=>Number(x.user_id)===Number(req.user.id)))return res.status(400).json({success:false,message:"Already joined"});
 if(ps.length>=Number(m.max_players))return res.status(400).json({success:false,message:"Match is full"});
 if(String(m.status).toLowerCase()!=="upcoming")return res.status(400).json({success:false,message:"Match is not open"});
 const b=balance(req.user.id),fee=Number(m.entry_fee)||0;if(Number(b.gaming_balance)<fee)return res.status(400).json({success:false,message:"Insufficient gaming balance"});
 b.gaming_balance-=fee;db.match_players.push({id:id(db.match_players),match_id:m.id,user_id:req.user.id,joined_at:now()});
 db.transactions.push({id:id(db.transactions),user_id:req.user.id,type:"match_entry",amount:fee,status:"approved",created_at:now()});save();
 res.json({success:true,message:"Match joined successfully"});
});

app.post("/api/deposit",auth,(req,res)=>{
 const {method,amount,transaction_id}=req.body,n=Number(amount);
 if(!method||!n||n<=0||!transaction_id)return res.status(400).json({success:false,message:"Invalid deposit details"});
 db.transactions.push({id:id(db.transactions),user_id:req.user.id,type:"deposit",method,amount:n,transaction_id,status:"pending",created_at:now()});save();
 res.json({success:true,message:"Deposit request submitted"});
});
app.post("/api/withdraw",auth,(req,res)=>{
 const {method,number,amount}=req.body,n=Number(amount);if(!method||!number||!n||n<=0)return res.status(400).json({success:false,message:"Invalid withdrawal details"});
 const b=balance(req.user.id);if(Number(b.winning_balance)<n)return res.status(400).json({success:false,message:"Insufficient winning balance"});
 b.winning_balance-=n;
 db.transactions.push({id:id(db.transactions),user_id:req.user.id,type:"withdraw",method,amount:n,number,status:"pending",created_at:now()});save();
 res.json({success:true,message:"Withdraw request submitted"});
});
app.get("/api/transactions",auth,(req,res)=>res.json({transactions:db.transactions.filter(x=>Number(x.user_id)===Number(req.user.id)).sort((a,b)=>b.id-a.id)}));

app.post("/api/winning",auth,upload.single("screenshot"),(req,res)=>{
 const {match_id,room_id}=req.body;if(!match_id||!room_id||!req.file)return res.status(400).json({success:false,message:"Match ID, Room ID and screenshot are required"});
 db.winnings.push({id:id(db.winnings),user_id:req.user.id,match_id,room_id,screenshot:req.file.filename,status:"pending",created_at:now()});save();
 res.json({success:true,message:"Winning submitted successfully"});
});
app.post("/api/support",auth,(req,res)=>{
 const {message}=req.body;if(!message)return res.status(400).json({success:false,message:"Message লিখুন"});
 db.support_messages.push({id:id(db.support_messages),user_id:req.user.id,message,status:"open",created_at:now()});save();res.json({success:true,message:"Message sent"});
});

app.post("/api/admin/login",(req,res)=>{
 const {mobile,password}=req.body;
 if(mobile!==ADMIN_MOBILE||password!==ADMIN_PASSWORD)return res.status(401).json({success:false,message:"Invalid admin credentials"});
 res.json({success:true,token:jwt.sign({role:"admin",mobile},SECRET,{expiresIn:"12h"})});
});

app.get("/api/admin/dashboard",adminAuth,(req,res)=>{
 const users=db.users.length,g=db.balances.reduce((s,b)=>s+Number(b.gaming_balance||0),0),w=db.balances.reduce((s,b)=>s+Number(b.winning_balance||0),0);
 res.json({users,gaming_balance:g,winning_balance:w,pending_deposits:db.transactions.filter(x=>x.type==="deposit"&&x.status==="pending").length,pending_withdraws:db.transactions.filter(x=>x.type==="withdraw"&&x.status==="pending").length,pending_winnings:db.winnings.filter(x=>x.status==="pending").length});
});
function withUser(item){const u=db.users.find(x=>Number(x.id)===Number(item.user_id))||{};return {...item,user_name:u.name||"Unknown",mobile:u.mobile||""}}

app.get("/api/admin/deposits",adminAuth,(req,res)=>res.json({items:db.transactions.filter(x=>x.type==="deposit"&&(!req.query.status||x.status===req.query.status)).sort((a,b)=>b.id-a.id).map(withUser)}));
app.get("/api/admin/withdraws",adminAuth,(req,res)=>res.json({items:db.transactions.filter(x=>x.type==="withdraw"&&(!req.query.status||x.status===req.query.status)).sort((a,b)=>b.id-a.id).map(withUser)}));
app.post("/api/admin/deposit/:id/review",adminAuth,(req,res)=>{
 const t=db.transactions.find(x=>x.id==req.params.id&&x.type==="deposit");if(!t)return res.status(404).json({success:false,message:"Deposit not found"});if(t.status!=="pending")return res.status(400).json({success:false,message:"Already reviewed"});
 const st=req.body.status;if(!["approved","rejected"].includes(st))return res.status(400).json({success:false,message:"Invalid status"});
 t.status=st;if(st==="approved")balance(t.user_id).gaming_balance+=Number(t.amount||0);save();res.json({success:true,message:"Deposit "+st});
});
app.post("/api/admin/withdraw/:id/review",adminAuth,(req,res)=>{
 const t=db.transactions.find(x=>x.id==req.params.id&&x.type==="withdraw");if(!t)return res.status(404).json({success:false,message:"Withdraw not found"});if(t.status!=="pending")return res.status(400).json({success:false,message:"Already reviewed"});
 const st=req.body.status;if(!["approved","rejected"].includes(st))return res.status(400).json({success:false,message:"Invalid status"});
 t.status=st;if(st==="rejected")balance(t.user_id).winning_balance+=Number(t.amount||0);save();res.json({success:true,message:"Withdraw "+st});
});

app.get("/api/admin/matches",adminAuth,(req,res)=>res.json({items:db.matches.map(m=>({...m,players:db.match_players.filter(p=>p.match_id==m.id).length})).sort((a,b)=>b.id-a.id)}));
app.post("/api/admin/matches",adminAuth,(req,res)=>{
 const {title,entry_fee,prize,max_players,time,status}=req.body,n=Number(entry_fee),p=Number(prize),mx=Number(max_players);
 if(!title||n<0||p<0||mx<1)return res.status(400).json({success:false,message:"Invalid match details"});
 db.matches.push({id:id(db.matches),title,entry_fee:n,prize:p,max_players:mx,time:time||"",status:status||"upcoming",created_at:now()});save();res.json({success:true,message:"Match created"});
});
app.delete("/api/admin/matches/:id",adminAuth,(req,res)=>{
 const m=db.matches.find(x=>x.id==req.params.id);if(!m)return res.status(404).json({success:false,message:"Match not found"});
 if(db.match_players.some(x=>x.match_id==m.id))return res.status(400).json({success:false,message:"Cannot delete a match with players"});
 db.matches=db.matches.filter(x=>x.id!=m.id);save();res.json({success:true,message:"Match deleted"});
});

app.get("/api/admin/users",adminAuth,(req,res)=>res.json({items:db.users.map(u=>{const b=balance(u.id);return {id:u.id,name:u.name,mobile:u.mobile,gaming_balance:Number(b.gaming_balance||0),winning_balance:Number(b.winning_balance||0),created_at:u.created_at}})}));
app.get("/api/admin/winnings",adminAuth,(req,res)=>res.json({items:db.winnings.filter(x=>!req.query.status||x.status===req.query.status).sort((a,b)=>b.id-a.id).map(withUser)}));
app.post("/api/admin/winning/:id/review",adminAuth,(req,res)=>{
 const w=db.winnings.find(x=>x.id==req.params.id);if(!w)return res.status(404).json({success:false,message:"Winning not found"});if(w.status!=="pending")return res.status(400).json({success:false,message:"Already reviewed"});
 const st=req.body.status;if(!["approved","rejected"].includes(st))return res.status(400).json({success:false,message:"Invalid status"});
 w.status=st;
 if(st==="approved"){const m=db.matches.find(x=>x.id==w.match_id);if(m)balance(w.user_id).winning_balance+=Number(m.prize||0);db.transactions.push({id:id(db.transactions),user_id:w.user_id,type:"winning",amount:Number(m?.prize||0),status:"approved",created_at:now()})}
 save();res.json({success:true,message:"Winning "+st});
});
app.get("/api/admin/support",adminAuth,(req,res)=>res.json({items:db.support_messages.sort((a,b)=>b.id-a.id).map(withUser)}));
app.get("/api/admin/announcement",adminAuth,(req,res)=>res.json({text:db.settings.announcement||""}));
app.post("/api/admin/announcement",adminAuth,(req,res)=>{db.settings.announcement=String(req.body.text||"");save();res.json({success:true,message:"Announcement saved"})});

app.use("/uploads",express.static(uploadDir));
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname,"public")));
app.get("/admin",(req,res)=>res.sendFile(path.join(__dirname,"admin.html")));
app.get("/",(req,res)=>res.sendFile(path.join(__dirname,"index.html")));
app.use((req,res)=>{if(req.path.startsWith("/api/"))return res.status(404).json({success:false,message:"API endpoint not found"});if(req.path==="/admin")return res.sendFile(path.join(__dirname,"admin.html"));res.sendFile(path.join(__dirname,"index.html"))});

app.listen(PORT,"0.0.0.0",()=>console.log(`Ludo Master server running on port ${PORT}`));
