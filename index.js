// ================================================
//  Yangi Odat Club — Premium Subscription Bot (Mongo Edition)
//  Node >= 20, Railway MongoDB
// ================================================

import TelegramBot from "node-telegram-bot-api";
import express from "express";
import bodyParser from "body-parser";
import mongoose from "mongoose";
import schedule from "node-schedule";

import User from "./models/User.js";
import Payment from "./models/Payment.js";

// ===================== ENV ======================
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const PRICE = Number(process.env.PRICE || 40000);
const WEB_BASE_URL = process.env.WEB_BASE_URL;
const AUTO_CHARGE_ENABLED = String(process.env.AUTO_CHARGE_ENABLED || "false").toLowerCase() === "true";
const MONGO_URI = process.env.MONGODB_URL;

if (!BOT_TOKEN || !CHANNEL_ID || !WEB_BASE_URL || !MONGO_URI) {
  console.error("❌ BOT_TOKEN, CHANNEL_ID, WEB_BASE_URL, MONGODB_URL kerak!");
  process.exit(1);
}

// ===================== MONGO =====================
mongoose.connect(MONGO_URI, {
  dbName: "yangiOdatDB"
})
.then(() => console.log("🍃 MongoDB ulandi"))
.catch(err => console.error("❌ Mongo xato:", err));

// ===================== BOT =======================
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log("🤖 Bot ishlayapti...");

// ===================== HELPERS ===================
async function ensureUser(id, username = "") {
  let u = await User.findOne({ user_id: id });
  if (!u) {
    u = await User.create({ user_id: id, username });
  }
  return u;
}

async function updateUser(id, patch) {
  return await User.findOneAndUpdate(
    { user_id: id },
    { $set: patch },
    { new: true }
  );
}

async function addPayment(id, data) {
  await Payment.create({ user_id: id, ...data });
  await User.updateOne(
    { user_id: id },
    { $push: { history: data } }
  );
}

// ===================== UI MENU ===================
function mainMenu() {
  return {
    inline_keyboard: [
      [{ text: "🎯 Obunam", callback_data: "menu_sub" }],
      [{ text: "💳 To‘lovlar tarixi", callback_data: "menu_payments" }],
      [{ text: "⚙️ Sozlamalar", callback_data: "menu_settings" }],
      [{ text: "📚 FAQ", callback_data: "menu_faq" }],
      [{ text: "📞 Yordam", callback_data: "menu_support" }]
    ]
  };
}

const escapeHtml = s =>
  String(s || "").replace(/&/g, "&amp;")
                 .replace(/</g, "&lt;")
                 .replace(/>/g, "&gt;");

// ===================== /START ====================
bot.onText(/\/start/, async (msg) => {
  const id = msg.chat.id;
  const name = escapeHtml(msg.from.first_name || "do‘st");

  await ensureUser(id, msg.from.username);

  bot.sendMessage(id, `
<b>👋 Salom, ${name}!</b>

Bu bot orqali Yangi Odat Club Premium obunasini boshqarasiz.

💰 Narx: <b>${PRICE} so‘m / oy</b>
⏳ Muddati: 30 kun

👇 Quyidagi menyulardan foydalaning:
`, { parse_mode: "HTML", reply_markup: mainMenu() });
});

// ===================== MENU HANDLER ==============
bot.on("callback_query", async (q) => {
  const id = q.from.id;
  const data = q.data;
  const u = await ensureUser(id);

  switch (data) {

    case "menu_sub": {
      const left = u.expires_at
        ? Math.ceil((new Date(u.expires_at) - new Date()) / 86400000)
        : 0;

      const status =
        u.status === "active" ? "✅ Faol"
        : u.status === "grace" ? "🟡 Kutilmoqda"
        : "❌ Faolsiz";

      const text = `
<b>📊 Obuna holati</b>

Holat: ${status}
Boshlangan: <b>${u.joined_at ? new Date(u.joined_at).toLocaleDateString() : "-"}</b>
Tugash: <b>${u.expires_at ? new Date(u.expires_at).toLocaleDateString() : "-"}</b>
Qolgan kun: <b>${left}</b>
Bonus kunlar: <b>${u.bonus_days}</b>

💳 Yangilash:
`;

      return bot.editMessageText(text, {
        chat_id: id,
        message_id: q.message.message_id,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "💳 Click orqali", web_app: { url: `${WEB_BASE_URL}/pay?method=click&user=${id}` }}],
            [{ text: "🌍 Tribute orqali", web_app: { url: `${WEB_BASE_URL}/pay?method=tribute&user=${id}` }}],
            [{ text: "⬅️ Ortga", callback_data: "back_main" }]
          ]
        }
      });
    }

    case "menu_payments": {
      const payments = (u.history || []).slice(-5).reverse();
      const list = payments.length
        ? payments.map((p, i) =>
          `${i+1}. ${new Date(p.date).toLocaleDateString()} — ${p.amount} — ${p.method} ${p.status==="success"?"✅":"❌"}`
        ).join("\n")
        : "Hali to‘lovlar yo‘q.";

      return bot.editMessageText(`<b>💳 To‘lovlar tarixi</b>\n\n${list}`, {
        chat_id: id,
        message_id: q.message.message_id,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: "⬅️ Ortga", callback_data: "back_main" }]] }
      });
    }

    case "menu_settings":
      return bot.editMessageText(`<b>⚙️ Sozlamalar</b>

Eslatmalar: ${u.remind_on ? "🔔 Yoqilgan" : "🔕 O‘chik"}
`, {
        chat_id: id,
        message_id: q.message.message_id,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: u.remind_on ? "🔕 O‘chirish" : "🔔 Yoqish", callback_data: "toggle_remind" }],
            [{ text: "⬅️ Ortga", callback_data: "back_main" }]
          ]
        }
      });

    case "toggle_remind":
      await updateUser(id, { remind_on: !u.remind_on });
      return bot.answerCallbackQuery(q.id, { text: "✔️ Saqlandi" });

    case "menu_faq":
      return bot.editMessageText(`
<b>📚 FAQ</b>

1️⃣ Obuna 30 kun amal qiladi.  
2️⃣ To‘lov Click/Tribute orqali.  
3️⃣ 3 marta to‘lov o‘tmasa — chiqariladi.  
4️⃣ Bonus kunlar tugamaguncha chiqarilmaydi.

`, {
        chat_id: id,
        message_id: q.message.message_id,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: "⬅️ Ortga", callback_data: "back_main" }]] }
      });

    case "menu_support":
      return bot.editMessageText(`
<b>📞 Yordam</b>

Savollar: @YangiOdatAdmin
`, {
        chat_id: id,
        message_id: q.message.message_id,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: "⬅️ Ortga", callback_data: "back_main" }]] }
      });

    case "back_main":
      return bot.editMessageText("Asosiy menyu 👇", {
        chat_id: id,
        message_id: q.message.message_id,
        parse_mode: "HTML",
        reply_markup: mainMenu()
      });
  }
});

