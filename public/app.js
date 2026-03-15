import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js";

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
  renderStage: document.querySelector("#render-stage"),
};

const state = {
  appName: "gungs",
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
  log: ["Stand by"],
  pingTick: 0,
};

const visuals = {
  renderer: null,
  scene: null,
  camera: null,
  clock: new THREE.Clock(),
  playerMeshes: new Map(),
  bulletMeshes: [],
  floor: null,
  reticle: null,
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

async function loadConfig() {
  const response = await fetch("/api/config");
  const payload = await response.json();
  state.appName = payload.appName || state.appName;
  state.adsenseClient = payload.adsenseClient || "";
  elements.heroAppName.textContent = state.appName;
  elements.appName.textContent = state.appName;
  document.title = `${state.appName} | 3D Duel Shooter`;
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
  elements.connectionStatus.textContent = state.connected ? "Online" : "Offline";
  elements.playerName.textContent = state.playerName;
  elements.roundLabel.textContent = state.room ? `Round ${state.room.round}` : "Queue";
  elements.matchMessage.textContent = state.room?.statusText || "Searching for opponent...";
  elements.winnerLabel.textContent = state.room?.winnerId
    ? `${state.players.find((player) => player.id === state.room.winnerId)?.name || "Winner"} Wins`
    : "No Winner";
  elements.pingLabel.textContent = `WS ${state.pingTick++ % 2 ? "LIVE" : "SYNC"}`;

  elements.scoreboard.innerHTML = "";
  if (!state.players.length) {
    elements.scoreboard.innerHTML = `<div class="score-card"><strong>Queue</strong><span>No duel yet</span></div>`;
    return;
  }

  state.players.forEach((player) => {
    const node = document.createElement("div");
    node.className = "score-card";
    node.innerHTML = `
      <div class="score-head">
        <strong>${player.name}</strong>
        <span style="color:${player.color}">${player.hp} HP</span>
      </div>
      <div class="score-foot">
        <span>${player.score} / ${state.arena.targetScore}</span>
        <span>K ${player.kills} | D ${player.deaths}</span>
      </div>
    `;
    elements.scoreboard.appendChild(node);
  });
}

function setArenaOverlay(text, visible = true) {
  elements.arenaOverlay.textContent = text;
  elements.arenaOverlay.classList.toggle("hidden", !visible);
}

function createRenderer() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  elements.renderStage.appendChild(renderer.domElement);
  visuals.renderer = renderer;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050916);
  scene.fog = new THREE.Fog(0x050916, 24, 60);
  visuals.scene = scene;

  const camera = new THREE.PerspectiveCamera(48, 16 / 9, 0.1, 120);
  camera.position.set(0, 18, 18);
  visuals.camera = camera;

  const hemi = new THREE.HemisphereLight(0x7ec8ff, 0x050916, 1.1);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xffffff, 1.7);
  key.position.set(6, 14, 7);
  key.castShadow = true;
  key.shadow.mapSize.width = 2048;
  key.shadow.mapSize.height = 2048;
  key.shadow.camera.left = -20;
  key.shadow.camera.right = 20;
  key.shadow.camera.top = 20;
  key.shadow.camera.bottom = -20;
  scene.add(key);

  const rimLeft = new THREE.PointLight(0xff4f7d, 22, 28, 2);
  rimLeft.position.set(-10, 2.5, 0);
  scene.add(rimLeft);

  const rimRight = new THREE.PointLight(0x44d9ff, 22, 28, 2);
  rimRight.position.set(10, 2.5, 0);
  scene.add(rimRight);

  buildArena(scene);
  resizeRenderer();
}

