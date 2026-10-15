const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { createHmac, timingSafeEqual } = require("node:crypto");
const { Pool } = require("pg");

const PORT = Number(process.env.PORT || 5000);
const ADMIN_TELEGRAM_ID = "6594530740";
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PHONE_CATALOG = {
  common: ["iPhone 11", "Samsung A12", "Xiaomi Redmi 9", "Motorola G8", "POCO X3", "Realme C11", "Nokia 5.4"],
  uncommon: ["iPhone 12", "Samsung S20", "OnePlus 9", "Xiaomi 11", "Realme GT", "Poco F3", "Samsung A52"],
  rare: ["iPhone 13 Pro", "Samsung S21 Ultra", "Xiaomi 12", "OnePlus 9 Pro", "Google Pixel 6", "Oppo Reno 6"],
  epic: ["iPhone 14 Pro Max", "Samsung Z Fold 3", "OnePlus 10 Pro", "Xiaomi 12 Ultra", "Pixel 7 Pro"],
  legendary: ["iPhone 15 Pro Max", "Samsung Z Fold 5", "OnePlus 11 Pro", "Pixel 8 Pro", "ROG Phone 7"],
  mythic: ["Samsung S24 Ultra", "iPhone 16 Pro Max", "OnePlus 12 Pro", "Xiaomi 14 Ultra", "Nothing Phone 3"],
  prismatic: ["Samsung S22 Ultra Prismatic", "iPhone 16 Titanium", "OnePlus Ultra Edition", "Xiaomi Ultra Concept", "Nothing Concept X", "ROG Phone Prismatic", "Honor Magic Prismatic", "Vivo X Prismatic", "Телифон"],
  secret: ["Unknown Prototype X", "Hidden Device Zero", "Classified Tech 01", "Mystery Phone Ω", "Secret Device Alpha", "Phantom Phone", "Ghost Tech", "Whisper Device"],
  cosmic: ["Nebula X", "Galaxy Singularity", "iPhone Nova Ultra", "Quantum Fold X", "Orion Pro Max", "Pixel Cosmos"],
  divine: ["Aether One", "iPhone Eternity", "Samsung Zenith Ultra", "Zenith Fold X", "Pixel Ascendant", "Celestial Prototype"],
};
const GAME_HTML = path.join(
  __dirname,
  "attached_assets",
  "Pasted--DOCTYPE-html-html-lang-ru-head-meta-charset-UTF-8-meta_1792002308718.txt",
);
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : null;
const lastActionAt = new Map();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, value) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(value));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 16_384) {
        reject(new HttpError(413, "Слишком большой запрос."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new HttpError(400, "Некорректный JSON."));
      }
    });
    req.on("error", reject);
  });
}

function validateTelegramId(value) {
  const id = String(value ?? "");
  if (!/^[1-9]\d{0,18}$/.test(id) || BigInt(id) > 9_223_372_036_854_775_807n) {
    throw new HttpError(400, "Укажи корректный Telegram ID.");
  }
  return id;
}

function validateAmount(value) {
  const amount = String(value ?? "");
  if (!/^[1-9]\d{0,15}$/.test(amount) || BigInt(amount) > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new HttpError(400, "Сумма должна быть целым положительным числом.");
  }
  return amount;
}

