"use strict";

const STORAGE_KEY = "dexter-ai-conversations-v1";
const SETTINGS_KEY = "dexter-ai-settings-v1";

const state = {
  conversations: [],
  activeId: null,
  mode: "agi",
  model: "",
  generating: false,
  abortController: null,
  online: false,
  publicConfig: null,
  accessKey: sessionStorage.getItem("dexter-beta-access-key") || "",
  voice: {
    supported: "speechSynthesis" in window && "SpeechSynthesisUtterance" in window,
    profile: "meme",
    rate: 0.85,
    pitch: 0.70,
    autoSpeak: false,
    voiceURI: "",
    voices: [],
    speakingMessageId: null,
    generation: 0,
  },
};

const elements = {
  body: document.body,
  sidebar: document.getElementById("sidebar"),
  menuButton: document.getElementById("menuButton"),
  mobileOverlay: document.getElementById("mobileOverlay"),
  newChatButton: document.getElementById("newChatButton"),
  clearHistoryButton: document.getElementById("clearHistoryButton"),
  historyList: document.getElementById("historyList"),
  modeButtons: [...document.querySelectorAll(".mode-button")],
  activeModeLabel: document.getElementById("activeModeLabel"),
  modelSelect: document.getElementById("modelSelect"),
  statusPill: document.getElementById("statusPill"),
  statusText: document.getElementById("statusText"),
  conversationTitle: document.getElementById("conversationTitle"),
  welcomeScreen: document.getElementById("welcomeScreen"),
  messages: document.getElementById("messages"),
  chatStage: document.getElementById("chatStage"),
  messageInput: document.getElementById("messageInput"),
  sendButton: document.getElementById("sendButton"),
  stopButton: document.getElementById("stopButton"),
  suggestionCards: [...document.querySelectorAll(".suggestion-card")],
  toast: document.getElementById("toast"),
  betaModal: document.getElementById("betaModal"),
  accessField: document.getElementById("accessField"),
  accessCodeInput: document.getElementById("accessCodeInput"),
  accessError: document.getElementById("accessError"),
  acceptBetaButton: document.getElementById("acceptBetaButton"),
  voiceToggle: document.getElementById("voiceToggle"),
  voicePanel: document.getElementById("voicePanel"),
  closeVoicePanel: document.getElementById("closeVoicePanel"),
  voiceUnsupported: document.getElementById("voiceUnsupported"),
  voiceControls: document.getElementById("voiceControls"),
  voiceProfile: document.getElementById("voiceProfile"),
  voiceSelect: document.getElementById("voiceSelect"),
  voiceRate: document.getElementById("voiceRate"),
  voiceRateValue: document.getElementById("voiceRateValue"),
  autoSpeak: document.getElementById("autoSpeak"),
  testVoice: document.getElementById("testVoice"),
  stopVoice: document.getElementById("stopVoice"),
  startDexterButton: document.getElementById("startDexterButton"),
  agiModeButton: document.getElementById("agiModeButton"),
  coreModelName: document.getElementById("coreModelName"),
  factCheckStatus: document.getElementById("factCheckStatus"),
  guestAccessStatus: document.getElementById("guestAccessStatus"),
  heroModelName: document.getElementById("heroModelName"),
  heroSystemStatus: document.getElementById("heroSystemStatus"),
};

function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function loadState() {
  try {
    const conversations = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (Array.isArray(conversations)) state.conversations = conversations.slice(0, 30);
  } catch (_) {
    state.conversations = [];
  }

  try {
    const settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    if (["agi", "general", "build", "debug", "linux", "security"].includes(settings.mode)) state.mode = settings.mode;
    if (typeof settings.model === "string") state.model = settings.model;
    if (["meme", "deep", "professional"].includes(settings.voiceProfile)) state.voice.profile = settings.voiceProfile;
    if (Number.isFinite(settings.voiceRate)) state.voice.rate = Math.min(1.35, Math.max(0.65, settings.voiceRate));
    if (Number.isFinite(settings.voicePitch)) state.voice.pitch = Math.min(1.4, Math.max(0.35, settings.voicePitch));
    if (typeof settings.autoSpeak === "boolean") state.voice.autoSpeak = settings.autoSpeak;
    if (typeof settings.voiceURI === "string") state.voice.voiceURI = settings.voiceURI;
  } catch (_) {
    // Use defaults.
  }

  if (state.conversations.length) state.activeId = state.conversations[0].id;
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.conversations.slice(0, 30)));
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    mode: state.mode,
    model: state.model,
    voiceProfile: state.voice.profile,
    voiceRate: state.voice.rate,
    voicePitch: state.voice.pitch,
    autoSpeak: state.voice.autoSpeak,
    voiceURI: state.voice.voiceURI,
  }));
}

function currentConversation() {
  return state.conversations.find((conversation) => conversation.id === state.activeId) || null;
}

function createConversation() {
  const conversation = {
    id: uid(),
    title: "New conversation",
    mode: state.mode,
    model: state.model,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  };
  state.conversations.unshift(conversation);
  state.activeId = conversation.id;
  saveState();
  renderAll();
  closeSidebar();
  elements.messageInput.focus();
  return conversation;
}

function ensureConversation() {
  return currentConversation() || createConversation();
}

