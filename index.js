// ================================================
//  YANGI ODAT CLUB PRO BOT v3.0
//  Premium Subscription + MongoDB + Pro UI
//  Node >= 20, package.json -> "type": "module"
// ================================================

import TelegramBot from "node-telegram-bot-api";
import express from "express";
import bodyParser from "body-parser";
import mongoose from "mongoose";
import schedule from "node-schedule";

// ==================  ENV  =======================
const BOT_TOKEN           = process.env.BOT_TOKEN;
const CHANNEL_ID          = process.env.CHANNEL_ID;        // -100xxxxxxxxxxxx
const PRICE               = Number(process.env.PRICE || 40000);
const WEB_BASE_URL        = process.env.WEB_BASE_URL;      // https://yourapp.up.railway.app
const MONGODB_URL         = process.env.MONGODB_URL;       // mongodb+srv://...
const ADMIN_IDS           = (process.env.ADMIN_IDS || "")
  .split(",")
  .map(x => Number(x.trim()))
  .filter(Boolean);
const AUTO_CHARGE_ENABLED = String(process.env.AUTO_CHARGE_ENABLED || "false")
  .toLowerCase() === "true";

if (!BOT_TOKEN || !CHANNEL_ID || !WEB_BASE_URL || !MONGODB_URL) {
  console.error("❌ BOT_TOKEN, CHANNEL_ID, WEB_BASE_URL, MONGODB_URL majburiy!");
  process.exit(1);
}

// ==================  MONGO  ======================
await mongoose.connect(MONGODB_URL, {});

// --- User model ---
const userSchema = new mongoose.Schema({
  user_id:       { type: Number, required: true, unique: true },
  username:      { type: String },
  status:        { type: String, enum: ["inactive", "active", "grace"], default: "inactive" },
  payment_method:{ type: String, default: "" },            // click / tribute / other
  joined_at:     { type: Date, default: null },
  expires_at:    { type: Date, default: null },
  retry_count:   { type: Number, default: 0 },             // auto-charge urinishlari
  bonus_days:    { type: Number, default: 0 },             // referal bonus (do‘st taklif botdan)
  remind_on:     { type: Boolean, default: true }
}, { timestamps: true });

const User = mongoose.model("User", userSchema);

// --- Payment model ---
const paymentSchema = new mongoose.Schema({
  user_id:   { type: Number, required: true },
  amount:    { type: Number, required: true },
  method:    { type: String, required: true },            // click / tribute
  status:    { type: String, default: "success" },        // success / fail
  provider_txn_id: { type: String, default: "" },         // Click/Tribute tranzaksiya ID (keyinchalik)
  created_at:{ type: Date, default: Date.now }
});

const Payment = mongoose.model("Payment", paymentSchema);

// ==================  HELPER FUNKSIONLAR  =========
const escapeHtml = (s = "") =>
  String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

function daysLeft(expires_at, bonus_days = 0) {
  if (!expires_at) return bonus_days || 0;
  const now = new Date();
  const exp = new Date(expires_at);
  const base = Math.ceil((exp - now) / 86400000);
  return Math.max(0, base + (bonus_days || 0));
}

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
      remind_on: true
    });
  } else if (username && !u.username) {
    u.username = username;
    await u.save();
  }
  return u;
}

async function addPayment(userId, amount, method, status = "success", providerId = "") {
  return Payment.create({
    user_id: userId,
    amount,
    method,
    status,
    provider_txn_id: providerId
  });
}

function prettyStatus(u) {
  if (u.status === "active") return "✅ Faol";
  if (u.status === "grace")  return "🟡 To‘lov kutilyapti";
  return "❌ Faolsiz";
}

// ==================  TELEGRAM BOT  ===============
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log("🤖 Bot polling started...");

// Komandalar menyusi (input yonida chiqadigan)
await bot.setMyCommands([
  { command: "start",  description: "Asosiy menyu" },
  { command: "status", description: "Obuna holatini ko‘rish" },
  { command: "pay",    description: "Obuna sotib olish / yangilash" }
]);

// ==================  UI: asosiy menyu  ===========
const APP_URL = process.env.APP_URL || "https://super30-app-web.vercel.app";

