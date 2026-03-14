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
      throw new Error(payload.error || "요청에 실패했습니다.");
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
  { id: "drill", title: "다이아 드릴", costBase: 25, growth: 1.6, description: "클릭 채굴량과 전투력이 함께 오른다." },
  { id: "crew", title: "광부 분대", costBase: 45, growth: 1.7, description: "초당 채굴량이 크게 오른다." },
  { id: "forge", title: "심연 제련로", costBase: 70, growth: 1.8, description: "전투력이 더 빠르게 증가한다." },
  { id: "scanner", title: "균열 스캐너", costBase: 90, growth: 1.95, description: "결정과 보스 효율이 상승한다." },
];

const labUpgrades = [
  { id: "overclock", title: "오버클럭", costBase: 150, growth: 2, description: "전투력 영구 배율 상승." },
  { id: "logistics", title: "물류 증폭", costBase: 180, growth: 2.05, description: "자동 채굴량 영구 배율 상승." },
  { id: "luck", title: "희귀 탐사학", costBase: 220, growth: 2.15, description: "결정과 보스 보상이 상승한다." },
];

const skinCatalog = [
  { id: "default", name: "Default Drill", description: "기본 외형." },
  { id: "founder-gold", name: "Founder Gold", description: "유료 상점에서 지급되는 황금 외형." },
];

const state = {
  profile: null,
  paymentProvider: "toss",
  paymentEnabled: false,
};

const elements = {
  authModal: document.querySelector("#auth-modal"),
  authStatus: document.querySelector("#auth-status"),
  usernameInput: document.querySelector("#username-input"),
  registerButton: document.querySelector("#register-button"),
  loginButton: document.querySelector("#login-button"),
  usernameLabel: document.querySelector("#username-label"),
  premiumGems: document.querySelector("#premium-gems"),
  saveButton: document.querySelector("#save-button"),
  mineButton: document.querySelector("#mine-button"),
  fightButton: document.querySelector("#fight-button"),
  bossButton: document.querySelector("#boss-button"),
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
};

function number(value) {
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: value > 100 ? 0 : 1 }).format(value);
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

function calcPower(gameState) {
  const drillPower = 1 + gameState.upgrades.drill * 2;
  const forgePower = 4 + gameState.upgrades.forge * 3;
  const labPower = 1 + gameState.lab.overclock * 0.18;
  const ascensionPower = 1 + gameState.resources.cores * 0.12;
  return Math.floor((drillPower + forgePower + Math.floor(gameState.progression.depth / 2)) * labPower * ascensionPower);
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
    pushLog("보스를 돌파하고 코어 1개를 확보했다.");
  }

  gameState.progression.depth += 1;
  const nextHp = Math.floor(120 * (1 + (gameState.progression.depth - 1) * 0.22));
  gameState.boss = {
    name: `Depth ${gameState.progression.depth} Warden`,
    hp: nextHp,
    maxHp: nextHp,
    ready: gameState.progression.depth >= gameState.progression.bossFloor,
  };
  pushLog(`심연 ${gameState.progression.depth}층으로 내려갔다.`);
  updateQuestProgress(gameState);
}

function attackBoss(auto = false) {
  const gameState = getGameState();
  if (!gameState) {
    return;
  }
  const damage = calcPower(gameState);
  gameState.boss.hp = Math.max(0, gameState.boss.hp - damage);
  gameState.stats.damageDealt += damage;
  elements.combatText.textContent = auto
    ? `자동 포탑이 ${number(damage)} 피해를 입혔다.`
    : `${number(damage)} 피해를 입혔다.`;
  advanceBossState(gameState);
}

function mine() {
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
    pushLog("광맥에서 결정이 튀어나왔다.");
  }
  updateQuestProgress(gameState);
  render();
}

function buyUpgrade(id) {
  const gameState = getGameState();
  const entry = upgrades.find((item) => item.id === id);
  const cost = costFor(entry, gameState.upgrades[id]);
  if (gameState.resources.ore < cost) {
    return;
  }
  gameState.resources.ore -= cost;
  gameState.upgrades[id] += 1;
  pushLog(`${entry.title} 레벨이 ${gameState.upgrades[id]}이 되었다.`);
  render();
}

