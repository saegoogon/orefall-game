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
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "요청에 실패했어요.");
    }
    if (payload.csrfToken) {
      API.csrfToken = payload.csrfToken;
    }
    return payload;
  },
};

const state = {
  profile: null,
  stats: null,
  polls: [],
  featured: null,
  creators: [],
  selectedPollId: null,
  sort: "latest",
  category: "전체",
};

const categories = ["전체", "일상", "연애", "음식", "학교", "직장", "기타"];

const elements = {
  authModal: document.querySelector("#auth-modal"),
  authStatus: document.querySelector("#auth-status"),
  usernameInput: document.querySelector("#username-input"),
  registerButton: document.querySelector("#register-button"),
  loginButton: document.querySelector("#login-button"),
  usernameLabel: document.querySelector("#username-label"),
  createdCount: document.querySelector("#created-count"),
  votedCount: document.querySelector("#voted-count"),
  refreshButton: document.querySelector("#refresh-button"),
  logoutButton: document.querySelector("#logout-button"),
  featuredQuestion: document.querySelector("#featured-question"),
  featuredDescription: document.querySelector("#featured-description"),
  featuredOptions: document.querySelector("#featured-options"),
  metricPolls: document.querySelector("#metric-polls"),
  metricVotes: document.querySelector("#metric-votes"),
  metricComments: document.querySelector("#metric-comments"),
  jumpFeaturedButton: document.querySelector("#jump-featured-button"),
  creatorList: document.querySelector("#creator-list"),
  composerForm: document.querySelector("#composer-form"),
  questionInput: document.querySelector("#question-input"),
  descriptionInput: document.querySelector("#description-input"),
  optionAInput: document.querySelector("#option-a-input"),
  optionBInput: document.querySelector("#option-b-input"),
  categoryInput: document.querySelector("#category-input"),
  composerStatus: document.querySelector("#composer-status"),
  pollList: document.querySelector("#poll-list"),
  categoryFilters: document.querySelector("#category-filters"),
  sortButtons: Array.from(document.querySelectorAll("[data-sort]")),
  detailEmpty: document.querySelector("#detail-empty"),
  detailView: document.querySelector("#detail-view"),
  detailCategory: document.querySelector("#detail-category"),
  detailMeta: document.querySelector("#detail-meta"),
  detailQuestion: document.querySelector("#detail-question"),
  detailDescription: document.querySelector("#detail-description"),
  voteOptions: document.querySelector("#vote-options"),
  detailTotalVotes: document.querySelector("#detail-total-votes"),
  detailUserVote: document.querySelector("#detail-user-vote"),
  commentForm: document.querySelector("#comment-form"),
  commentInput: document.querySelector("#comment-input"),
  commentStatus: document.querySelector("#comment-status"),
  commentList: document.querySelector("#comment-list"),
};

function formatNumber(value) {
  return new Intl.NumberFormat("ko-KR").format(value || 0);
}

function formatDate(value) {
  return new Date(value).toLocaleString("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function setMessage(target, message, isError = false) {
  target.textContent = message;
  target.style.color = isError ? "#d64a4a" : "";
}

function updateHeader() {
  elements.usernameLabel.textContent = state.profile?.username || "Guest";
  elements.createdCount.textContent = formatNumber(state.profile?.stats?.createdCount || 0);
  elements.votedCount.textContent = formatNumber(state.profile?.stats?.participatedCount || 0);
}

function renderMetrics() {
  elements.metricPolls.textContent = formatNumber(state.stats?.pollCount || 0);
  elements.metricVotes.textContent = formatNumber(state.stats?.voteCount || 0);
  elements.metricComments.textContent = formatNumber(state.stats?.commentCount || 0);
}

function renderFeatured() {
  const featured = state.featured;
  elements.featuredOptions.innerHTML = "";
  if (!featured) {
    elements.featuredQuestion.textContent = "아직 대표 질문이 없어요";
    elements.featuredDescription.textContent = "첫 질문을 올려서 이 자리를 가져가보세요.";
    return;
  }
  elements.featuredQuestion.textContent = featured.question;
  elements.featuredDescription.textContent = featured.description || `${featured.authorName} 님의 질문`;
  featured.options.forEach((option) => {
    const node = document.createElement("button");
    node.type = "button";
    node.className = "preview-option";
    node.innerHTML = `<strong>${option.text}</strong><span>${option.percent}% · ${formatNumber(option.votes)}표</span>`;
    node.addEventListener("click", () => selectPoll(featured.id));
    elements.featuredOptions.appendChild(node);
  });
}

function renderCreators() {
  elements.creatorList.innerHTML = "";
  if (!state.creators.length) {
    const empty = document.createElement("p");
    empty.className = "muted-text";
    empty.textContent = "아직 질문을 올린 사용자가 없어요.";
    elements.creatorList.appendChild(empty);
    return;
  }
  state.creators.forEach((creator, index) => {
    const node = document.createElement("div");
    node.className = "creator-item";
    node.innerHTML = `
      <div>
        <strong>#${index + 1} ${creator.username}</strong>
        <p>${formatNumber(creator.polls)}개 질문</p>
      </div>
      <span>${formatNumber(creator.votesReceived)}표</span>
    `;
    elements.creatorList.appendChild(node);
  });
}

function renderCategoryFilters() {
  elements.categoryFilters.innerHTML = "";
  categories.forEach((category) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `category-button${state.category === category ? " active" : ""}`;
    button.textContent = category;
    button.addEventListener("click", async () => {
      state.category = category;
      await loadPolls();
    });
    elements.categoryFilters.appendChild(button);
  });
}