// ===================== EXPRESS (PAYMENT PAGES) ===
const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ▶ CLICK / TRIBUTE uchun to‘lov sahifasi
app.get("/pay", (req, res) => {
  const method = req.query.method;
  const user = req.query.user;

  return res.send(`
<html><body style="font-family:Arial;padding:30px">

<h2>Yangi Odat Club — To‘lov</h2>

Foydalanuvchi: <b>${user}</b><br>
Usul: <b>${method}</b><br>
Summa: <b>${PRICE}</b>

<br><br>

<!-- ❗ BU JOYGA CLICK LINKI / TRIBUTE LINKI QO‘YILADI -->

<p>Test rejimi:</p>

<form method="POST" action="/payment/mock">
  <input type="hidden" name="user" value="${user}">
  <input type="hidden" name="method" value="${method}">
  <button>Test to‘lovni tasdiqlash</button>
</form>

</body></html>
`);
});

// ▶ TEST PAYMENT (hozircha)
app.post("/payment/mock", async (req, res) => {
  try {
    const userId = Number(req.body.user);
    const method = req.body.method;

    const now = new Date();
    const exp = new Date(now);
    exp.setDate(exp.getDate() + 30);

    await updateUser(userId, {
      status: "active",
      payment_method: method,
      joined_at: now.toISOString(),
      expires_at: exp.toISOString(),
      retry_count: 0
    });

    await addPayment(userId, {
      date: now.toISOString(),
      amount: PRICE,
      method,
      status: "success"
    });

    // Kanalga yangi invite link
    let inviteLink = "https://t.me/YangiOdatClub";
    try {
      const inv = await bot.createChatInviteLink(CHANNEL_ID, {
        member_limit: 1,
        expire_date: Math.floor(Date.now() / 1000) + 86400
      });
      inviteLink = inv.invite_link;
    } catch (e) {}

    await bot.sendMessage(userId, `
<b>✅ To‘lov tasdiqlandi (TEST)</b>

🌱 Premium kanalga kirish:
`, {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[{ text: "🌱 Kirish", url: inviteLink }]]
      }
    });

    return res.send("OK");
  } catch (e) {
    console.error(e);
    res.status(500).send("Server xato");
  }
});

// ===================== CRON JOBS =================
// Har 12 soatda to‘lov tekshiradi
schedule.scheduleJob("0 */12 * * *", async () => {
  const users = await User.find({});
  const now = new Date();

  for (const u of users) {
    if (u.bonus_days > 0) continue;
    if (!["active", "grace"].includes(u.status)) continue;
    if (!u.expires_at || new Date(u.expires_at) > now) continue;

    const retry = (u.retry_count || 0) + 1;

    await updateUser(u.user_id, { retry_count: retry, status: "grace" });

    if (retry >= 3) {
      try {
        await bot.kickChatMember(CHANNEL_ID, u.user_id);
      } catch {}
      await updateUser(u.user_id, { status: "inactive" });

      await bot.sendMessage(u.user_id, `
❌ Obunangiz to‘xtatildi.
`, { parse_mode: "HTML" });

    } else {
      if (u.remind_on) {
        bot.sendMessage(u.user_id, `
⚠️ To‘lov amalga oshmadi.
Iltimos kartangizni tekshiring.
`, { parse_mode: "HTML" });
      }
    }
  }
});

// Har kuni 09:00 — bonusdan -1 kun kamaytirish
schedule.scheduleJob("0 9 * * *", async () => {
  await User.updateMany(
    { bonus_days: { $gt: 0 } },
    { $inc: { bonus_days: -1 } }
  );
});

// ===================== START SERVER ==============
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server ishga tushdi → ${PORT}`));
