const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { URL } = require("node:url");

loadEnvFile(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 3000);
const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PROD = NODE_ENV === "production";
const PAYMENT_PROVIDER = process.env.PAYMENT_PROVIDER || "toss";
const TOSS_CLIENT_KEY = process.env.TOSS_CLIENT_KEY || "";
const TOSS_SECRET_KEY = process.env.TOSS_SECRET_KEY || "";

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "db.json");

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const STATIC_ROUTE_MAP = {
  "/payments/success": "/payments-success.html",
  "/payments/fail": "/payments-fail.html",
};

const SHOP_CATALOG = [
  {
    sku: "gem_pack_small",
    name: "Starter Gem Pack",
    description: "Premium gems 120개를 지급합니다.",
    price: 4900,
    currency: "KRW",
    type: "gems",
    amount: 120,
  },
  {
    sku: "gem_pack_large",
    name: "Tycoon Gem Pack",
    description: "Premium gems 350개를 지급합니다.",
    price: 12900,
    currency: "KRW",
    type: "gems",
    amount: 350,
  },
  {
    sku: "founder_skin",
    name: "Founder Drill Skin",
    description: "메인 드릴 외형을 황금 스타일로 바꿉니다.",
    price: 6900,
    currency: "KRW",
    type: "skin",
    skinId: "founder-gold",
  },
];

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const index = line.indexOf("=");
    if (index === -1) {
      continue;
    }
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function nowIso() {
  return new Date().toISOString();
}

function uid(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function clampNumber(value, min = 0, max = 1_000_000_000) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return min;
  }
  return Math.min(max, Math.max(min, num));
}

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(
      DB_PATH,
      JSON.stringify({ users: [], sessions: [], orders: [], leaderboardSnapshots: [] }, null, 2),
    );
  }
}

function readDb() {
  ensureDataFile();
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}

function writeDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function defaultGameState() {
  return {
    resources: { gold: 0, ore: 0, crystals: 0, cores: 0, premiumGems: 0 },
    progression: { depth: 1, kills: 0, bossFloor: 10, ascensions: 0 },
    upgrades: { drill: 0, crew: 0, forge: 0, scanner: 0 },
    lab: { overclock: 0, logistics: 0, luck: 0 },
    cosmetics: { activeSkin: "default", ownedSkins: ["default"] },
    quests: [
      { id: "ore", label: "광석 250개 채굴", progress: 0, goal: 250, claimed: false, reward: { gold: 120 } },
      { id: "kills", label: "적 12마리 처치", progress: 0, goal: 12, claimed: false, reward: { crystals: 4 } },
      { id: "depth", label: "15층 도달", progress: 0, goal: 15, claimed: false, reward: { premiumGems: 10 } },
    ],
    boss: { name: "Crag Maw", hp: 120, maxHp: 120, ready: false },
    lastUpdatedAt: Date.now(),
    logs: [
      { id: uid("log"), text: "원정대가 광산 입구에 도착했다." },
      { id: uid("log"), text: "서버 동기화가 활성화되었다." },
    ],
    stats: { oreMined: 0, damageDealt: 0, sessions: 1 },
  };
}

function calculatePower(state) {
  const drillPower = 1 + state.upgrades.drill * 2;
  const forgePower = 4 + state.upgrades.forge * 3;
  const labPower = 1 + state.lab.overclock * 0.18;
  const ascensionPower = 1 + state.resources.cores * 0.12;
  return Math.floor((drillPower + forgePower + Math.floor(state.progression.depth / 2)) * labPower * ascensionPower);
}

function updateQuestProgress(state) {
  const mapping = {
    ore: Math.floor(state.stats.oreMined),
    kills: state.progression.kills,
    depth: state.progression.depth,
  };
  state.quests = state.quests.map((quest) => ({
    ...quest,
    progress: Math.min(quest.goal, mapping[quest.id] ?? quest.progress),
  }));
}

