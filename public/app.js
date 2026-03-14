const API = {
  csrfToken: "",

  async request(path, options = {}) {
    const method = options.method || "GET";
    const response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        ...(method !== "GET" && API.csrfToken ? { "X-CSRF-Token": API.csrfToken } : {}),
        ...(options.headers || {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Request failed.");
    }
    if (payload.csrfToken) {
      API.csrfToken = payload.csrfToken;
    }
    return payload;
  },
};

const TICK_MS = 1000;
const SAVE_INTERVAL_MS = 10000;

const upgrades = [
  { id: "drill", title: "Seed Injector", costBase: 25, growth: 1.6, description: "Raises random enhance output and direct strip damage." },
  { id: "crew", title: "Scrap Runners", costBase: 45, growth: 1.7, description: "Boosts passive scrap income from off-grid workers." },
  { id: "forge", title: "Blackforge Loop", costBase: 70, growth: 1.8, description: "Adds heavy pressure to the core enhancement stack." },
  { id: "scanner", title: "Trace Scanner", costBase: 90, growth: 1.95, description: "Improves cursed shard drops and dragon trail rewards." },
];

const labUpgrades = [
  { id: "overclock", title: "Heat Overclock", costBase: 150, growth: 2, description: "Amplifies all strip damage through unstable tuning." },
  { id: "logistics", title: "Ghost Logistics", costBase: 180, growth: 2.05, description: "Increases passive scrap flow through hidden routes." },
  { id: "luck", title: "Black Signal", costBase: 220, growth: 2.15, description: "Raises shard luck and rare board reward frequency." },
];

const skinCatalog = [
  { id: "default", name: "Rust Default", description: "The base loadout every new handle starts with." },
  { id: "founder-gold", name: "Founder Gold", description: "Reserved skin for future premium buyers." },
];

const state = {
  profile: null,
  paymentProvider: "coming soon",
  paymentEnabled: false,
  soundEnabled: true,
  audioContext: null,
};

const elements = {
  authModal: document.querySelector("#auth-modal"),
  authStatus: document.querySelector("#auth-status"),
  usernameInput: document.querySelector("#username-input"),
  registerButton: document.querySelector("#register-button"),
  loginButton: document.querySelector("#login-button"),
  usernameLabel: document.querySelector("#username-label"),
  premiumGems: document.querySelector("#premium-gems"),
  soundButton: document.querySelector("#sound-button"),
  saveButton: document.querySelector("#save-button"),
  mineButton: document.querySelector("#mine-button"),
  mineButtonMobile: document.querySelector("#mine-button-mobile"),
  fightButton: document.querySelector("#fight-button"),
  fightButtonMobile: document.querySelector("#fight-button-mobile"),
  bossButton: document.querySelector("#boss-button"),
  bossButtonMobile: document.querySelector("#boss-button-mobile"),
  heroTitle: document.querySelector("#hero-title"),
  heroCopy: document.querySelector("#hero-copy"),
  syncBadge: document.querySelector("#sync-badge"),
  syncText: document.querySelector("#sync-text"),
  offlineLabel: document.querySelector("#offline-label"),
  paymentProvider: document.querySelector("#payment-provider"),
  goldStat: document.querySelector("#gold-stat"),
  oreStat: document.querySelector("#ore-stat"),
  crystalStat: document.querySelector("#crystal-stat"),
  coreStat: document.querySelector("#core-stat"),
  powerStat: document.querySelector("#power-stat"),
  oreRateStat: document.querySelector("#ore-rate-stat"),
  bossFloorBadge: document.querySelector("#boss-floor-badge"),
  bossName: document.querySelector("#boss-name"),
  bossHealthFill: document.querySelector("#boss-health-fill"),
  bossHealthText: document.querySelector("#boss-health-text"),
  combatText: document.querySelector("#combat-text"),
  leaderboardList: document.querySelector("#leaderboard-list"),
  upgradeList: document.querySelector("#upgrade-list"),
  labList: document.querySelector("#lab-list"),
  questList: document.querySelector("#quest-list"),
  storeList: document.querySelector("#store-list"),
  skinList: document.querySelector("#skin-list"),
  logList: document.querySelector("#log-list"),
  impactLayer: document.querySelector("#impact-layer"),
};

function number(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: value > 100 ? 0 : 1 }).format(value);
}

function getGameState() {
  return state.profile?.gameState;
}