function deleteConversation(id) {
  const index = state.conversations.findIndex((conversation) => conversation.id === id);
  if (index < 0) return;
  state.conversations.splice(index, 1);
  if (state.activeId === id) state.activeId = state.conversations[0]?.id || null;
  saveState();
  renderAll();
}

function clearHistory() {
  if (!state.conversations.length) return;
  if (!window.confirm("Clear all Dexter conversation history stored in this browser?")) return;
  state.conversations = [];
  state.activeId = null;
  saveState();
  renderAll();
}

function setMode(mode) {
  const valid = ["agi", "general", "build", "debug", "linux", "security"];
  if (!valid.includes(mode) || state.generating) return;
  state.mode = mode;
  const conversation = currentConversation();
  if (conversation && !conversation.messages.length) conversation.mode = mode;
  saveState();
  renderModes();
}

function modeName(mode) {
  return ({ agi: "Agent Core", general: "General", build: "Build", debug: "Debug", linux: "Linux", security: "Security" })[mode] || "Agent Core";
}

function renderModes() {
  elements.modeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === state.mode);
  });
  elements.activeModeLabel.textContent = `${modeName(state.mode)} mode`;
}

function renderHistory() {
  elements.historyList.replaceChildren();
  if (!state.conversations.length) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = "Your recent conversations will appear here.";
    elements.historyList.append(empty);
    return;
  }

  for (const conversation of state.conversations) {
    const row = document.createElement("div");
    row.className = `history-item${conversation.id === state.activeId ? " active" : ""}`;

    const open = document.createElement("button");
    open.type = "button";
    open.className = "history-title";
    open.textContent = conversation.title || "New conversation";
    open.title = conversation.title || "New conversation";
    open.addEventListener("click", () => {
      if (state.generating) return;
      state.activeId = conversation.id;
      state.mode = conversation.mode || "general";
      if (conversation.model) state.model = conversation.model;
      saveState();
      renderAll();
      closeSidebar();
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "history-delete";
    remove.textContent = "×";
    remove.title = "Delete conversation";
    remove.setAttribute("aria-label", `Delete ${conversation.title || "conversation"}`);
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteConversation(conversation.id);
    });

    row.append(open, remove);
    elements.historyList.append(row);
  }
}

function appendInlineMarkdown(container, text) {
  const tokenPattern = /(`[^`\n]+`|\*\*[^\n]+?\*\*|__[^\n]+?__|\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)|\*([^*\n]+)\*|_([^_\n]+)_)/g;
  let lastIndex = 0;
  let match;

  while ((match = tokenPattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      container.append(document.createTextNode(text.slice(lastIndex, match.index)));
    }

    const token = match[0];
    if (token.startsWith("`") && token.endsWith("`")) {
      const code = document.createElement("code");
      code.className = "inline-code";
      code.textContent = token.slice(1, -1);
      container.append(code);
    } else if ((token.startsWith("**") && token.endsWith("**")) ||
               (token.startsWith("__") && token.endsWith("__"))) {
      const strong = document.createElement("strong");
      appendInlineMarkdown(strong, token.slice(2, -2));
      container.append(strong);
    } else if (match[2] && match[3]) {
      const link = document.createElement("a");
      link.href = match[3];
      link.textContent = match[2];
      link.rel = "noopener noreferrer";
      if (match[3].startsWith("http")) link.target = "_blank";
      container.append(link);
    } else if ((token.startsWith("*") && token.endsWith("*")) ||
               (token.startsWith("_") && token.endsWith("_"))) {
      const emphasis = document.createElement("em");
      appendInlineMarkdown(emphasis, token.slice(1, -1));
      container.append(emphasis);
    } else {
      container.append(document.createTextNode(token));
    }

    lastIndex = tokenPattern.lastIndex;
  }

  if (lastIndex < text.length) {
    container.append(document.createTextNode(text.slice(lastIndex)));
  }
}

function renderCodeBlock(container, language, code) {
  const wrapper = document.createElement("div");
  wrapper.className = "code-block";

  const header = document.createElement("div");
  header.className = "code-header";

  const label = document.createElement("span");
  label.textContent = language || "code";

  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "code-copy";
  copy.textContent = "Copy";
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(code.replace(/\n$/, ""));
      copy.textContent = "Copied";
    } catch {
      copy.textContent = "Copy failed";
    }
    setTimeout(() => { copy.textContent = "Copy"; }, 1200);
  });

  const pre = document.createElement("pre");
  const codeElement = document.createElement("code");
  codeElement.textContent = code.replace(/^\n|\n$/g, "");
  pre.append(codeElement);
  header.append(label, copy);
  wrapper.append(header, pre);
  container.append(wrapper);
}

function isMarkdownBlockStart(line) {
  return /^\s*```/.test(line) ||
    /^\s*#{1,6}\s+/.test(line) ||
    /^\s*([-+*])\s+/.test(line) ||
    /^\s*\d+[.)]\s+/.test(line) ||
    /^\s*>\s?/.test(line) ||
    /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line);
}

