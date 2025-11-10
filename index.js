// ===============================
// YANGI ODAT CLUB — Premium Subscription Bot (full skeleton)
// Node >= 20, "type":"module"
// ===============================

import TelegramBot from "node-telegram-bot-api";
import express from "express";
import bodyParser from "body-parser";
import fs from "fs";
import path from "path";
import url from "url";
import schedule from "node-schedule";

// -------------------------------
// .ENV (Railway Variables) kutilyapti
// -------------------------------
// BOT_TOKEN                — Telegram bot token
// CHANNEL_ID               — Yopiq kanal ID (masalan: -1002862428456)
// PRICE                    — Oylik narx (default 40000)
// ADMIN_IDS                — Adminlar ro‘yxati, vergul bilan: "123,456"
// WEB_BASE_URL             — Sening Railway URL: https://<railway>.up.railway.app
// AUTO_CHARGE_ENABLED      — "true" bo‘lsa real auto-charge ishga tushadi (hozircha false)
// PAYMENT_PROVIDER         — "click" yoki "tribute" (default "click")
// CLICK_* / TRIBUTE_*      — Keyin real integratsiya paytida to‘ldiriladi

// -------------------------------
// Global sozlamalar
// -------------------------------
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const PRICE = Number(process.env.PRICE || 40000); // so'm
const WEB_BASE_URL = process.env.WEB_BASE_URL || "https://example.com";
const ADMIN_IDS = (process.env.ADMIN_IDS || "").split(",").map(s => Number(s.trim())).filter(Boolean);
const AUTO_CHARGE_ENABLED = String(process.env.AUTO_CHARGE_ENABLED || "false").toLowerCase() === "true";

if (!BOT_TOKEN || !CHANNEL_ID) {
  console.error("❌ BOT_TOKEN va CHANNEL_ID sozlamalari kerak!");
  process.exit(1);
}

// -------------------------------
/* Fayl saqlash joyi:
   - Foydalanuvchilar bazasi: data.json
   Tuzilishi user obyektlari ro‘yxati:
   {
     user_id, username, status ("active"|"inactive"|"grace"),
     payment_method ("click"|"tribute"|""), joined_at, expires_at,
     retry_count, bonus_days, remind_on (true|false), history: [{date,amount,method,status}]
   }
*/
const DATA_FILE = "data.json";
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]", "utf-8");

// JSON o‘qish-yozish util
const readUsers = () => JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
const writeUsers = (users) => fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2), "utf-8");

// Topish / yaratish
function ensureUser(userId, username = "") {
  const users = readUsers();
  let u = users.find(x => x.user_id === userId);
  if (!u) {
    u = {
      user_id: userId,
      username: username || "",
      status: "inactive",
      payment_method: "",
      joined_at: null,
      expires_at: null,
      retry_count: 0,
      bonus_days: 0,     // referal bonus kunlari
      remind_on: true,   // eslatma yoqilgan/yoqilmagan
      history: []        // to‘lovlar tarixi
    };
    users.push(u);
    writeUsers(users);
  }
  return u;
}

function updateUser(userId, patch = {}) {
  const users = readUsers();
  const idx = users.findIndex(x => x.user_id === userId);
  if (idx === -1) return null;
  users[idx] = { ...users[idx], ...patch };
  writeUsers(users);
  return users[idx];
}

function pushPaymentHistory(userId, item) {
  const users = readUsers();
  const idx = users.findIndex(x => x.user_id === userId);
  if (idx === -1) return;
  users[idx].history = [...(users[idx].history || []), item];
  writeUsers(users);
}

function daysLeft(expires_at) {
  if (!expires_at) return 0;
  const now = new Date();
  const exp = new Date(expires_at);
  return Math.ceil((exp - now) / (1000 * 60 * 60 * 24));
}

