const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { URL } = require("node:url");

const PORT = Number(process.env.PORT || 3000);
const APP_NAME = process.env.APP_NAME || "Neon Duel Arena";
const ADSENSE_CLIENT = process.env.ADSENSE_CLIENT || "";

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const ARENA = {
  width: 1600,
  height: 900,
  playerRadius: 26,
  bulletRadius: 7,
  playerSpeed: 380,
  bulletSpeed: 980,
  fireCooldownMs: 180,
  damagePerShot: 34,
  roundResetMs: 1600,
  matchResetMs: 4200,
  targetScore: 5,
};

const clients = new Map();
const rooms = new Map();
let waitingPlayerId = null;

function uid(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function securityHeaders() {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self' https://pagead2.googlesyndication.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https://pagead2.googlesyndication.com https://googleads.g.doubleclick.net",
      "connect-src 'self' ws: wss: https://pagead2.googlesyndication.com https://googleads.g.doubleclick.net",
      "frame-src https://googleads.g.doubleclick.net https://tpc.googlesyndication.com",
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

function createPlayer(socket) {
  const id = uid("player");
  const player = {
    id,
    socket,
    name: `Player-${id.slice(-4)}`,
    roomId: null,
    color: "#ff5a7a",
    x: 0,
    y: 0,
    aimX: 0,
    aimY: 0,
    hp: 100,
    alive: false,
    input: { up: false, down: false, left: false, right: false, shoot: false },
    lastShotAt: 0,
    score: 0,
    kills: 0,
    deaths: 0,
  };
  clients.set(id, player);
  return player;
}

function createRoom(firstPlayer, secondPlayer) {
  const room = {
    id: uid("room"),
    players: [firstPlayer.id, secondPlayer.id],
    bullets: [],
    status: "countdown",
    round: 1,
    winnerId: null,
    statusText: "Round start",
    resetAt: Date.now() + 1200,
  };
  firstPlayer.roomId = room.id;
  secondPlayer.roomId = room.id;
  firstPlayer.color = "#ff6b81";
  secondPlayer.color = "#59d8ff";
  rooms.set(room.id, room);
  respawnPlayers(room);
  room.status = "live";
  room.statusText = "Fight";
  broadcastRoomState(room);
  return room;
}

function playerSpawn(index) {
  return index === 0
    ? { x: 220, y: ARENA.height / 2 }
    : { x: ARENA.width - 220, y: ARENA.height / 2 };
}

function respawnPlayers(room) {
  room.players.forEach((playerId, index) => {
    const player = clients.get(playerId);
    if (!player) {
      return;
    }
    const spawn = playerSpawn(index);
    player.x = spawn.x;
    player.y = spawn.y;
    player.aimX = index === 0 ? ARENA.width : 0;
    player.aimY = ARENA.height / 2;
    player.hp = 100;
    player.alive = true;
    player.input.shoot = false;
  });
}

function broadcast(playerIds, message) {
  playerIds.forEach((playerId) => {
    const player = clients.get(playerId);
    if (player) {
      sendWs(player.socket, message);
    }
  });
}

function roomStateFor(room, selfId) {
  return {
    type: "state",
    appName: APP_NAME,
    selfId,
    arena: {
      width: ARENA.width,
      height: ARENA.height,
      targetScore: ARENA.targetScore,
    },
    room: {
      id: room.id,
      round: room.round,
      status: room.status,
      statusText: room.statusText,
      winnerId: room.winnerId,
      resetAt: room.resetAt,
    },
    players: room.players
      .map((playerId) => clients.get(playerId))
      .filter(Boolean)
      .map((player) => ({
        id: player.id,
        name: player.name,
        color: player.color,
        x: player.x,
        y: player.y,
        hp: player.hp,
        alive: player.alive,
        score: player.score,
        kills: player.kills,
        deaths: player.deaths,
        aimX: player.aimX,
        aimY: player.aimY,
      })),
    bullets: room.bullets.map((bullet) => ({
      x: bullet.x,
      y: bullet.y,
      ownerId: bullet.ownerId,
    })),
  };
}

function broadcastRoomState(room) {
  room.players.forEach((playerId) => {
    const player = clients.get(playerId);
    if (player) {
      sendWs(player.socket, roomStateFor(room, playerId));
    }
  });
}

function sendQueueState(player) {
  sendWs(player.socket, {
    type: "queue",
    appName: APP_NAME,
    adsenseClient: ADSENSE_CLIENT,
    waiting: true,
    message: "상대를 찾는 중입니다...",
  });
}

function queueOrMatch(player) {
  if (waitingPlayerId && waitingPlayerId !== player.id) {
    const opponent = clients.get(waitingPlayerId);
    waitingPlayerId = null;
    if (opponent && !opponent.roomId) {
      createRoom(opponent, player);
      return;
    }
  }
  waitingPlayerId = player.id;
  sendQueueState(player);
}

function removeRoom(roomId) {
  rooms.delete(roomId);
}

function cleanupPlayer(player) {
  if (waitingPlayerId === player.id) {
    waitingPlayerId = null;
  }

  if (player.roomId) {
    const room = rooms.get(player.roomId);
    if (room) {
      const otherId = room.players.find((id) => id !== player.id);
      const other = clients.get(otherId);
      if (other) {
        other.roomId = null;
        sendWs(other.socket, {
          type: "queue",
          appName: APP_NAME,
          waiting: true,
          message: "상대가 나갔습니다. 새 상대를 찾는 중...",
        });
        queueOrMatch(other);
      }
      removeRoom(room.id);
    }
  }

  clients.delete(player.id);
}

function parseFrame(buffer) {
  if (buffer.length < 2) {
    return null;
  }
  const byte1 = buffer[0];
  const byte2 = buffer[1];
  const opcode = byte1 & 0x0f;
  const masked = (byte2 & 0x80) === 0x80;
  let offset = 2;
  let payloadLength = byte2 & 0x7f;

  if (payloadLength === 126) {
    if (buffer.length < offset + 2) {
      return null;
    }
    payloadLength = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (payloadLength === 127) {
    if (buffer.length < offset + 8) {
      return null;
    }
    payloadLength = Number(buffer.readBigUInt64BE(offset));
    offset += 8;
  }

  const maskLength = masked ? 4 : 0;
  if (buffer.length < offset + maskLength + payloadLength) {
    return null;
  }

  let payload = buffer.slice(offset + maskLength, offset + maskLength + payloadLength);
  if (masked) {
    const mask = buffer.slice(offset, offset + 4);
    const unmasked = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i += 1) {
      unmasked[i] = payload[i] ^ mask[i % 4];
    }
    payload = unmasked;
  }

  return {
    opcode,
    payload,
    consumed: offset + maskLength + payloadLength,
  };
}

function sendRawFrame(socket, opcode, payloadBuffer) {
  const payloadLength = payloadBuffer.length;
  let header;
  if (payloadLength < 126) {
    header = Buffer.alloc(2);
    header[1] = payloadLength;
  } else if (payloadLength < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(payloadLength, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payloadLength), 2);
  }
  header[0] = 0x80 | opcode;
  socket.write(Buffer.concat([header, payloadBuffer]));
}

function sendWs(socket, message) {
  if (socket.destroyed) {
    return;
  }
  const payload = Buffer.from(JSON.stringify(message));
  sendRawFrame(socket, 0x1, payload);
}

function closeWs(socket) {
  if (!socket.destroyed) {
    sendRawFrame(socket, 0x8, Buffer.alloc(0));
    socket.end();
  }
}

function handleClientMessage(player, data) {
  const message = JSON.parse(data.toString("utf8"));
  if (message.type === "join") {
    player.name = normalizeText(message.name, 20) || player.name;
    sendWs(player.socket, {
      type: "welcome",
      id: player.id,
      appName: APP_NAME,
      adsenseClient: ADSENSE_CLIENT,
    });
    queueOrMatch(player);
    return;
  }

  if (message.type === "input") {
    player.input = {
      up: Boolean(message.input?.up),
      down: Boolean(message.input?.down),
      left: Boolean(message.input?.left),
      right: Boolean(message.input?.right),
      shoot: Boolean(message.input?.shoot),
    };
    player.aimX = Number.isFinite(message.aim?.x) ? message.aim.x : player.aimX;
    player.aimY = Number.isFinite(message.aim?.y) ? message.aim.y : player.aimY;
  }
}

function distance(aX, aY, bX, bY) {
  const dx = aX - bX;
  const dy = aY - bY;
  return Math.sqrt(dx * dx + dy * dy);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function startNextRound(room, reason) {
  room.bullets = [];
  room.round += 1;
  room.status = "countdown";
  room.statusText = reason;
  room.resetAt = Date.now() + ARENA.roundResetMs;
}

function finishMatch(room, winnerId) {
  room.bullets = [];
  room.status = "finished";
  room.winnerId = winnerId;
  room.statusText = `${clients.get(winnerId)?.name || "Winner"} wins the match`;
  room.resetAt = Date.now() + ARENA.matchResetMs;
}

function updateRoom(room, deltaSeconds, now) {
  if (room.status === "finished" && now >= room.resetAt) {
    room.players.forEach((playerId) => {
      const player = clients.get(playerId);
      if (player) {
        player.score = 0;
        player.kills = 0;
        player.deaths = 0;
      }
    });
    room.round = 1;
    room.winnerId = null;
    room.status = "live";
    room.statusText = "Rematch";
    respawnPlayers(room);
  }

  if (room.status === "countdown" && now >= room.resetAt) {
    room.status = "live";
    room.statusText = "Fight";
    respawnPlayers(room);
  }

  if (room.status !== "live") {
    return;
  }

  const roomPlayers = room.players.map((id) => clients.get(id)).filter(Boolean);
  roomPlayers.forEach((player) => {
    if (!player.alive) {
      return;
    }

    let moveX = 0;
    let moveY = 0;
    if (player.input.left) moveX -= 1;
    if (player.input.right) moveX += 1;
    if (player.input.up) moveY -= 1;
    if (player.input.down) moveY += 1;

    if (moveX !== 0 || moveY !== 0) {
      const length = Math.sqrt(moveX * moveX + moveY * moveY);
      moveX /= length;
      moveY /= length;
      player.x = clamp(player.x + moveX * ARENA.playerSpeed * deltaSeconds, ARENA.playerRadius, ARENA.width - ARENA.playerRadius);
      player.y = clamp(player.y + moveY * ARENA.playerSpeed * deltaSeconds, ARENA.playerRadius, ARENA.height - ARENA.playerRadius);
    }

    if (player.input.shoot && now - player.lastShotAt >= ARENA.fireCooldownMs) {
      const aimDx = player.aimX - player.x;
      const aimDy = player.aimY - player.y;
      const len = Math.sqrt(aimDx * aimDx + aimDy * aimDy) || 1;
      const dirX = aimDx / len;
      const dirY = aimDy / len;
      room.bullets.push({
        id: uid("bullet"),
        ownerId: player.id,
        x: player.x + dirX * (ARENA.playerRadius + 8),
        y: player.y + dirY * (ARENA.playerRadius + 8),
        vx: dirX * ARENA.bulletSpeed,
        vy: dirY * ARENA.bulletSpeed,
      });
      player.lastShotAt = now;
    }
  });

  room.bullets = room.bullets.filter((bullet) => {
    bullet.x += bullet.vx * deltaSeconds;
    bullet.y += bullet.vy * deltaSeconds;

    if (bullet.x < -20 || bullet.x > ARENA.width + 20 || bullet.y < -20 || bullet.y > ARENA.height + 20) {
      return false;
    }

    const target = roomPlayers.find((player) => player.id !== bullet.ownerId && player.alive);
    if (!target) {
      return true;
    }

    if (distance(bullet.x, bullet.y, target.x, target.y) <= ARENA.playerRadius + ARENA.bulletRadius) {
      const attacker = clients.get(bullet.ownerId);
      target.hp -= ARENA.damagePerShot;
      if (target.hp <= 0) {
        target.hp = 0;
        target.alive = false;
        target.deaths += 1;
        if (attacker) {
          attacker.kills += 1;
          attacker.score += 1;
          if (attacker.score >= ARENA.targetScore) {
            finishMatch(room, attacker.id);
          } else {
            startNextRound(room, `${attacker.name} scored`);
          }
        }
      }
      return false;
    }

    return true;
  });
}

let lastTickAt = Date.now();
setInterval(() => {
  const now = Date.now();
  const deltaSeconds = Math.min(0.05, (now - lastTickAt) / 1000);
  lastTickAt = now;
  rooms.forEach((room) => {
    updateRoom(room, deltaSeconds, now);
    broadcastRoomState(room);
  });
}, 1000 / 30);

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "GET" && url.pathname === "/healthz") {
      sendJson(res, 200, { ok: true, app: APP_NAME });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/config") {
      sendJson(res, 200, { appName: APP_NAME, adsenseClient: ADSENSE_CLIENT });
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

server.on("upgrade", (req, socket) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }

  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }

  const acceptKey = crypto
    .createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");

  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${acceptKey}`,
      "",
      "",
    ].join("\r\n"),
  );

  const player = createPlayer(socket);
  let buffer = Buffer.alloc(0);

  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const frame = parseFrame(buffer);
      if (!frame) {
        break;
      }
      buffer = buffer.slice(frame.consumed);

      if (frame.opcode === 0x8) {
        closeWs(socket);
        return;
      }
      if (frame.opcode === 0x9) {
        sendRawFrame(socket, 0xA, frame.payload);
        continue;
      }
      if (frame.opcode === 0x1) {
        try {
          handleClientMessage(player, frame.payload);
        } catch {
          sendWs(socket, { type: "error", message: "잘못된 메시지입니다." });
        }
      }
    }
  });

  socket.on("close", () => cleanupPlayer(player));
  socket.on("end", () => cleanupPlayer(player));
  socket.on("error", () => cleanupPlayer(player));
});

server.listen(PORT, () => {
  console.log(`${APP_NAME} running at http://localhost:${PORT}`);
});
