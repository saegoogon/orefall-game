const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { URL } = require("node:url");

const PORT = Number(process.env.PORT || 3000);
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

const MAX_POLLS = 100;
const MAX_COMMENTS_PER_POLL = 80;

function uid(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function nowIso() {
  return new Date().toISOString();
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
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
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self'",
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

function normalizeText(value, maxLength) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function createPoll({ authorId, authorName, question, optionA, optionB, category, description = "" }) {
  const createdAt = nowIso();
  return {
    id: uid("poll"),
    question,
    description,
    category,
    createdAt,
    updatedAt: createdAt,
    authorId,
    authorName,
    options: [
      { id: "A", text: optionA, votes: 0 },
      { id: "B", text: optionB, votes: 0 },
    ],
    comments: [],
    voters: [],
  };
}

function seedPolls() {
  return [
    createPoll({
      authorId: "seed",
      authorName: "BalanceBot",
      category: "일상",
      question: "평생 배달음식 금지 vs 평생 카페 금지",
      description: "사소한 것 같지만 삶의 만족도를 크게 흔드는 선택.",
      optionA: "배달음식 금지",
      optionB: "카페 금지",
    }),
    createPoll({
      authorId: "seed",
      authorName: "BalanceBot",
      category: "연애",
      question: "애인이 연락은 느리지만 다정함 vs 연락은 빠르지만 무뚝뚝함",
      description: "연애에서 더 중요한 기준은 뭘까요?",
      optionA: "느리지만 다정함",
      optionB: "빠르지만 무뚝뚝함",
    }),
    createPoll({
      authorId: "seed",
      authorName: "BalanceBot",
      category: "학교",
      question: "시험 범위 2배 vs 과제 양 2배",
      description: "학생이라면 누구나 고민할 질문.",
      optionA: "시험 범위 2배",
      optionB: "과제 양 2배",
    }),
    createPoll({
      authorId: "seed",
      authorName: "BalanceBot",
      category: "음식",
      question: "치킨만 먹기 vs 피자만 먹기",
      description: "가볍지만 절대 가볍지 않은 영원한 논쟁.",
      optionA: "치킨만 먹기",
      optionB: "피자만 먹기",
    }),
  ].map((poll, index) => {
    poll.createdAt = new Date(Date.now() - (index + 1) * 1000 * 60 * 23).toISOString();
    poll.updatedAt = poll.createdAt;
    return poll;
  });
}

function emptyDb() {
  return {
    users: [],
    sessions: [],
    polls: seedPolls(),
  };
}

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(emptyDb(), null, 2));
    return;
  }
  try {
    const db = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
    const nextDb = {
      users: Array.isArray(db.users) ? db.users : [],
      sessions: Array.isArray(db.sessions) ? db.sessions : [],
      polls: Array.isArray(db.polls) && db.polls.length ? db.polls : seedPolls(),
    };
    fs.writeFileSync(DB_PATH, JSON.stringify(nextDb, null, 2));
  } catch {
    fs.writeFileSync(DB_PATH, JSON.stringify(emptyDb(), null, 2));
  }
}

function readDb() {
  ensureDataFile();
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}

function writeDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
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
  return [
    `balance_session=${encodeURIComponent(rawToken)}; Path=/; HttpOnly; SameSite=Lax`,
    `balance_csrf=${encodeURIComponent(csrfToken)}; Path=/; SameSite=Lax`,
  ];
}

function clearSessionHeaders() {
  return [
    "balance_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax",
    "balance_csrf=; Path=/; Max-Age=0; SameSite=Lax",
  ];
}