function mainMenu() {
  return {
    inline_keyboard: [
      [{ text: "🎟 Obuna holatim", callback_data: "menu_status" }],
      [{ text: "💳 Obuna olish / yangilash", callback_data: "menu_pay" }],
      [{ text: "🧾 To‘lovlar tarixi", callback_data: "menu_history" }],
      [{ text: "⚙️ Sozlamalar", callback_data: "menu_settings" }],
      [{ text: "📚 Qo‘llanma", callback_data: "menu_faq" }],
      [{ text: "📞 Aloqa va yordam", callback_data: "menu_support" }]
    ]
  };
}

function backButton() {
  return { inline_keyboard: [[{ text: "⬅️ Asosiy menyu", callback_data: "back_main" }]] };
}

// ==================  /start, /status, /pay  ======
bot.onText(/\/start/, async (msg) => {
  const id   = msg.chat.id;
  const name = escapeHtml(msg.from?.first_name || "do‘st");

  const u = await ensureUser(id, msg.from?.username || "");
  const left = daysLeft(u.expires_at, u.bonus_days);

  const text = [
    `<b>👋 Salom, ${name}!</b>`,
    ``,
    `Bu — <b>Yangi Odat Club Premium</b> obuna boti.`,
    ``,
    `📊 Joriy holatingiz: <b>${prettyStatus(u)}</b>`,
    `Qolgan kunlar: <b>${left > 0 ? left : "–"}</b>`,
    u.bonus_days
      ? `Referal bonus: <b>${u.bonus_days} kun</b> (yopiq kanalga bonus orqali kirgansiz).`
      : ``,
    ``,
    `💰 Tarif: <b>${PRICE.toLocaleString("ru-RU")} so‘m / 30 kun</b>`,
    ``,
    `Bot orqali siz:`,
    `• Obuna holatini ko‘rasiz`,
    `• Click yoki Tribute orqali obuna xarid qilasiz`,
    `• To‘lovlar tarixini ko‘rasiz`,
    `• Eslatmalarni sozlaysiz`,
    ``,
    `Quyidagi menyudan kerakli bo‘limni tanlang 👇`
  ].join("\n");

  await bot.sendMessage(id, text, { parse_mode: "HTML", reply_markup: mainMenu() });
});

bot.onText(/\/status/, async (msg) => {
  const id = msg.chat.id;
  const u  = await ensureUser(id, msg.from?.username || "");
  await showStatus(id, null, u);
});

bot.onText(/\/pay/, async (msg) => {
  const id = msg.chat.id;
  const u  = await ensureUser(id, msg.from?.username || "");
  await showPayMenu(id, null, u);
});

// ==================  CALLBACK MENUS  =============
bot.on("callback_query", async (q) => {
  const id   = q.from.id;
  const data = q.data;
  const u    = await ensureUser(id, q.from?.username || "");

  try {
    switch (data) {
      case "menu_status":
        return await showStatus(id, q, u);

      case "menu_pay":
        return await showPayMenu(id, q, u);

      case "pay_click":
        return await showClickPay(id, q, u);

      case "pay_tribute":
        return await showTributePay(id, q, u);

      case "menu_history":
        return await showHistory(id, q, u);

      case "menu_settings":
        return await showSettings(id, q, u);

      case "toggle_remind":
        u.remind_on = !u.remind_on;
        await u.save();
        return await bot.answerCallbackQuery(q.id, {
          text: u.remind_on ? "🔔 Eslatma yoqildi" : "🔕 Eslatma o‘chirildi"
        });

      case "menu_faq":
        return await showFaq(id, q);

      case "menu_support":
        return await showSupport(id, q);

      case "back_main":
        return await editOrSend(id, q, "Asosiy menyu 👇", mainMenu());

      default:
        return await bot.answerCallbackQuery(q.id, { text: "..." });
    }
  } catch (e) {
    console.error("callback xato:", e);
  }
});

// ============ UI helper funksiyalar ==============
async function editOrSend(chatId, q, text, reply_markup) {
  if (q && q.message) {
    return bot.editMessageText(text, {
      chat_id: chatId,
      message_id: q.message.message_id,
      parse_mode: "HTML",
      reply_markup
    }).catch(() =>
      bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup })
    );
  }
  return bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup });
}