// -------------------------------
// Telegram Bot
// -------------------------------
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from?.username ? `@${msg.from.username}` : (msg.from?.first_name || "do'stim");
  ensureUser(chatId, msg.from?.username || "");

  const text = `👋 Salom, ${username}!Bu — **Yangi Odat Club** Premium obuna bot.
💳 Narx: **${PRICE.toLocaleString("ru-RU")} so'm / oy**
📅 Muddati: 30 kun

To‘lov usulini tanlang va bot ichidagi oynada davom eting 👇`;

  bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "🇺🇿 Click — kartadan to‘lov",
            web_app: { url: `${WEB_BASE_URL}/pay?method=click&user=${chatId}` }
          }
        ],
        [
          {
            text: "🌍 Tribute — Visa/MasterCard",
            web_app: { url: `${WEB_BASE_URL}/pay?method=tribute&user=${chatId}` }
          }
        ],
        [
          { text: "📊 Mening obunam", callback_data: "my_status" }
        ]
      ]
    }
  });
});

// /subscribe (shortcut)
bot.onText(/\/subscribe/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, `💳 To‘lov uchun usul tanlang`, {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "🇺🇿 Click — kartadan to‘lov",
            web_app: { url: `${WEB_BASE_URL}/pay?method=click&user=${chatId}` }
          }
        ],
        [
          {
            text: "🌍 Tribute — Visa/MasterCard",
            web_app: { url: `${WEB_BASE_URL}/pay?method=tribute&user=${chatId}` }
          }
        ]
      ]
    }
  });
});

// /my — foydalanuvchi paneli
bot.onText(/\/my/, (msg) => showMyStatus(msg.chat.id));

// /payments — to‘lov tarixi
bot.onText(/\/payments/, (msg) => {
  const u = ensureUser(msg.chat.id, msg.from?.username || "");
  const hist = u.history || [];
  if (!hist.length) return bot.sendMessage(msg.chat.id, "🧾 To‘lov tarixi hozircha bo‘sh.");

  const last5 = hist.slice(-5).reverse();
  const list = last5.map((h, i) => {
    const d = new Date(h.date);
    return `${i + 1}️⃣  ${d.toLocaleDateString()} — ${Number(h.amount).toLocaleString("ru-RU")} so‘m — ${h.method} — ${h.status === "success" ? "✅" : "❌"}`;
  }).join("\n");

  bot.sendMessage(msg.chat.id, `🧾 So‘nggi to‘lovlar:\n${list}`);
});

// /reminder — eslatma yoq/och
bot.onText(/\/reminder/, (msg) => {
  const u = ensureUser(msg.chat.id, msg.from?.username || "");
  const newVal = !u.remind_on;
  updateUser(u.user_id, { remind_on: newVal });
  bot.sendMessage(u.user_id, newVal ? "🔔 Eslatma Yoqildi." : "🔕 Eslatma O‘chirildi.");
});

// Admin: /stats
bot.onText(/\/stats/, (msg) => {
  if (!ADMIN_IDS.includes(msg.chat.id)) return;
  const users = readUsers();
  const active = users.filter(u => u.status === "active").length;
  const grace = users.filter(u => u.status === "grace").length;
  const total = users.length;
  bot.sendMessage(msg.chat.id,
    `📊 Statistika:
Jami user: ${total}
Faol (active): ${active}
Kutilayotgan (grace/bonus): ${grace}`);
});