function renderRichText(container, content) {
  container.replaceChildren();
  const lines = String(content || "").replace(/\r\n?/g, "\n").split("\n");
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^\s*```\s*([^\s`]*)?.*$/);
    if (fence) {
      const language = (fence[1] || "code").trim() || "code";
      const codeLines = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      renderCodeBlock(container, language, codeLines.join("\n"));
      continue;
    }

    const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const level = Math.min(6, heading[1].length);
      const element = document.createElement(`h${level}`);
      appendInlineMarkdown(element, heading[2]);
      container.append(element);
      index += 1;
      continue;
    }

    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      container.append(document.createElement("hr"));
      index += 1;
      continue;
    }

    const unordered = line.match(/^\s*[-+*]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      const list = document.createElement(unordered ? "ul" : "ol");
      const itemPattern = unordered ? /^\s*[-+*]\s+(.+)$/ : /^\s*\d+[.)]\s+(.+)$/;

      while (index < lines.length) {
        const itemMatch = lines[index].match(itemPattern);
        if (!itemMatch) break;
        const item = document.createElement("li");
        appendInlineMarkdown(item, itemMatch[1]);
        list.append(item);
        index += 1;
      }
      container.append(list);
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quote = document.createElement("blockquote");
      const quoteLines = [];
      while (index < lines.length) {
        const quoteMatch = lines[index].match(/^\s*>\s?(.*)$/);
        if (!quoteMatch) break;
        quoteLines.push(quoteMatch[1]);
        index += 1;
      }
      quoteLines.forEach((quoteLine, quoteIndex) => {
        appendInlineMarkdown(quote, quoteLine);
        if (quoteIndex < quoteLines.length - 1) quote.append(document.createElement("br"));
      });
      container.append(quote);
      continue;
    }

    const paragraphLines = [];
    while (index < lines.length && lines[index].trim() && !isMarkdownBlockStart(lines[index])) {
      paragraphLines.push(lines[index]);
      index += 1;
    }

    if (!paragraphLines.length) {
      paragraphLines.push(line);
      index += 1;
    }

    const paragraph = document.createElement("p");
    paragraphLines.forEach((paragraphLine, paragraphIndex) => {
      appendInlineMarkdown(paragraph, paragraphLine);
      if (paragraphIndex < paragraphLines.length - 1) paragraph.append(document.createElement("br"));
    });
    container.append(paragraph);
  }
}


const VOICE_PROFILES = {
  meme: { rate: 0.85, pitch: 0.70 },
  deep: { rate: 0.76, pitch: 0.50 },
  professional: { rate: 1.0, pitch: 1.0 },
};

function openVoicePanel() {
  elements.voicePanel.classList.remove("hidden");
  elements.voiceToggle.setAttribute("aria-expanded", "true");
}

function closeVoicePanel() {
  elements.voicePanel.classList.add("hidden");
  elements.voiceToggle.setAttribute("aria-expanded", "false");
}

function updateVoiceControls() {
  elements.voiceUnsupported.classList.toggle("hidden", state.voice.supported);
  elements.voiceControls.classList.toggle("hidden", !state.voice.supported);
  elements.voiceToggle.disabled = !state.voice.supported;
  elements.voiceProfile.value = state.voice.profile;
  elements.voiceRate.value = String(state.voice.rate);
  elements.voiceRateValue.textContent = `${state.voice.rate.toFixed(2)}×`;
  elements.autoSpeak.checked = state.voice.autoSpeak;
  if ([...elements.voiceSelect.options].some((option) => option.value === state.voice.voiceURI)) {
    elements.voiceSelect.value = state.voice.voiceURI;
  }
}

function voiceScore(voice) {
  let score = 0;
  const lang = String(voice.lang || "").toLowerCase();
  const name = String(voice.name || "").toLowerCase();
  if (lang.startsWith("en-au")) score += 60;
  else if (lang.startsWith("en-gb")) score += 50;
  else if (lang.startsWith("en-us")) score += 45;
  else if (lang.startsWith("en")) score += 35;
  if (/male|daniel|david|james|gordon|aaron|alex/.test(name)) score += 12;
  if (voice.localService) score += 5;
  if (voice.default) score += 3;
  return score;
}

function populateVoices() {
  if (!state.voice.supported) return;
  const voices = window.speechSynthesis.getVoices().slice().sort((a, b) => {
    const languageOrder = String(a.lang).localeCompare(String(b.lang));
    return languageOrder || String(a.name).localeCompare(String(b.name));
  });
  state.voice.voices = voices;
  const previous = state.voice.voiceURI;
  elements.voiceSelect.replaceChildren();
  const automatic = document.createElement("option");
  automatic.value = "";
  automatic.textContent = "Automatic (recommended)";
  elements.voiceSelect.append(automatic);
  for (const voice of voices) {
    const option = document.createElement("option");
    option.value = voice.voiceURI;
    option.textContent = `${voice.name} — ${voice.lang}${voice.localService ? " · device" : ""}`;
    elements.voiceSelect.append(option);
  }
  if (previous && voices.some((voice) => voice.voiceURI === previous)) {
    elements.voiceSelect.value = previous;
  }
}