async function showStatus(chatId, q, u) {
  const left = daysLeft(u.expires_at, u.bonus_days);
  const text = [
    `<b>🎟 Mening obunam</b>`,
    ``,
    `Holat: <b>${prettyStatus(u)}</b>`,
    `Boshlangan sana: <b>${u.joined_at ? new Date(u.joined_at).toLocaleDateString() : "–"}</b>`,
    `Tugash sana: <b>${u.expires_at ? new Date(u.expires_at).toLocaleDateString() : "–"}</b>`,
    `Qolgan kun: <b>${left > 0 ? left : "–"}</b>`,
    ``,
    `Bonus kunlar (referal orqali): <b>${u.bonus_days || 0}</b>`,
    `To‘lov usuli: <b>${escapeHtml(u.payment_method || "–")}</b>`,
    ``,
    `💰 Tarif: <b>${PRICE.toLocaleString("ru-RU")} so‘m / 30 kun</b>`
  ].join("\n");

  return editOrSend(chatId, q, text, backButton());
}

async function showPayMenu(chatId, q, u) {
  const left = daysLeft(u.expires_at, u.bonus_days);

  const text = [
    `<b>💳 Obuna olish / yangilash</b>`,
    ``,
    `Joriy holat: <b>${prettyStatus(u)}</b>`,
    `Qolgan kun: <b>${left > 0 ? left : "–"}</b>`,
    ``,
    `To‘lovni qaysi usul orqali amalga oshirmoqchisiz?`,
    ``,
    `<b>1️⃣ Uzcard / Humo (Click)</b> — O‘zbekiston kartalari uchun.`,
    `<b>2️⃣ Visa / Mastercard (Tribute)</b> — xalqaro kartalar uchun.`
  ].join("\n");

  const reply_markup = {
    inline_keyboard: [
      [{ text: "🇺🇿 Uzcard / Humo (Click)",  callback_data: "pay_click" }],
      [{ text: "🌍 Visa / Mastercard (Tribute)", callback_data: "pay_tribute" }],
      [{ text: "⬅️ Asosiy menyu", callback_data: "back_main" }]
    ]
  };

  return editOrSend(chatId, q, text, reply_markup);
}

async function showClickPay(chatId, q, u) {
  const url = `${WEB_BASE_URL}/pay?method=click&user=${chatId}`;
  const text = [
    `<b>🇺🇿 Uzcard / Humo orqali to‘lov</b>`,
    ``,
    `Quyidagi tugmani bossangiz, Click to‘lov sahifasi ochiladi.`,
    `To‘lov muvaffaqiyatli yakunlansa, bot sizga <b>30 kunlik Premium</b> uchun havola yuboradi.`,
    ``,
    `💡 Eslatma: real loyihada bu sahifaga Click'ning <b>checkout vidjeti</b> yoki API orqali to‘lov oynasini joylashtirasiz.`,
  ].join("\n");

  const reply_markup = {
    inline_keyboard: [
      [{ text: "💳 Click orqali to‘lov", url }],
      [{ text: "⬅️ Ortga", callback_data: "menu_pay" }]
    ]
  };

  return editOrSend(chatId, q, text, reply_markup);
}

async function showTributePay(chatId, q, u) {
  const url = `${WEB_BASE_URL}/pay?method=tribute&user=${chatId}`;
  const text = [
    `<b>🌍 Visa / Mastercard orqali to‘lov</b>`,
    ``,
    `Quyidagi tugmani bossangiz, Tribute / xalqaro to‘lov sahifasi ochiladi.`,
    `To‘lov muvaffaqiyatli yakunlansa, bot sizga <b>30 kunlik Premium</b> uchun havola yuboradi.`,
    ``,
    `💡 Eslatma: real loyihada bu sahifaga Tribute integratsiyasini joylashtirasiz.`,
  ].join("\n");

  const reply_markup = {
    inline_keyboard: [
      [{ text: "💳 Visa / Mastercard", url }],
      [{ text: "⬅️ Ortga", callback_data: "menu_pay" }]
    ]
  };

  return editOrSend(chatId, q, text, reply_markup);
}

async function showHistory(chatId, q, u) {
  const last = await Payment.find({ user_id: chatId })
    .sort({ created_at: -1 })
    .limit(10);

  const list = last.length
    ? last.map((p, i) =>
        `${i + 1}. ${new Date(p.created_at).toLocaleDateString()} — ` +
        `${p.amount.toLocaleString("ru-RU")} so‘m — ${p.method} ` +
        `${p.status === "success" ? "✅" : "❌"}`
      ).join("\n")
    : "Hozircha hech qanday to‘lov qilmagansiz.";

  const text = `<b>🧾 So‘nggi to‘lovlar</b>\n\n${escapeHtml(list)}`;

  return editOrSend(chatId, q, text, backButton());
}