// Admin: /bonus <userId | @username> <kun>
bot.onText(/\/bonus(?:\s+(.+))?/, (msg, match) => {
  if (!ADMIN_IDS.includes(msg.chat.id)) return;
  const args = (match?.[1] || "").trim().split(/\s+/).filter(Boolean);
  if (args.length < 2) {
    return bot.sendMessage(msg.chat.id, `Foydalanish: /bonus <userId | @username> <kun>\nMasalan: /bonus @bekjon 5`);
  }

  const who = args[0];
  const days = Number(args[1]) || 0;
  if (days <= 0) return bot.sendMessage(msg.chat.id, "Kun soni noto‘g‘ri.");

  const users = readUsers();
  let target = null;

  if (/^@/.test(who)) {
    const uname = who.replace("@", "");
    target = users.find(u => (u.username || "").toLowerCase() === uname.toLowerCase());
  } else {
    const uid = Number(who);
    target = users.find(u => u.user_id === uid);
  }

  if (!target) return bot.sendMessage(msg.chat.id, "User topilmadi.");

  const newBonus = (target.bonus_days || 0) + days;
  updateUser(target.user_id, { bonus_days: newBonus, status: target.status === "inactive" ? "grace" : target.status });

  bot.sendMessage(msg.chat.id, `✅ ${who} foydalanuvchisiga ${days} kun bonus berildi. (Jami bonus: ${newBonus} kun)`);
  bot.sendMessage(target.user_id, `🏅 Sizga ${days} kun BONUS berildi! Jami bonus: ${newBonus} kun.`);
});// Inline "📊 Mening obunam"
bot.on("callback_query", (q) => {
  if (q.data === "my_status") {
    showMyStatus(q.from.id).catch(() => {});
  }
});

// Helper: Status ko‘rsatish
async function showMyStatus(userId) {
  const u = ensureUser(userId);
  const left = daysLeft(u.expires_at);
  const started = u.joined_at ? new Date(u.joined_at).toLocaleDateString() : "-";
  const exp = u.expires_at ? new Date(u.expires_at).toLocaleDateString() : "-";
  const statusEmoji = u.status === "active" ? "✅" : (u.status === "grace" ? "🟡" : "❌");

  const text = `📊 **Mening obunam**
────────────────────
Holat: ${statusEmoji} ${u.status}
Boshlangan: ${started}
Tugash sanasi: ${exp}
Qolgan: ${left > 0 ? left + " kun" : (u.status === "active" ? "bugun" : "—")}
To‘lov usuli: ${u.payment_method || "-"}
Bonus: ${u.bonus_days || 0} kun
Eslatma: ${u.remind_on ? "🔔 Yoqilgan" : "🔕 O‘chik"}
────────────────────
💳 Narx: ${PRICE.toLocaleString("ru-RU")} so‘m / oy`;

  await bot.sendMessage(userId, text, { parse_mode: "MarkdownV2",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "💳 Obunani yangilash (Click)", web_app: { url: `${WEB_BASE_URL}/pay?method=click&user=${userId}` } }
        ],
        [
          { text: "🌍 Obunani yangilash (Tribute)", web_app: { url: `${WEB_BASE_URL}/pay?method=tribute&user=${userId}` } }
        ]
      ]
    }
  });
}

