// ================================================
//  YANGI ODAT CLUB — PREMIUM SUBSCRIPTION BOT v3
//  MongoDB + Auto Charge + Ready for Click/Tribute
//  Professional Architecture (Node >= 20)
// ================================================

import TelegramBot from "node-telegram-bot-api";
import express from "express";
import bodyParser from "body-parser";
import mongoose from "mongoose";
import schedule from "node-schedule";

// ================== ENV ===================
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const PRICE = Number(process.env.PRICE || 40000);
const WEB_BASE_URL = process.env.WEB_BASE_URL;
const MONGO_URI = process.env.MONGO_URI;
const AUTO_CHARGE_ENABLED =
  String(process.env.AUTO_CHARGE_ENABLED || "false").toLowerCase() === "true";

if (!BOT_TOKEN || !CHANNEL_ID || !WEB_BASE_URL || !MONGO_URI) {
  console.error("❌ ENV parametrlari to‘liq emas");
  process.exit(1);
}

// ================== MONGO CONNECT ===================
await mongoose.connect(MONGO_URI);
console.log("🍃 MongoDB ulandi");

// ================== MONGO SCHEMA ====================
const userSchema = new mongoose.Schema({
  user_id: Number,
  username: String,
  status: String, // inactive | active | grace
  payment_method: String,
  joined_at: Date,
  expires_at: Date,
  retry_count: Number,
  bonus_days: Number,
  remind_on: Boolean,
});

const paymentSchema = new mongoose.Schema({
  user_id: Number,
  date: Date,
  amount: Number,
  method: String,
  status: String, // success | fail
});

const User = mongoose.model("User", userSchema);
const Payment = mongoose.model("Payment", paymentSchema);

// =============== HELPERS ==================
async function ensureUser(id, username = "") {
  let u = await User.findOne({ user_id: id });
  if (!u) {
    u = await User.create({
      user_id: id,
      username,
      status: "inactive",
      payment_method: "",
      joined_at: null,
      expires_at: null,
      retry_count: 0,
      bonus_days: 0,
      remind_on: true,
    });
  }
  return u;
}

function daysLeft(date) {
  if (!date) return 0;
  return Math.ceil((new Date(date) - new Date()) / 86400000);
}

const escapeHtml = (s = "") =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ================= BOT START ==================
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log("🤖 Bot ishga tushdi...");

// ================== MAIN MENU ====================
function mainMenu() {
  return {
    inline_keyboard: [
      [{ text: "🎯 Obunam", callback_data: "menu_sub" }],
      [{ text: "💳 To‘lovlar tarixi", callback_data: "menu_payments" }],
      [{ text: "⚙️ Sozlamalar", callback_data: "menu_settings" }],
      [{ text: "📚 FAQ", callback_data: "menu_faq" }],
      [{ text: "📞 Aloqa", callback_data: "menu_support" }],
    ],
  };
}

// ================= START ===================
bot.onText(/\/start/, async (msg) => {
  const id = msg.chat.id;
  const name = escapeHtml(msg.from.first_name || "do‘st");
  await ensureUser(id, msg.from.username);

  bot.sendMessage(
    id,
    `<b>👋 Salom, ${name}!</b>

Bu — <b>Yangi Odat Club Premium</b> obuna bot.

💰 Narx: <b>${PRICE.toLocaleString()} so‘m / oy</b>
⏳ Muddati: 30 kun

👇 Asosiy menyu`,
    { parse_mode: "HTML", reply_markup: mainMenu() }
  );
});