function buyLab(id) {
  const gameState = getGameState();
  const entry = labUpgrades.find((item) => item.id === id);
  const cost = costFor(entry, gameState.lab[id]);
  if (gameState.resources.gold < cost) {
    return;
  }
  gameState.resources.gold -= cost;
  gameState.lab[id] += 1;
  pushLog(`${entry.title} 연구가 ${gameState.lab[id]}단계가 되었다.`);
  render();
}

async function claimQuest(id) {
  try {
    const payload = await API.request("/api/game/claim-quest", {
      method: "POST",
      body: { questId: id },
    });
    state.profile = payload.profile;
    setSync("보상 수령 완료", "서버에서 퀘스트 보상이 반영되었다.");
    render();
  } catch (error) {
    setSync("수령 실패", error.message, true);
  }
}

function selectSkin(id) {
  const gameState = getGameState();
  if (!gameState || !gameState.cosmetics.ownedSkins.includes(id)) {
    return;
  }
  gameState.cosmetics.activeSkin = id;
  pushLog(`${skinCatalog.find((item) => item.id === id)?.name || id} 스킨을 장착했다.`);
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
  strong.textContent = "기록";
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
  meta.textContent = `${entry.depth}층 · 전투력 ${number(entry.power)}`;
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
  elements.heroTitle.textContent = `심연 ${gameState.progression.depth}층`;
  elements.heroCopy.textContent = `${gameState.cosmetics.activeSkin} 스킨 장착 중. 서버 저장과 리더보드 경쟁이 활성화되어 있다.`;
  elements.offlineLabel.textContent = new Date(gameState.lastUpdatedAt).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  elements.paymentProvider.textContent = state.paymentProvider;

  elements.goldStat.textContent = number(gameState.resources.gold);
  elements.oreStat.textContent = number(gameState.resources.ore);
  elements.crystalStat.textContent = number(gameState.resources.crystals);
  elements.coreStat.textContent = number(gameState.resources.cores);
  elements.powerStat.textContent = number(calcPower(gameState));
  elements.oreRateStat.textContent = number(calcOrePerSecond(gameState));

  elements.bossFloorBadge.textContent = `${gameState.progression.bossFloor}층`;
  elements.bossName.textContent = gameState.boss.name;
  elements.bossHealthFill.style.width = `${Math.max(0, (gameState.boss.hp / gameState.boss.maxHp) * 100)}%`;
  elements.bossHealthText.textContent = `${number(gameState.boss.hp)} / ${number(gameState.boss.maxHp)}`;

  renderList(
    elements.upgradeList,
    upgrades.map((entry) =>
      buildCard({
        title: entry.title,
        description: entry.description,
        meta: `Lv.${gameState.upgrades[entry.id]} | ${number(costFor(entry, gameState.upgrades[entry.id]))} 광석`,
        buttonLabel: "강화",
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
        meta: `${gameState.lab[entry.id]}단계 | ${number(costFor(entry, gameState.lab[entry.id]))} 금화`,
        buttonLabel: "연구",
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
        description: "완수 시 서버 보상이 즉시 지급된다.",
        meta: quest.claimed ? "수령 완료" : `${quest.progress} / ${quest.goal}`,
        buttonLabel: quest.claimed ? "완료" : quest.progress >= quest.goal ? "보상 받기" : "진행 중",
        disabled: quest.claimed || quest.progress < quest.goal,
        className: "primary-button small-button",
        onClick: () => claimQuest(quest.id),
      }),
    ),
  );

  renderList(
    elements.skinList,
    skinCatalog.map((skin) =>
      buildCard({
        title: skin.name,
        description: skin.description,
        meta: gameState.cosmetics.ownedSkins.includes(skin.id) ? "보유 중" : "미보유",
        buttonLabel: gameState.cosmetics.activeSkin === skin.id ? "장착됨" : "장착",
        disabled: !gameState.cosmetics.ownedSkins.includes(skin.id) || gameState.cosmetics.activeSkin === skin.id,
        onClick: () => selectSkin(skin.id),
      }),
    ),
  );

  renderList(elements.logList, gameState.logs.map(createLogNode));
}

