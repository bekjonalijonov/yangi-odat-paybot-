// ================================================
//  YANGI ODAT CLUB PRO BOT v2.0  —  Premium Subscription System
//  Professional HTML edition, Node >= 20
// ================================================

import TelegramBot from "node-telegram-bot-api";
import express from "express";
import bodyParser from "body-parser";
import fs from "fs";
import schedule from "node-schedule";

// ==================  ENV  =======================
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;               // -100XXXXXXXXXXXX
const PRICE = Number(process.env.PRICE || 40000);
const WEB_BASE_URL = process.env.WEB_BASE_URL;           // https://yourapp.up.railway.app
const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",")
  .map(x => Number(x.trim()))
  .filter(Boolean);
const AUTO_CHARGE_ENABLED = String(process.env.AUTO_CHARGE_ENABLED || "false").toLowerCase() === "true";

if (!BOT_TOKEN || !CHANNEL_ID || !WEB_BASE_URL) {
  console.error("❌ BOT_TOKEN, CHANNEL_ID, WEB_BASE_URL majburiy!");
  process.exit(1);
}

// ==================  UTILITIES  ==================
const DATA_FILE = "data.json";
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]", "utf-8");

const readUsers = () => JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
const writeUsers = (u) => fs.writeFileSync(DATA_FILE, JSON.stringify(u, null, 2), "utf-8");

function ensureUser(id, username = "") {
  const users = readUsers();
  let u = users.find(x => x.user_id === id);
  if (!u) {
    u = {
      user_id: id, username,
      status: "inactive", payment_method: "", joined_at: null, expires_at: null,
      retry_count: 0, bonus_days: 0, remind_on: true,
      history: []
    };
    users.push(u); writeUsers(users);
  }
  return u;
}
function updateUser(id, patch) {
  const u = readUsers(); const i = u.findIndex(x => x.user_id === id);
  if (i >= 0) { u[i] = { ...u[i], ...patch }; writeUsers(u); return u[i]; }
}
function pushPayment(id, item) {
  const u = readUsers(); const i = u.findIndex(x => x.user_id === id);
  if (i >= 0) { u[i].history.push(item); writeUsers(u); }
}
const daysLeft = d => d ? Math.ceil((new Date(d) - new Date()) / 86400000) : 0;
const escapeHtml = s => String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

// ==================  BOT STARTUP  =================
const bot = new TelegramBot(BOT_TOKEN, { polling: false });
(async()=>{
  await bot.deleteWebHook({ drop_pending_updates:true });
  await bot.startPolling();
  console.log("🤖 Bot polling started...");
})();

// ==================  MAIN MENU  ===================
function mainMenu() {
  return {
    inline_keyboard:[
      [{text:"🎯 Obunam", callback_data:"menu_sub"}],
      [{text:"💳 To‘lovlar tarixi", callback_data:"menu_payments"}],
      [{text:"⚙️ Sozlamalar", callback_data:"menu_settings"}],
      [{text:"📚 FAQ / Foydalanish shartlari", callback_data:"menu_faq"}],
      [{text:"📞 Aloqa va yordam", callback_data:"menu_support"}]
    ]
  };
}

// ==================  COMMANDS  ====================
bot.onText(/\/start/, (msg)=>{
  const id=msg.chat.id;
  const name=escapeHtml(msg.from?.first_name||"do‘st");
  ensureUser(id,msg.from?.username||"");
  bot.sendMessage(id,
`<b>👋 Salom, ${name}!</b>

Bu — <b>Yangi Odat Club Premium</b> obuna bot.

💰 Narx: <b>${PRICE.toLocaleString("ru-RU")} so‘m / oy</b>
⏳ Muddati: 30 kun

Quyidagi menyudan bo‘lim tanlang 👇`,
{parse_mode:"HTML", reply_markup:mainMenu()});
});