// ================= CALLBACK MENULAR ==================
bot.on("callback_query", async (q) => {
  const id = q.from.id;
  const data = q.data;
  const u = await ensureUser(id);

  // 1) OBUNA BO‘LIMI
  if (data === "menu_sub") {
    const left = daysLeft(u.expires_at);
    const status =
      u.status === "active"
        ? "✅ Faol"
        : u.status === "grace"
        ? "🟡 Kutilmoqda"
        : "❌ Faolsiz";

    const text = `<b>📊 Obuna holati</b>

Holat: ${status}
Boshlangan: <b>${u.joined_at ? u.joined_at.toLocaleDateString() : "—"}</b>
Tugash: <b>${u.expires_at ? u.expires_at.toLocaleDateString() : "—"}</b>
Qolgan: <b>${left > 0 ? left + " kun" : "—"}</b>
Bonus: <b>${u.bonus_days} kun</b>
To‘lov usuli: <b>${u.payment_method || "—"}</b>

💳 Narx: <b>${PRICE.toLocaleString()} so‘m</b>`;

    return bot.editMessageText(text, {
      chat_id: id,
      message_id: q.message.message_id,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "💳 Yangilash (Click)",
              url: `${WEB_BASE_URL}/pay?method=click&user=${id}`,
            },
          ],
          [
            {
              text: "🌍 Yangilash (Tribute)",
              url: `${WEB_BASE_URL}/pay?method=tribute&user=${id}`,
            },
          ],
          [{ text: "⬅️ Ortga", callback_data: "back_main" }],
        ],
      },
    });
  }

  // 2) TO‘LOV TARIXI
  if (data === "menu_payments") {
    const payments = await Payment.find({ user_id: id })
      .sort({ date: -1 })
      .limit(10);

    const list = payments
      .map(
        (p, i) =>
          `${i + 1}. ${p.date.toLocaleDateString()} — ${p.amount} so‘m — ${
            p.method
          } ${p.status === "success" ? "✅" : "❌"}`
      )
      .join("\n");

    return bot.editMessageText(`<b>💳 To‘lovlar</b>\n\n${list}`, {
      chat_id: id,
      message_id: q.message.message_id,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: "⬅️ Ortga", callback_data: "back_main" }]] },
    });
  }

  // 3) SOZLAMALAR
  if (data === "menu_settings") {
    return bot.editMessageText(
      `<b>⚙️ Sozlamalar</b>

Eslatmalar: ${u.remind_on ? "🔔 Yoqilgan" : "🔕 O‘chirilgan"}`,
      {
        chat_id: id,
        message_id: q.message.message_id,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: u.remind_on ? "🔕 O‘chirish" : "🔔 Yoqish",
                callback_data: "toggle_remind",
              },
            ],
            [{ text: "⬅️ Ortga", callback_data: "back_main" }],
          ],
        },
      }
    );
  }

  if (data === "toggle_remind") {
    await User.updateOne({ user_id: id }, { remind_on: !u.remind_on });
    return bot.answerCallbackQuery(q.id, {
      text: u.remind_on ? "🔕 O‘chirildi" : "🔔 Yoqildi",
    });
  }

  // 4) FAQ
  if (data === "menu_faq") {
    return bot.editMessageText(
      `<b>📚 FAQ</b>

1️⃣ Obuna 30 kun davom etadi  
2️⃣ 3 marta to‘lov o‘tmasa, chiqariladi  
3️⃣ Bonus kun bo‘lsa — chiqarilmaydi
4️⃣ To‘lov Click yoki Tribute orqali`,
      {
        chat_id: id,
        message_id: q.message.message_id,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: "⬅️ Ortga", callback_data: "back_main" }]] },
      }
    );
  }

  // 5) ALOQA
  if (data === "menu_support") {
    return bot.editMessageText(
      `<b>📞 Aloqa</b>

Admin: @YangiOdatAdmin`,
      {
        chat_id: id,
        message_id: q.message.message_id,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: "⬅️ Ortga", callback_data: "back_main" }]] },
      }
    );
  }

  if (data === "back_main") {
    return bot.editMessageText("Asosiy menyu 👇", {
      chat_id: id,
      message_id: q.message.message_id,
      parse_mode: "HTML",
      reply_markup: mainMenu(),
    });
  }
});