function getTelegramDisplayName(user, id) {
  const username = getTelegramUsername(user);
  if (username) return `@${username}`;

  const name = [user.first_name, user.last_name]
    .map((part) => String(part ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, 64);
  return name || `Игрок ${id.slice(-4)}`;
}

function getTelegramUsername(user) {
  const username = String(user.username ?? "").trim();
  return /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(username) ? username : null;
}

async function upsertTelegramAlias(db, identity) {
  if (identity.username) {
    await db.query(
      `UPDATE phone_game_player_aliases
          SET username = NULL, updated_at = NOW()
        WHERE LOWER(username) = LOWER($1)
          AND telegram_id <> $2`,
      [identity.username, identity.id],
    );
  }
  await db.query(
    `INSERT INTO phone_game_player_aliases (telegram_id, username, display_name, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (telegram_id) DO UPDATE
       SET username = EXCLUDED.username,
           display_name = EXCLUDED.display_name,
           updated_at = NOW()`,
    [identity.id, identity.username, identity.displayName],
  );
}

async function resolvePlayerIdentifier(db, value) {
  const input = String(value ?? "").trim();
  if (/^[1-9]\d{0,18}$/.test(input)) {
    const id = validateTelegramId(input);
    const result = await db.query(
      `SELECT a.telegram_id, a.username, a.display_name,
              COALESCE(w.balance, 0)::text AS balance
         FROM (SELECT $1::bigint AS telegram_id) target
         LEFT JOIN phone_game_player_aliases a ON a.telegram_id = target.telegram_id
         LEFT JOIN phone_game_wallets w ON w.telegram_id = target.telegram_id`,
      [id],
    );
    const row = result.rows[0];
    return {
      id,
      username: row?.username || null,
      displayName: row?.display_name || `Игрок ${id.slice(-4)}`,
      balance: row?.balance || "0",
    };
  }

  const username = input.replace(/^@/, "");
  if (!/^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(username)) {
    throw new HttpError(400, "Введи Telegram ID или @username (5–32 символа).");
  }
  const result = await db.query(
    `SELECT a.telegram_id, a.username, a.display_name,
            COALESCE(w.balance, 0)::text AS balance
       FROM phone_game_player_aliases a
       LEFT JOIN phone_game_wallets w ON w.telegram_id = a.telegram_id
      WHERE LOWER(a.username) = LOWER($1)
      LIMIT 1`,
    [username],
  );
  const row = result.rows[0];
  if (!row) {
    throw new HttpError(404, "Игрок не найден. Попроси его открыть игру в Telegram хотя бы один раз.");
  }
  return {
    id: String(row.telegram_id),
    username: row.username,
    displayName: row.display_name,
    balance: String(row.balance),
  };
}

function validateSocialCursor(value) {
  const cursor = String(value ?? "0");
  if (!/^(0|[1-9]\d{0,18})$/.test(cursor) || BigInt(cursor) > 9_223_372_036_854_775_807n) {
    throw new HttpError(400, "Некорректный идентификатор сообщения.");
  }
  return cursor;
}

function toPublicChatMessage(row, requesterIsAdmin) {
  const message = {
    id: String(row.id),
    display_name: row.display_name,
    message: row.message,
    created_at: row.created_at,
    is_admin: String(row.telegram_id) === ADMIN_TELEGRAM_ID,
  };
  if (requesterIsAdmin) message.telegram_id = String(row.telegram_id);
  return message;
}

function authenticateTelegram(req) {
  if (!BOT_TOKEN) {
    throw new HttpError(503, "Администратор должен добавить новый токен бота в Secrets.");
  }

  const initData = req.headers["x-telegram-init-data"];
  if (typeof initData !== "string" || initData.length > 10_000) {
    throw new HttpError(401, "Открой игру через Telegram.");
  }

  const params = new URLSearchParams(initData);
  const entries = [...params.entries()];
  if (entries.length < 2 || entries.some(([key]) => params.getAll(key).length !== 1)) {
    throw new HttpError(401, "Подпись Telegram недействительна.");
  }

  const suppliedHash = params.get("hash");
  if (!suppliedHash || !/^[a-f0-9]{64}$/i.test(suppliedHash)) {
    throw new HttpError(401, "Подпись Telegram недействительна.");
  }

  const checkString = entries
    .filter(([key]) => key !== "hash")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const expectedHash = createHmac("sha256", secretKey).update(checkString).digest();
  const actualHash = Buffer.from(suppliedHash, "hex");
  if (actualHash.length !== expectedHash.length || !timingSafeEqual(actualHash, expectedHash)) {
    throw new HttpError(401, "Подпись Telegram недействительна.");
  }

  const authDate = Number(params.get("auth_date"));
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(authDate) || authDate > now + 300 || now - authDate > 86_400) {
    throw new HttpError(401, "Данные Telegram устарели. Перезапусти игру.");
  }

  let user;
  try {
    user = JSON.parse(params.get("user") || "");
  } catch {
    throw new HttpError(401, "Не удалось прочитать профиль Telegram.");
  }
  if (!user || !user.id) {
    throw new HttpError(401, "Telegram не передал ID пользователя.");
  }

  const id = validateTelegramId(user.id);
  return {
    id,
    admin: id === ADMIN_TELEGRAM_ID,
    username: getTelegramUsername(user),
    displayName: getTelegramDisplayName(user, id),
  };
}

function requireDatabase() {
  if (!pool) {
    throw new HttpError(503, "База данных пока недоступна.");
  }
  return pool;
}

function applyRateLimit(id, action) {
  const key = `${id}:${action}`;
  const now = Date.now();
  if (now - (lastActionAt.get(key) || 0) < 800) {
    throw new HttpError(429, "Подожди секунду перед следующим действием.");
  }
  lastActionAt.set(key, now);
  if (lastActionAt.size > 5_000) {
    for (const [entry, timestamp] of lastActionAt) {
      if (now - timestamp > 60_000) lastActionAt.delete(entry);
    }
  }
}

