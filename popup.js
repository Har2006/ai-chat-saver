// popup.js — talks to the content script on the active tab and to chrome.storage

const $ = (sel) => document.querySelector(sel);
const platformBadge = $("#platform-badge");
const recStatus = $("#rec-status");
const toggleRecBtn = $("#toggle-rec");
const chatList = $("#chat-list");
const filterSel = $("#filter");
const toast = $("#toast");

let currentTab = null;
let currentPlatform = null;
let recording = false;

const SUPPORTED = {
  "chatgpt.com": "chatgpt",
  "chat.openai.com": "chatgpt",
  "claude.ai": "claude",
  "gemini.google.com": "gemini"
};

// ------- utilities -------

function showToast(msg, ms = 1600) {
  toast.textContent = msg;
  toast.classList.remove("hidden");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.add("hidden"), ms);
}

function detectPlatformFromUrl(url) {
  try {
    const host = new URL(url).hostname;
    for (const [domain, id] of Object.entries(SUPPORTED)) {
      if (host === domain || host.endsWith("." + domain)) return id;
    }
  } catch (_) {}
  return null;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function sendToTab(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (resp) => {
      if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
      else resolve(resp || { ok: false, error: "no response" });
    });
  });
}

async function scrapeCurrentChat() {
  if (!currentTab || !currentPlatform) return null;
  const resp = await sendToTab(currentTab.id, { type: "SCRAPE_CHAT" });
  if (!resp || !resp.ok) return null;
  return resp.data; // { platform, title, url, messages: [{role, text}] }
}