// ================== EXPRESS (PAYMENT) ===================
const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// =========== PAYMENT PAGE ==============
app.get("/pay", (req, res) => {
  const user = req.query.user;
  const method = req.query.method;

  if (!user) return res.send("User yo‘q");

  res.send(`
  <h2>Yangi Odat — To‘lov</h2>
  <p>User: <b>${user}</b></p>
  <p>Usul: <b>${method}</b></p>
  <p>Summa: <b>${PRICE}</b> so‘m</p>

  <!-- TODO: CLICK yoki TRIBUTE API bu yerda bo‘ladi -->

  <form method="POST" action="/payment/test">
    <input type="hidden" name="user" value="${user}" />
    <input type="hidden" name="method" value="${method}" />

    <button>TEST – To‘lovni tasdiqlash</button>
  </form>
  `);
});

// =========== TEST PAYMENT ================
app.post("/payment/test", async (req, res) => {
  try {
    const id = Number(req.body.user);
    const method = req.body.method;

    let u = await ensureUser(id);

    // 30 kun qo‘shiladi
    const now = new Date();
    const exp = new Date(now);
    exp.setDate(exp.getDate() + 30);

    await User.updateOne(
      { user_id: id },
      {
        status: "active",
        payment_method: method,
        joined_at: now,
        expires_at: exp,
        retry_count: 0,
      }
    );

    await Payment.create({
      user_id: id,
      date: now,
      amount: PRICE,
      method,
      status: "success",
    });

    // invite link
    let inviteLink = "https://t.me/YangiOdatClub";
    try {
      const inv = await bot.createChatInviteLink(CHANNEL_ID, {
        member_limit: 1,
        expire_date: Math.floor(Date.now() / 1000) + 86400,
      });
      inviteLink = inv.invite_link;
    } catch {}

    await bot.sendMessage(
      id,
      `✅ To‘lov tasdiqlandi (TEST)

🌱 30 kunlik Premium faollashtirildi.
Kirish havolasi:`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [[{ text: "🌱 Kirish", url: inviteLink }]],
        },
      }
    );

    res.send("OK, Telegramga qayting 😊");
  } catch (e) {
    console.log(e);
    res.send("Server xato");
  }
});

// ================== AUTO CHARGE CRON ===================
schedule.scheduleJob("0 */12 * * *", async () => {
  const users = await User.find({});
  const now = new Date();

  for (const u of users) {
    if (u.bonus_days > 0) continue; // bonus bo‘lsa — to‘lov talab qilinmaydi
    if (!["active", "grace"].includes(u.status)) continue;
    if (!u.expires_at || new Date(u.expires_at) > now) continue;

    // TO‘LOV VAQTI KELDI
    u.retry_count = (u.retry_count || 0) + 1;
    u.status = "grace";
    await u.save();

    if (u.retry_count >= 3) {
      try {
        await bot.kickChatMember(CHANNEL_ID, u.user_id);
      } catch {}

      u.status = "inactive";
      await u.save();

      await bot.sendMessage(
        u.user_id,
        "❌ To‘lov amalga oshmadi. Kanaldan chiqarildingiz.",
        { parse_mode: "HTML" }
      );
    } else {
      if (u.remind_on) {
        await bot.sendMessage(
          u.user_id,
          `⚠️ To‘lov muvaffaqiyatsiz (urinish ${u.retry_count}/3). Iltimos, kartangizni to‘ldiring.`,
          { parse_mode: "HTML" }
        );
      }
    }
  }
});

// BONUS KUNLARNI KAMAYTIRISH
schedule.scheduleJob("0 9 * * *", async () => {
  const users = await User.find({ bonus_days: { $gt: 0 } });
  for (const u of users) {
    u.bonus_days--;
    await u.save();
  }
});

// ================== START SERVER ===================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 Server ishga tushdi → " + PORT);
});
