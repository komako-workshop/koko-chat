let loadedCard = null;
let sessionId = null;

const $ = (id) => document.getElementById(id);
const pathInput = $("path");
const loadButton = $("load");
const startButton = $("start");
const cardBox = $("card");
const messages = $("messages");
const form = $("form");
const messageInput = $("message");
const sendButton = $("send");

loadButton.onclick = async () => {
  setStatus("加载角色卡…");
  const input = pathInput.value.trim();
  const body = input.startsWith("http") ? { pageUrl: input } : { path: input };
  const result = await post("/api/load-card", body);
  loadedCard = result.card;
  renderCard(loadedCard, result.firstMessage);
  startButton.disabled = false;
  setStatus("角色卡已加载。点“开始聊天”。");
};

startButton.onclick = async () => {
  if (!loadedCard) return;
  setStatus("创建 OpenClaw session…");
  const result = await post("/api/start", { card: loadedCard });
  sessionId = result.sessionId;
  messages.innerHTML = "";
  addMessage("assistant", result.firstMessage);
  messageInput.disabled = false;
  sendButton.disabled = false;
  setStatus(`已连接 ${result.characterName}`);
};

form.onsubmit = async (event) => {
  event.preventDefault();
  const text = messageInput.value.trim();
  if (!text || !sessionId) return;
  messageInput.value = "";
  addMessage("user", text);
  setStatus("等待角色回复…");
  sendButton.disabled = true;
  try {
    const result = await post("/api/send", { sessionId, message: text });
    addMessage("assistant", result.reply || "（空回复）");
    setStatus("就绪");
  } finally {
    sendButton.disabled = false;
  }
};

function renderCard(card, firstMessage) {
  cardBox.classList.remove("hidden");
  cardBox.innerHTML = `
    <img src="${escapeHtml(card.imageUrl)}" alt="" />
    <div>
      <h2>${escapeHtml(card.name)}</h2>
      <div class="meta">${escapeHtml(card.path)} · ${card.tokenTotal || 0} tokens</div>
      <p>${escapeHtml(card.tagline || card.pageDescription || "")}</p>
      <details><summary>First message</summary><p>${escapeHtml(firstMessage)}</p></details>
    </div>
  `;
}

function addMessage(role, text) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.textContent = text;
  messages.append(div);
  messages.scrollTop = messages.scrollHeight;
}

function setStatus(text) {
  let node = document.querySelector(".status");
  if (!node) {
    node = document.createElement("div");
    node.className = "status";
    document.querySelector(".setup").append(node);
  }
  node.textContent = text;
}

async function post(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