async function showSettings(chatId, q, u) {
  const text = [
    `<b>⚙️ Sozlamalar</b>`,
    ``,
    `Eslatmalar: ${u.remind_on ? "🔔 Yoqilgan" : "🔕 O‘chirilgan"}`,
    ``,
    `Agar obuna muddati tugashiga yaqinlashsa, eslatma xabarlari yuboriladi.`
  ].join("\n");

  const reply_markup = {
    inline_keyboard: [
      [{ text: u.remind_on ? "🔕 Eslatmani o‘chirish" : "🔔 Eslatmani yoqish", callback_data: "toggle_remind" }],
      [{ text: "⬅️ Asosiy menyu", callback_data: "back_main" }]
    ]
  };

  return editOrSend(chatId, q, text, reply_markup);
}

async function showFaq(chatId, q) {
  const text = [
    `<b>📚 FAQ / Foydalanish shartlari</b>`,
    ``,
    `1️⃣ Bot faqat Premium a’zolar uchun yopiq kanalga kirish beradi.`,
    `2️⃣ To‘lov muddati: 30 kun.`,
    `3️⃣ Agar avtomatik yechish yoqilgan bo‘lsa, muddati tugaganda karta orqali qayta yechishga urinadi.`,
    `4️⃣ 3 marta yecholmasa — foydalanuvchi kanaldan chiqariladi.`,
    `5️⃣ Agar sizda referal bonus kunlar bo‘lsa, avval bonus tugaydi, keyin to‘lovlar hisobga olinadi.`,
    ``,
    `Click va Tribute integratsiyasi real loyihada mos API/webhook orqali bog‘lanadi.`
  ].join("\n");

  return editOrSend(chatId, q, text, backButton());
}

async function showSupport(chatId, q) {
  const text = [
    `<b>📞 Aloqa va yordam</b>`,
    ``,
    `Savol, taklif yoki xatolik bo‘lsa yozing:`,
    `📩 <code>@YangiOdatAdmin</code>`,
    `🌐 <code>https://t.me/YangiOdatClub</code>`
  ].join("\n");

  return editOrSend(chatId, q, text, backButton());
}

// ==================  EXPRESS APP  =================
const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// --- To'lov sahifasi (Click / Tribute uchun umumiy) ---
app.get("/pay", (req, res) => {
  const method = req.query.method || "click"; // click | tribute
  const user   = req.query.user;
  if (!user) return res.status(400).send("user id yo‘q");

  // ⚠️ Bu joyga keyinchalik Click / Tribute checkout kodini joylashtirasiz.
  // Hozircha test uchun oddiy HTML.
  res.send(`<!DOCTYPE html>
<html>
  <body style="font-family:Arial;padding:30px">
    <h2>Yangi Odat Club — Obuna to‘lovi</h2>
    <p>Foydalanuvchi ID: <b>${user}</b></p>
    <p>Usul: <b>${method.toUpperCase()}</b></p>
    <p>Summa: <b>${PRICE.toLocaleString("ru-RU")} so‘m</b></p>

    <!--
      SHU YERGA:
      - CLICK checkout widgeti
      - yoki Tribute checkout sahifasi joylashtiriladi.

      To'lov muvaffaqiyatli bo'lsa, u holda /payment/webhook yoki /payment/mock ga
      server-to-server so'rov yuborasiz.
    -->

    <form method="POST" action="/payment/mock">
      <input type="hidden" name="user" value="${user}"/>
      <input type="hidden" name="method" value="${method}"/>
      <button style="padding:10px 20px">✅ TEST: to‘lovni tasdiqlash</button>
    </form>
  </body>
</html>`);
});