function selectedSpeechVoice() {
  if (state.voice.voiceURI) {
    const selected = state.voice.voices.find((voice) => voice.voiceURI === state.voice.voiceURI);
    if (selected) return selected;
  }
  return state.voice.voices
    .filter((voice) => String(voice.lang || "").toLowerCase().startsWith("en"))
    .sort((a, b) => voiceScore(b) - voiceScore(a))[0] || state.voice.voices[0] || null;
}

function speechText(content) {
  return String(content || "")
    .replace(/```[\s\S]*?```/g, " Code block omitted. ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\((?:https?:\/\/|mailto:)[^)]+\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-+*]|\d+[.)])\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/[*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 12000);
}

function splitSpeech(text, limit = 220) {
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
  const chunks = [];
  let current = "";
  for (const sentence of sentences) {
    const part = sentence.trim();
    if (!part) continue;
    if ((current + " " + part).trim().length <= limit) {
      current = `${current} ${part}`.trim();
      continue;
    }
    if (current) chunks.push(current);
    if (part.length <= limit) {
      current = part;
    } else {
      const words = part.split(/\s+/);
      current = "";
      for (const word of words) {
        if ((current + " " + word).trim().length > limit) {
          if (current) chunks.push(current);
          current = word;
        } else {
          current = `${current} ${word}`.trim();
        }
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function updateSpeakingButtons() {
  document.querySelectorAll(".speak-message").forEach((button) => {
    const active = button.dataset.messageId === state.voice.speakingMessageId;
    button.classList.toggle("speaking", active);
    button.textContent = active ? "Stop voice" : "Read aloud";
    button.setAttribute("aria-label", active ? "Stop reading this reply" : "Read this Dexter reply aloud");
  });
  elements.stopVoice.disabled = !state.voice.speakingMessageId;
  elements.voiceToggle.classList.toggle("speaking", Boolean(state.voice.speakingMessageId));
}

function stopSpeech() {
  if (!state.voice.supported) return;
  state.voice.generation += 1;
  window.speechSynthesis.cancel();
  state.voice.speakingMessageId = null;
  updateSpeakingButtons();
}

function speakContent(content, messageId = "voice-test") {
  if (!state.voice.supported) {
    showToast("Speech is not supported in this browser.");
    return;
  }
  const text = speechText(content);
  if (!text) {
    showToast("There is no readable text in this reply.");
    return;
  }

  stopSpeech();
  const generation = ++state.voice.generation;
  const chunks = splitSpeech(text);
  const voice = selectedSpeechVoice();
  state.voice.speakingMessageId = messageId;
  updateSpeakingButtons();

  const speakNext = (index) => {
    if (generation !== state.voice.generation || index >= chunks.length) {
      if (generation === state.voice.generation) {
        state.voice.speakingMessageId = null;
        updateSpeakingButtons();
      }
      return;
    }
    const utterance = new SpeechSynthesisUtterance(chunks[index]);
    utterance.rate = state.voice.rate;
    utterance.pitch = state.voice.pitch;
    utterance.volume = 1;
    if (voice) utterance.voice = voice;
    utterance.onend = () => speakNext(index + 1);
    utterance.onerror = (event) => {
      if (generation !== state.voice.generation || event.error === "interrupted" || event.error === "canceled") return;
      state.voice.speakingMessageId = null;
      updateSpeakingButtons();
      showToast("The browser voice stopped unexpectedly.");
    };
    window.speechSynthesis.speak(utterance);
  };

  speakNext(0);
}

function toggleMessageSpeech(message) {
  if (state.voice.speakingMessageId === message.id) {
    stopSpeech();
  } else {
    speakContent(message.content, message.id);
  }
}

function applyVoiceProfile(profile) {
  const preset = VOICE_PROFILES[profile] || VOICE_PROFILES.meme;
  state.voice.profile = profile in VOICE_PROFILES ? profile : "meme";
  state.voice.rate = preset.rate;
  state.voice.pitch = preset.pitch;
  saveState();
  updateVoiceControls();
}

function initializeVoice() {
  updateVoiceControls();
  if (!state.voice.supported) return;
  populateVoices();
  window.speechSynthesis.addEventListener?.("voiceschanged", populateVoices);
  window.addEventListener("beforeunload", stopSpeech);
}

function createMessageElement(message, streaming = false) {
  const article = document.createElement("article");
  article.className = `message ${message.role}`;
  article.dataset.messageId = message.id;

  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.textContent = message.role === "assistant" ? "D" : "YOU";

  const copy = document.createElement("div");
  copy.className = "message-copy";

  const head = document.createElement("div");
  head.className = "message-head";
  const author = document.createElement("strong");
  author.textContent = message.role === "assistant" ? "Dexter" : "You";
  const detail = document.createElement("span");
  if (message.role === "assistant") {
    const labels = [message.mode === "agi" ? "Agent Core" : (message.model || modeName(message.mode || state.mode))];
    if (message.webVerified) {
      labels.push(message.sourceCount ? `${message.sourceCount} sources checked` : "web verified");
    } else if (message.factChecked) {
      labels.push("verification unavailable");
    }
    if (message.deepThinking) labels.push("deep reasoning");
    if (message.agentValidated) labels.push("validated");
    detail.textContent = labels.filter(Boolean).join(" · ");
  } else {
    detail.textContent = "";
  }
  head.append(author, detail);

  const body = document.createElement("div");
  body.className = "message-body";
  renderRichText(body, message.content || "");
  if (streaming) {
    const cursor = document.createElement("span");
    cursor.className = "cursor";
    cursor.setAttribute("aria-hidden", "true");
    body.append(cursor);
  }

  if (message.error) {
    const error = document.createElement("div");
    error.className = "message-error";
    error.textContent = message.error;
    body.append(error);
  }

  const tools = document.createElement("div");
  tools.className = "message-tools";
  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "message-tool";
  copyButton.textContent = "Copy";
  copyButton.addEventListener("click", async () => {
    await navigator.clipboard.writeText(message.content || "");
    showToast("Message copied");
  });
  tools.append(copyButton);

  if (message.role === "assistant") {
    const speakButton = document.createElement("button");
    speakButton.type = "button";
    speakButton.className = "message-tool speak-message";
    speakButton.dataset.messageId = message.id;
    speakButton.textContent = state.voice.speakingMessageId === message.id ? "Stop voice" : "Read aloud";
    speakButton.disabled = streaming || !state.voice.supported;
    speakButton.classList.toggle("hidden", !state.voice.supported);
    speakButton.addEventListener("click", () => toggleMessageSpeech(message));
    tools.append(speakButton);

    const exportButton = document.createElement("button");
    exportButton.type = "button";
    exportButton.className = "message-tool export-project";
    exportButton.textContent = "Export ZIP";
    exportButton.classList.toggle("hidden", streaming || !String(message.content || "").includes("```"));
    exportButton.addEventListener("click", () => exportProject(message, exportButton));
    tools.append(exportButton);
  }

  copy.append(head, body, tools);
  article.append(avatar, copy);
  return article;
}

function renderConversation() {
  const conversation = currentConversation();
  const hasMessages = Boolean(conversation?.messages?.length);
  elements.welcomeScreen.classList.toggle("hidden", hasMessages);
  elements.messages.classList.toggle("active", hasMessages);
  elements.messages.replaceChildren();

  elements.conversationTitle.textContent = conversation?.title || "New conversation";
  if (!hasMessages) return;

  for (const message of conversation.messages) {
    elements.messages.append(createMessageElement(message, false));
  }
  requestAnimationFrame(scrollToBottom);
}

function renderAll() {
  renderModes();
  renderHistory();
  renderConversation();
  if (state.model && [...elements.modelSelect.options].some((option) => option.value === state.model)) {
    elements.modelSelect.value = state.model;
  }
}

function setStatus(status, text) {
  elements.statusPill.dataset.state = status;
  elements.statusText.textContent = text;
  if (elements.heroSystemStatus) {
    elements.heroSystemStatus.textContent = text;
    elements.heroSystemStatus.dataset.state = status;
  }
}

async function loadPublicConfig() {
  try {
    const response = await fetch("/api/config", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "Could not load Dexter configuration.");
    state.publicConfig = data;
    if (elements.factCheckStatus) elements.factCheckStatus.textContent = data.fact_check_enabled ? "Source checks on" : "Source checks off";
    if (elements.guestAccessStatus) elements.guestAccessStatus.textContent = data.no_account_required ? "No account required" : "Access code enabled";
    if (elements.coreModelName) elements.coreModelName.textContent = data.smart_model || "Local Ollama model";
    if (elements.heroModelName) elements.heroModelName.textContent = data.smart_model || "Local model";

    const accepted = localStorage.getItem("dexter-public-beta-accepted-v1") === "yes";
    const needsAccess = Boolean(data.access_required && !state.accessKey);
    if (data.public_beta && (!accepted || needsAccess)) {
      elements.betaModal.classList.remove("hidden");
      elements.accessField.classList.toggle("hidden", !data.access_required);
      if (data.access_required) elements.accessCodeInput.focus();
    }
    if (!data.chat_enabled) showToast("Dexter public chat is temporarily paused.");
  } catch (error) {
    showToast(error.message || "Could not load public beta settings.");
  }
}

async function acceptPublicBeta() {
  elements.accessError.classList.add("hidden");
  elements.accessError.textContent = "";
  const accessRequired = Boolean(state.publicConfig?.access_required);
  const candidate = accessRequired ? elements.accessCodeInput.value.trim() : "";

  if (accessRequired && !candidate) {
    elements.accessError.textContent = "Enter the beta access code.";
    elements.accessError.classList.remove("hidden");
    return;
  }

  if (accessRequired) {
    elements.acceptBetaButton.disabled = true;
    try {
      const response = await fetch("/api/access", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Dexter-Access-Key": candidate },
        body: "{}",
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Access code rejected.");
      state.accessKey = candidate;
      sessionStorage.setItem("dexter-beta-access-key", candidate);
    } catch (error) {
      elements.accessError.textContent = error.message || "Access code rejected.";
      elements.accessError.classList.remove("hidden");
      return;
    } finally {
      elements.acceptBetaButton.disabled = false;
    }
  }

  localStorage.setItem("dexter-public-beta-accepted-v1", "yes");
  elements.betaModal.classList.add("hidden");
  elements.messageInput.focus();
}

async function checkHealth() {
  setStatus("checking", "Checking Ollama");
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "Ollama is offline");

    state.online = true;
    setStatus("online", "Dexter online");
    const models = Array.isArray(data.models) ? data.models : [];
    const preferred = state.model && models.includes(state.model) ? state.model : data.default_model;
    elements.modelSelect.replaceChildren();
    for (const model of models) {
      const option = document.createElement("option");
      option.value = model;
      option.textContent = model;
      elements.modelSelect.append(option);
    }
    if (preferred) {
      elements.modelSelect.value = preferred;
      state.model = preferred;
    }
    saveState();
  } catch (error) {
    state.online = false;
    setStatus("offline", "Ollama offline");
    showToast(error.message || "Dexter cannot reach Ollama");
  }
}

function autoResize() {
  elements.messageInput.style.height = "auto";
  elements.messageInput.style.height = `${Math.min(elements.messageInput.scrollHeight, 180)}px`;
}

function scrollToBottom() {
  elements.chatStage.scrollTop = elements.chatStage.scrollHeight;
}

function titleFromMessage(text) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned.length > 46 ? `${cleaned.slice(0, 46).trim()}…` : cleaned || "New conversation";
}

function setGenerating(generating) {
  state.generating = generating;
  elements.body.classList.toggle("generating", generating);
  elements.sendButton.classList.toggle("hidden", generating);
  elements.stopButton.classList.toggle("hidden", !generating);
  elements.messageInput.disabled = generating;
  elements.modelSelect.disabled = generating;
  elements.modeButtons.forEach((button) => { button.disabled = generating; });
  if (generating) setStatus("working", "Dexter thinking");
  else setStatus(state.online ? "online" : "offline", state.online ? "Dexter online" : "Ollama offline");
}

function updateStreamingMessage(message, element, streaming = true) {
  const body = element.querySelector(".message-body");
  const detail = element.querySelector(".message-head span");
  if (detail) {
    const labels = [message.mode === "agi" ? "Agent Core" : (message.model || modeName(message.mode || state.mode))];
    if (message.webVerified) {
      labels.push(message.sourceCount ? `${message.sourceCount} sources checked` : "web verified");
    } else if (message.factChecked) {
      labels.push("verification unavailable");
    }
    if (message.deepThinking) labels.push("deep reasoning");
    if (message.agentValidated) labels.push("validated");
    detail.textContent = labels.filter(Boolean).join(" · ");
  }
  renderRichText(body, message.content || "");
  if (streaming) {
    const cursor = document.createElement("span");
    cursor.className = "cursor";
    body.append(cursor);
  }
  const speakButton = element.querySelector(".speak-message");
  if (speakButton) {
    speakButton.disabled = streaming || !state.voice.supported;
    speakButton.classList.toggle("hidden", !state.voice.supported);
  }
  const exportButton = element.querySelector(".export-project");
  if (exportButton) {
    exportButton.classList.toggle("hidden", streaming || !String(message.content || "").includes("```"));
  }
  if (message.error) {
    const error = document.createElement("div");
    error.className = "message-error";
    error.textContent = message.error;
    body.append(error);
  }
}

async function sendMessage(prefilledText = null) {
  if (state.generating) return;
  const text = (prefilledText ?? elements.messageInput.value).trim();
  if (!text) return;
  if (!state.publicConfig?.chat_enabled) {
    showToast("Dexter public chat is temporarily paused.");
    return;
  }
  if (state.publicConfig?.access_required && !state.accessKey) {
    elements.betaModal.classList.remove("hidden");
    elements.accessField.classList.remove("hidden");
    elements.accessCodeInput.focus();
    return;
  }
  if (!state.online) {
    showToast("Ollama is offline. Start Ollama, then refresh Dexter.");
    return;
  }

  const conversation = ensureConversation();
  conversation.mode = state.mode;
  conversation.model = state.model || elements.modelSelect.value;
  if (!conversation.messages.length) conversation.title = titleFromMessage(text);

  const userMessage = { id: uid(), role: "user", content: text, createdAt: Date.now() };
  const assistantMessage = {
    id: uid(),
    role: "assistant",
    content: "",
    createdAt: Date.now(),
    mode: state.mode,
    model: conversation.model,
  };
  conversation.messages.push(userMessage, assistantMessage);
  conversation.updatedAt = Date.now();
  state.conversations.sort((a, b) => b.updatedAt - a.updatedAt);
  saveState();

  elements.messageInput.value = "";
  autoResize();
  elements.welcomeScreen.classList.add("hidden");
  elements.messages.classList.add("active");
  elements.conversationTitle.textContent = conversation.title;
  elements.messages.append(createMessageElement(userMessage));
  const assistantElement = createMessageElement(assistantMessage, true);
  elements.messages.append(assistantElement);
  renderHistory();
  scrollToBottom();

  setGenerating(true);
  state.abortController = new AbortController();

  const apiMessages = conversation.messages
    .filter((message) => !message.error && message.id !== assistantMessage.id)
    .map(({ role, content }) => ({ role, content }));

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(state.accessKey ? { "X-Dexter-Access-Key": state.accessKey } : {}),
      },
      body: JSON.stringify({
        messages: apiMessages,
        mode: state.mode,
        model: conversation.model,
      }),
      signal: state.abortController.signal,
    });

    if (!response.ok) {
      let detail = `Dexter request failed with HTTP ${response.status}.`;
      try {
        const data = await response.json();
        detail = data.error || detail;
      } catch (_) { /* Keep fallback. */ }
      if (response.status === 401) {
        state.accessKey = "";
        sessionStorage.removeItem("dexter-beta-access-key");
        elements.betaModal.classList.remove("hidden");
        elements.accessField.classList.remove("hidden");
      }
      throw new Error(detail);
    }
    if (!response.body) throw new Error("This browser did not provide a streaming response body.");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        let event;
        try { event = JSON.parse(line); } catch (_) { continue; }

        if (event.type === "meta") {
          assistantMessage.model = event.model || assistantMessage.model;
          assistantMessage.webVerified = Boolean(event.web_verified);
          assistantMessage.factChecked = Boolean(event.fact_checked);
          assistantMessage.sourceCount = Number(event.source_count || 0);
          assistantMessage.deepThinking = Boolean(event.thinking);
          updateStreamingMessage(assistantMessage, assistantElement, true);
        } else if (event.type === "thinking") {
          assistantMessage.deepThinking = true;
          setStatus("working", "Dexter reasoning");
          updateStreamingMessage(assistantMessage, assistantElement, true);
        } else if (event.type === "stage") {
          const stageLabels = {
            planning: "Agent Core: planning",
            executing: "Agent Core: executing",
            verifying: "Agent Core: validating",
            fallback: "Agent Core: standard fallback",
          };
          setStatus("working", event.label || stageLabels[event.stage] || "Dexter working");
          assistantMessage.agentic = event.stage !== "fallback";
          updateStreamingMessage(assistantMessage, assistantElement, true);
        } else if (event.type === "heartbeat") {
          const elapsed = Number(event.elapsed_seconds || 0);
          const suffix = elapsed > 0 ? ` (${elapsed}s)` : "";
          setStatus("working", `${event.label || "Agent Core is still working"}${suffix}`);
        } else if (event.type === "validation") {
          assistantMessage.agentValidated = Boolean(event.ok);
          setStatus("working", event.ok ? "Agent Core: response validated" : "Agent Core: response delivered with warnings");
          updateStreamingMessage(assistantMessage, assistantElement, true);
        } else if (event.type === "token") {
          setStatus("working", "Dexter answering");
          assistantMessage.content += event.content || "";
          updateStreamingMessage(assistantMessage, assistantElement, true);
          scrollToBottom();
        } else if (event.type === "error") {
          throw new Error(event.message || "Dexter encountered an Ollama error.");
        } else if (event.type === "done") {
          assistantMessage.model = event.model || assistantMessage.model;
        }
      }
      if (done) break;
    }

    if (!assistantMessage.content.trim()) {
      assistantMessage.error = "Dexter returned an empty response.";
    }
  } catch (error) {
    if (error.name === "AbortError") {
      if (!assistantMessage.content) assistantMessage.content = "Generation stopped.";
    } else {
      const rawError = error.message || "Dexter could not complete the response.";
      assistantMessage.error = /network|failed to fetch/i.test(rawError)
        ? "The public connection was interrupted. Agent Core now keeps the connection alive; retry this request once."
        : rawError;
      if (!assistantMessage.content) assistantMessage.content = "I could not complete that response.";
      if (/connect|offline|Ollama/i.test(assistantMessage.error)) {
        state.online = false;
      }
    }
  } finally {
    updateStreamingMessage(assistantMessage, assistantElement, false);
    conversation.updatedAt = Date.now();
    saveState();
    setGenerating(false);
    state.abortController = null;
    if (state.voice.autoSpeak && assistantMessage.content.trim() && !assistantMessage.error) {
      speakContent(assistantMessage.content, assistantMessage.id);
    }
    renderHistory();
    scrollToBottom();
    elements.messageInput.disabled = false;
    elements.messageInput.focus();
  }
}