function renderSortButtons() {
  elements.sortButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.sort === state.sort);
  });
}

function createPollCard(poll) {
  const node = document.createElement("button");
  node.type = "button";
  node.className = `poll-card${state.selectedPollId === poll.id ? " active" : ""}`;
  node.innerHTML = `
    <div class="poll-card-top">
      <span class="mini-pill">${poll.category}</span>
      <span class="poll-card-date">${formatDate(poll.createdAt)}</span>
    </div>
    <strong>${poll.question}</strong>
    <p>${poll.description || `${poll.authorName} 님이 올린 질문`}</p>
    <div class="poll-split">
      <span>${poll.options[0].text}</span>
      <span>vs</span>
      <span>${poll.options[1].text}</span>
    </div>
    <div class="poll-meta">
      <span>${formatNumber(poll.totalVotes)}표</span>
      <span>${formatNumber(poll.totalComments)}댓글</span>
      <span>${poll.userVote ? "투표 완료" : "미참여"}</span>
    </div>
  `;
  node.addEventListener("click", () => selectPoll(poll.id));
  return node;
}

function renderPollList() {
  elements.pollList.innerHTML = "";
  if (!state.polls.length) {
    const empty = document.createElement("p");
    empty.className = "muted-text";
    empty.textContent = "조건에 맞는 질문이 아직 없어요.";
    elements.pollList.appendChild(empty);
    return;
  }
  state.polls.forEach((poll) => elements.pollList.appendChild(createPollCard(poll)));
}

function renderDetail(poll) {
  if (!poll) {
    elements.detailEmpty.classList.remove("hidden");
    elements.detailView.classList.add("hidden");
    return;
  }

  elements.detailEmpty.classList.add("hidden");
  elements.detailView.classList.remove("hidden");
  elements.detailCategory.textContent = poll.category;
  elements.detailMeta.textContent = `${poll.authorName} · ${formatDate(poll.createdAt)}`;
  elements.detailQuestion.textContent = poll.question;
  elements.detailDescription.textContent = poll.description || "설명 없이 올라온 질문이에요.";
  elements.detailTotalVotes.textContent = `${formatNumber(poll.totalVotes)} votes`;
  elements.detailUserVote.textContent = poll.userVote
    ? `내 선택: ${poll.options.find((option) => option.id === poll.userVote)?.text}`
    : "아직 투표하지 않았어요.";

  elements.voteOptions.innerHTML = "";
  poll.options.forEach((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `vote-button${poll.userVote === option.id ? " chosen" : ""}`;
    button.disabled = Boolean(poll.userVote) || !state.profile;
    button.innerHTML = `
      <div class="vote-top">
        <strong>${option.text}</strong>
        <span>${option.percent}%</span>
      </div>
      <div class="vote-bar">
        <div class="vote-fill" style="width: ${option.percent}%"></div>
      </div>
      <div class="vote-bottom">${formatNumber(option.votes)}표</div>
    `;
    button.addEventListener("click", () => votePoll(poll.id, option.id));
    elements.voteOptions.appendChild(button);
  });

  elements.commentList.innerHTML = "";
  if (!poll.comments.length) {
    const empty = document.createElement("p");
    empty.className = "muted-text";
    empty.textContent = "아직 댓글이 없어요. 첫 반응을 남겨보세요.";
    elements.commentList.appendChild(empty);
  } else {
    poll.comments.forEach((comment) => {
      const node = document.createElement("div");
      node.className = "comment-item";
      node.innerHTML = `
        <div class="comment-top">
          <strong>${comment.authorName}</strong>
          <span>${formatDate(comment.createdAt)}</span>
        </div>
        <p>${comment.text}</p>
      `;
      elements.commentList.appendChild(node);
    });
  }
}

async function loadBootstrap() {
  const payload = await API.request("/api/bootstrap");
  state.profile = payload.profile;
  state.stats = payload.stats;
  state.featured = payload.featured;
  state.creators = payload.creators;
  updateHeader();
  renderMetrics();
  renderFeatured();
  renderCreators();
  if (!state.selectedPollId && payload.featured?.id) {
    state.selectedPollId = payload.featured.id;
  }
}

