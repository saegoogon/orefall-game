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
  ammoLabel: document.querySelector("#ammo-label"),
  dashLabel: document.querySelector("#dash-label"),
  arenaOverlay: document.querySelector("#arena-overlay"),
  damageFlash: document.querySelector("#damage-flash"),
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
  arena: { width: 1600, height: 900, targetScore: 5, obstacles: [] },
  mouse: { x: 800, y: 450, down: false },
  keys: { up: false, down: false, left: false, right: false },
  actions: { reload: false, dash: false },
  log: ["Stand by"],
  pingTick: 0,
  damageFlash: 0,
};

const visuals = {
  renderer: null,
  scene: null,
  camera: null,
  clock: new THREE.Clock(),
  playerMeshes: new Map(),
  bulletMeshes: [],
  impactMeshes: [],
  reticle: null,
  audioContext: null,
  recoilKick: 0,
  dashPulse: 0,
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

function ensureAudio() {
  if (!visuals.audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      return null;
    }
    visuals.audioContext = new AudioContextClass();
  }
  if (visuals.audioContext.state === "suspended") {
    visuals.audioContext.resume();
  }
  return visuals.audioContext;
}

function playTone(freq, duration, type, gainValue = 0.04) {
  const ctx = ensureAudio();
  if (!ctx) {
    return;
  }
  const now = ctx.currentTime;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(freq, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(gainValue, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(now);
  oscillator.stop(now + duration + 0.03);
}

function playShotSound() {
  playTone(220, 0.08, "square", 0.03);
  playTone(110, 0.12, "triangle", 0.02);
}

function playHitSound() {
  playTone(480, 0.06, "sawtooth", 0.035);
  playTone(320, 0.12, "triangle", 0.025);
}

function playReloadSound() {
  playTone(180, 0.08, "sine", 0.02);
  setTimeout(() => playTone(240, 0.1, "sine", 0.02), 100);
}

function playDashSound() {
  playTone(90, 0.06, "sawtooth", 0.04);
  setTimeout(() => playTone(180, 0.08, "triangle", 0.03), 40);
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

function selfPlayer() {
  return state.players.find((player) => player.id === state.playerId) || null;
}

function updateHud() {
  const self = selfPlayer();
  elements.connectionStatus.textContent = state.connected ? "Online" : "Offline";
  elements.playerName.textContent = state.playerName;
  elements.roundLabel.textContent = state.room ? `Round ${state.room.round}` : "Queue";
  elements.matchMessage.textContent = state.room?.statusText || "Searching for opponent...";
  elements.winnerLabel.textContent = state.room?.winnerId
    ? `${state.players.find((player) => player.id === state.room.winnerId)?.name || "Winner"} Wins`
    : "No Winner";
  elements.pingLabel.textContent = `WS ${state.pingTick++ % 2 ? "LIVE" : "SYNC"}`;
  elements.ammoLabel.textContent = self ? `${self.ammo} / ${self.maxAmmo}${self.reloading ? " Reloading" : ""}` : "10 / 10";

  if (self) {
    const remaining = Math.max(0, self.dashReadyAt - Date.now());
    elements.dashLabel.textContent = remaining > 0 ? `Dash ${Math.ceil(remaining / 100) / 10}s` : "Dash Ready";
  } else {
    elements.dashLabel.textContent = "Dash Ready";
  }

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
        <span>${player.ammo}/${player.maxAmmo} | K ${player.kills} | D ${player.deaths}</span>
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

  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 120);
  camera.position.set(0, 18, 18);
  visuals.camera = camera;

  const hemi = new THREE.HemisphereLight(0x7ec8ff, 0x050916, 1.2);
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

  const rimLeft = new THREE.PointLight(0xff4f7d, 24, 30, 2);
  rimLeft.position.set(-10, 2.5, 0);
  scene.add(rimLeft);

  const rimRight = new THREE.PointLight(0x44d9ff, 24, 30, 2);
  rimRight.position.set(10, 2.5, 0);
  scene.add(rimRight);

  buildArena(scene);
  resizeRenderer();
}

function buildArena(scene) {
  const arenaWidth = state.arena.width / 80;
  const arenaDepth = state.arena.height / 80;

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(arenaWidth, arenaDepth, 24, 24),
    new THREE.MeshStandardMaterial({
      color: 0x101a32,
      emissive: 0x07101f,
      metalness: 0.55,
      roughness: 0.35,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const grid = new THREE.GridHelper(arenaWidth, 20, 0x2dcfff, 0x133159);
  grid.position.y = 0.02;
  scene.add(grid);

  const wallMaterial = new THREE.MeshStandardMaterial({
    color: 0x162440,
    emissive: 0x091526,
    metalness: 0.65,
    roughness: 0.25,
  });
  const wallThickness = 0.6;
  const wallHeight = 2.8;
  const horizontalWallGeometry = new THREE.BoxGeometry(arenaWidth + 1, wallHeight, wallThickness);
  const verticalWallGeometry = new THREE.BoxGeometry(wallThickness, wallHeight, arenaDepth + 1);

  [
    { geometry: horizontalWallGeometry, position: [0, wallHeight / 2, arenaDepth / 2 + 0.2] },
    { geometry: horizontalWallGeometry, position: [0, wallHeight / 2, -arenaDepth / 2 - 0.2] },
    { geometry: verticalWallGeometry, position: [arenaWidth / 2 + 0.2, wallHeight / 2, 0] },
    { geometry: verticalWallGeometry, position: [-arenaWidth / 2 - 0.2, wallHeight / 2, 0] },
  ].forEach((wall) => {
    const mesh = new THREE.Mesh(wall.geometry, wallMaterial);
    mesh.position.set(...wall.position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  });

  state.arena.obstacles.forEach((obstacle, index) => {
    const obstacleMesh = new THREE.Mesh(
      new THREE.BoxGeometry(obstacle.width / 80, 2.8, obstacle.height / 80),
      new THREE.MeshStandardMaterial({
        color: 0x1a2848,
        emissive: index % 2 === 0 ? 0x18142a : 0x102634,
        metalness: 0.7,
        roughness: 0.2,
      }),
    );
    obstacleMesh.position.set(
      (obstacle.x - state.arena.width / 2) / 80,
      1.4,
      (obstacle.y - state.arena.height / 2) / 80,
    );
    obstacleMesh.castShadow = true;
    obstacleMesh.receiveShadow = true;
    scene.add(obstacleMesh);

    const outline = new THREE.Mesh(
      new THREE.BoxGeometry(obstacle.width / 80 + 0.06, 2.85, obstacle.height / 80 + 0.06),
      new THREE.MeshBasicMaterial({
        color: index % 2 === 0 ? 0xff5a7a : 0x59d8ff,
        wireframe: true,
      }),
    );
    outline.position.copy(obstacleMesh.position);
    scene.add(outline);
  });

  visuals.reticle = new THREE.Mesh(
    new THREE.TorusGeometry(0.35, 0.03, 10, 32),
    new THREE.MeshBasicMaterial({ color: 0xffcb61 }),
  );
  visuals.reticle.rotation.x = Math.PI / 2;
  visuals.reticle.position.set(0, 0.08, 0);
  scene.add(visuals.reticle);
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

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    emissive: new THREE.Color(color),
    emissiveIntensity: 0.3,
    metalness: 0.5,
    roughness: 0.24,
  });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.65, 8, 16), bodyMaterial);
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

  group.userData = { bodyMaterial, gun };
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

function spawnImpact(player) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.25, 0.34, 24),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(player.color), transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set((player.x - state.arena.width / 2) / 80, 0.08, (player.y - state.arena.height / 2) / 80);
  visuals.scene.add(ring);
  visuals.impactMeshes.push({ mesh: ring, life: 0.45, maxLife: 0.45, grow: 2.4 });
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

    mesh.userData.bodyMaterial.emissiveIntensity = player.id === state.playerId ? 0.52 : 0.3;
    mesh.scale.setScalar(player.alive ? 1 : 0.88);
    mesh.visible = true;
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

function updateImpacts(delta) {
  visuals.impactMeshes = visuals.impactMeshes.filter((impact) => {
    impact.life -= delta;
    if (impact.life <= 0) {
      visuals.scene.remove(impact.mesh);
      return false;
    }
    const progress = 1 - impact.life / impact.maxLife;
    impact.mesh.scale.setScalar(1 + progress * impact.grow);
    impact.mesh.material.opacity = 1 - progress;
    return true;
  });
}

function updateCamera(delta) {
  const self = selfPlayer() || state.players[0];
  if (!self) {
    return;
  }

  const target = new THREE.Vector3(
    (self.x - state.arena.width / 2) / 80,
    0,
    (self.y - state.arena.height / 2) / 80,
  );

  const baseHeight = 12.5 + visuals.recoilKick * 1.8;
  const baseDistance = 9.8 + visuals.recoilKick * 1.1;
  const dashLift = visuals.dashPulse * 1.2;
  const cameraTarget = new THREE.Vector3(target.x, baseHeight + dashLift, target.z + baseDistance);
  visuals.camera.position.lerp(cameraTarget, Math.min(1, delta * 4));
  visuals.camera.lookAt(target.x, 0.8 + visuals.recoilKick * 0.4, target.z - 1.7);

  visuals.reticle.position.set(
    (state.mouse.x - state.arena.width / 2) / 80,
    0.06,
    (state.mouse.y - state.arena.height / 2) / 80,
  );

  visuals.recoilKick = Math.max(0, visuals.recoilKick - delta * 4.5);
  visuals.dashPulse = Math.max(0, visuals.dashPulse - delta * 2.8);
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
      const previousPlayers = new Map(state.players.map((player) => [player.id, player]));
      const previousWinner = state.room?.winnerId;

      state.playerId = payload.selfId;
      state.room = payload.room;
      state.players = payload.players;
      state.bullets = payload.bullets;
      state.arena = payload.arena;

      state.players.forEach((player) => {
        const previous = previousPlayers.get(player.id);
        if (!previous) {
          return;
        }
        if (player.lastShotAt > previous.lastShotAt) {
          if (player.id === state.playerId) {
            visuals.recoilKick = Math.min(1.2, visuals.recoilKick + 0.6);
            playShotSound();
          }
        }
        if (player.lastHitAt > previous.lastHitAt) {
          spawnImpact(player);
          if (player.id === state.playerId) {
            state.damageFlash = 0.9;
            playHitSound();
          }
        }
        if (player.lastDashAt > previous.lastDashAt) {
          visuals.dashPulse = 1;
          if (player.id === state.playerId) {
            playDashSound();
          }
        }
        if (player.reloading && !previous.reloading) {
          if (player.id === state.playerId) {
            playReloadSound();
          }
        }
      });

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

  ensureAudio();
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
      reload: state.actions.reload,
      dash: state.actions.dash,
    },
    aim: {
      x: state.mouse.x,
      y: state.mouse.y,
    },
  }));

  state.actions.reload = false;
  state.actions.dash = false;
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
  updateImpacts(delta);
  updateCamera(delta);

  if (state.damageFlash > 0) {
    state.damageFlash = Math.max(0, state.damageFlash - delta * 2.2);
  }
  elements.damageFlash.style.opacity = `${state.damageFlash * 0.42}`;

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
    if (key === "r") state.actions.reload = true;
    if (key === "shift" || event.code === "Space") state.actions.dash = true;
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