function buildArena(scene) {
  const arenaWidth = state.arena.width / 80;
  const arenaDepth = state.arena.height / 80;

  const floorGeometry = new THREE.PlaneGeometry(arenaWidth, arenaDepth, 24, 24);
  const floorMaterial = new THREE.MeshStandardMaterial({
    color: 0x101a32,
    emissive: 0x07101f,
    metalness: 0.55,
    roughness: 0.35,
  });
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  visuals.floor = floor;

  const grid = new THREE.GridHelper(arenaWidth, 20, 0x2dcfff, 0x133159);
  grid.position.y = 0.02;
  scene.add(grid);

  const wallMaterial = new THREE.MeshStandardMaterial({
    color: 0x162440,
    emissive: 0x091526,
    metalness: 0.65,
    roughness: 0.25,
  });
  const glowMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xffc461,
    emissiveIntensity: 1.8,
    toneMapped: false,
  });

  const wallThickness = 0.6;
  const wallHeight = 2.8;
  const horizontalWallGeometry = new THREE.BoxGeometry(arenaWidth + 1, wallHeight, wallThickness);
  const verticalWallGeometry = new THREE.BoxGeometry(wallThickness, wallHeight, arenaDepth + 1);
  const walls = [
    { geometry: horizontalWallGeometry, position: [0, wallHeight / 2, arenaDepth / 2 + 0.2] },
    { geometry: horizontalWallGeometry, position: [0, wallHeight / 2, -arenaDepth / 2 - 0.2] },
    { geometry: verticalWallGeometry, position: [arenaWidth / 2 + 0.2, wallHeight / 2, 0] },
    { geometry: verticalWallGeometry, position: [-arenaWidth / 2 - 0.2, wallHeight / 2, 0] },
  ];

  walls.forEach((wall) => {
    const mesh = new THREE.Mesh(wall.geometry, wallMaterial);
    mesh.position.set(...wall.position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  });

  const pillarGeometry = new THREE.CylinderGeometry(0.35, 0.35, 3.6, 20);
  const pillarGlowGeometry = new THREE.CylinderGeometry(0.12, 0.12, 3.7, 12);
  const pillarPositions = [
    [-5.5, 1.8, -2.6],
    [-5.5, 1.8, 2.6],
    [5.5, 1.8, -2.6],
    [5.5, 1.8, 2.6],
    [0, 1.8, -4.2],
    [0, 1.8, 4.2],
  ];

  pillarPositions.forEach((position, index) => {
    const pillar = new THREE.Mesh(pillarGeometry, wallMaterial);
    pillar.position.set(position[0], position[1], position[2]);
    pillar.castShadow = true;
    scene.add(pillar);

    const glow = new THREE.Mesh(
      pillarGlowGeometry,
      glowMaterial.clone(),
    );
    glow.material.emissive = new THREE.Color(index % 2 === 0 ? 0xff5a7a : 0x59d8ff);
    glow.material.color = new THREE.Color(index % 2 === 0 ? 0xff95aa : 0x9feeff);
    glow.position.copy(pillar.position);
    scene.add(glow);
  });

  const reticle = new THREE.Mesh(
    new THREE.TorusGeometry(0.35, 0.03, 10, 32),
    new THREE.MeshBasicMaterial({ color: 0xffcb61 }),
  );
  reticle.rotation.x = Math.PI / 2;
  reticle.position.set(0, 0.08, 0);
  scene.add(reticle);
  visuals.reticle = reticle;
}

function resizeRenderer() {
  if (!visuals.renderer) {
    return;
  }
  const width = elements.renderStage.clientWidth;
  const height = elements.renderStage.clientHeight;
  visuals.renderer.setSize(width, height, false);
  visuals.camera.aspect = width / height;
  visuals.camera.updateProjectionMatrix();
}