function getSession(req, db) {
  const cookies = parseCookies(req);
  const rawToken = cookies.balance_session || "";
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

function totalVotes(poll) {
  return poll.options.reduce((sum, option) => sum + Number(option.votes || 0), 0);
}

function profileFromUser(user, db) {
  const createdCount = db.polls.filter((poll) => poll.authorId === user.id).length;
  const participatedCount = db.polls.filter((poll) => poll.voters.some((voter) => voter.userId === user.id)).length;
  return {
    id: user.id,
    username: user.username,
    createdAt: user.createdAt,
    stats: {
      createdCount,
      participatedCount,
    },
  };
}

function pollSummary(poll, currentUserId = null) {
  const total = totalVotes(poll);
  const vote = currentUserId ? poll.voters.find((entry) => entry.userId === currentUserId) : null;
  return {
    id: poll.id,
    question: poll.question,
    description: poll.description,
    category: poll.category,
    createdAt: poll.createdAt,
    updatedAt: poll.updatedAt,
    authorName: poll.authorName,
    totalVotes: total,
    totalComments: poll.comments.length,
    options: poll.options.map((option) => ({
      id: option.id,
      text: option.text,
      votes: option.votes,
      percent: total ? Math.round((option.votes / total) * 100) : 0,
    })),
    userVote: vote ? vote.optionId : null,
  };
}

function pollDetails(poll, currentUserId = null) {
  return {
    ...pollSummary(poll, currentUserId),
    comments: poll.comments
      .slice()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((comment) => ({
        id: comment.id,
        authorName: comment.authorName,
        text: comment.text,
        createdAt: comment.createdAt,
      })),
  };
}

function buildBootstrapPayload(db, user) {
  const currentUserId = user?.id || null;
  const latest = db.polls
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 12)
    .map((poll) => pollSummary(poll, currentUserId));
  const trending = db.polls
    .slice()
    .sort((a, b) => totalVotes(b) - totalVotes(a) || new Date(b.updatedAt) - new Date(a.updatedAt))
    .slice(0, 6)
    .map((poll) => pollSummary(poll, currentUserId));
  const creators = db.users
    .map((userItem) => ({
      username: userItem.username,
      polls: db.polls.filter((poll) => poll.authorId === userItem.id).length,
      votesReceived: db.polls
        .filter((poll) => poll.authorId === userItem.id)
        .reduce((sum, poll) => sum + totalVotes(poll), 0),
    }))
    .filter((entry) => entry.polls > 0)
    .sort((a, b) => b.votesReceived - a.votesReceived || b.polls - a.polls)
    .slice(0, 5);
  return {
    profile: user ? profileFromUser(user, db) : null,
    stats: {
      pollCount: db.polls.length,
      voteCount: db.polls.reduce((sum, poll) => sum + totalVotes(poll), 0),
      commentCount: db.polls.reduce((sum, poll) => sum + poll.comments.length, 0),
      userCount: db.users.length,
    },
    featured: trending[0] || latest[0] || null,
    latest,
    trending,
    creators,
  };
}