// ==========  CALLBACK MENUS  ============
bot.on("callback_query", async(q)=>{
  const id=q.from.id;
  const data=q.data;
  const u=ensureUser(id);

  switch(data){

  case "menu_sub": {
    const left=daysLeft(u.expires_at);
    const status=u.status==="active"?"✅ Faol":u.status==="grace"?"🟡 Kutilmoqda":"❌ Faolsiz";
    const text=`<b>📊 Mening obunam</b>Holat: ${status}
Boshlangan: <b>${u.joined_at?new Date(u.joined_at).toLocaleDateString():"–"}</b>
Tugash sana: <b>${u.expires_at?new Date(u.expires_at).toLocaleDateString():"–"}</b>
Qolgan: <b>${left>0?left+" kun":"–"}</b>
Bonus: <b>${u.bonus_days||0} kun</b>
To‘lov usuli: <b>${escapeHtml(u.payment_method||"–")}</b>

💳 Narx: <b>${PRICE.toLocaleString("ru-RU")} so‘m</b>`;
    const buttons=[
      [{text:"💳 Obunani yangilash (Click)", web_app:{url:`${WEB_BASE_URL}/pay?method=click&user=${id}`}}],
      [{text:"🌍 Obunani yangilash (Tribute)", web_app:{url:`${WEB_BASE_URL}/pay?method=tribute&user=${id}`}}],
      [{text:"⬅️ Ortga", callback_data:"back_main"}]
    ];
    return bot.editMessageText(text,{chat_id:id,message_id:q.message.message_id,parse_mode:"HTML",reply_markup:{inline_keyboard:buttons}});
  }

  case "menu_payments": {
    const hist=u.history.slice(-5).reverse();
    const list=hist.length?hist.map((h,i)=>`${i+1}. ${new Date(h.date).toLocaleDateString()} — ${h.amount} so‘m — ${h.method} ${h.status==="success"?"✅":"❌"}`).join("\n"):"Hech qanday to‘lov yo‘q.";
    const text=`<b>💳 So‘nggi to‘lovlar</b>\n\n${escapeHtml(list)}`;
    return bot.editMessageText(text,{chat_id:id,message_id:q.message.message_id,parse_mode:"HTML",reply_markup:{inline_keyboard:[[ {text:"⬅️ Ortga",callback_data:"back_main"} ]] }});
  }

  case "menu_settings": {
    const text=`<b>⚙️ Sozlamalar</b>\n\nEslatmalar: ${u.remind_on?"🔔 Yoqilgan":"🔕 O‘chik"}`;
    const btns=[[{text:u.remind_on?"🔕 O‘chirish":"🔔 Yoqish",callback_data:"toggle_remind"}],[{text:"⬅️ Ortga",callback_data:"back_main"}]];
    return bot.editMessageText(text,{chat_id:id,message_id:q.message.message_id,parse_mode:"HTML",reply_markup:{inline_keyboard:btns}});
  }

  case "menu_faq": {
    const text=`<b>📚 FAQ / Foydalanish shartlari</b>

1️⃣ Bot faqat premium a’zolar uchun kanalga kirish beradi.
2️⃣ To‘lov muddati 30 kun.
3️⃣ 3 kun to‘lov amalga oshmasa — chiqariladi.
4️⃣ Bonus kunlar tugamaguncha chiqarilmaydi.
5️⃣ To‘lov Click yoki Tribute orqali amalga oshiriladi.`;
    return bot.editMessageText(text,{chat_id:id,message_id:q.message.message_id,parse_mode:"HTML",reply_markup:{inline_keyboard:[[ {text:"⬅️ Ortga",callback_data:"back_main"} ]] }});
  }

  case "menu_support": {
    const text=`<b>📞 Aloqa va yordam</b>

Savollaringiz bo‘lsa — biz bilan bog‘laning:
📩 <code>@YangiOdatAdmin</code>
🌐 <code>https://t.me/YangiOdatClub</code>`;
    return bot.editMessageText(text,{chat_id:id,message_id:q.message.message_id,parse_mode:"HTML",reply_markup:{inline_keyboard:[[ {text:"⬅️ Ortga",callback_data:"back_main"} ]] }});
  }

  case "toggle_remind": {
    const newVal=!u.remind_on; updateUser(id,{remind_on:newVal});
    return bot.answerCallbackQuery(q.id,{text:newVal?"🔔 Eslatma yoqildi":"🔕 Eslatma o‘chirildi"});
  }

  case "back_main":
    return bot.editMessageText("Asosiy menyu 👇",{chat_id:id,message_id:q.message.message_id,parse_mode:"HTML",reply_markup:mainMenu()});

  default: return bot.answerCallbackQuery(q.id,{text:"..."});
  }
});