function stopGeneration() {
  state.abortController?.abort();
}


async function exportProject(message, button) {
  if (!message?.content?.includes("```")) {
    showToast("Dexter needs to include code blocks before this can be exported.");
    return;
  }

  const conversation = currentConversation();
  const suggested = (conversation?.title || "dexter-project")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "")
    .slice(0, 64) || "dexter-project";
  const chosen = window.prompt("Name this project ZIP:", suggested);
  if (chosen === null) return;

  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Building ZIP…";

  try {
    const response = await fetch("/api/export-project", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(state.accessKey ? { "X-Dexter-Access-Key": state.accessKey } : {}),
      },
      body: JSON.stringify({
        project_name: chosen.trim() || suggested,
        content: message.content,
      }),
    });

    if (!response.ok) {
      let detail = `Project export failed with HTTP ${response.status}.`;
      try {
        const data = await response.json();
        detail = data.error || detail;
      } catch (_) { /* Keep fallback. */ }
      throw new Error(detail);
    }

    const blob = await response.blob();
    const disposition = response.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename\*?=(?:UTF-8''|["']?)([^"';]+)/i);
    const filename = match ? decodeURIComponent(match[1]) : `${suggested}.zip`;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    showToast("Project ZIP created");
  } catch (error) {
    showToast(error.message || "Dexter could not export that project.");
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => elements.toast.classList.remove("visible"), 2600);
}

