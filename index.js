// ===============================
// YANGI ODAT CLUB — Premium Subscription Bot (HTML, full skeleton)
// Node >= 20, package.json -> "type":"module"
// ===============================

import TelegramBot from "node-telegram-bot-api";
import express from "express";
import bodyParser from "body-parser";
import fs from "fs";
import schedule from "node-schedule";

// -------------------------------
// ENV sozlamalar
// -------------------------------
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;                 // -100xxxxxxxxxxxx
const PRICE = Number(process.env.PRICE || 40000);          // so'm
const WEB_BASE_URL = process.env.WEB_BASE_URL || "https://example.com";
const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter(Boolean);
const AUTO_CHARGE_ENABLED =
  String(process.env.AUTO_CHARGE_ENABLED || "false").toLowerCase() === "true";

if (!BOT_TOKEN || !CHANNEL_ID) {
  console.error("❌ BOT_TOKEN va CHANNEL_ID Variables’ni kiriting!");
  process.exit(1);
}

// -------------------------------
// JSON baza: data.json
// -------------------------------
const DATA_FILE = "data.json";
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]", "utf-8");

const readUsers = () => JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
const writeUsers = (users) =>
  fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2), "utf-8");

function ensureUser(userId, username = "") {
  const users = readUsers();
  let u = users.find((x) => x.user_id === userId);
  if (!u) {
    u = {
      user_id: userId,
      username: username || "",
      status: "inactive",       // active | inactive | grace
      payment_method: "",       // click | tribute | ""
      joined_at: null,
      expires_at: null,
      retry_count: 0,           // auto-charge urinish sanog‘i
      bonus_days: 0,            // referal bonus kunlari
      remind_on: true,          // ogohlantirish xabarlari
      history: []               // [{date, amount, method, status}]
    };
    users.push(u);
    writeUsers(users);
  }
  return u;
}

function updateUser(userId, patch = {}) {
  const users = readUsers();
  const i = users.findIndex((x) => x.user_id === userId);
  if (i === -1) return null;
  users[i] = { ...users[i], ...patch };
  writeUsers(users);
  return users[i];
}

function pushPaymentHistory(userId, item) {
  const users = readUsers();
  const i = users.findIndex((x) => x.user_id === userId);
  if (i === -1) return;
  users[i].history = [...(users[i].history || []), item];
  writeUsers(users);
}

function daysLeft(expires_at) {
  if (!expires_at) return 0;
  const now = new Date();
  const exp = new Date(expires_at);
  return Math.ceil((exp - now) / (1000 * 60 * 60 * 24));
}