function createPlayerMesh(color) {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.32, 0.65, 8, 16),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      emissive: new THREE.Color(color),
      emissiveIntensity: 0.3,
      metalness: 0.5,
      roughness: 0.24,
    }),
  );
  body.position.y = 0.75;
  body.castShadow = true;
  group.add(body);

  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.38, 0.16, 0.24),
    new THREE.MeshStandardMaterial({
      color: 0xdff7ff,
      emissive: 0x7fe6ff,
      emissiveIntensity: 1.8,
      toneMapped: false,
    }),
  );
  visor.position.set(0, 0.92, 0.24);
  group.add(visor);

  const gun = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.14, 0.9),
    new THREE.MeshStandardMaterial({ color: 0x2d3958, metalness: 0.55, roughness: 0.2 }),
  );
  gun.position.set(0, 0.72, 0.55);
  gun.castShadow = true;
  group.add(gun);

  const glowRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.48, 0.04, 12, 32),
    new THREE.MeshBasicMaterial({ color }),
  );
  glowRing.rotation.x = Math.PI / 2;
  glowRing.position.y = 0.1;
  group.add(glowRing);

  return group;
}

function ensurePlayerMeshes() {
  const activeIds = new Set(state.players.map((player) => player.id));
  visuals.playerMeshes.forEach((mesh, id) => {
    if (!activeIds.has(id)) {
      visuals.scene.remove(mesh);
      visuals.playerMeshes.delete(id);
    }
  });

  state.players.forEach((player) => {
    if (!visuals.playerMeshes.has(player.id)) {
      const mesh = createPlayerMesh(player.color);
      visuals.playerMeshes.set(player.id, mesh);
      visuals.scene.add(mesh);
    }
  });
}

function syncPlayersToScene(delta) {
  ensurePlayerMeshes();
  state.players.forEach((player) => {
    const mesh = visuals.playerMeshes.get(player.id);
    if (!mesh) {
      return;
    }

    const targetX = (player.x - state.arena.width / 2) / 80;
    const targetZ = (player.y - state.arena.height / 2) / 80;
    mesh.position.lerp(new THREE.Vector3(targetX, 0, targetZ), Math.min(1, delta * 10));

    const angle = Math.atan2(player.aimY - player.y, player.aimX - player.x);
    const targetRotation = -angle + Math.PI / 2;
    mesh.rotation.y = THREE.MathUtils.lerp(mesh.rotation.y, targetRotation, Math.min(1, delta * 12));

    mesh.children[0].material.emissiveIntensity = player.id === state.playerId ? 0.52 : 0.3;
    mesh.visible = player.alive;
  });
}

function syncBulletsToScene() {
  while (visuals.bulletMeshes.length < state.bullets.length) {
    const bullet = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xfff199 }),
    );
    visuals.bulletMeshes.push(bullet);
    visuals.scene.add(bullet);
  }

  visuals.bulletMeshes.forEach((mesh, index) => {
    const bulletState = state.bullets[index];
    if (!bulletState) {
      mesh.visible = false;
      return;
    }
    const owner = state.players.find((player) => player.id === bulletState.ownerId);
    mesh.visible = true;
    mesh.material.color.set(owner?.color || "#fff199");
    mesh.position.set(
      (bulletState.x - state.arena.width / 2) / 80,
      0.55,
      (bulletState.y - state.arena.height / 2) / 80,
    );
  });
}

function updateCamera(delta) {
  const self = state.players.find((player) => player.id === state.playerId) || state.players[0];
  if (!self) {
    return;
  }

  const target = new THREE.Vector3(
    (self.x - state.arena.width / 2) / 80,
    0,
    (self.y - state.arena.height / 2) / 80,
  );
  const camTarget = new THREE.Vector3(target.x, 12.5, target.z + 9.5);
  visuals.camera.position.lerp(camTarget, Math.min(1, delta * 4));
  visuals.camera.lookAt(target.x, 0.8, target.z - 1.5);

  visuals.reticle.position.set(
    (state.mouse.x - state.arena.width / 2) / 80,
    0.06,
    (state.mouse.y - state.arena.height / 2) / 80,
  );
}