function openSidebar() { document.body.classList.add("sidebar-open"); }
function closeSidebar() { document.body.classList.remove("sidebar-open"); }

function bindEvents() {
  elements.startDexterButton?.addEventListener("click", () => {
    elements.messageInput.focus();
    elements.messageInput.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  elements.agiModeButton?.addEventListener("click", () => {
    setMode("agi");
    elements.messageInput.focus();
  });
  elements.newChatButton.addEventListener("click", () => {
    if (!state.generating) createConversation();
  });
  elements.clearHistoryButton.addEventListener("click", clearHistory);
  elements.modeButtons.forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));
  elements.modelSelect.addEventListener("change", () => {
    state.model = elements.modelSelect.value;
    const conversation = currentConversation();
    if (conversation && !conversation.messages.length) conversation.model = state.model;
    saveState();
  });
  elements.sendButton.addEventListener("click", () => sendMessage());
  elements.stopButton.addEventListener("click", stopGeneration);
  elements.messageInput.addEventListener("input", autoResize);
  elements.messageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });
  elements.suggestionCards.forEach((card) => {
    card.addEventListener("click", () => sendMessage(card.dataset.prompt || ""));
  });
  elements.menuButton.addEventListener("click", openSidebar);
  elements.mobileOverlay.addEventListener("click", closeSidebar);
  elements.acceptBetaButton.addEventListener("click", acceptPublicBeta);
  elements.accessCodeInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") acceptPublicBeta();
  });
  elements.voiceToggle.addEventListener("click", () => {
    if (elements.voicePanel.classList.contains("hidden")) openVoicePanel();
    else closeVoicePanel();
  });
  elements.closeVoicePanel.addEventListener("click", closeVoicePanel);
  elements.voiceProfile.addEventListener("change", () => applyVoiceProfile(elements.voiceProfile.value));
  elements.voiceSelect.addEventListener("change", () => {
    state.voice.voiceURI = elements.voiceSelect.value;
    saveState();
  });
  elements.voiceRate.addEventListener("input", () => {
    state.voice.rate = Number(elements.voiceRate.value);
    elements.voiceRateValue.textContent = `${state.voice.rate.toFixed(2)}×`;
    saveState();
  });
  elements.autoSpeak.addEventListener("change", () => {
    state.voice.autoSpeak = elements.autoSpeak.checked;
    saveState();
    showToast(state.voice.autoSpeak ? "Automatic voice enabled" : "Automatic voice disabled");
  });
  elements.testVoice.addEventListener("click", () => {
    speakContent("Dexter meme voice online. Locally powered, intelligent, and independent. The world is yours.", "voice-test");
  });
  elements.stopVoice.addEventListener("click", stopSpeech);
  document.addEventListener("click", (event) => {
    if (elements.voicePanel.classList.contains("hidden")) return;
    if (elements.voicePanel.contains(event.target) || elements.voiceToggle.contains(event.target)) return;
    closeVoicePanel();
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (!elements.voicePanel.classList.contains("hidden")) closeVoicePanel();
      else if (state.generating) stopGeneration();
      else closeSidebar();
    }
  });
}