async function loadPolls() {
  const params = new URLSearchParams({
    sort: state.sort,
    category: state.category,
  });
  const payload = await API.request(`/api/polls?${params.toString()}`);
  state.polls = payload.polls;
  if (!state.selectedPollId && state.polls[0]) {
    state.selectedPollId = state.polls[0].id;
  }
  if (state.selectedPollId && !state.polls.some((poll) => poll.id === state.selectedPollId)) {
    state.selectedPollId = state.polls[0]?.id || null;
  }
  renderCategoryFilters();
  renderSortButtons();
  renderPollList();
  if (state.selectedPollId) {
    await selectPoll(state.selectedPollId, false);
  } else {
    renderDetail(null);
  }
}

async function selectPoll(pollId, rerenderList = true) {
  state.selectedPollId = pollId;
  if (rerenderList) {
    renderPollList();
  }
  const payload = await API.request(`/api/polls/${pollId}`);
  renderDetail(payload.poll);
}

async function refreshAll() {
  await loadBootstrap();
  await loadPolls();
  updateHeader();
}

async function fetchSession() {
  try {
    const payload = await API.request("/api/session");
    state.profile = payload.profile;
    updateHeader();
    elements.authModal.classList.remove("visible");
  } catch {
    elements.authModal.classList.add("visible");
  }
}

async function authenticate(mode) {
  const username = elements.usernameInput.value.trim();
  if (username.length < 2) {
    setMessage(elements.authStatus, "닉네임은 2글자 이상이어야 해요.", true);
    return;
  }
  try {
    setMessage(elements.authStatus, "입장 중...");
    const payload = await API.request(`/api/auth/${mode}`, {
      method: "POST",
      body: { username },
    });
    state.profile = payload.profile;
    updateHeader();
    elements.authModal.classList.remove("visible");
    await refreshAll();
    setMessage(elements.authStatus, "입장 완료");
  } catch (error) {
    setMessage(elements.authStatus, error.message, true);
  }
}

async function logout() {
  await API.request("/api/auth/logout", { method: "POST" });
  state.profile = null;
  updateHeader();
  elements.authModal.classList.add("visible");
}

async function submitPoll(event) {
  event.preventDefault();
  try {
    setMessage(elements.composerStatus, "질문 등록 중...");
    const payload = await API.request("/api/polls", {
      method: "POST",
      body: {
        question: elements.questionInput.value,
        description: elements.descriptionInput.value,
        optionA: elements.optionAInput.value,
        optionB: elements.optionBInput.value,
        category: elements.categoryInput.value,
      },
    });
    elements.composerForm.reset();
    state.selectedPollId = payload.poll.id;
    await refreshAll();
    await selectPoll(payload.poll.id);
    setMessage(elements.composerStatus, "질문이 등록됐어요.");
  } catch (error) {
    setMessage(elements.composerStatus, error.message, true);
  }
}

async function votePoll(pollId, optionId) {
  try {
    const payload = await API.request(`/api/polls/${pollId}/vote`, {
      method: "POST",
      body: { optionId },
    });
    renderDetail(payload.poll);
    await refreshAll();
    await selectPoll(pollId);
    setMessage(elements.commentStatus, "");
  } catch (error) {
    setMessage(elements.commentStatus, error.message, true);
  }
}

async function submitComment(event) {
  event.preventDefault();
  if (!state.selectedPollId) {
    return;
  }
  try {
    setMessage(elements.commentStatus, "댓글 등록 중...");
    const payload = await API.request(`/api/polls/${state.selectedPollId}/comments`, {
      method: "POST",
      body: { text: elements.commentInput.value },
    });
    elements.commentInput.value = "";
    renderDetail(payload.poll);
    await refreshAll();
    setMessage(elements.commentStatus, "댓글이 등록됐어요.");
  } catch (error) {
    setMessage(elements.commentStatus, error.message, true);
  }
}

elements.registerButton.addEventListener("click", () => authenticate("register"));
elements.loginButton.addEventListener("click", () => authenticate("login"));
elements.refreshButton.addEventListener("click", () => refreshAll());
elements.logoutButton.addEventListener("click", () => logout());
elements.composerForm.addEventListener("submit", submitPoll);
elements.commentForm.addEventListener("submit", submitComment);
elements.jumpFeaturedButton.addEventListener("click", () => {
  if (state.featured?.id) {
    selectPoll(state.featured.id);
  }
});

elements.sortButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    state.sort = button.dataset.sort;
    await loadPolls();
  });
});

(async function init() {
  renderCategoryFilters();
  renderSortButtons();
  await fetchSession();
  await refreshAll();
})();
