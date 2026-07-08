"use strict";

const STORAGE_KEY = "dexter-ai-conversations-v1";
const SETTINGS_KEY = "dexter-ai-settings-v1";

const state = {
  conversations: [],
  activeId: null,
  mode: "general",
  model: "",
  generating: false,
  abortController: null,
  online: false,
  publicConfig: null,
  accessKey: sessionStorage.getItem("dexter-beta-access-key") || "",
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
    if (typeof settings.mode === "string") state.mode = settings.mode;
    if (typeof settings.model === "string") state.model = settings.model;
  } catch (_) {
    // Use defaults.
  }

  if (state.conversations.length) state.activeId = state.conversations[0].id;
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.conversations.slice(0, 30)));
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ mode: state.mode, model: state.model }));
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
  const valid = ["general", "build", "debug", "linux", "security"];
  if (!valid.includes(mode) || state.generating) return;
  state.mode = mode;
  const conversation = currentConversation();
  if (conversation && !conversation.messages.length) conversation.mode = mode;
  saveState();
  renderModes();
}

function modeName(mode) {
  return ({ general: "General", build: "Build", debug: "Debug", linux: "Linux", security: "Security" })[mode] || "General";
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
  detail.textContent = message.role === "assistant" ? (message.model || modeName(message.mode || state.mode)) : "";
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
}

async function loadPublicConfig() {
  try {
    const response = await fetch("/api/config", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "Could not load Dexter configuration.");
    state.publicConfig = data;

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
  if (detail) detail.textContent = message.model || modeName(message.mode || state.mode);
  renderRichText(body, message.content || "");
  if (streaming) {
    const cursor = document.createElement("span");
    cursor.className = "cursor";
    body.append(cursor);
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
        } else if (event.type === "token") {
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
      assistantMessage.error = error.message || "Dexter could not complete the response.";
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
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (state.generating) stopGeneration();
      else closeSidebar();
    }
  });
}

async function initializeDexter() {
  loadState();
  bindEvents();
  renderAll();
  autoResize();
  await loadPublicConfig();
  checkHealth();
  setInterval(() => {
    if (!state.generating) checkHealth();
  }, 30000);
}

initializeDexter();
