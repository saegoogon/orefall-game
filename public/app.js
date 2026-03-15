const canvas = document.querySelector("#game-canvas");
const ctx = canvas.getContext("2d");

const elements = {
  entryOverlay: document.querySelector("#entry-overlay"),
  heroAppName: document.querySelector("#hero-app-name"),
  nicknameInput: document.querySelector("#nickname-input"),
  playButton: document.querySelector("#play-button"),
  entryStatus: document.querySelector("#entry-status"),
  appName: document.querySelector("#app-name"),
  connectionStatus: document.querySelector("#connection-status"),
  playerName: document.querySelector("#player-name"),
  roundLabel: document.querySelector("#round-label"),
  matchMessage: document.querySelector("#match-message"),
  scoreboard: document.querySelector("#scoreboard"),
  pingLabel: document.querySelector("#ping-label"),
  winnerLabel: document.querySelector("#winner-label"),
  arenaOverlay: document.querySelector("#arena-overlay"),
  eventLog: document.querySelector("#event-log"),
};

const state = {
  appName: "gung",
  adsenseClient: "",
  socket: null,
  connected: false,
  joined: false,
  playerId: null,
  playerName: "Guest",
  room: null,
  players: [],
  bullets: [],
  arena: { width: 1600, height: 900, targetScore: 5 },
  mouse: { x: 800, y: 450, down: false },
  keys: { up: false, down: false, left: false, right: false },
  log: ["매칭 시작 전"],
};

function addLog(message) {
  state.log.unshift(message);
  state.log = state.log.slice(0, 8);
  renderLog();
}

function renderLog() {
  elements.eventLog.innerHTML = "";
  state.log.forEach((item) => {
    const node = document.createElement("div");
    node.className = "log-item";
    node.textContent = item;
    elements.eventLog.appendChild(node);
  });
}

function setEntryStatus(message, isError = false) {
  elements.entryStatus.textContent = message;
  elements.entryStatus.style.color = isError ? "#ff8f8f" : "";
}

function resizeCanvas() {
  const ratio = canvas.width / canvas.height;
  const wrap = canvas.parentElement;
  const maxWidth = wrap.clientWidth;
  const width = maxWidth;
  const height = width / ratio;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
}

function worldFromMouse(event) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = state.arena.width / rect.width;
  const scaleY = state.arena.height / rect.height;
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}

async function loadConfig() {
  const response = await fetch("/api/config");
  const payload = await response.json();
  state.appName = payload.appName || state.appName;
  state.adsenseClient = payload.adsenseClient || "";
  elements.heroAppName.textContent = state.appName;
  elements.appName.textContent = state.appName;
  document.title = `${state.appName} | 1v1 온라인 슈터`;
  mountAds();
}