// -------------------------------
// Express — mini-web (WebApp va Callbacklar)
// -------------------------------
const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// /pay — Telegram WebApp oynasi (soddalashtirilgan, gatewayga yo‘naltiruvchi)
app.get("/pay", (req, res) => {
  const method = String(req.query.method || "click");
  const user = Number(req.query.user || 0);
  const valid = ["click", "tribute"].includes(method);

  if (!user || !valid) {
    return res.status(400).send("Invalid parameters");
  }

  // Bu yerda real hayotda siz Click/Tribute sahifasini ochasiz yoki redirect berasiz.
  // Hozircha sinov: “To‘lovni tasdiqlash” tugmasi bilan mock.
  const html = `
<!DOCTYPE html><html><head><meta charset="utf-8"/><title>To'lov</title></head>
<body style="font-family:Arial;padding:18px">
  <h2>Yangi Odat Club — Obuna to'lovi</h2>
  <p>Foydalanuvchi: <b>${user}</b></p>
  <p>Usul: <b>${method.toUpperCase()}</b></p>
  <p>Summa: <b>${PRICE.toLocaleString("ru-RU")} so'm</b></p>
  <hr/>
  <p><i>Real to'lovda bu sahifa Click/Tribute oynasiga yo'naltiriladi.</i></p>
  <form method="POST" action="/payment/mock">
    <input type="hidden" name="user" value="${user}"/>
    <input type="hidden" name="method" value="${method}"/>
    <button type="submit" style="padding:10px 16px">✅ Sinov uchun to'lovni tasdiqlash</button>
  </form>
</body></html>`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

// /payment/mock — test rejimi uchun (real gateway o‘rniga)
app.post("/payment/mock", async (req, res) => {
  try {
    const userId = Number(req.body.user);
    const method = String(req.body.method || "click");

    if (!userId) return res.status(400).send("user required");

    // Muvaffaqiyatli “test” to‘lov
    const now = new Date();
    const exp = new Date(now); exp.setDate(exp.getDate() + 30);

    ensureUser(userId);
    updateUser(userId, {
      status: "active",
      payment_method: method,
      joined_at: now.toISOString(),
      expires_at: exp.toISOString(),
      retry_count: 0
    });
    pushPaymentHistory(userId, {
      date: now.toISOString(),
      amount: PRICE,
      method,
      status: "success"
    });

    // Kanalga qo‘shish
    try {
      await bot.unbanChatMember(CHANNEL_ID, userId);
      await bot.sendMessage(userId, `✅ To‘lov tasdiqlandi (test).
Siz 30 kunlik PREMIUMga qo‘shildingiz!`);
    } catch (e) {
      console.error("Kanalga qo'shishda xatolik:", e.message);
    }res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(`<p>✅ Test to'lov muvaffaqiyatli! Telegram'ga qaytishingiz mumkin.</p>`);
  } catch (e) {
    console.error(e);
    return res.status(500).send("server error");
  }
});

// CLICK callback (REAL) — TODO: imzo tekshiruvi va maydonlar
app.post("/click/callback", async (req, res) => {
  const data = req.body || {};
  try {
    // TODO: SIGNATURE tekshirish (SECRET_KEY bilan)
    // Muvaffaqiyatli bo'lsa:
    if (Number(data.status) === 0 && Number(data.amount) === PRICE) {
      const userId = Number(String(data.merchant_trans_id || "").replace("user", ""));
      if (userId) {
        const now = new Date();
        const exp = new Date(now); exp.setDate(exp.getDate() + 30);
        ensureUser(userId);
        updateUser(userId, {
          status: "active",
          payment_method: "click",
          joined_at: now.toISOString(),
          expires_at: exp.toISOString(),
          retry_count: 0
        });
        pushPaymentHistory(userId, {
          date: now.toISOString(),
          amount: PRICE,
          method: "click",
          status: "success"
        });

        try {
          await bot.unbanChatMember(CHANNEL_ID, userId);
          await bot.sendMessage(userId, `✅ Click to'lovi qabul qilindi.
PREMIUM 30 kunga faollashtirildi.`);
        } catch (e) {
          console.error("Kanalga qo'shish xatosi:", e.message);
        }
      }
    }
  } catch (e) {
    console.error("Click callback error:", e);
  }
  res.json({ status: "ok" });
});

// TRIBUTE callback (REAL) — TODO: imzo tekshiruvi va maydonlar
app.post("/tribute/callback", async (req, res) => {
  const data = req.body || {};
  try {
    // TODO: SIGNATURE tekshiruvi
    if (String(data.status) === "succeeded" && Number(data.amount) === PRICE) {
      const userId = Number(String(data.reference || "").replace("user", ""));
      if (userId) {
        const now = new Date();
        const exp = new Date(now); exp.setDate(exp.getDate() + 30);
        ensureUser(userId);
        updateUser(userId, {
          status: "active",
          payment_method: "tribute",
          joined_at: now.toISOString(),
          expires_at: exp.toISOString(),
          retry_count: 0
        });
        pushPaymentHistory(userId, {
          date: now.toISOString(),
          amount: PRICE,
          method: "tribute",
          status: "success"
        });
        try {
          await bot.unbanChatMember(CHANNEL_ID, userId);
          await bot.sendMessage(userId, `✅ Tribute to'lovi qabul qilindi.
PREMIUM 30 kunga faollashtirildi.`);
        } catch (e) {
          console.error("Kanalga qo'shish xatosi:", e.message);
        }
      }
    }
  } catch (e) {
    console.error("Tribute callback error:", e);
  }
  res.json({ status: "ok" });
});

// -------------------------------
// CRON — kuniga 2 marta tekshiruv
// -------------------------------
schedule.scheduleJob("0 */12 * * *", async () => {
  const users = readUsers();
  const now = new Date();

  for (const u of users) {
    // Bonusni “grace” sifatida tutamiz: expires tugagan bo‘lsa ham bonus bor — chiqarilmaydi
    if (u.bonus_days && u.bonus_days > 0) {
      // Har 24 soatda 1 kun kamayadi (12 soatda emas, lekin ishni soddalashtiramiz: faqat bir marta kuniga kamaytirishni xohlasang,
      // yuqorida cron vaqtini "0 9 * * *" (har kuni 09:00) qilib o'zgartir).
      // Biz 12 soatlikda kamaytirmaymiz. Faqat tekshiramiz.
      // Bonus bo'lsa — chiqarish YO'Q.
      continue;
    }

    // Faol bo'lmaganlarga o'tmaymiz
    if (u.status !== "active" && u.status !== "grace") continue;

    const expired = u.expires_at ? (new Date(u.expires_at) < now) : false;

    if (!expired) continue; // hali tugamagan

    // Expires tugagan — endi auto-charge
    if (!AUTO_CHARGE_ENABLED) {
      // Hozircha sinov: auto-charge “muvaffaqiyatsiz” deb tasavvur qilamiz
      const rc = (u.retry_count || 0) + 1;
      updateUser(u.user_id, { retry_count: rc, status: "grace" });if (rc >= 3) {
        // Bonus yo‘q va 3 urinishdan keyin — chiqaramiz
        try {
          await bot.kickChatMember(CHANNEL_ID, u.user_id);
          updateUser(u.user_id, { status: "inactive" });
          await bot.sendMessage(u.user_id, "❌ To‘lov amalga oshmadi. Siz premium kanal ro‘yxatidan chiqarildingiz.");
        } catch (e) {
          console.error("Chiqarishda xato:", e.message);
        }
      } else {
        // Ogohlantirish
        if (u.remind_on) {
          await bot.sendMessage(u.user_id, `⚠️ To‘lov muvaffaqiyatsiz (urinish ${rc}/3).
Iltimos, kartangizni to‘ldiring yoki obunani qayta faollashtiring.`);
        }
      }

    } else {
      // REAL AUTO-CHARGE BLok (TODO: Click/Tribute repeatPayment)
      // Agar muvaffaqiyatli bo‘lsa:
      //  - retry_count=0
      //  - expires_at = now + 30 days
      //  - status="active"
      //  - history.push({ ..., status:"success" })
      // Agar muvaffaqiyatsiz bo‘lsa:
      //  - retry_count += 1
      //  - 3 ga yetganda kick
      // Hozircha ushbu qismni keyin to‘ldirasan.
    }
  }
  // Bonusni kamaytirish uchun ALohida kundalik job qo‘yish mumkin:
});

// Bonusni har kuni 09:00 da -1 ga tushirish (agar >0)
schedule.scheduleJob("0 9 * * *", () => {
  const users = readUsers();
  let changed = false;
  for (const u of users) {
    if (u.bonus_days && u.bonus_days > 0) {
      u.bonus_days = u.bonus_days - 1;
      changed = true;
      // bonus tugasa status "active" bo‘lsa ham qolgani o‘z joyida; keyingi cron da expire va retry ishlaydi
    }
  }
  if (changed) writeUsers(users);
});

// -------------------------------
// Server
// -------------------------------
const PORT = Number(process.env.PORT || 3000);
const server = express();
server.use(app); // barcha marshrutlar shu app ichida
server.listen(PORT, () => {
  console.log(`✅ Server ishga tushdi: PORT ${PORT}`);
});
console.log("🤖 Bot polling boshlandi…");
