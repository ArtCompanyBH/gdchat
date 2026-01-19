
// ========== Configuration ==========
const configuracoesAcesso = (function () {
  const partes = ["AIzaSyAF", "AuWmUJ6c", "6opWGOPj", "8nMLdYha", "lmWxA-8"];
  return partes.join("");
})();

const MODELOS_DISPONIVEIS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-3-flash-preview",
];

function escolherModeloAleatorio() {
  const indice = Math.floor(Math.random() * MODELOS_DISPONIVEIS.length);
  return MODELOS_DISPONIVEIS[indice];
}

// ========== DOM Elements ==========
const chatOutput = document.getElementById("chat-output");
const textInput = document.getElementById("text-input");
const sendButton = document.getElementById("send-button");
const clearButton = document.getElementById("clear-button");
const saveButton = document.getElementById("save-button");
const quickRepliesContainer = document.getElementById("quick-replies");
const botStatusEl = document.getElementById("bot-status");

// Se algum ID estiver errado, evita quebrar tudo
if (!chatOutput || !textInput || !sendButton || !clearButton || !saveButton || !quickRepliesContainer) {
  console.error("GDCHAT: Falta algum elemento no HTML. Verifique os IDs: chat-output, text-input, send-button, clear-button, save-button, quick-replies.");
} else {

  // ========== Cache / State ==========
  const CACHE_KEY_HISTORY = "gdchat_history";
  const CACHE_KEY_LAST_SEND = "gdchat_last_send_time";

  const MAX_CACHE_MESSAGES = 250;
  const RATE_LIMIT_MS = 15000;

  const SCROLL_BOTTOM_THRESHOLD = 120;
  const SCROLL_UP_THRESHOLD = 200;

  let chatHistory = JSON.parse(localStorage.getItem(CACHE_KEY_HISTORY)) || [];
  let lastMessageTime = Number(localStorage.getItem(CACHE_KEY_LAST_SEND)) || 0;

  let userScrolledUp = false;
  let lastScrollPosition = 0;
  let scrollListenerBound = false;
  let isSending = false;

  // ========== Quick replies ==========
  const quickReplies = [
    "Corrigir textos gramaticalmente e retornar apenas o texto pronto: ",
    "Em que você pode me ajudar?",
  ];

  // ========== Helpers ==========
  function normalizeText(value) {
    return String(value ?? "");
  }

  function formatGeminiResponse(text) {
    return normalizeText(text)
      .replace(/^\s*[-•]\s+/gm, "• ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function saveChatToCache() {
    if (chatHistory.length > MAX_CACHE_MESSAGES) {
      chatHistory = chatHistory.slice(chatHistory.length - MAX_CACHE_MESSAGES);
    }
    localStorage.setItem(CACHE_KEY_HISTORY, JSON.stringify(chatHistory));
  }

  function setLastSendTime(ts) {
    lastMessageTime = ts;
    localStorage.setItem(CACHE_KEY_LAST_SEND, String(ts));
  }

  function setBusyUI(isBusy) {
    isSending = isBusy;
    sendButton.disabled = isBusy;
    clearButton.disabled = isBusy;
    saveButton.disabled = isBusy;

    if (botStatusEl) {
      botStatusEl.style.opacity = isBusy ? "0.85" : "1";
      const label = botStatusEl.querySelector("span:last-child");
      if (label) label.textContent = isBusy ? "GDCHAT Processando..." : "GDCHAT Online";
    }
  }

  // ========== Clipboard ==========
  async function copyToClipboard(text) {
    const t = normalizeText(text);

    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(t);
      return true;
    }

    const ta = document.createElement("textarea");
    ta.value = t;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();

    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (_) {
      ok = false;
    } finally {
      document.body.removeChild(ta);
    }
    return ok;
  }

  // ========== Scroll ==========
  function smartScroll(forceScroll = false) {
    const isNearBottom =
      chatOutput.scrollHeight - chatOutput.scrollTop - chatOutput.clientHeight < SCROLL_BOTTOM_THRESHOLD;

    if (forceScroll || !userScrolledUp || isNearBottom) {
      chatOutput.scrollTop = chatOutput.scrollHeight;
      userScrolledUp = false;
    }
  }

  function bindScrollListenerOnce() {
    if (scrollListenerBound) return;

    chatOutput.addEventListener("scroll", () => {
      const currentScroll = chatOutput.scrollTop;

      if (
        currentScroll < lastScrollPosition &&
        currentScroll < chatOutput.scrollHeight - chatOutput.clientHeight - SCROLL_UP_THRESHOLD
      ) {
        userScrolledUp = true;
      }
      lastScrollPosition = currentScroll;
    });

    scrollListenerBound = true;
  }

  // ========== Typing Indicator ==========
  function showTyping() {
    const existing = document.getElementById("typing-indicator");
    if (existing) return;

    const div = document.createElement("div");
    div.className = "typing-indicator";
    div.id = "typing-indicator";
    div.textContent = "Carregando resposta";
    chatOutput.appendChild(div);
    smartScroll(true);
  }

  function hideTyping() {
    const existing = document.getElementById("typing-indicator");
    if (existing && existing.parentNode === chatOutput) {
      chatOutput.removeChild(existing);
    }
  }

  // ========== Rendering ==========
  function appendTimestamp(container) {
    const timestamp = new Date().toLocaleTimeString();
    const timeSpan = document.createElement("div");
    timeSpan.className = "timestamp";
    timeSpan.textContent = timestamp;
    container.appendChild(timeSpan);
  }

  function addSystemMessage(content) {
    hideTyping();
    const div = document.createElement("div");
    div.className = "system-message";
    div.textContent = normalizeText(content);
    chatOutput.appendChild(div);
    smartScroll();
  }

  function createCopyButton(botText) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Copiar";
    btn.title = "Copiar resposta";

    // estilo inline leve (não mexe no seu CSS)
    btn.style.marginTop = "8px";
    btn.style.padding = "4px 10px";
    btn.style.fontSize = "12px";
    btn.style.borderRadius = "6px";
    btn.style.backgroundColor = "#e0e0e0";
    btn.style.color = "#333";
    btn.style.border = "none";
    btn.style.cursor = "pointer";
    btn.style.width = "fit-content";

    btn.addEventListener("click", async () => {
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Copiando...";

      try {
        const ok = await copyToClipboard(botText);
        btn.textContent = ok ? "Copiado!" : "Falhou";
      } catch (_) {
        btn.textContent = "Falhou";
      }

      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = original;
      }, 1200);
    });

    return btn;
  }

  function addMessage(role, content) {
    hideTyping();

    const div = document.createElement("div");
    div.className = role === "user" ? "user-message" : "bot-message";

    const formatted = formatGeminiResponse(content);
    const rolePrefix = role === "user" ? "👤 Você: " : "🤖 GDCHAT: ";
    div.style.whiteSpace = "pre-wrap";
    div.textContent = rolePrefix + formatted;

    appendTimestamp(div);

    if (role === "bot") {
      div.appendChild(createCopyButton(formatted));
    }

    chatOutput.appendChild(div);

    if (role === "bot") smartScroll(true);
    else smartScroll();

    chatHistory.push({ role, content: normalizeText(content) });
    saveChatToCache();
  }

  // ========== Init ==========
  function initQuickReplies() {
    quickRepliesContainer.innerHTML = "";
    quickReplies.forEach((reply) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = reply;
      btn.addEventListener("click", () => {
        textInput.value = reply;
        textInput.focus();
      });
      quickRepliesContainer.appendChild(btn);
    });
  }

  function renderHistory() {
    chatOutput.innerHTML = "";

    if (chatHistory.length === 0) {
      addSystemMessage("=== Bem-vindo ao GDCHAT ===");
      addSystemMessage("Comandos especiais:");
      addSystemMessage("- 'sair', 'fim' ou 'exit' para encerrar");
      addSystemMessage("- Use 'Limpar' para reiniciar a conversa");
      addSystemMessage("- 'Salvar' guarda o histórico no arquivo");
      addSystemMessage("- Digite /ajuda para ver comandos extras");
      return;
    }

    chatHistory.forEach((msg) => {
      const div = document.createElement("div");
      div.className = msg.role === "user" ? "user-message" : "bot-message";
      div.style.whiteSpace = "pre-wrap";

      const formatted = formatGeminiResponse(msg.content);
      const prefix = msg.role === "user" ? "👤 Você: " : "🤖 GDCHAT: ";
      div.textContent = prefix + formatted;

      appendTimestamp(div);
      if (msg.role === "bot") div.appendChild(createCopyButton(formatted));
      chatOutput.appendChild(div);
    });

    smartScroll(true);
  }

  function initChat() {
    renderHistory();
    initQuickReplies();
    bindScrollListenerOnce();
    setBusyUI(false);
    textInput.focus();
  }

  // ========== Commands ==========
  function showHelp() {
    addSystemMessage("📋 Comandos disponíveis:");
    addSystemMessage("/limpar - Reinicia a conversa");
    addSystemMessage("/exportar - Salva o histórico");
    addSystemMessage("/ajuda - Mostra esta mensagem");
  }

  function clearChat() {
    if (isSending) return;
    if (!confirm("Tem certeza que deseja limpar todo o histórico?")) return;

    chatHistory = [];
    localStorage.removeItem(CACHE_KEY_HISTORY);

    chatOutput.innerHTML = "";
    userScrolledUp = false;
    lastScrollPosition = 0;

    addSystemMessage("> Histórico limpo. Conversa reiniciada.");
    addSystemMessage("Dica: digite /ajuda para ver comandos extras.");
  }

  function saveChatHistory() {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `chat_history_${timestamp}.txt`;
      let content = "";

      chatHistory.forEach((message) => {
        const role = message.role === "user" ? "Você" : "GDCHAT";
        content += `${role}: ${message.content}\n\n`;
      });

      const blob = new Blob([content], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      addSystemMessage(`✅ Conversa salva como ${filename}`);
      return filename;
    } catch (error) {
      addSystemMessage(`❌ Erro ao salvar: ${error.message}`);
      return null;
    }
  }

  // ========== API Send (somente mensagem atual) ==========
  async function sendMessage(message) {
    const trimmed = normalizeText(message).trim();
    if (!trimmed) return { blocked: true, reason: "empty" };

    const lower = trimmed.toLowerCase();

    if (["sair", "exit", "fim"].includes(lower)) {
      addSystemMessage("> Chat encerrado. Até mais!");
      return { blocked: true, reason: "exit" };
    }

    if (trimmed.startsWith("/")) {
      switch (lower) {
        case "/ajuda":
          showHelp();
          return { blocked: true, reason: "command" };
        case "/limpar":
          clearChat();
          return { blocked: true, reason: "command" };
        case "/exportar":
          saveChatHistory();
          return { blocked: true, reason: "command" };
        default:
          addSystemMessage("⚠️ Comando não reconhecido. Digite /ajuda.");
          return { blocked: true, reason: "command" };
      }
    }

    if (isSending) {
      addSystemMessage("⚠️ Aguarde a resposta atual antes de enviar outra mensagem.");
      return { blocked: true, reason: "busy" };
    }

    const now = Date.now();
    if (now - lastMessageTime < RATE_LIMIT_MS) {
      addSystemMessage("⚠️ Aguarde 15 segundos entre mensagens");
      return { blocked: true, reason: "rate_limit" };
    }
    setLastSendTime(now);

    addMessage("user", trimmed);
    showTyping();
    setBusyUI(true);

    const modeloAtual = escolherModeloAleatorio();
    console.log(`Usando modelo: ${modeloAtual}`);

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modeloAtual}:generateContent?key=${configuracoesAcesso}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: trimmed }] }],
            generationConfig: {
              temperature: 0.9,
              topK: 1,
              topP: 1,
              maxOutputTokens: 2048,
            },
            safetySettings: [
              { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
              { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
              { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
              { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
            ],
          }),
        }
      );

      let data = null;
      try {
        data = await response.json();
      } catch (_) {}

      if (!response.ok) {
        const apiMsg = data?.error?.message || `API request failed with status ${response.status}`;
        throw new Error(apiMsg);
      }

      const botResponse = data?.candidates?.[0]?.content?.parts?.[0]?.text || "⚠️ Resposta inesperada (sem texto).";

      hideTyping();
      addMessage("bot", botResponse);
      setBusyUI(false);
      return { blocked: false };
    } catch (error) {
      hideTyping();
      addSystemMessage(`❌ Erro: ${error.message}`);
      console.error("Error:", error);
      setBusyUI(false);
      return { blocked: false, error: true };
    }
  }

  // ========== UI Events ==========
  sendButton.addEventListener("click", () => {
    const trimmed = normalizeText(textInput.value).trim();
    if (!trimmed) return;

    textInput.value = "";

    sendMessage(trimmed).then((result) => {
      if (result?.blocked && (result.reason === "rate_limit" || result.reason === "busy")) {
        textInput.value = trimmed;
        textInput.focus();
      }
    });
  });

  textInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendButton.click();
    }
  });

  clearButton.addEventListener("click", clearChat);
  saveButton.addEventListener("click", saveChatHistory);

  // ========== Start ==========
  initChat();
}