async function handleApi(req, res, url) {
  const db = readDb();

  if (req.method === "GET" && url.pathname === "/api/bootstrap") {
    const auth = getSession(req, db);
    sendJson(res, 200, buildBootstrapPayload(db, auth?.user || null));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/register") {
    const body = await parseBody(req);
    const username = normalizeText(body.username, 20);
    if (username.length < 2) {
      sendJson(res, 400, { error: "닉네임은 2자 이상이어야 해요." });
      return;
    }
    if (db.users.some((user) => user.username.toLowerCase() === username.toLowerCase())) {
      sendJson(res, 409, { error: "이미 사용 중인 닉네임이에요." });
      return;
    }
    const user = { id: uid("user"), username, createdAt: nowIso() };
    const createdSession = createSession(user.id);
    db.users.push(user);
    db.sessions.push(createdSession.record);
    writeDb(db);
    sendJson(
      res,
      201,
      { profile: profileFromUser(user, db), csrfToken: createdSession.record.csrfToken },
      { "Set-Cookie": sessionCookieHeaders(createdSession.rawToken, createdSession.record.csrfToken) },
    );
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    const body = await parseBody(req);
    const username = normalizeText(body.username, 20).toLowerCase();
    const user = db.users.find((entry) => entry.username.toLowerCase() === username);
    if (!user) {
      sendJson(res, 404, { error: "해당 닉네임을 찾지 못했어요." });
      return;
    }
    const createdSession = createSession(user.id);
    db.sessions.push(createdSession.record);
    writeDb(db);
    sendJson(
      res,
      200,
      { profile: profileFromUser(user, db), csrfToken: createdSession.record.csrfToken },
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
      sendJson(res, 401, { error: "로그인이 필요해요." });
      return;
    }
    sendJson(res, 200, { profile: profileFromUser(auth.user, db), csrfToken: auth.session.csrfToken });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/polls") {
    const auth = getSession(req, db);
    const sort = url.searchParams.get("sort") || "latest";
    const category = normalizeText(url.searchParams.get("category"), 20);
    let polls = db.polls.slice();
    if (category && category !== "전체") {
      polls = polls.filter((poll) => poll.category === category);
    }
    polls.sort((a, b) => {
      if (sort === "trending") {
        return totalVotes(b) - totalVotes(a) || new Date(b.updatedAt) - new Date(a.updatedAt);
      }
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
    sendJson(res, 200, {
      polls: polls.slice(0, 24).map((poll) => pollSummary(poll, auth?.user?.id || null)),
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/polls") {
    const auth = getSession(req, db);
    if (!auth || !requireCsrf(req, auth.session)) {
      sendJson(res, 401, { error: "질문 작성은 로그인 후 가능해요." });
      return;
    }
    if (db.polls.length >= MAX_POLLS) {
      sendJson(res, 400, { error: "질문 수가 너무 많아요. 잠시 후 다시 시도해주세요." });
      return;
    }
    const body = await parseBody(req);
    const question = normalizeText(body.question, 120);
    const description = normalizeText(body.description, 220);
    const optionA = normalizeText(body.optionA, 40);
    const optionB = normalizeText(body.optionB, 40);
    const category = normalizeText(body.category, 20) || "기타";
    if (question.length < 6) {
      sendJson(res, 400, { error: "질문은 조금 더 구체적으로 적어주세요." });
      return;
    }
    if (!optionA || !optionB) {
      sendJson(res, 400, { error: "선택지는 두 개 모두 입력해야 해요." });
      return;
    }
    if (optionA === optionB) {
      sendJson(res, 400, { error: "두 선택지는 서로 달라야 해요." });
      return;
    }
    const poll = createPoll({
      authorId: auth.user.id,
      authorName: auth.user.username,
      question,
      description,
      optionA,
      optionB,
      category,
    });
    db.polls.unshift(poll);
    writeDb(db);
    sendJson(res, 201, { poll: pollDetails(poll, auth.user.id) });
    return;
  }

  const pollIdMatch = url.pathname.match(/^\/api\/polls\/([^/]+)$/);
  if (req.method === "GET" && pollIdMatch) {
    const auth = getSession(req, db);
    const poll = db.polls.find((entry) => entry.id === pollIdMatch[1]);
    if (!poll) {
      sendJson(res, 404, { error: "질문을 찾지 못했어요." });
      return;
    }
    sendJson(res, 200, { poll: pollDetails(poll, auth?.user?.id || null) });
    return;
  }

  const voteMatch = url.pathname.match(/^\/api\/polls\/([^/]+)\/vote$/);
  if (req.method === "POST" && voteMatch) {
    const auth = getSession(req, db);
    if (!auth || !requireCsrf(req, auth.session)) {
      sendJson(res, 401, { error: "투표하려면 로그인해주세요." });
      return;
    }
    const poll = db.polls.find((entry) => entry.id === voteMatch[1]);
    if (!poll) {
      sendJson(res, 404, { error: "질문을 찾지 못했어요." });
      return;
    }
    if (poll.voters.some((entry) => entry.userId === auth.user.id)) {
      sendJson(res, 409, { error: "이미 투표한 질문이에요." });
      return;
    }
    const body = await parseBody(req);
    const optionId = String(body.optionId || "");
    const option = poll.options.find((entry) => entry.id === optionId);
    if (!option) {
      sendJson(res, 400, { error: "올바른 선택지가 아니에요." });
      return;
    }
    option.votes += 1;
    poll.voters.push({ userId: auth.user.id, optionId, createdAt: nowIso() });
    poll.updatedAt = nowIso();
    writeDb(db);
    sendJson(res, 200, { poll: pollDetails(poll, auth.user.id) });
    return;
  }

  const commentMatch = url.pathname.match(/^\/api\/polls\/([^/]+)\/comments$/);
  if (req.method === "POST" && commentMatch) {
    const auth = getSession(req, db);
    if (!auth || !requireCsrf(req, auth.session)) {
      sendJson(res, 401, { error: "댓글은 로그인 후 작성할 수 있어요." });
      return;
    }
    const poll = db.polls.find((entry) => entry.id === commentMatch[1]);
    if (!poll) {
      sendJson(res, 404, { error: "질문을 찾지 못했어요." });
      return;
    }
    if (poll.comments.length >= MAX_COMMENTS_PER_POLL) {
      sendJson(res, 400, { error: "댓글이 너무 많아요. 다른 질문에서 이어가볼까요?" });
      return;
    }
    const body = await parseBody(req);
    const text = normalizeText(body.text, 160);
    if (text.length < 2) {
      sendJson(res, 400, { error: "댓글은 2자 이상 입력해주세요." });
      return;
    }
    poll.comments.push({
      id: uid("comment"),
      authorId: auth.user.id,
      authorName: auth.user.username,
      text,
      createdAt: nowIso(),
    });
    poll.updatedAt = nowIso();
    writeDb(db);
    sendJson(res, 201, { poll: pollDetails(poll, auth.user.id) });
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
    const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
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
  console.log(`Balance game server running at http://localhost:${PORT}`);
});
