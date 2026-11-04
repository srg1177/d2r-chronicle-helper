// Chronicle API: user accounts, login sessions, and each user's marked entries.
const crypto = require("crypto");
const express = require("express");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");

const {
  DATABASE_URL,
  PORT = "3000",
  DEFAULT_USERNAME = "",
  DEFAULT_PASSWORD = "",
  ALLOW_REGISTRATION = "true",
  SESSION_DAYS = "30",
  COOKIE_SECURE = "false",
} = process.env;

const pool = new Pool({ connectionString: DATABASE_URL });
const registrationOpen = ALLOW_REGISTRATION.toLowerCase() === "true";
const SESSION_MS = Number(SESSION_DAYS) * 24 * 60 * 60 * 1000;
const COOKIE = "chronicle_session";

const USERNAME_RE = /^[A-Za-z0-9_.-]{3,32}$/;
const ITEM_ID_RE = /^[a-z0-9_]{1,40}$/;

// ---------- Database ----------
async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      username      TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower ON users (lower(username));
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS marks (
      user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      item_id   TEXT NOT NULL,
      marked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, item_id)
    );
  `);
}

async function seedDefaultUser() {
  if (!DEFAULT_USERNAME || !DEFAULT_PASSWORD) return;
  const hash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
  // Only created once; an existing account keeps its password.
  const r = await pool.query(
    `INSERT INTO users (username, password_hash)
     SELECT $1, $2 WHERE NOT EXISTS (SELECT 1 FROM users WHERE lower(username) = lower($1))`,
    [DEFAULT_USERNAME, hash]);
  if (r.rowCount) console.log(`Created default user "${DEFAULT_USERNAME}"`);
}

async function waitForDb(tries = 30) {
  for (let i = 1; ; i++) {
    try { await pool.query("SELECT 1"); return; } catch (e) {
      if (i >= tries) throw e;
      console.log(`Waiting for database (${i}/${tries})...`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

// ---------- Sessions ----------
const sha256 = s => crypto.createHash("sha256").update(s).digest("hex");

function readCookie(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

function setSessionCookie(res, token, maxAgeMs) {
  const parts = [`${COOKIE}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
  if (COOKIE_SECURE === "true") parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

async function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString("hex");
  await pool.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)",
    [sha256(token), userId, new Date(Date.now() + SESSION_MS)]);
  setSessionCookie(res, token, SESSION_MS);
}

async function auth(req, res, next) {
  const token = readCookie(req, COOKIE);
  if (!token) return res.status(401).json({ error: "Not logged in" });
  const r = await pool.query(
    `SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`, [sha256(token)]);
  if (!r.rowCount) return res.status(401).json({ error: "Session expired" });
  req.user = r.rows[0];
  next();
}

// ---------- Routes ----------
const app = express();
app.use(express.json({ limit: "64kb" }));
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

app.get("/api/config", (req, res) => res.json({ allowRegistration: registrationOpen }));

app.post("/api/register", wrap(async (req, res) => {
  if (!registrationOpen) return res.status(403).json({ error: "Registration is disabled" });
  const { username, password } = req.body || {};
  if (typeof username !== "string" || !USERNAME_RE.test(username)) {
    return res.status(400).json({ error: "Username must be 3-32 letters, numbers, _ . or -" });
  }
  if (typeof password !== "string" || password.length < 4 || password.length > 200) {
    return res.status(400).json({ error: "Password must be at least 4 characters" });
  }
  const hash = await bcrypt.hash(password, 10);
  try {
    const r = await pool.query("INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id",
      [username, hash]);
    await startSession(res, r.rows[0].id);
    res.status(201).json({ username });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "That username is taken" });
    throw e;
  }
}));

app.post("/api/login", wrap(async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Enter a username and password" });
  }
  const r = await pool.query("SELECT id, username, password_hash FROM users WHERE lower(username) = lower($1)",
    [username]);
  const user = r.rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: "Wrong username or password" });
  }
  await startSession(res, user.id);
  res.json({ username: user.username });
}));

app.post("/api/logout", wrap(async (req, res) => {
  const token = readCookie(req, COOKIE);
  if (token) await pool.query("DELETE FROM sessions WHERE token_hash = $1", [sha256(token)]);
  setSessionCookie(res, "", 0);
  res.status(204).end();
}));

app.get("/api/me", wrap(auth), (req, res) => res.json({ username: req.user.username }));

app.get("/api/marks", wrap(auth), wrap(async (req, res) => {
  const r = await pool.query("SELECT item_id FROM marks WHERE user_id = $1", [req.user.id]);
  res.json({ ids: r.rows.map(x => x.item_id) });
}));

app.put("/api/marks/:id", wrap(auth), wrap(async (req, res) => {
  if (!ITEM_ID_RE.test(req.params.id)) return res.status(400).json({ error: "Bad item id" });
  await pool.query("INSERT INTO marks (user_id, item_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [req.user.id, req.params.id]);
  res.status(204).end();
}));

// Reset: clears the given ids, or every mark when no ids are sent.
app.delete("/api/marks", wrap(auth), wrap(async (req, res) => {
  const ids = req.body?.ids;
  if (ids === undefined) {
    const r = await pool.query("DELETE FROM marks WHERE user_id = $1", [req.user.id]);
    return res.json({ removed: r.rowCount });
  }
  if (!Array.isArray(ids) || ids.length > 2000 || !ids.every(id => typeof id === "string" && ITEM_ID_RE.test(id))) {
    return res.status(400).json({ error: "Bad item ids" });
  }
  const r = await pool.query("DELETE FROM marks WHERE user_id = $1 AND item_id = ANY($2::text[])",
    [req.user.id, ids]);
  res.json({ removed: r.rowCount });
}));

app.delete("/api/marks/:id", wrap(auth), wrap(async (req, res) => {
  await pool.query("DELETE FROM marks WHERE user_id = $1 AND item_id = $2", [req.user.id, req.params.id]);
  res.status(204).end();
}));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Server error" });
});

(async () => {
  await waitForDb();
  await migrate();
  await seedDefaultUser();
  await pool.query("DELETE FROM sessions WHERE expires_at < now()");
  app.listen(Number(PORT), () => console.log(`Chronicle API listening on ${PORT}`));
})().catch(e => { console.error(e); process.exit(1); });