// ==================  EXPRESS APP  ==================
const app=express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended:true}));

// Payment page (mock)
app.get("/pay",(req,res)=>{
  const method=req.query.method||"click"; const user=req.query.user;
  if(!user) return res.status(400).send("user id yo‘q");
  res.send(`<!DOCTYPE html><html><body style="font-family:Arial;padding:30px">
<h2>Yangi Odat Club — Obuna to‘lovi</h2>
<p>Foydalanuvchi: <b>${user}</b></p>
<p>Usul: <b>${method.toUpperCase()}</b></p>
<p>Summa: <b>${PRICE.toLocaleString("ru-RU")} so‘m</b></p>
<form method="POST" action="/payment/mock">
<input type="hidden" name="user" value="${user}"/><input type="hidden" name="method" value="${method}"/>
<button style="padding:10px 20px">✅ Sinov uchun to‘lovni tasdiqlash</button>
</form></body></html>`);
});// Mock payment confirmation
app.post("/payment/mock",async(req,res)=>{
 try{
  const userId=Number(req.body.user); const method=req.body.method;
  const now=new Date(); const exp=new Date(now); exp.setDate(exp.getDate()+30);
  ensureUser(userId);
  updateUser(userId,{status:"active",payment_method:method,joined_at:now.toISOString(),expires_at:exp.toISOString(),retry_count:0});
  pushPayment(userId,{date:now.toISOString(),amount:PRICE,method,status:"success"});

  // Har to‘lov uchun yangi 1 kunlik link yaratish
  let inviteLink="https://t.me/YangiOdatClub";
  try{
    const invite=await bot.createChatInviteLink(CHANNEL_ID,{member_limit:1,expire_date:Math.floor(Date.now()/1000)+86400});
    inviteLink=invite.invite_link;
  }catch(e){console.error("Invite link xato:",e.message);}

  await bot.sendMessage(userId,
`✅ To‘lov tasdiqlandi (test).

Siz 30 kunlik PREMIUM a’zolikka ega bo‘ldingiz!  

🌱 Kanalga kirish uchun havola 👇`,
{parse_mode:"HTML",reply_markup:{inline_keyboard:[[ {text:"🌱 Premium kanalga kirish",url:inviteLink} ]]}});

  res.send("<p>✅ Test to‘lov tasdiqlandi. Telegram’ga qayting.</p>");
 }catch(e){console.error(e);res.status(500).send("Server xato");}
});

// ==================  CRON JOBS  ===================
schedule.scheduleJob("0 */12 * * *",
async()=>{
  const users=readUsers(); const now=new Date();
  for(const u of users){
    if(u.bonus_days>0) continue;
    if(!["active","grace"].includes(u.status)) continue;
    if(!u.expires_at||new Date(u.expires_at)>now) continue;

    const rc=(u.retry_count||0)+1; updateUser(u.user_id,{retry_count:rc,status:"grace"});
    if(rc>=3){
      try{await bot.kickChatMember(CHANNEL_ID,u.user_id);
        updateUser(u.user_id,{status:"inactive"});
        await bot.sendMessage(u.user_id,"❌ To‘lov amalga oshmadi. Premium kanaldan chiqarildingiz.",{parse_mode:"HTML"});
      }catch(e){console.error("Kick xato:",e.message);}
    }else if(u.remind_on){
      await bot.sendMessage(u.user_id,`⚠️ To‘lov muvaffaqiyatsiz (urinish ${rc}/3).\nIltimos, kartangizni to‘ldiring yoki obunani yangilang.`,{parse_mode:"HTML"});
    }
  }
});

// Bonusni har 09:00 da 1 kun kamaytirish
schedule.scheduleJob("0 9 * * *",()=>{
  const u=readUsers(); let ch=false;
  for(const x of u){if(x.bonus_days>0){x.bonus_days--; ch=true;}}
  if(ch) writeUsers(u);
});

// ==================  SERVER START  =================
const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log(✅ Server ishga tushdi → ${PORT}));