async function ensureWallet(db, id) {
  await db.query(
    `INSERT INTO phone_game_wallets (telegram_id)
     VALUES ($1)
     ON CONFLICT (telegram_id) DO NOTHING`,
    [id],
  );
}

async function getTransactions(db, id) {
  const result = await db.query(
    `SELECT id, from_telegram_id, to_telegram_id, amount, kind, created_at
       FROM phone_game_wallet_transactions
      WHERE from_telegram_id = $1 OR to_telegram_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT 20`,
    [id],
  );
  return result.rows;
}

async function getGiftedItems(db, id) {
  const result = await db.query(
    `SELECT id, phone_name, rarity, created_at
       FROM phone_game_inventory_items
      WHERE telegram_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT 100`,
    [id],
  );
  return result.rows;
}

async function handleApi(req, res, url) {
  const identity = authenticateTelegram(req);
  const db = requireDatabase();

  if (req.method === "GET" && url.pathname === "/api/me") {
    await upsertTelegramAlias(db, identity);
    await ensureWallet(db, identity.id);
    const [wallet, transactions, items] = await Promise.all([
      db.query("SELECT balance FROM phone_game_wallets WHERE telegram_id = $1", [identity.id]),
      getTransactions(db, identity.id),
      getGiftedItems(db, identity.id),
    ]);
    let adminTransactions = [];
    let adminItemGrants = [];
    if (identity.admin) {
      const [history, itemHistory] = await Promise.all([
        db.query(
        `SELECT id, from_telegram_id, to_telegram_id, amount, kind, created_at
           FROM phone_game_wallet_transactions
          ORDER BY created_at DESC, id DESC
          LIMIT 30`,
        ),
        db.query(
          `SELECT id, telegram_id, phone_name, rarity, created_at
             FROM phone_game_inventory_items
            ORDER BY created_at DESC, id DESC
            LIMIT 30`,
        ),
      ]);
      adminTransactions = history.rows;
      adminItemGrants = itemHistory.rows;
    }
    return sendJson(res, 200, {
      id: identity.id,
      admin: identity.admin,
      balance: wallet.rows[0].balance,
      transactions,
      items: items.rows,
      adminTransactions,
      adminItemGrants,
    });
  }

  if (req.method === "POST" && url.pathname === "/api/wallet/transfer") {
    applyRateLimit(identity.id, "transfer");
    const body = await readBody(req);
    const recipient = await resolvePlayerIdentifier(db, body.toId);
    const recipientId = recipient.id;
    const amount = validateAmount(body.amount);
    if (recipientId === identity.id) {
      throw new HttpError(400, "Нельзя перевести деньги самому себе.");
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await ensureWallet(client, identity.id);
      await ensureWallet(client, recipientId);
      const lockIds = [identity.id, recipientId].sort((a, b) =>
        BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0,
      );
      await client.query(
        `SELECT telegram_id
           FROM phone_game_wallets
          WHERE telegram_id = ANY($1::bigint[])
          ORDER BY telegram_id
          FOR UPDATE`,
        [lockIds],
      );
      const debit = await client.query(
        `UPDATE phone_game_wallets
            SET balance = balance - $1::bigint, updated_at = NOW()
          WHERE telegram_id = $2 AND balance >= $1::bigint
          RETURNING balance`,
        [amount, identity.id],
      );
      if (debit.rowCount !== 1) {
        throw new HttpError(409, "В кошельке недостаточно средств.");
      }
      await client.query(
        `UPDATE phone_game_wallets
            SET balance = balance + $1::bigint, updated_at = NOW()
          WHERE telegram_id = $2`,
        [amount, recipientId],
      );
      await client.query(
        `INSERT INTO phone_game_wallet_transactions
          (from_telegram_id, to_telegram_id, amount, kind)
         VALUES ($1, $2, $3::bigint, 'transfer')`,
        [identity.id, recipientId, amount],
      );
      await client.query("COMMIT");
      return sendJson(res, 200, { ok: true, player: recipient });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  if (req.method === "POST" && url.pathname === "/api/admin/resolve-player") {
    if (!identity.admin) throw new HttpError(403, "Эта команда доступна только администратору.");
    applyRateLimit(identity.id, "resolve-player");
    const body = await readBody(req);
    const player = await resolvePlayerIdentifier(db, body.identifier);
    return sendJson(res, 200, { player });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/grant") {
    if (!identity.admin) throw new HttpError(403, "Эта команда доступна только администратору.");
    applyRateLimit(identity.id, "grant");
    const body = await readBody(req);
    const recipient = await resolvePlayerIdentifier(db, body.toId);
    const recipientId = recipient.id;
    const amount = validateAmount(body.amount);
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await ensureWallet(client, recipientId);
      await client.query(
        `UPDATE phone_game_wallets
            SET balance = balance + $1::bigint, updated_at = NOW()
          WHERE telegram_id = $2`,
        [amount, recipientId],
      );
      await client.query(
        `INSERT INTO phone_game_wallet_transactions
          (from_telegram_id, to_telegram_id, amount, kind)
         VALUES ($1, $2, $3::bigint, 'admin_grant')`,
        [identity.id, recipientId, amount],
      );
      await client.query("COMMIT");
      return sendJson(res, 200, { ok: true, player: recipient });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  if (req.method === "POST" && url.pathname === "/api/admin/items/grant") {
    if (!identity.admin) throw new HttpError(403, "Эта команда доступна только администратору.");
    applyRateLimit(identity.id, "item-grant");
    const body = await readBody(req);
    const recipient = await resolvePlayerIdentifier(db, body.toId);
    const recipientId = recipient.id;
    const rarity = String(body.rarity ?? "");
    const phoneName = String(body.phoneName ?? "");
    if (!PHONE_CATALOG[rarity]?.includes(phoneName)) {
      throw new HttpError(400, "Выбери предмет из списка игры.");
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await ensureWallet(client, recipientId);
      await client.query(
        `INSERT INTO phone_game_inventory_items
          (telegram_id, phone_name, rarity, granted_by)
         VALUES ($1, $2, $3, $4)`,
        [recipientId, phoneName, rarity, identity.id],
      );
      await client.query("COMMIT");
      return sendJson(res, 200, { ok: true, player: recipient });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  if (req.method === "POST" && url.pathname === "/api/social/presence") {
    applyRateLimit(identity.id, "presence");
    await upsertTelegramAlias(db, identity);
    await db.query(
      `INSERT INTO phone_game_social_presence (telegram_id, display_name, last_seen)
       VALUES ($1, $2, NOW())
       ON CONFLICT (telegram_id) DO UPDATE
         SET display_name = EXCLUDED.display_name, last_seen = NOW()`,
      [identity.id, identity.displayName],
    );
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "GET" && url.pathname === "/api/social") {
    const afterMessage = validateSocialCursor(url.searchParams.get("afterMessage"));
    const afterEvent = validateSocialCursor(url.searchParams.get("afterEvent"));
    const [messages, online, events] = await Promise.all([
      afterMessage === "0"
        ? db.query(
          `SELECT id, telegram_id, display_name, message, created_at
             FROM (
               SELECT id, telegram_id, display_name, message, created_at
                 FROM phone_game_chat_messages
                ORDER BY id DESC
                LIMIT 50
             ) recent
            ORDER BY id ASC`,
        )
        : db.query(
          `SELECT id, telegram_id, display_name, message, created_at
             FROM phone_game_chat_messages
            WHERE id > $1::bigint
            ORDER BY id ASC
            LIMIT 100`,
          [afterMessage],
        ),
      db.query(
        `SELECT telegram_id, display_name, last_seen
           FROM phone_game_social_presence
          WHERE last_seen > NOW() - INTERVAL '45 seconds'
          ORDER BY last_seen DESC
          LIMIT 50`,
      ),
      afterEvent === "0"
        ? db.query(
          `SELECT id, display_name, rarity, phone_name, created_at
             FROM (
               SELECT id, display_name, rarity, phone_name, created_at
                 FROM phone_game_rare_events
                WHERE created_at > NOW() - INTERVAL '15 minutes'
                ORDER BY id DESC
                LIMIT 10
             ) recent
            ORDER BY id ASC`,
        )
        : db.query(
          `SELECT id, display_name, rarity, phone_name, created_at
             FROM phone_game_rare_events
            WHERE id > $1::bigint
            ORDER BY id ASC
            LIMIT 20`,
          [afterEvent],
        ),
    ]);

    return sendJson(res, 200, {
      messages: messages.rows.map((row) => toPublicChatMessage(row, identity.admin)),
      online: online.rows.map((row) => ({
        display_name: row.display_name,
        ...(identity.admin ? { id: String(row.telegram_id) } : {}),
      })),
      events: events.rows.map((row) => ({
        id: String(row.id),
        display_name: row.display_name,
        rarity: row.rarity,
        phone_name: row.phone_name,
        created_at: row.created_at,
      })),
    });
  }

  if (req.method === "POST" && url.pathname === "/api/social/chat") {
    applyRateLimit(identity.id, "chat");
    const body = await readBody(req);
    if (typeof body.message !== "string") throw new HttpError(400, "Напиши сообщение.");
    const message = body.message.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
    if (!message || Array.from(message).length > 240) {
      throw new HttpError(400, "Сообщение должно быть длиной от 1 до 240 символов.");
    }

    const recentMessage = await db.query(
      `SELECT 1
         FROM phone_game_chat_messages
        WHERE telegram_id = $1
          AND created_at > NOW() - INTERVAL '1.2 seconds'
        LIMIT 1`,
      [identity.id],
    );
    if (recentMessage.rowCount) {
      throw new HttpError(429, "Подожди немного перед следующим сообщением.");
    }

    const result = await db.query(
      `INSERT INTO phone_game_chat_messages (telegram_id, display_name, message)
       VALUES ($1, $2, $3)
       RETURNING id, telegram_id, display_name, message, created_at`,
      [identity.id, identity.displayName, message],
    );
    await db.query(
      `DELETE FROM phone_game_chat_messages
        WHERE id < (
          SELECT id FROM phone_game_chat_messages
          ORDER BY id DESC
          OFFSET 499 LIMIT 1
        )`,
    );
    return sendJson(res, 201, {
      message: toPublicChatMessage(result.rows[0], identity.admin),
    });
  }

  if (req.method === "POST" && url.pathname === "/api/social/rare-drop") {
    applyRateLimit(identity.id, "rare-drop");
    const body = await readBody(req);
    const rarity = String(body.rarity ?? "");
    const phoneName = String(body.phoneName ?? "");
    if (!["prismatic", "secret", "cosmic", "divine"].includes(rarity) || !PHONE_CATALOG[rarity]?.includes(phoneName)) {
      throw new HttpError(400, "Некорректный редкий предмет.");
    }

    const recentEvent = await db.query(
      `SELECT 1
         FROM phone_game_rare_events
        WHERE telegram_id = $1
          AND created_at > NOW() - INTERVAL '5 seconds'
        LIMIT 1`,
      [identity.id],
    );
    if (recentEvent.rowCount) {
      throw new HttpError(429, "Подожди немного перед следующим объявлением.");
    }

    const result = await db.query(
      `INSERT INTO phone_game_rare_events (telegram_id, display_name, rarity, phone_name)
       VALUES ($1, $2, $3, $4)
       RETURNING id, display_name, rarity, phone_name, created_at`,
      [identity.id, identity.displayName, rarity, phoneName],
    );
    await db.query(
      `DELETE FROM phone_game_rare_events
        WHERE id < (
          SELECT id FROM phone_game_rare_events
          ORDER BY id DESC
          OFFSET 199 LIMIT 1
        )`,
    );
    return sendJson(res, 201, {
      event: {
        id: String(result.rows[0].id),
        display_name: result.rows[0].display_name,
        rarity: result.rows[0].rarity,
        phone_name: result.rows[0].phone_name,
        created_at: result.rows[0].created_at,
      },
    });
  }

  sendJson(res, 404, { error: "API route not found." });
}

function serveFile(res, filePath, contentType) {
  fs.readFile(filePath, (error, contents) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Not found");
    }
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });
    res.end(contents);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (url.pathname === "/healthz" && req.method === "GET") {
    return sendJson(res, 200, { ok: true });
  }
  if (url.pathname === "/favicon.ico" && req.method === "GET") {
    res.writeHead(204, { "Cache-Control": "no-store" });
    return res.end();
  }
  if (url.pathname.startsWith("/api/")) {
    try {
      await handleApi(req, res, url);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) console.error("API request failed:", error.message);
      if (!res.headersSent) {
        sendJson(res, status, {
          error: status === 500 ? "Внутренняя ошибка сервера." : error.message,
        });
      }
    }
    return;
  }
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET", "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Method not allowed");
  }
  if (url.pathname === "/feature.js") {
    return serveFile(res, path.join(__dirname, "feature.js"), "text/javascript; charset=utf-8");
  }
  if (url.pathname === "/" || url.pathname === "/index.html") {
    return serveFile(res, GAME_HTML, "text/html; charset=utf-8");
  }
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Game server listening on port ${PORT}`);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    server.close(() => {
      if (pool) pool.end().finally(() => process.exit(0));
      else process.exit(0);
    });
  });
}