function mountAds() {
  if (!state.adsenseClient) {
    return;
  }
  if (!document.querySelector("script[data-adsense='true']")) {
    const script = document.createElement("script");
    script.async = true;
    script.dataset.adsense = "true";
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(state.adsenseClient)}`;
    script.crossOrigin = "anonymous";
    document.head.appendChild(script);
  }
  document.querySelectorAll(".ad-slot").forEach((slot) => {
    if (slot.dataset.loaded === "true") {
      return;
    }
    slot.innerHTML = `
      <ins class="adsbygoogle"
        style="display:block"
        data-ad-client="${state.adsenseClient}"
        data-ad-slot="${slot.dataset.adSlot}"
        data-ad-format="auto"
        data-full-width-responsive="true"></ins>
    `;
    slot.dataset.loaded = "true";
    try {
      window.adsbygoogle = window.adsbygoogle || [];
      window.adsbygoogle.push({});
    } catch {}
  });
}

function updateHud() {
  elements.connectionStatus.textContent = state.connected ? "온라인" : "오프라인";
  elements.playerName.textContent = state.playerName;
  elements.roundLabel.textContent = state.room ? `Round ${state.room.round}` : "대기 중";
  elements.matchMessage.textContent = state.room?.statusText || "상대를 찾는 중";
  elements.winnerLabel.textContent = state.room?.winnerId
    ? `${state.players.find((player) => player.id === state.room.winnerId)?.name || "Winner"} WIN`
    : "NO WINNER";

  elements.scoreboard.innerHTML = "";
  if (!state.players.length) {
    elements.scoreboard.innerHTML = `<div class="score-card"><strong>대기 중</strong><span>상대를 찾고 있어요</span></div>`;
  } else {
    state.players.forEach((player) => {
      const node = document.createElement("div");
      node.className = "score-card";
      node.innerHTML = `
        <div class="score-top">
          <strong>${player.name}</strong>
          <span style="color:${player.color}">${player.hp} HP</span>
        </div>
        <div class="score-bottom">
          <span>${player.score} / ${state.arena.targetScore}</span>
          <span>K ${player.kills} · D ${player.deaths}</span>
        </div>
      `;
      elements.scoreboard.appendChild(node);
    });
  }
}

function setArenaOverlay(text, visible = true) {
  elements.arenaOverlay.textContent = text;
  elements.arenaOverlay.classList.toggle("hidden", !visible);
}

function connect() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
  state.socket = socket;

  socket.addEventListener("open", () => {
    state.connected = true;
    updateHud();
    elements.pingLabel.textContent = "WS READY";
  });

  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === "welcome") {
      state.playerId = payload.id;
      state.appName = payload.appName || state.appName;
      state.adsenseClient = payload.adsenseClient || state.adsenseClient;
      elements.appName.textContent = state.appName;
      elements.heroAppName.textContent = state.appName;
      mountAds();
      return;
    }

    if (payload.type === "queue") {
      setArenaOverlay(payload.message || "상대를 찾는 중...", true);
      state.room = null;
      state.players = [];
      state.bullets = [];
      updateHud();
      addLog(payload.message || "매칭 중");
      return;
    }

    if (payload.type === "state") {
      state.playerId = payload.selfId;
      state.room = payload.room;
      state.players = payload.players;
      state.bullets = payload.bullets;
      state.arena = payload.arena;
      updateHud();

      if (payload.room.status === "live") {
        setArenaOverlay("", false);
      } else if (payload.room.status === "countdown") {
        setArenaOverlay(payload.room.statusText || "다음 라운드 준비 중", true);
      } else if (payload.room.status === "finished") {
        setArenaOverlay(payload.room.statusText || "매치 종료", true);
      }
      return;
    }

    if (payload.type === "error") {
      addLog(payload.message);
    }
  });

  socket.addEventListener("close", () => {
    state.connected = false;
    updateHud();
    setArenaOverlay("연결이 끊겼습니다. 새로고침 후 다시 시도하세요.", true);
    addLog("서버 연결 종료");
  });
}

function joinMatch() {
  const nickname = elements.nicknameInput.value.trim();
  if (nickname.length < 2) {
    setEntryStatus("닉네임은 2글자 이상이어야 해요.", true);
    return;
  }
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
    setEntryStatus("연결 중입니다. 잠시만 기다려주세요.", true);
    return;
  }
  state.playerName = nickname;
  state.socket.send(JSON.stringify({ type: "join", name: nickname }));
  state.joined = true;
  elements.entryOverlay.classList.remove("visible");
  setArenaOverlay("상대를 찾는 중...", true);
  updateHud();
  addLog(`${nickname} 입장`);
}

function sendInput() {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN || !state.joined) {
    return;
  }
  state.socket.send(JSON.stringify({
    type: "input",
    input: {
      up: state.keys.up,
      down: state.keys.down,
      left: state.keys.left,
      right: state.keys.right,
      shoot: state.mouse.down,
    },
    aim: {
      x: state.mouse.x,
      y: state.mouse.y,
    },
  }));
}

function drawArena() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#0a1022";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "rgba(120,180,255,0.08)";
  for (let x = 0; x < state.arena.width; x += 80) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, state.arena.height);
    ctx.stroke();
  }
  for (let y = 0; y < state.arena.height; y += 80) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(state.arena.width, y);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 6;
  ctx.strokeRect(8, 8, state.arena.width - 16, state.arena.height - 16);

  state.bullets.forEach((bullet) => {
    const owner = state.players.find((player) => player.id === bullet.ownerId);
    ctx.fillStyle = owner?.color || "#ffffff";
    ctx.beginPath();
    ctx.arc(bullet.x, bullet.y, 7, 0, Math.PI * 2);
    ctx.fill();
  });

  state.players.forEach((player) => {
    const isSelf = player.id === state.playerId;
    const angle = Math.atan2(player.aimY - player.y, player.aimX - player.x);

    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(angle);
    ctx.fillStyle = player.color;
    ctx.fillRect(8, -6, 28, 12);
    ctx.restore();

    ctx.fillStyle = player.color;
    ctx.beginPath();
    ctx.arc(player.x, player.y, 26, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = isSelf ? "#ffffff" : "rgba(255,255,255,0.3)";
    ctx.lineWidth = isSelf ? 4 : 2;
    ctx.beginPath();
    ctx.arc(player.x, player.y, 30, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 18px Trebuchet MS";
    ctx.textAlign = "center";
    ctx.fillText(player.name, player.x, player.y - 38);

    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.fillRect(player.x - 34, player.y + 34, 68, 8);
    ctx.fillStyle = player.color;
    ctx.fillRect(player.x - 34, player.y + 34, 68 * (player.hp / 100), 8);
  });
}

function animationLoop() {
  drawArena();
  requestAnimationFrame(animationLoop);
}

window.addEventListener("resize", resizeCanvas);
window.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() === "w") state.keys.up = true;
  if (event.key.toLowerCase() === "s") state.keys.down = true;
  if (event.key.toLowerCase() === "a") state.keys.left = true;
  if (event.key.toLowerCase() === "d") state.keys.right = true;
});
window.addEventListener("keyup", (event) => {
  if (event.key.toLowerCase() === "w") state.keys.up = false;
  if (event.key.toLowerCase() === "s") state.keys.down = false;
  if (event.key.toLowerCase() === "a") state.keys.left = false;
  if (event.key.toLowerCase() === "d") state.keys.right = false;
});
canvas.addEventListener("mousemove", (event) => {
  const point = worldFromMouse(event);
  state.mouse.x = point.x;
  state.mouse.y = point.y;
});
canvas.addEventListener("mousedown", () => {
  state.mouse.down = true;
});
window.addEventListener("mouseup", () => {
  state.mouse.down = false;
});

elements.playButton.addEventListener("click", joinMatch);
elements.refreshButton?.addEventListener("click", () => window.location.reload());

setInterval(sendInput, 1000 / 30);

(async function init() {
  resizeCanvas();
  renderLog();
  await loadConfig();
  connect();
  updateHud();
  animationLoop();
})();