function sanitizeGameState(input, previousState) {
  const base = defaultGameState();
  const state = {
    ...base,
    ...input,
    resources: {
      ...base.resources,
      ...(input?.resources || {}),
      premiumGems: previousState.resources.premiumGems,
    },
    progression: { ...base.progression, ...(input?.progression || {}) },
    upgrades: { ...base.upgrades, ...(input?.upgrades || {}) },
    lab: { ...base.lab, ...(input?.lab || {}) },
    cosmetics: {
      ...base.cosmetics,
      activeSkin: previousState.cosmetics.activeSkin,
      ownedSkins: [...previousState.cosmetics.ownedSkins],
    },
    boss: { ...base.boss, ...(input?.boss || {}) },
    stats: { ...base.stats, ...(input?.stats || {}) },
    logs: Array.isArray(input?.logs) ? input.logs.slice(0, 24) : previousState.logs,
    quests: previousState.quests.map((quest) => ({ ...quest, claimed: Boolean(quest.claimed) })),
  };

  state.resources.gold = clampNumber(state.resources.gold);
  state.resources.ore = clampNumber(state.resources.ore);
  state.resources.crystals = clampNumber(state.resources.crystals, 0, 100000);
  state.resources.cores = clampNumber(state.resources.cores, 0, 10000);
  state.progression.depth = clampNumber(state.progression.depth, 1, 10000);
  state.progression.kills = clampNumber(state.progression.kills, 0, 1000000);
  state.progression.bossFloor = clampNumber(state.progression.bossFloor, 10, 100000);
  state.upgrades.drill = clampNumber(state.upgrades.drill, 0, 500);
  state.upgrades.crew = clampNumber(state.upgrades.crew, 0, 500);
  state.upgrades.forge = clampNumber(state.upgrades.forge, 0, 500);
  state.upgrades.scanner = clampNumber(state.upgrades.scanner, 0, 500);
  state.lab.overclock = clampNumber(state.lab.overclock, 0, 500);
  state.lab.logistics = clampNumber(state.lab.logistics, 0, 500);
  state.lab.luck = clampNumber(state.lab.luck, 0, 500);
  state.logs = state.logs
    .map((entry) => ({
      id: String(entry?.id || uid("log")).slice(0, 80),
      text: String(entry?.text || "").slice(0, 180),
    }))
    .filter((entry) => entry.text);
  updateQuestProgress(state);
  state.lastUpdatedAt = Date.now();
  return state;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function parseCookies(req) {
  const cookieHeader = req.headers.cookie || "";
  return cookieHeader.split(";").reduce((acc, pair) => {
    const [rawKey, ...rest] = pair.trim().split("=");
    if (!rawKey) {
      return acc;
    }
    acc[rawKey] = decodeURIComponent(rest.join("="));
    return acc;
  }, {});
}

function securityHeaders() {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self' https://js.tosspayments.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self' https://api.tosspayments.com",
      "frame-src https://js.tosspayments.com https://*.tosspayments.com",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; "),
  };
}

function sendJson(res, statusCode, body, extraHeaders = {}) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...securityHeaders(),
    ...extraHeaders,
  });
  res.end(JSON.stringify(body));
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = MIME_TYPES[ext] || "application/octet-stream";
  fs.createReadStream(filePath)
    .on("error", () => sendJson(res, 404, { error: "Not found" }))
    .once("open", () => {
      res.writeHead(200, { "Content-Type": mimeType, ...securityHeaders() });
    })
    .pipe(res);
}

function createSession(userId) {
  const rawToken = uid("sess");
  return {
    rawToken,
    record: {
      tokenHash: hashToken(rawToken),
      csrfToken: uid("csrf"),
      userId,
      createdAt: nowIso(),
    },
  };
}

function sessionCookieHeaders(rawToken, csrfToken) {
  const secure = IS_PROD ? "; Secure" : "";
  return [
    `orefall_session=${encodeURIComponent(rawToken)}; Path=/; HttpOnly; SameSite=Lax${secure}`,
    `orefall_csrf=${encodeURIComponent(csrfToken)}; Path=/; SameSite=Lax${secure}`,
  ];
}

function clearSessionHeaders() {
  return [
    "orefall_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax",
    "orefall_csrf=; Path=/; Max-Age=0; SameSite=Lax",
  ];
}

function getSession(req, db) {
  const cookies = parseCookies(req);
  const rawToken = cookies.orefall_session || "";
  if (!rawToken) {
    return null;
  }
  const session = db.sessions.find((entry) => entry.tokenHash === hashToken(rawToken));
  if (!session) {
    return null;
  }
  const user = db.users.find((entry) => entry.id === session.userId);
  if (!user) {
    return null;
  }
  return { session, user };
}

function requireCsrf(req, session) {
  if (req.method === "GET" || req.method === "HEAD") {
    return true;
  }
  return req.headers["x-csrf-token"] === session.csrfToken;
}

function profileFromUser(user) {
  return {
    id: user.id,
    username: user.username,
    createdAt: user.createdAt,
    premium: {
      gems: user.gameState.resources.premiumGems,
      ownedSkins: user.gameState.cosmetics.ownedSkins,
      activeSkin: user.gameState.cosmetics.activeSkin,
    },
    gameState: user.gameState,
  };
}

function applyOrderToUser(user, item) {
  if (item.type === "gems") {
    user.gameState.resources.premiumGems += item.amount;
    user.gameState.logs.unshift({ id: uid("log"), text: `${item.name} 구매로 프리미엄 젬 ${item.amount}개를 받았다.` });
  }
  if (item.type === "skin" && item.skinId) {
    if (!user.gameState.cosmetics.ownedSkins.includes(item.skinId)) {
      user.gameState.cosmetics.ownedSkins.push(item.skinId);
    }
    user.gameState.logs.unshift({ id: uid("log"), text: `${item.name} 스킨이 지급되었다.` });
  }
  user.gameState.logs = user.gameState.logs.slice(0, 24);
}