// --- MOCK PAYMENT (faqat test uchun!) ---
app.post("/payment/mock", async (req, res) => {
  try {
    const userId = Number(req.body.user);
    const method = req.body.method || "click";

    const now = new Date();
    const exp = new Date(now);
    exp.setDate(exp.getDate() + 30);

    const u = await ensureUser(userId);
    u.status = "active";
    u.payment_method = method;
    u.joined_at = now;
    u.expires_at = exp;
    u.retry_count = 0;
    await u.save();

    await addPayment(userId, PRICE, method, "success", "TEST_TXN");

    // Har to‘lov uchun yangi 1 kunlik invite link
    let inviteLink = "https://t.me/YangiOdatClub";
    try {
      const invite = await bot.createChatInviteLink(CHANNEL_ID, {
        member_limit: 1,
        expire_date: Math.floor(Date.now() / 1000) + 86400
      });
      inviteLink = invite.invite_link;
    } catch (e) {
      console.error("Invite link xato:", e.message);
    }

    await bot.sendMessage(
      userId,
      [
        `✅ <b>Test to‘lovi tasdiqlandi.</b>`,
        ``,
        `Siz 30 kunlik PREMIUM a’zolikka ega bo‘ldingiz!`,
        ``,
        `🌱 Kanalga kirish uchun havola 👇`
      ].join("\n"),
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [[{ text: "🌱 Premium kanalga kirish", url: inviteLink }]]
        }
      }
    );

    res.send("<p>✅ Test to‘lov tasdiqlandi. Telegram’ga qaytishingiz mumkin.</p>");
  } catch (e) {
    console.error("mock payment xato:", e);
    res.status(500).send("Server xato");
  }
});

/*
  📌 REAL CLICK / TRIBUTE INTEGRATSIYA UCHUN:
  - /payment/click-webhook
  - /payment/tribute-webhook
  marshrutlarini ochasiz.
  Bu endpointlarda:
    1) to'lovni imzo va status bo'yicha tekshirasiz;
    2) agar SUCCESS bo'lsa -> yuqoridagi /payment/mock dagi logikani (User + Payment + inviteLink) ishga tushirasiz.
*/

// ==================  CRON JOBLAR  =================
schedule.scheduleJob("0 */12 * * *", async () => {
  const now = new Date();
  const users = await User.find({
    status: { $in: ["active", "grace"] }
  });

  for (const u of users) {
    // Agar bonus kunlari bo'lsa, avval bonus tugashini kutamiz
    if (u.bonus_days && u.bonus_days > 0) {
      continue;
    }

    if (!u.expires_at || new Date(u.expires_at) > now) {
      continue;
    }

    // Muddati tugagan
    if (!AUTO_CHARGE_ENABLED) {
      // Avtomatik yechish yoqmagan: darhol chiqaramiz
      try {
        await bot.kickChatMember(CHANNEL_ID, u.user_id);
      } catch (e) {
        console.error("Kick xato:", e.message);
      }
      u.status = "inactive";
      await u.save();
      if (u.remind_on) {
        await bot.sendMessage(
          u.user_id,
          "❌ Obuna muddati tugadi va Premium kanaldan chiqarildingiz.",
          { parse_mode: "HTML" }
        ).catch(() => {});
      }
      continue;
    }

    // AUTO_CHARGE_ENABLED = true bo'lsa — bu yerda CLICK / TRIBUTE auto-charge
    // API chaqirig'i bo'ladi (hozircha faqat retry_count ni yuritamiz).
    const nextRetry = (u.retry_count || 0) + 1;
    u.retry_count = nextRetry;
    u.status = "grace";
    await u.save();

    if (nextRetry >= 3) {
      try {
        await bot.kickChatMember(CHANNEL_ID, u.user_id);
      } catch (e) {
        console.error("Kick xato:", e.message);
      }
      u.status = "inactive";
      await u.save();
      if (u.remind_on) {
        await bot.sendMessage(
          u.user_id,
          "❌ 3 marta to‘lov yechib bo‘lmadi. Premium kanaldan chiqarildingiz.",
          { parse_mode: "HTML" }
        ).catch(() => {});
      }
    } else if (u.remind_on) {
      await bot.sendMessage(
        u.user_id,
        `⚠️ Obuna muddati tugadi. Kartadan avtomatik yechishga urinilmoqda (urinish ${nextRetry}/3). Agar kartada mablag‘ bo‘lmasa, iltimos, to‘ldiring.`,
        { parse_mode: "HTML" }
      ).catch(() => {});
    }
  }
});

// Bonus kunlarni har 09:00 da 1 kunga kamaytirish
schedule.scheduleJob("0 9 * * *", async () => {
  const users = await User.find({ bonus_days: { $gt: 0 } });
  for (const u of users) {
    u.bonus_days = u.bonus_days - 1;
    if (u.bonus_days < 0) u.bonus_days = 0;
    await u.save();
  }
});

// ==================  SERVER START  =================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server ishga tushdi → ${PORT}`));