function connect() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
  state.socket = socket;

  socket.addEventListener("open", () => {
    state.connected = true;
    updateHud();
    elements.pingLabel.textContent = "WS LIVE";
    addLog("Socket connected");
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
      setArenaOverlay(payload.message || "Searching for opponent...", true);
      state.room = null;
      state.players = [];
      state.bullets = [];
      updateHud();
      addLog(payload.message || "Queueing");
      return;
    }

    if (payload.type === "state") {
      const previousWinner = state.room?.winnerId;
      state.playerId = payload.selfId;
      state.room = payload.room;
      state.players = payload.players;
      state.bullets = payload.bullets;
      state.arena = payload.arena;
      updateHud();

      if (payload.room.status === "live") {
        setArenaOverlay("", false);
      } else if (payload.room.status === "countdown") {
        setArenaOverlay(payload.room.statusText || "Next round loading", true);
      } else if (payload.room.status === "finished") {
        setArenaOverlay(payload.room.statusText || "Match finished", true);
      }

      if (previousWinner !== payload.room.winnerId && payload.room.winnerId) {
        const winner = payload.players.find((player) => player.id === payload.room.winnerId);
        addLog(`${winner?.name || "Winner"} won the match`);
      }
      return;
    }

    if (payload.type === "error") {
      addLog(payload.message || "Socket error");
    }
  });

  socket.addEventListener("close", () => {
    state.connected = false;
    updateHud();
    setArenaOverlay("Connection lost. Refresh to reconnect.", true);
    addLog("Socket closed");
  });
}

function joinMatch() {
  const nickname = elements.nicknameInput.value.trim();
  if (nickname.length < 2) {
    setEntryStatus("Name must be at least 2 characters.", true);
    return;
  }
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
    setEntryStatus("Still connecting. Try again in a second.", true);
    return;
  }

  state.playerName = nickname;
  state.socket.send(JSON.stringify({ type: "join", name: nickname }));
  state.joined = true;
  elements.entryOverlay.classList.remove("visible");
  setArenaOverlay("Searching for opponent...", true);
  updateHud();
  addLog(`${nickname} entered matchmaking`);
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

function pointerToWorld(event) {
  const rect = elements.renderStage.getBoundingClientRect();
  const nx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  const ny = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
  const mouse = new THREE.Vector2(nx, ny);
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, visuals.camera);
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const intersection = new THREE.Vector3();
  raycaster.ray.intersectPlane(plane, intersection);
  state.mouse.x = intersection.x * 80 + state.arena.width / 2;
  state.mouse.y = intersection.z * 80 + state.arena.height / 2;
}

function renderFrame() {
  const delta = visuals.clock.getDelta();
  syncPlayersToScene(delta);
  syncBulletsToScene();
  updateCamera(delta);
  visuals.renderer.render(visuals.scene, visuals.camera);
  requestAnimationFrame(renderFrame);
}

function registerEvents() {
  window.addEventListener("resize", resizeRenderer);
  window.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if (key === "w") state.keys.up = true;
    if (key === "s") state.keys.down = true;
    if (key === "a") state.keys.left = true;
    if (key === "d") state.keys.right = true;
  });
  window.addEventListener("keyup", (event) => {
    const key = event.key.toLowerCase();
    if (key === "w") state.keys.up = false;
    if (key === "s") state.keys.down = false;
    if (key === "a") state.keys.left = false;
    if (key === "d") state.keys.right = false;
  });
  elements.renderStage.addEventListener("mousemove", pointerToWorld);
  elements.renderStage.addEventListener("mousedown", () => {
    state.mouse.down = true;
  });
  window.addEventListener("mouseup", () => {
    state.mouse.down = false;
  });
  elements.playButton.addEventListener("click", joinMatch);
}

setInterval(sendInput, 1000 / 30);

(async function init() {
  renderLog();
  createRenderer();
  registerEvents();
  await loadConfig();
  connect();
  updateHud();
  renderFrame();
})();