function absoluteUrl(req, pathname) {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol = forwardedProto || (IS_PROD ? "https" : "http");
  const host = req.headers.host || `localhost:${PORT}`;
  return `${protocol}://${host}${pathname}`;
}

function createPendingOrder(db, userId, item) {
  const order = {
    id: uid("order"),
    userId,
    sku: item.sku,
    status: "pending",
    amount: item.price,
    currency: item.currency,
    provider: PAYMENT_PROVIDER,
    createdAt: nowIso(),
  };
  db.orders.push(order);
  return order;
}

async function confirmTossPayment(order, paymentKey) {
  const authorization = Buffer.from(`${TOSS_SECRET_KEY}:`).toString("base64");
  const response = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
    method: "POST",
    headers: {
      Authorization: `Basic ${authorization}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `orefall-${order.id}`,
    },
    body: JSON.stringify({
      paymentKey,
      orderId: order.id,
      amount: order.amount,
    }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.message || payload?.code || "토스 결제 승인에 실패했습니다.");
  }
  return payload;
}

async function handleApi(req, res, url) {
  const db = readDb();

  if (req.method === "GET" && url.pathname === "/api/config") {
    sendJson(res, 200, {
      paymentProvider: PAYMENT_PROVIDER,
      toss: {
        clientKey: TOSS_CLIENT_KEY,
        enabled: Boolean(TOSS_CLIENT_KEY && TOSS_SECRET_KEY),
      },
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/register") {
    const body = await parseBody(req);
    const username = String(body.username || "").trim().slice(0, 20);
    if (!username || username.length < 2) {
      sendJson(res, 400, { error: "닉네임은 2자 이상이어야 합니다." });
      return;
    }
    if (db.users.some((user) => user.username.toLowerCase() === username.toLowerCase())) {
      sendJson(res, 409, { error: "이미 사용 중인 닉네임입니다." });
      return;
    }
    const user = { id: uid("user"), username, createdAt: nowIso(), gameState: defaultGameState() };
    const createdSession = createSession(user.id);
    db.users.push(user);
    db.sessions.push(createdSession.record);
    writeDb(db);
    sendJson(
      res,
      201,
      { profile: profileFromUser(user), csrfToken: createdSession.record.csrfToken },
      { "Set-Cookie": sessionCookieHeaders(createdSession.rawToken, createdSession.record.csrfToken) },
    );
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    const body = await parseBody(req);
    const username = String(body.username || "").trim().toLowerCase();
    const user = db.users.find((entry) => entry.username.toLowerCase() === username);
    if (!user) {
      sendJson(res, 404, { error: "해당 닉네임을 찾을 수 없습니다." });
      return;
    }
    const createdSession = createSession(user.id);
    db.sessions.push(createdSession.record);
    writeDb(db);
    sendJson(
      res,
      200,
      { profile: profileFromUser(user), csrfToken: createdSession.record.csrfToken },
      { "Set-Cookie": sessionCookieHeaders(createdSession.rawToken, createdSession.record.csrfToken) },
    );
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    const auth = getSession(req, db);
    if (auth) {
      db.sessions = db.sessions.filter((entry) => entry.tokenHash !== auth.session.tokenHash);
      writeDb(db);
    }
    sendJson(res, 200, { ok: true }, { "Set-Cookie": clearSessionHeaders() });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/session") {
    const auth = getSession(req, db);
    if (!auth) {
      sendJson(res, 401, { error: "세션이 없습니다." });
      return;
    }
    sendJson(res, 200, { profile: profileFromUser(auth.user), csrfToken: auth.session.csrfToken });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/game/save") {
    const auth = getSession(req, db);
    if (!auth || !requireCsrf(req, auth.session)) {
      sendJson(res, 401, { error: "로그인이 필요합니다." });
      return;
    }
    const body = await parseBody(req);
    auth.user.gameState = sanitizeGameState(body.gameState, auth.user.gameState);
    writeDb(db);
    sendJson(res, 200, { ok: true, savedAt: auth.user.gameState.lastUpdatedAt });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/game/claim-quest") {
    const auth = getSession(req, db);
    if (!auth || !requireCsrf(req, auth.session)) {
      sendJson(res, 401, { error: "로그인이 필요합니다." });
      return;
    }
    const body = await parseBody(req);
    const questId = String(body.questId || "");
    const quest = auth.user.gameState.quests.find((entry) => entry.id === questId);
    if (!quest || quest.claimed || quest.progress < quest.goal) {
      sendJson(res, 400, { error: "퀘스트를 수령할 수 없습니다." });
      return;
    }
    quest.claimed = true;
    auth.user.gameState.resources.gold += quest.reward.gold || 0;
    auth.user.gameState.resources.crystals += quest.reward.crystals || 0;
    auth.user.gameState.resources.premiumGems += quest.reward.premiumGems || 0;
    auth.user.gameState.logs.unshift({ id: uid("log"), text: `${quest.label} 보상을 수령했다.` });
    auth.user.gameState.logs = auth.user.gameState.logs.slice(0, 24);
    auth.user.gameState.lastUpdatedAt = Date.now();
    writeDb(db);
    sendJson(res, 200, { profile: profileFromUser(auth.user) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/leaderboard") {
    const leaderboard = [...db.users]
      .map((user) => ({
        username: user.username,
        depth: user.gameState.progression.depth,
        power: calculatePower(user.gameState),
        ores: Math.floor(user.gameState.stats.oreMined),
      }))
      .sort((a, b) => b.depth - a.depth || b.power - a.power || b.ores - a.ores)
      .slice(0, 10);
    sendJson(res, 200, { leaderboard });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/store/catalog") {
    sendJson(res, 200, {
      provider: PAYMENT_PROVIDER,
      items: SHOP_CATALOG,
      liveReady: Boolean(TOSS_CLIENT_KEY && TOSS_SECRET_KEY),
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/store/checkout") {
    const auth = getSession(req, db);
    if (!auth || !requireCsrf(req, auth.session)) {
      sendJson(res, 401, { error: "로그인이 필요합니다." });
      return;
    }
    const body = await parseBody(req);
    const item = SHOP_CATALOG.find((entry) => entry.sku === body.sku);
    if (!item) {
      sendJson(res, 404, { error: "상품을 찾을 수 없습니다." });
      return;
    }
    if (!TOSS_CLIENT_KEY || !TOSS_SECRET_KEY) {
      sendJson(res, 400, { error: "토스 결제 키가 설정되지 않았습니다." });
      return;
    }
    const order = createPendingOrder(db, auth.user.id, item);
    writeDb(db);
    sendJson(res, 200, {
      checkout: {
        provider: PAYMENT_PROVIDER,
        clientKey: TOSS_CLIENT_KEY,
        orderId: order.id,
        orderName: item.name,
        amount: item.price,
        currency: item.currency,
        customerKey: auth.user.id,
        successUrl: absoluteUrl(req, "/payments/success"),
        failUrl: absoluteUrl(req, "/payments/fail"),
      },
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/store/toss/confirm") {
    const auth = getSession(req, db);
    if (!auth || !requireCsrf(req, auth.session)) {
      sendJson(res, 401, { error: "로그인이 필요합니다." });
      return;
    }
    const body = await parseBody(req);
    const paymentKey = String(body.paymentKey || "");
    const orderId = String(body.orderId || "");
    const amount = Number(body.amount || 0);
    const order = db.orders.find((entry) => entry.id === orderId && entry.userId === auth.user.id);
    if (!order || order.status !== "pending") {
      sendJson(res, 404, { error: "대기 중인 주문이 없습니다." });
      return;
    }
    if (order.amount !== amount) {
      sendJson(res, 400, { error: "주문 금액이 일치하지 않습니다." });
      return;
    }
    try {
      const payment = await confirmTossPayment(order, paymentKey);
      const item = SHOP_CATALOG.find((entry) => entry.sku === order.sku);
      order.status = "paid";
      order.paidAt = nowIso();
      order.paymentKey = paymentKey;
      order.tossPaymentId = payment.paymentKey;
      applyOrderToUser(auth.user, item);
      auth.user.gameState.lastUpdatedAt = Date.now();
      writeDb(db);
      sendJson(res, 200, { profile: profileFromUser(auth.user), order, payment });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  sendJson(res, 404, { error: "Unknown API route" });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "GET" && url.pathname === "/healthz") {
      sendJson(res, 200, { ok: true });
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    const requestedPath = STATIC_ROUTE_MAP[url.pathname] || (url.pathname === "/" ? "/index.html" : url.pathname);
    const filePath = path.join(PUBLIC_DIR, requestedPath);
    const normalized = path.normalize(filePath);
    if (!normalized.startsWith(PUBLIC_DIR)) {
      sendJson(res, 403, { error: "Forbidden" });
      return;
    }
    if (!fs.existsSync(normalized) || fs.statSync(normalized).isDirectory()) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }
    sendFile(res, normalized);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Internal server error" });
  }
});

ensureDataFile();
server.listen(PORT, () => {
  console.log(`Orefall Idle server running at http://localhost:${PORT}`);
});