async function initializeDexter() {
  loadState();
  bindEvents();
  initializeVoice();
  renderAll();
  autoResize();
  await loadPublicConfig();
  checkHealth();
  setInterval(() => {
    if (!state.generating) checkHealth();
  }, 30000);
}

initializeDexter();


// Dexter v2 media honesty helper
function dexterMediaComingSoonMessage(kind) {
  const label = kind || "media";
  return `Dexter ${label} generation is coming soon. Real ${label} generation is not connected yet. I can help write a strong prompt instead.`;
}



// === Dexter Real Image Generation UI ===
async function dexterGenerateRealImage() {
  const promptEl = document.getElementById("dexterImagePrompt");
  const statusEl = document.getElementById("dexterImageStatus");
  const resultEl = document.getElementById("dexterImageResult");
  const btn = document.getElementById("dexterGenerateImageBtn");

  if (!promptEl || !statusEl || !resultEl || !btn) return;

  const prompt = promptEl.value.trim();
  if (!prompt) {
    statusEl.textContent = "Please enter an image prompt.";
    return;
  }

  statusEl.textContent = "Dexter is creating your image...";
  resultEl.innerHTML = "";
  btn.disabled = true;

  try {
    const res = await fetch("/api/generate-image", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({prompt})
    });

    const data = await res.json();

    if (!res.ok || !data.ok) {
      throw new Error(data.error || "Image generation failed.");
    }

    resultEl.innerHTML = `
      <div class="dexter-generated-image-wrap">
        <img src="${data.image_url}" alt="Dexter generated image" class="dexter-generated-image">
        <a href="${data.image_url}" download class="dexter-download-btn">Download Image</a>
      </div>
    `;

    statusEl.textContent = "Image created successfully.";
  } catch (err) {
    statusEl.textContent = err.message || "Something went wrong.";
  } finally {
    btn.disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", function () {
  const btn = document.getElementById("dexterGenerateImageBtn");
  if (btn) btn.addEventListener("click", dexterGenerateRealImage);
});
// === End Dexter Real Image Generation UI ===