function pushLog(text) {
  const gameState = getGameState();
  if (!gameState) {
    return;
  }
  gameState.logs.unshift({ id: `${Date.now()}-${Math.random()}`, text: String(text).slice(0, 180) });
  gameState.logs = gameState.logs.slice(0, 24);
}

function ensureAudioContext() {
  if (!state.soundEnabled) {
    return null;
  }
  if (!state.audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      return null;
    }
    state.audioContext = new AudioContextClass();
  }
  if (state.audioContext.state === "suspended") {
    state.audioContext.resume();
  }
  return state.audioContext;
}

function playSound(type) {
  const ctx = ensureAudioContext();
  if (!ctx) {
    return;
  }
  const now = ctx.currentTime;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();

  oscillator.connect(gain);
  gain.connect(ctx.destination);

  if (type === "mine") {
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(520, now);
    oscillator.frequency.exponentialRampToValueAtTime(340, now + 0.08);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.09, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
  } else if (type === "boss") {
    oscillator.type = "sawtooth";
    oscillator.frequency.setValueAtTime(180, now);
    oscillator.frequency.exponentialRampToValueAtTime(70, now + 0.18);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.13, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
  } else {
    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(260, now);
    oscillator.frequency.exponentialRampToValueAtTime(150, now + 0.14);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
  }

  oscillator.start(now);
  oscillator.stop(now + 0.24);
}

function spawnFeedback(text, x, y, variant) {
  if (!elements.impactLayer) {
    return;
  }
  const node = document.createElement("div");
  node.className = `floating-feedback ${variant}`;
  node.textContent = text;
  node.style.left = `${x}px`;
  node.style.top = `${y}px`;
  elements.impactLayer.appendChild(node);
  setTimeout(() => node.remove(), 900);
}