function setSync(title, body, isError = false) {
  elements.syncBadge.textContent = title;
  elements.syncBadge.style.color = isError ? "#ffd0d0" : "";
  elements.syncText.textContent = body;
}

async function syncToServer() {
  if (!state.profile) {
    return;
  }
  try {
    setSync("저장 중", "현재 진행도를 서버에 반영하고 있다.");
    await API.request("/api/game/save", {
      method: "POST",
      body: { gameState: getGameState() },
    });
    setSync("동기화 완료", "서버 저장이 최신 상태다.");
  } catch (error) {
    setSync("저장 실패", error.message, true);
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
    state.paymentProvider = config.paymentProvider;
    state.paymentEnabled = Boolean(config.toss?.enabled);

    const payload = await API.request("/api/store/catalog");
    renderList(
      elements.storeList,
      payload.items.map((item) =>
        buildCard({
          title: item.name,
          description: state.paymentEnabled ? item.description : `${item.description} 현재는 결제 키가 없어 비활성화됨.`,
          meta: `${number(item.price)} ${item.currency}`,
          buttonLabel: "구매",
          disabled: !state.profile || !state.paymentEnabled,
          className: "secondary-button small-button",
          onClick: () => openCheckout(item),
        }),
      ),
    );
  } catch (error) {
    setSync("상점 오류", error.message, true);
  }
}

async function fetchLeaderboard() {
  try {
    const payload = await API.request("/api/leaderboard");
    renderList(elements.leaderboardList, payload.leaderboard.map(createLeaderboardNode));
  } catch (error) {
    setSync("랭킹 오류", error.message, true);
  }
}

async function authenticate(mode) {
  const username = elements.usernameInput.value.trim();
  if (username.length < 2) {
    elements.authStatus.textContent = "닉네임은 2자 이상이어야 한다.";
    return;
  }
  try {
    elements.authStatus.textContent = "계정 처리 중...";
    const payload = await API.request(`/api/auth/${mode}`, {
      method: "POST",
      body: { username },
    });
    state.profile = payload.profile;
    elements.authModal.classList.remove("visible");
    setSync("접속 완료", `${payload.profile.username} 계정으로 로그인했다.`);
    render();
    fetchStore();
    fetchLeaderboard();
  } catch (error) {
    elements.authStatus.textContent = error.message;
  }
}

async function openCheckout(item) {
  try {
    const payload = await API.request("/api/store/checkout", {
      method: "POST",
      body: { sku: item.sku },
    });
    if (typeof window.TossPayments !== "function") {
      throw new Error("토스 SDK를 불러오지 못했습니다.");
    }
    const tossPayments = window.TossPayments(payload.checkout.clientKey);
    const payment = tossPayments.payment({
      customerKey: payload.checkout.customerKey,
    });
    await payment.requestPayment({
      method: "CARD",
      amount: {
        currency: payload.checkout.currency,
        value: payload.checkout.amount,
      },
      orderId: payload.checkout.orderId,
      orderName: payload.checkout.orderName,
      successUrl: payload.checkout.successUrl,
      failUrl: payload.checkout.failUrl,
    });
  } catch (error) {
    setSync("결제 준비 실패", error.message, true);
  }
}

elements.registerButton.addEventListener("click", () => authenticate("register"));
elements.loginButton.addEventListener("click", () => authenticate("login"));
elements.saveButton.addEventListener("click", () => syncToServer());
elements.mineButton.addEventListener("click", () => mine());
elements.fightButton.addEventListener("click", () => {
  attackBoss(false);
  render();
});
elements.bossButton.addEventListener("click", () => {
  const gameState = getGameState();
  if (!gameState) {
    return;
  }
  if (gameState.progression.depth < gameState.progression.bossFloor) {
    elements.combatText.textContent = `${gameState.progression.bossFloor}층까지 더 내려가야 보스를 만난다.`;
    return;
  }
  attackBoss(false);
  render();
});

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