function escapeHtml(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// -------------------------------
// Telegram Bot — pollingni to‘g‘ri yoqish (409 oldini olish)
// -------------------------------
const bot = new TelegramBot(BOT_TOKEN, { polling: false });

(async () => {
  try {
    // webhook bo‘lsa o‘chirib, eski update’larni tashlab yuboramiz
    await bot.deleteWebHook({ drop_pending_updates: true });
    // endi pollingni yoqamiz
    await bot.startPolling();
    console.log("✅ Polling boshlandi");
  } catch (e) {
    console.error("Polling start xatosi:", e);
  }
})();

// -------------------------------
// /start
// -------------------------------
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const name =
    msg.from?.username ? `@${escapeHtml(msg.from.username)}` : escapeHtml(msg.from?.first_name || "do'stim");
  ensureUser(chatId, msg.from?.username || "");

  const text = [
    `👋 Salom, <b>${name}</b>!`,
    ``,
    `Bu — <b>Yangi Odat Club</b> Premium obuna bot.`,
    `💳 Narx: <b>${PRICE.toLocaleString("ru-RU")} so'm / oy</b>`,
    `📅 Muddati: <b>30 kun</b>`,
    ``,
    `To‘lov usulini tanlang va bot ichidagi oynada davom eting 👇`
  ].join("\n");bot.sendMessage(chatId, text, {
    parse_mode: "HTML",
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
  bot.sendMessage(
    chatId,
    `💳 To‘lov usulini tanlang:`,
    {
      parse_mode: "HTML",
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
    }
  );
});

// /my — foydalanuvchi paneli
bot.onText(/\/my/, (msg) => showMyStatus(msg.chat.id));

// /payments — to‘lov tarixi
bot.onText(/\/payments/, (msg) => {
  const u = ensureUser(msg.chat.id, msg.from?.username || "");
  const hist = u.history || [];
  if (!hist.length) return bot.sendMessage(msg.chat.id, "🧾 To‘lov tarixi hozircha bo‘sh.", { parse_mode: "HTML" });

  const last5 = hist.slice(-5).reverse();
  const list = last5
    .map((h, i) => {
      const d = new Date(h.date);
      return `${i + 1}️⃣  ${d.toLocaleDateString()} — ${Number(h.amount).toLocaleString("ru-RU")} so‘m — ${escapeHtml(h.method)} — ${h.status === "success" ? "✅" : "❌"}`;
    })
    .join("\n");

  bot.sendMessage(msg.chat.id, `🧾 So‘nggi to‘lovlar:\n${list}`, { parse_mode: "HTML" });
});

// /reminder — eslatma yoq/och
bot.onText(/\/reminder/, (msg) => {
  const u = ensureUser(msg.chat.id, msg.from?.username || "");
  const newVal = !u.remind_on;
  updateUser(u.user_id, { remind_on: newVal });
  bot.sendMessage(u.user_id, newVal ? "🔔 Eslatma YOQILDI." : "🔕 Eslatma O‘CHIRILDI.", { parse_mode: "HTML" });
});

// Admin: /stats
bot.onText(/\/stats/, (msg) => {
  if (!ADMIN_IDS.includes(msg.chat.id)) return;
  const users = readUsers();
  const active = users.filter((u) => u.status === "active").length;
  const grace = users.filter((u) => u.status === "grace").length;
  const total = users.length;
  bot.sendMessage(
    msg.chat.id,
    [
      `📊 <b>Statistika</b>`,
      `Jami user: <b>${total}</b>`,
      `Faol (active): <b>${active}</b>`,
      `Kutilayotgan (grace/bonus): <b>${grace}</b>`
    ].join("\n"),
    { parse_mode: "HTML" }
  );
});

// Admin: /bonus <userId | @username> <kun>
bot.onText(/\/bonus(?:\s+(.+))?/, (msg, match) => {
  if (!ADMIN_IDS.includes(msg.chat.id)) return;
  const args = (match?.[1] || "").trim().split(/\s+/).filter(Boolean);
  if (args.length < 2) {
    return bot.sendMessage(
      msg.chat.id,
      `Foydalanish: <code>/bonus &lt;userId | @username&gt; &lt;kun&gt;</code>\nMasalan: <code>/bonus @bekjon 5</code>`,
      { parse_mode: "HTML" }
    );
  }

  const who = args[0];
  const days = Number(args[1]) || 0;
  if (days <= 0) return bot.sendMessage(msg.chat.id, "Kun soni noto‘g‘ri.", { parse_mode: "HTML" });

  const users = readUsers();
  let target = null;

  if (/^@/.test(who)) {
    const uname = who.replace("@", "");
    target = users.find((u) => (u.username || "").toLowerCase() === uname.toLowerCase());
  } else {
    const uid = Number(who);
    target = users.find((u) => u.user_id === uid);
  }

  if (!target) return bot.sendMessage(msg.chat.id, "User topilmadi.", { parse_mode: "HTML" });

  const newBonus = (target.bonus_days || 0) + days;
  updateUser(target.user_id, {
    bonus_days: newBonus,
    status: target.status === "inactive" ? "grace" : target.status
  });bot.sendMessage(msg.chat.id, `✅ ${escapeHtml(who)} foydalanuvchisiga <b>${days}</b> kun BONUS berildi. (Jami: <b>${newBonus}</b> kun)`, { parse_mode: "HTML" });
  bot.sendMessage(target.user_id, `🏅 Sizga <b>${days}</b> kun BONUS berildi! Jami bonus: <b>${newBonus}</b> kun.`, { parse_mode: "HTML" });
});

// Inline "📊 Mening obunam"
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
  const statusEmoji = u.status === "active" ? "✅" : u.status === "grace" ? "🟡" : "❌";

  const text = [
    `📊 <b>Mening obunam</b>`,
    `────────────────────`,
    `Holat: ${statusEmoji} <b>${escapeHtml(u.status)}</b>`,
    `Boshlangan: <b>${escapeHtml(started)}</b>`,
    `Tugash sanasi: <b>${escapeHtml(exp)}</b>`,
    `Qolgan: <b>${left > 0 ? left + " kun" : (u.status === "active" ? "bugun" : "—")}</b>`,
    `To‘lov usuli: <b>${escapeHtml(u.payment_method || "-")}</b>`,
    `Bonus: <b>${u.bonus_days || 0} kun</b>`,
    `Eslatma: ${u.remind_on ? "🔔" : "🔕"}`,
    `────────────────────`,
    `💳 Narx: <b>${PRICE.toLocaleString("ru-RU")} so'm / oy</b>`
  ].join("\n");

  await bot.sendMessage(userId, text, {
    parse_mode: "HTML",
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
/* EXPRESS — WebApp / Callbacks
   /pay — Telegram WebApp oynasi (soddalashtirilgan mock)
   /payment/mock — test to‘lov (real gateway o‘rniga)
   /click/callback — Click REAL callback (TODO: imzo tekshiruvi)
   /tribute/callback — Tribute REAL callback (TODO: imzo tekshiruvi)
*/
// -------------------------------
const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// WebApp: To‘lov sahifasi (mock)
app.get("/pay", (req, res) => {
  const method = String(req.query.method || "click");
  const user = Number(req.query.user || 0);
  const valid = ["click", "tribute"].includes(method);

  if (!user || !valid) return res.status(400).send("Invalid parameters");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>To'lov</title></head>
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

// Mock payment: sinov uchun muvaffaqiyatli to‘lov
app.post("/payment/mock", async (req, res) => {
  try {
    const userId = Number(req.body.user);
    const method = String(req.body.method || "click");
    if (!userId) return res.status(400).send("user required");

    const now = new Date();
    const exp = new Date(now);
    exp.setDate(exp.getDate() + 30);

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
    });try {
      await bot.unbanChatMember(CHANNEL_ID, userId);
      await bot.sendMessage(
        userId,
        `✅ To‘lov tasdiqlandi (test).\nSiz 30 kunlik PREMIUMga qo‘shildingiz!`,
        { parse_mode: "HTML" }
      );
    } catch (e) {
      console.error("Kanalga qo‘shishda xato:", e.message);
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<p>✅ Test to'lov muvaffaqiyatli! Telegram'ga qaytishingiz mumkin.</p>`);
  } catch (e) {
    console.error(e);
    res.status(500).send("server error");
  }
});

// CLICK callback (REAL) — TODO: imzo tekshiruvi
app.post("/click/callback", async (req, res) => {
  const data = req.body || {};
  try {
    // TODO: SIGNATURE tekshirish (SECRET_KEY bilan)
    if (Number(data.status) === 0 && Number(data.amount) === PRICE) {
      const userId = Number(String(data.merchant_trans_id || "").replace("user", ""));
      if (userId) {
        const now = new Date();
        const exp = new Date(now);
        exp.setDate(exp.getDate() + 30);

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
          await bot.sendMessage(userId, `✅ Click to'lovi qabul qilindi.\nPREMIUM 30 kunga faollashtirildi.`, { parse_mode: "HTML" });
        } catch (e) {
          console.error("Kanalga qo‘shish xatosi:", e.message);
        }
      }
    }
  } catch (e) {
    console.error("Click callback error:", e);
  }
  res.json({ status: "ok" });
});

// TRIBUTE callback (REAL) — TODO: imzo tekshiruvi
app.post("/tribute/callback", async (req, res) => {
  const data = req.body || {};
  try {
    // TODO: SIGNATURE tekshiruvi
    if (String(data.status) === "succeeded" && Number(data.amount) === PRICE) {
      const userId = Number(String(data.reference || "").replace("user", ""));
      if (userId) {
        const now = new Date();
        const exp = new Date(now);
        exp.setDate(exp.getDate() + 30);

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
          await bot.sendMessage(userId, `✅ Tribute to'lovi qabul qilindi.\nPREMIUM 30 kunga faollashtirildi.`, { parse_mode: "HTML" });
        } catch (e) {
          console.error("Kanalga qo‘shish xatosi:", e.message);
        }
      }
    }
  } catch (e) {
    console.error("Tribute callback error:", e);
  }
  res.json({ status: "ok" });
});