function formatChatAsPrompt(chat) {
  const header =
`You are being handed the transcript of a previous AI conversation the user had elsewhere. Please:
1. Read the entire transcript below carefully.
2. Summarize the key points, decisions, and open threads in a few bullets so we're on the same page.
3. Then continue helping the user from where the previous conversation left off. Ask a clarifying question only if genuinely needed.

--- BEGIN PREVIOUS CONVERSATION ---
Source: ${chat.platform.toUpperCase()}${chat.title ? " · " + chat.title : ""}
Captured: ${new Date(chat.savedAt || Date.now()).toLocaleString()}
`;

  const body = chat.messages
    .map((m) => {
      const who = m.role === "user" ? "USER" : m.role === "assistant" ? "ASSISTANT" : m.role.toUpperCase();
      return `\n[${who}]\n${m.text.trim()}`;
    })
    .join("\n");

  const footer = `\n--- END PREVIOUS CONVERSATION ---\n\nPlease now begin with the summary, then continue the conversation.`;
  return header + body + footer;
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    // fallback
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

// ------- storage helpers -------

async function getAllChats() {
  const { chats = [] } = await chrome.storage.local.get("chats");
  return chats;
}

async function saveChat(chat, kind) {
  const chats = await getAllChats();
  const record = {
    id: crypto.randomUUID(),
    kind, // "temp" | "permanent"
    platform: chat.platform,
    title: chat.title || "(untitled)",
    url: chat.url,
    savedAt: Date.now(),
    messages: chat.messages
  };
  if (kind === "temp") {
    // keep only one temp slot
    const filtered = chats.filter((c) => c.kind !== "temp");
    filtered.unshift(record);
    await chrome.storage.local.set({ chats: filtered });
  } else {
    chats.unshift(record);
    await chrome.storage.local.set({ chats });
  }
  return record;
}

async function deleteChat(id) {
  const chats = await getAllChats();
  await chrome.storage.local.set({ chats: chats.filter((c) => c.id !== id) });
}

async function promoteToPermanent(id) {
  const chats = await getAllChats();
  const c = chats.find((x) => x.id === id);
  if (c) c.kind = "permanent";
  await chrome.storage.local.set({ chats });
}

// ------- recording state (per tab) -------

async function getRecordingState(tabId) {
  const { recordingTabs = {} } = await chrome.storage.local.get("recordingTabs");
  return !!recordingTabs[tabId];
}
async function setRecordingState(tabId, on) {
  const { recordingTabs = {} } = await chrome.storage.local.get("recordingTabs");
  if (on) recordingTabs[tabId] = true;
  else delete recordingTabs[tabId];
  await chrome.storage.local.set({ recordingTabs });
}

function updateRecUI() {
  if (recording) {
    recStatus.textContent = "Recording";
    recStatus.className = "status on";
    toggleRecBtn.textContent = "Stop recording";
    toggleRecBtn.classList.remove("primary");
    toggleRecBtn.classList.add("danger");
  } else {
    recStatus.textContent = "Not recording";
    recStatus.className = "status off";
    toggleRecBtn.textContent = "Start recording";
    toggleRecBtn.classList.add("primary");
    toggleRecBtn.classList.remove("danger");
  }
}

// ------- rendering saved chats -------

async function renderList() {
  const chats = await getAllChats();
  const filter = filterSel.value;
  const shown = chats.filter((c) => filter === "all" ? true : c.kind === filter);

  chatList.innerHTML = "";
  if (shown.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No saved chats yet.";
    chatList.appendChild(empty);
    return;
  }

  for (const c of shown) {
    const li = document.createElement("li");
    li.innerHTML = `
      <div class="item-top">
        <div class="title" title="${escapeHtml(c.title)}">${escapeHtml(c.title)}</div>
        <span class="tag ${c.kind}">${c.kind}</span>
      </div>
      <div class="meta">${c.platform} · ${c.messages.length} msgs · ${new Date(c.savedAt).toLocaleString()}</div>
      <div class="actions">
        <button class="btn" data-act="copy" data-id="${c.id}">Copy + prompt</button>
        ${c.kind === "temp" ? `<button class="btn" data-act="promote" data-id="${c.id}">Make permanent</button>` : ""}
        <button class="btn" data-act="delete" data-id="${c.id}">Delete</button>
      </div>
    `;
    chatList.appendChild(li);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// ------- event wiring -------

chatList.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const id = btn.dataset.id;
  const chats = await getAllChats();
  const chat = chats.find((c) => c.id === id);
  if (!chat) return;

  if (btn.dataset.act === "copy") {
    const text = formatChatAsPrompt(chat);
    const ok = await copyToClipboard(text);
    showToast(ok ? "Copied to clipboard" : "Copy failed");
  } else if (btn.dataset.act === "delete") {
    await deleteChat(id);
    await renderList();
    showToast("Deleted");
  } else if (btn.dataset.act === "promote") {
    await promoteToPermanent(id);
    await renderList();
    showToast("Moved to permanent");
  }
});

filterSel.addEventListener("change", renderList);

toggleRecBtn.addEventListener("click", async () => {
  if (!currentTab || !currentPlatform) {
    showToast("Open a supported AI chat first");
    return;
  }
  recording = !recording;
  await setRecordingState(currentTab.id, recording);
  await sendToTab(currentTab.id, { type: recording ? "START_RECORDING" : "STOP_RECORDING" });
  updateRecUI();
  showToast(recording ? "Recording started" : "Recording stopped");

  // If we just stopped, save whatever was captured as a temp snapshot
  if (!recording) {
    const chat = await scrapeCurrentChat();
    if (chat && chat.messages.length) {
      await saveChat(chat, "temp");
      await renderList();
      showToast("Saved recording as temp snapshot");
    }
  }
});

$("#snapshot-temp").addEventListener("click", async () => {
  const chat = await scrapeCurrentChat();
  if (!chat || !chat.messages.length) {
    showToast("Couldn't read chat on this tab");
    return;
  }
  await saveChat(chat, "temp");
  await renderList();
  showToast("Temp snapshot saved");
});

$("#save-permanent").addEventListener("click", async () => {
  const chat = await scrapeCurrentChat();
  if (!chat || !chat.messages.length) {
    showToast("Couldn't read chat on this tab");
    return;
  }
  await saveChat(chat, "permanent");
  await renderList();
  showToast("Saved permanently");
});

$("#copy-chat").addEventListener("click", async () => {
  const chat = await scrapeCurrentChat();
  if (!chat || !chat.messages.length) {
    showToast("Couldn't read chat on this tab");
    return;
  }
  const text = formatChatAsPrompt({ ...chat, savedAt: Date.now() });
  const ok = await copyToClipboard(text);
  showToast(ok ? "Copied — paste into any AI chat" : "Copy failed");
});

// ------- init -------

(async function init() {
  currentTab = await activeTab();
  currentPlatform = currentTab ? detectPlatformFromUrl(currentTab.url) : null;

  if (currentPlatform) {
    platformBadge.textContent = currentPlatform;
    platformBadge.className = "badge " + currentPlatform;
  } else {
    platformBadge.textContent = "unsupported tab";
  }

  recording = currentTab ? await getRecordingState(currentTab.id) : false;
  updateRecUI();
  await renderList();
})();
