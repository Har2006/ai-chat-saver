// background.js — MV3 service worker

// When a tab closes, clear its recording flag so the popup doesn't think it's still on.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { recordingTabs = {} } = await chrome.storage.local.get("recordingTabs");
  if (recordingTabs[tabId]) {
    delete recordingTabs[tabId];
    await chrome.storage.local.set({ recordingTabs });
  }
});

// First install — seed empty stores so popup queries are fast.
chrome.runtime.onInstalled.addListener(async () => {
  const state = await chrome.storage.local.get(["chats", "recordingTabs"]);
  const patch = {};
  if (!state.chats) patch.chats = [];
  if (!state.recordingTabs) patch.recordingTabs = {};
  if (Object.keys(patch).length) await chrome.storage.local.set(patch);
});
