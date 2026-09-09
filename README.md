# AI Chat Saver

A Chrome extension that captures conversations from **ChatGPT, Claude, and Gemini** and lets you carry them across chats or platforms.

## What it does

- **Record** an ongoing chat. Every new message is auto-captured while recording is on.
- **Snapshot (temp)** — grab the current chat into a single temporary slot (overwritten by the next snapshot). Good for quick "hold this for a minute" saves.
- **Save (permanent)** — store the current chat forever in local browser storage.
- **Copy chat + prompt** — copies the transcript to your clipboard, wrapped in a continuation prompt that instructs the next AI to read it, summarize, and pick up where the previous conversation left off.
- **Saved chats list** — browse, filter (temp / permanent), copy, promote temp → permanent, or delete.

All data stays in your browser (`chrome.storage.local`). Nothing is sent anywhere.

## Install (unpacked)

1. Unzip `ai-chat-saver.zip` somewhere permanent.
2. Open `chrome://extensions` in Chrome or any Chromium browser (Edge, Brave, Arc…).
3. Toggle **Developer mode** on (top right).
4. Click **Load unpacked** and pick the `ai-chat-saver` folder.
5. Pin the extension for easy access.

## Use it

1. Open a chat on **chatgpt.com**, **claude.ai**, or **gemini.google.com**.
2. Click the extension icon.
3. Pick one:
   - **Start recording** — captures messages as they arrive; press **Stop** to save as a temp snapshot.
   - **Snapshot (temp)** — one-shot temp save of whatever's on screen right now.
   - **Save (permanent)** — same, but keeps it forever.
   - **Copy chat + prompt** — puts a formatted transcript on your clipboard.
4. Open any new AI chat (same platform or another one) and paste. The receiving AI will read the transcript, summarize, and continue.

## The continuation prompt

When you copy a chat, it's wrapped like this:

```
You are being handed the transcript of a previous AI conversation…
1. Read the entire transcript below carefully.
2. Summarize the key points, decisions, and open threads…
3. Then continue helping the user from where the previous conversation left off.

--- BEGIN PREVIOUS CONVERSATION ---
Source: CHATGPT · <chat title>
Captured: <timestamp>

[USER]
…

[ASSISTANT]
…
--- END PREVIOUS CONVERSATION ---
```

## Files

```
manifest.json    Extension manifest (MV3)
popup.html/css/js   Popup UI and logic
content.js       Scrapes each platform's DOM
background.js    Service worker (cleanup + install seeding)
icons/           16/48/128 px icons
```

## Notes on scraping

Each platform's DOM changes over time. `content.js` has selectors that work as of late 2026:
- **ChatGPT** — `[data-message-author-role]`
- **Claude** — `[data-testid="user-message"]` and `.font-claude-message`
- **Gemini** — `<user-query>` / `<model-response>` web components, with fallback classes

If a platform breaks, the fix lives in the corresponding `scrapeX()` function in `content.js`.
