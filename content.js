// content.js — runs on ChatGPT, Claude, and Gemini pages.
// Two jobs:
//   1) On demand: scrape the current chat and return it to the popup.
//   2) When recording is on: watch the DOM for new messages and stash them
//      in chrome.storage so a snapshot survives navigation.

(function () {
  const HOST = location.hostname;
  const PLATFORM =
    HOST.includes("chatgpt.com") || HOST.includes("chat.openai.com") ? "chatgpt" :
    HOST.includes("claude.ai") ? "claude" :
    HOST.includes("gemini.google.com") ? "gemini" :
    null;

  if (!PLATFORM) return;

  // ---------- scrapers ----------

  function cleanText(node) {
    // Preserve line breaks reasonably. innerText respects layout better than textContent.
    return (node.innerText || node.textContent || "").replace(/\u00a0/g, " ").trim();
  }

  function scrapeChatGPT() {
    // ChatGPT annotates each turn with data-message-author-role="user" | "assistant"
    const nodes = document.querySelectorAll('[data-message-author-role]');
    const messages = [];
    nodes.forEach((n) => {
      const role = n.getAttribute("data-message-author-role");
      const text = cleanText(n);
      if (text) messages.push({ role, text });
    });
    const title =
      document.querySelector('nav a[aria-current="page"]')?.innerText?.trim() ||
      document.title.replace(/ - ChatGPT.*$/, "").trim();
    return { platform: "chatgpt", title, url: location.href, messages };
  }

  function scrapeClaude() {
    // Claude uses data-testid="user-message" for user turns; assistant turns are
    // sibling blocks with the "font-claude-message" class. Structure has shifted
    // over time — try a couple of strategies.
    const messages = [];

    // Strategy 1: iterate every conversation "turn" in order
    const turns = document.querySelectorAll(
      '[data-testid="user-message"], .font-claude-message, [data-testid="assistant-message"]'
    );
    turns.forEach((n) => {
      const isUser =
        n.matches('[data-testid="user-message"]') ||
        n.closest('[data-testid="user-message"]');
      const isAssistant =
        n.matches('.font-claude-message, [data-testid="assistant-message"]') ||
        n.closest('.font-claude-message, [data-testid="assistant-message"]');

      const role = isUser ? "user" : isAssistant ? "assistant" : null;
      if (!role) return;
      const text = cleanText(n);
      if (text) messages.push({ role, text });
    });

    // Dedup consecutive duplicates from overlapping selectors
    const deduped = [];
    for (const m of messages) {
      const last = deduped[deduped.length - 1];
      if (!last || last.role !== m.role || last.text !== m.text) deduped.push(m);
    }

    const title = document.title.replace(/ - Claude$/, "").trim();
    return { platform: "claude", title, url: location.href, messages: deduped };
  }

  function scrapeGemini() {
    // Gemini renders each turn as <user-query> / <model-response> web components.
    const messages = [];
    document.querySelectorAll("user-query, model-response").forEach((n) => {
      const role = n.tagName.toLowerCase() === "user-query" ? "user" : "assistant";
      const text = cleanText(n);
      if (text) messages.push({ role, text });
    });

    // Fallback selectors used by older Gemini builds
    if (messages.length === 0) {
      document
        .querySelectorAll(".conversation-container .user-query-container, .conversation-container .model-response-text")
        .forEach((n) => {
          const role = n.classList.contains("user-query-container") ? "user" : "assistant";
          const text = cleanText(n);
          if (text) messages.push({ role, text });
        });
    }

    const title = document.title.replace(/ - Gemini.*$/, "").trim();
    return { platform: "gemini", title, url: location.href, messages };
  }

  function scrape() {
    try {
      if (PLATFORM === "chatgpt") return scrapeChatGPT();
      if (PLATFORM === "claude") return scrapeClaude();
      if (PLATFORM === "gemini") return scrapeGemini();
    } catch (err) {
      console.error("[AI Chat Saver] scrape failed", err);
    }
    return { platform: PLATFORM, title: document.title, url: location.href, messages: [] };
  }

  // ---------- recording watcher ----------

  let observer = null;

  function startRecording() {
    if (observer) return;
    const root = document.body;
    observer = new MutationObserver(() => {
      // Debounce with rAF — DOM updates fire in bursts
      cancelAnimationFrame(startRecording._raf);
      startRecording._raf = requestAnimationFrame(() => {
        const chat = scrape();
        chrome.storage.local.set({
          [`recording:${location.href}`]: {
            ...chat,
            updatedAt: Date.now()
          }
        });
      });
    });
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    // Take an initial snapshot immediately
    const chat = scrape();
    chrome.storage.local.set({
      [`recording:${location.href}`]: { ...chat, updatedAt: Date.now() }
    });
  }

  function stopRecording() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  // ---------- message router ----------

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || !msg.type) return;
    if (msg.type === "SCRAPE_CHAT") {
      sendResponse({ ok: true, data: scrape() });
      return true;
    }
    if (msg.type === "START_RECORDING") {
      startRecording();
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === "STOP_RECORDING") {
      stopRecording();
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === "PING") {
      sendResponse({ ok: true, platform: PLATFORM });
      return true;
    }
  });

  // On load, if the background says this tab is being recorded, resume watching.
  chrome.storage.local.get("recordingTabs", ({ recordingTabs = {} }) => {
    // We don't know our own tab id here, so re-arm on any URL match:
    // the popup will confirm and reissue START_RECORDING when reopened.
    // (This is a best-effort resume across reloads.)
    if (Object.keys(recordingTabs).length > 0) {
      // No-op: rely on popup to reissue START_RECORDING on next open.
    }
  });
})();