// -------------------------------
// CRON — 12 soatda tekshiruv (expiry + retry + kick)
// -------------------------------
schedule.scheduleJob("0 */12 * * *", async () => {
  const users = readUsers();
  const now = new Date();

  for (const u of users) {
    // Bonus bor — chiqarishni kutamiz (bonus kamayishi alohida jobda)
    if (u.bonus_days && u.bonus_days > 0) continue;

    // Faqat active/grace holatlar muhim
    if (u.status !== "active" && u.status !== "grace") continue;

    const expired = u.expires_at ? new Date(u.expires_at) < now : false;
    if (!expired) continue; // hali tugamagan

    // Muddati tugagan — auto-charge
    if (!AUTO_CHARGE_ENABLED) {
      // Test rejim: muvaffaqiyatsiz urinish sifatida belgilaymiz
      const rc = (u.retry_count || 0) + 1;
      updateUser(u.user_id, { retry_count: rc, status: "grace" });if (rc >= 3) {
        // 3 urinishdan keyin chiqaramiz (bonus yo‘q)
        try {
          await bot.kickChatMember(CHANNEL_ID, u.user_id);
          updateUser(u.user_id, { status: "inactive" });
          await bot.sendMessage(u.user_id, "❌ To‘lov amalga oshmadi. Siz premium kanal ro‘yxatidan chiqarildingiz.", { parse_mode: "HTML" });
        } catch (e) {
          console.error("Chiqarishda xato:", e.message);
        }
      } else {
        // Ogohlantirish
        if (u.remind_on) {
          await bot.sendMessage(
            u.user_id,
            `⚠️ To‘lov muvaffaqiyatsiz (urinish ${rc}/3).\nIltimos, kartangizni to‘ldiring yoki obunani qayta faollashtiring.`,
            { parse_mode: "HTML" }
          );
        }
      }
    } else {
      // REAL AUTO-CHARGE (TODO: Click/Tribute repeatPayment)
      //  - muvaffaqiyatli: retry_count=0, expires_at +30, status="active", history push
      //  - muvaffaqiyatsiz: retry_count++, 3 da kick
    }
  }
});

// Bonusni har kuni 09:00 da 1 kunga kamaytirish
schedule.scheduleJob("0 9 * * *", () => {
  const users = readUsers();
  let changed = false;
  for (const u of users) {
    if (u.bonus_days && u.bonus_days > 0) {
      u.bonus_days = u.bonus_days - 1;
      changed = true;
    }
  }
  if (changed) writeUsers(users);
});

// -------------------------------
// Server — Expressni ishga tushirish
// -------------------------------
const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`✅ Server ishga tushdi: PORT ${PORT}`);
});
console.log("🤖 Bot ishga tushdi (HTML, polling).");