function buttonCenter(button) {
  const rect = button.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function shake(target) {
  target.classList.remove("screen-shake");
  void target.offsetWidth;
  target.classList.add("screen-shake");
  setTimeout(() => target.classList.remove("screen-shake"), 260);
}

function calcPower(gameState) {
  const drillPower = 1 + gameState.upgrades.drill * 2;
  const forgePower = 4 + gameState.upgrades.forge * 3;
  const labPower = 1 + gameState.lab.overclock * 0.18;
  const corePower = 1 + gameState.resources.cores * 0.12;
  return Math.floor((drillPower + forgePower + Math.floor(gameState.progression.depth / 2)) * labPower * corePower);
}

function calcOrePerSecond(gameState) {
  const base = gameState.upgrades.crew * 1.8 + gameState.lab.logistics * 1.5;
  return Number((base * (1 + gameState.resources.cores * 0.12)).toFixed(1));
}

function costFor(entry, level) {
  return Math.floor(entry.costBase * entry.growth ** level);
}

function updateQuestProgress(gameState) {
  const mapping = {
    ore: Math.floor(gameState.stats.oreMined),
    kills: gameState.progression.kills,
    depth: gameState.progression.depth,
  };
  gameState.quests = gameState.quests.map((quest) => ({
    ...quest,
    progress: Math.min(quest.goal, mapping[quest.id] ?? quest.progress),
  }));
}

function passiveTick() {
  const gameState = getGameState();
  if (!gameState) {
    return;
  }
  const oreRate = calcOrePerSecond(gameState);
  gameState.resources.ore += oreRate;
  gameState.resources.gold += Math.max(1, Math.floor(gameState.progression.depth * 0.35 + gameState.lab.logistics));
  gameState.stats.oreMined += oreRate;
  updateQuestProgress(gameState);
}

function advanceBossState(gameState) {
  if (gameState.boss.hp > 0) {
    return;
  }

  const rewardGold = Math.floor(80 + gameState.progression.depth * 10);
  const rewardOre = Math.floor(50 + gameState.progression.depth * 9);
  const rewardCrystal = 1 + Math.floor(gameState.lab.luck / 2);

  gameState.resources.gold += rewardGold;
  gameState.resources.ore += rewardOre;
  gameState.resources.crystals += rewardCrystal;
  gameState.progression.kills += 1;

  if (gameState.progression.depth >= gameState.progression.bossFloor) {
    gameState.resources.cores += 1;
    gameState.progression.bossFloor += 10;
    pushLog("Dragon target burned out. Void core secured.");
  }

  gameState.progression.depth += 1;
  const nextHp = Math.floor(120 * (1 + (gameState.progression.depth - 1) * 0.22));
  gameState.boss = {
    name: `Dragon Node ${gameState.progression.depth}`,
    hp: nextHp,
    maxHp: nextHp,
    ready: gameState.progression.depth >= gameState.progression.bossFloor,
  };
  pushLog(`Board rank advanced to forge node ${gameState.progression.depth}.`);
  updateQuestProgress(gameState);
}

function attackBoss(auto = false, sourceButton = elements.fightButton) {
  const gameState = getGameState();
  if (!gameState) {
    return;
  }
  const damage = calcPower(gameState);
  gameState.boss.hp = Math.max(0, gameState.boss.hp - damage);
  gameState.stats.damageDealt += damage;
  elements.combatText.textContent = auto
    ? `Auto-strip thread dealt ${number(damage)} damage.`
    : `Manual strip dealt ${number(damage)} damage.`;
  if (!auto && sourceButton) {
    const point = buttonCenter(sourceButton);
    spawnFeedback(`-${number(damage)}`, point.x, point.y, "hit");
    shake(document.querySelector(".boss-panel"));
    playSound("boss");
  }
  advanceBossState(gameState);
}

function mine(sourceButton = elements.mineButton) {
  const gameState = getGameState();
  if (!gameState) {
    return;
  }
  const gain = 1 + gameState.upgrades.drill * 2 + gameState.resources.cores;
  gameState.resources.ore += gain;
  gameState.resources.gold += Math.max(1, Math.floor(gain / 2));
  gameState.stats.oreMined += gain;

  if (Math.random() < 0.05 + gameState.upgrades.scanner * 0.01 + gameState.lab.luck * 0.02) {
    gameState.resources.crystals += 1;
    pushLog("A cursed shard flashed out of the scrap heap.");
  }

  updateQuestProgress(gameState);
  if (sourceButton) {
    const point = buttonCenter(sourceButton);
    spawnFeedback(`+${number(gain)} scrap`, point.x, point.y, "mine");
  }
  playSound("mine");
  render();
}

function buyUpgrade(id) {
  const gameState = getGameState();
  const entry = upgrades.find((item) => item.id === id);
  if (!entry) {
    return;
  }
  const cost = costFor(entry, gameState.upgrades[id]);
  if (gameState.resources.ore < cost) {
    return;
  }
  gameState.resources.ore -= cost;
  gameState.upgrades[id] += 1;
  pushLog(`${entry.title} reached tier ${gameState.upgrades[id]}.`);
  render();
}

function buyLab(id) {
  const gameState = getGameState();
  const entry = labUpgrades.find((item) => item.id === id);
  if (!entry) {
    return;
  }
  const cost = costFor(entry, gameState.lab[id]);
  if (gameState.resources.gold < cost) {
    return;
  }
  gameState.resources.gold -= cost;
  gameState.lab[id] += 1;
  pushLog(`${entry.title} patch upgraded to tier ${gameState.lab[id]}.`);
  render();
}

async function claimQuest(id) {
  try {
    const payload = await API.request("/api/game/claim-quest", {
      method: "POST",
      body: { questId: id },
    });
    state.profile = payload.profile;
    setSync("REWARD CLAIMED", "Server confirmed the board payout.");
    render();
  } catch (error) {
    setSync("CLAIM FAILED", error.message, true);
  }
}

function selectSkin(id) {
  const gameState = getGameState();
  if (!gameState || !gameState.cosmetics.ownedSkins.includes(id)) {
    return;
  }
  gameState.cosmetics.activeSkin = id;
  pushLog(`${skinCatalog.find((item) => item.id === id)?.name || id} is now active.`);
  render();
}

function renderList(target, nodes) {
  target.innerHTML = "";
  nodes.forEach((node) => target.appendChild(node));
}

function buildCard({ title, description, meta, buttonLabel, disabled, className = "ghost-button small-button", onClick }) {
  const card = document.createElement("div");
  card.className = "list-item";

  const heading = document.createElement("h4");
  heading.textContent = title;
  card.appendChild(heading);

  const copy = document.createElement("p");
  copy.className = "muted-text";
  copy.textContent = description;
  card.appendChild(copy);

  const row = document.createElement("div");
  row.className = "item-row";

  const info = document.createElement("span");
  info.className = "item-meta";
  info.textContent = meta;
  row.appendChild(info);

  const button = document.createElement("button");
  button.className = className;
  button.textContent = buttonLabel;
  button.disabled = disabled;
  button.addEventListener("click", onClick);
  row.appendChild(button);

  card.appendChild(row);
  return card;
}

function createLogNode(entry) {
  const node = document.createElement("div");
  node.className = "log-entry";
  const strong = document.createElement("strong");
  strong.textContent = "LOG";
  node.appendChild(strong);
  node.appendChild(document.createTextNode(` ${entry.text}`));
  return node;
}

function createLeaderboardNode(entry, index) {
  const node = document.createElement("div");
  node.className = "list-item";
  const strong = document.createElement("strong");
  strong.textContent = `#${index + 1} ${entry.username}`;
  const meta = document.createElement("span");
  meta.className = "item-meta";
  meta.textContent = `Node ${entry.depth} | Power ${number(entry.power)}`;
  node.appendChild(strong);
  node.appendChild(meta);
  return node;
}

function render() {
  if (!state.profile) {
    return;
  }

  const gameState = getGameState();
  updateQuestProgress(gameState);

  elements.authModal.classList.remove("visible");
  elements.usernameLabel.textContent = state.profile.username;
  elements.premiumGems.textContent = number(gameState.resources.premiumGems);
  elements.heroTitle.textContent = `Forge Rank ${gameState.progression.depth}`;
  elements.heroCopy.textContent = `${gameState.cosmetics.activeSkin} loadout active. The board keeps tracking every risky enhance and illegal dragon strip in real time.`;
  elements.soundButton.textContent = state.soundEnabled ? "AUDIO ON" : "AUDIO OFF";
  elements.offlineLabel.textContent = new Date(gameState.lastUpdatedAt).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
  elements.paymentProvider.textContent = state.paymentEnabled ? state.paymentProvider : "coming soon";

  elements.goldStat.textContent = number(gameState.resources.gold);
  elements.oreStat.textContent = number(gameState.resources.ore);
  elements.crystalStat.textContent = number(gameState.resources.crystals);
  elements.coreStat.textContent = number(gameState.resources.cores);
  elements.powerStat.textContent = number(calcPower(gameState));
  elements.oreRateStat.textContent = `${number(calcOrePerSecond(gameState))}/s`;

  elements.bossFloorBadge.textContent = `${gameState.progression.bossFloor}TH NODE`;
  elements.bossName.textContent = gameState.boss.name;
  elements.bossHealthFill.style.width = `${Math.max(0, (gameState.boss.hp / gameState.boss.maxHp) * 100)}%`;
  elements.bossHealthText.textContent = `${number(gameState.boss.hp)} / ${number(gameState.boss.maxHp)}`;

  renderList(
    elements.upgradeList,
    upgrades.map((entry) =>
      buildCard({
        title: entry.title,
        description: entry.description,
        meta: `Lv.${gameState.upgrades[entry.id]} | ${number(costFor(entry, gameState.upgrades[entry.id]))} scrap`,
        buttonLabel: "Enhance",
        disabled: gameState.resources.ore < costFor(entry, gameState.upgrades[entry.id]),
        onClick: () => buyUpgrade(entry.id),
      }),
    ),
  );

  renderList(
    elements.labList,
    labUpgrades.map((entry) =>
      buildCard({
        title: entry.title,
        description: entry.description,
        meta: `Tier ${gameState.lab[entry.id]} | ${number(costFor(entry, gameState.lab[entry.id]))} credits`,
        buttonLabel: "Patch",
        disabled: gameState.resources.gold < costFor(entry, gameState.lab[entry.id]),
        onClick: () => buyLab(entry.id),
      }),
    ),
  );

  renderList(
    elements.questList,
    gameState.quests.map((quest) =>
      buildCard({
        title: quest.label,
        description: "Clear the thread target and claim instant board rewards from the server.",
        meta: quest.claimed ? "Claimed" : `${quest.progress} / ${quest.goal}`,
        buttonLabel: quest.claimed ? "Done" : quest.progress >= quest.goal ? "Claim" : "Pending",
        disabled: quest.claimed || quest.progress < quest.goal,
        className: "primary-button small-button",
        onClick: () => claimQuest(quest.id),
      }),
    ),
  );

  renderList(elements.storeList, [
    buildCard({
      title: "Premium thread locked",
      description: "Paid trade will open after business setup and payment activation. For now the board stays free to test.",
      meta: "Free public build",
      buttonLabel: "Locked",
      disabled: true,
      className: "secondary-button small-button",
      onClick: () => {},
    }),
  ]);

  renderList(
    elements.skinList,
    skinCatalog.map((skin) =>
      buildCard({
        title: skin.name,
        description: skin.description,
        meta: gameState.cosmetics.ownedSkins.includes(skin.id) ? "Owned" : "Locked",
        buttonLabel: gameState.cosmetics.activeSkin === skin.id ? "Active" : "Equip",
        disabled: !gameState.cosmetics.ownedSkins.includes(skin.id) || gameState.cosmetics.activeSkin === skin.id,
        onClick: () => selectSkin(skin.id),
      }),
    ),
  );

  renderList(elements.logList, gameState.logs.map(createLogNode));
}

function setSync(title, body, isError = false) {
  elements.syncBadge.textContent = title;
  elements.syncBadge.style.color = isError ? "#ffd2dc" : "";
  elements.syncText.textContent = body;
}

function toggleSound() {
  state.soundEnabled = !state.soundEnabled;
  if (!state.soundEnabled && state.audioContext) {
    state.audioContext.suspend();
  }
  render();
}

async function syncToServer() {
  if (!state.profile) {
    return;
  }
  try {
    setSync("SYNCING", "Pushing your current board state to the server.");
    await API.request("/api/game/save", {
      method: "POST",
      body: { gameState: getGameState() },
    });
    setSync("SYNCED", "Server thread is now updated.");
  } catch (error) {
    setSync("SYNC FAILED", error.message, true);
  }
}

async function fetchSession() {
  try {
    const session = await API.request("/api/session");
    state.profile = session.profile;
    render();
  } catch {
    elements.authModal.classList.add("visible");
  }
}

async function fetchStore() {
  try {
    const config = await API.request("/api/config");
    state.paymentProvider = config.paymentProvider || "coming soon";
    state.paymentEnabled = Boolean(config.toss?.enabled);
    render();
  } catch (error) {
    setSync("STORE ERROR", error.message, true);
  }
}

async function fetchLeaderboard() {
  try {
    const payload = await API.request("/api/leaderboard");
    renderList(elements.leaderboardList, payload.leaderboard.map(createLeaderboardNode));
  } catch (error) {
    setSync("BOARD ERROR", error.message, true);
  }
}

async function authenticate(mode) {
  const username = elements.usernameInput.value.trim();
  if (username.length < 2) {
    elements.authStatus.textContent = "Handle must be at least 2 characters.";
    return;
  }

  try {
    elements.authStatus.textContent = "Processing handle...";
    const payload = await API.request(`/api/auth/${mode}`, {
      method: "POST",
      body: { username },
    });
    state.profile = payload.profile;
    elements.authModal.classList.remove("visible");
    setSync("CONNECTED", `${payload.profile.username} entered the market board.`);
    render();
    fetchStore();
    fetchLeaderboard();
  } catch (error) {
    elements.authStatus.textContent = error.message;
  }
}

function attemptBoss(sourceButton) {
  const gameState = getGameState();
  if (!gameState) {
    return;
  }
  if (gameState.progression.depth < gameState.progression.bossFloor) {
    elements.combatText.textContent = `Reach node ${gameState.progression.bossFloor} to trigger the dragon trace.`;
    return;
  }
  attackBoss(false, sourceButton);
  render();
}

elements.registerButton.addEventListener("click", () => authenticate("register"));
elements.loginButton.addEventListener("click", () => authenticate("login"));
elements.soundButton.addEventListener("click", () => toggleSound());
elements.saveButton.addEventListener("click", () => syncToServer());
elements.mineButton.addEventListener("click", () => mine(elements.mineButton));
elements.mineButtonMobile.addEventListener("click", () => mine(elements.mineButtonMobile));
elements.fightButton.addEventListener("click", () => {
  attackBoss(false, elements.fightButton);
  render();
});
elements.fightButtonMobile.addEventListener("click", () => {
  attackBoss(false, elements.fightButtonMobile);
  render();
});
elements.bossButton.addEventListener("click", () => attemptBoss(elements.bossButton));
elements.bossButtonMobile.addEventListener("click", () => attemptBoss(elements.bossButtonMobile));

setInterval(() => {
  if (!state.profile) {
    return;
  }
  passiveTick();
  if (Math.random() < 0.24) {
    attackBoss(true);
  }
  render();
}, TICK_MS);

setInterval(() => {
  syncToServer();
  fetchLeaderboard();
}, SAVE_INTERVAL_MS);

fetchSession();
fetchStore();
fetchLeaderboard();
