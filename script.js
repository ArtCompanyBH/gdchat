
// ========== Configuration  ==========
const configuracoesAcesso = (function () {
  const partes = ["AIzaSyAF", "AuWmUJ6c", "6opWGOPj", "8nMLdYha", "lmWxA-8"];
  return partes.join("");
})();

// Lista de modelos disponíveis
const MODELOS_DISPONIVEIS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-3-flash-preview",
];

// Função para escolher um modelo aleatório (MANTIDA)
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


// ========== Chat state ==========
const CACHE_KEY_HISTORY = "gdchat_history";
const CACHE_KEY_LAST_SEND = "gdchat_last_send_time";

const MAX_CACHE_MESSAGES = 250; // limita peso do localStorage e performance do DOM
let chatHistory = JSON.parse(localStorage.getItem(CACHE_KEY_HISTORY)) || [];

// rate-limit persistente (ainda é client-side, mas evita bypass por refresh)
let lastMessageTime = Number(localStorage.getItem(CACHE_KEY_LAST_SEND)) || 0;


// ========== Scroll control variables ==========
let userScrolledUp = false;
let lastScrollPosition = 0;
let scrollListenerBound = false;


// ========== Quick replies ==========
const quickReplies = [
  "Corrigir textos gramaticalmente e retornar apenas o texto pronto: ",
  "Em que você pode me ajudar?",
];


// ========== Helpers ==========
function formatGeminiResponse(text) {
  // Mantive uma limpeza leve e útil (sem “comer” todos os asteriscos)
  // - normaliza listas simples
  // - normaliza espaços e quebras
  return String(text || "")
    .replace(/^\s*[-•]\s+/gm, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function saveChatToCache() {
  // limita o cache
  if (chatHistory.length > MAX_CACHE_MESSAGES) {
    chatHistory = chatHistory.slice(chatHistory.length - MAX_CACHE_MESSAGES);
  }
  localStorage.setItem(CACHE_KEY_HISTORY, JSON.stringify(chatHistory));
}

function setLastSendTime(ts) {
  lastMessageTime = ts;
  localStorage.setItem(CACHE_KEY_LAST_SEND, String(ts));
}


// ========== Smart scroll ==========
function smartScroll(forceScroll = false) {
  const chat = chatOutput;
  const isNearBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 100;

  if (forceScroll || !userScrolledUp || isNearBottom) {
    chat.scrollTop = chat.scrollHeight;
    userScrolledUp = false;
  }
}


// ========== Rendering ==========
function createMessageBubble({ role, content, isTyping = false }) {
  const messageDiv = document.createElement("div");
  const timestamp = new Date().toLocaleTimeString();

  if (isTyping) {
    messageDiv.className = "typing-indicator";
    messageDiv.id = "typing-indicator";
    // Use textContent para não quebrar o DOM com qualquer caractere/HTML
    messageDiv.textContent = "Carregando resposta...";
    return messageDiv;
  }

  if (role === "system") {
    messageDiv.className = "system-message";
    messageDiv.textContent = String(content || "");
    return messageDiv;
  }

  messageDiv.className = role === "user" ? "user-message" : "bot-message";

  const rolePrefix = role === "user" ? "👤 Você: " : "🤖 GDCHAT: ";
  const bodyText = rolePrefix + formatGeminiResponse(content);

  // Conteúdo
  const body = document.createElement("div");
  body.className = "message-body";
  body.textContent = bodyText;
  messageDiv.appendChild(body);

  // Timestamp
  const timeSpan = document.createElement("div");
  timeSpan.className = "timestamp";
  timeSpan.textContent = timestamp;
  messageDiv.appendChild(timeSpan);

  return messageDiv;
}

function addMessage(role, content) {
  // Remove typing se existir antes de adicionar mensagem real
  hideTyping();

  const bubble = createMessageBubble({ role, content, isTyping: false });
  chatOutput.appendChild(bubble);

  // Scroll
  if (role === "bot") smartScroll(true);
  else smartScroll();

  // Persistência (não salva system pra não poluir)
  if (role !== "system") {
    chatHistory.push({ role, content: String(content || "") });
    saveChatToCache();
  }
}

function addSystemMessage(content) {
  const bubble = createMessageBubble({ role: "system", content, isTyping: false });
  chatOutput.appendChild(bubble);
  smartScroll();
}


// ========== Typing indicator (dedicado) ==========
function showTyping() {
  const existing = document.getElementById("typing-indicator");
  if (existing) return;

  const bubble = createMessageBubble({ role: "bot", content: "", isTyping: true });
  chatOutput.appendChild(bubble);
  smartScroll(true);
}

function hideTyping() {
  const existing = document.getElementById("typing-indicator");
  if (existing && existing.parentNode === chatOutput) {
    chatOutput.removeChild(existing);
  }
}


// ========== Init ==========
function bindScrollListenerOnce() {
  if (scrollListenerBound) return;

  chatOutput.addEventListener("scroll", () => {
    const currentScroll = chatOutput.scrollTop;

    // Detecta se usuário subiu de forma significativa
    if (
      currentScroll < lastScrollPosition &&
      currentScroll < chatOutput.scrollHeight - chatOutput.clientHeight - 200
    ) {
      userScrolledUp = true;
    }

    lastScrollPosition = currentScroll;
  });

  scrollListenerBound = true;
}

function initQuickReplies() {
  // Evita duplicar botões
  quickRepliesContainer.innerHTML = "";

  quickReplies.forEach((reply) => {
    const btn = document.createElement("button");
    btn.textContent = reply;
    btn.addEventListener("click", () => {
      textInput.value = reply;
      textInput.focus();
    });
    quickRepliesContainer.appendChild(btn);
  });
}

function initChat() {
  chatOutput.innerHTML = "";

  // Boas-vindas corretas: quando não há histórico
  if (chatHistory.length === 0) {
    addSystemMessage("=== Bem-vindo ao GDCHAT ===");
    addSystemMessage("Comandos especiais:");
    addSystemMessage("- 'sair', 'fim' ou 'exit' para encerrar");
    addSystemMessage("- Use 'Limpar' para reiniciar a conversa");
    addSystemMessage("- 'Salvar' guarda o histórico no arquivo");
    addSystemMessage("- Digite /ajuda para ver comandos extras");
  } else {
    chatHistory.forEach((msg) => addMessage(msg.role, msg.content));
  }

  initQuickReplies();
  bindScrollListenerOnce();
}


// ========== Commands ==========
function showHelp() {
  addSystemMessage("📋 Comandos disponíveis:");
  addSystemMessage("/limpar - Reinicia a conversa");
  addSystemMessage("/exportar - Salva o histórico");
  addSystemMessage("/ajuda - Mostra esta mensagem");
}

function clearChat() {
  if (!confirm("Tem certeza que deseja limpar todo o histórico?")) return;

  chatHistory = [];
  localStorage.removeItem(CACHE_KEY_HISTORY);
  chatOutput.innerHTML = "";
  userScrolledUp = false;
  lastScrollPosition = 0;

  addSystemMessage("> Histórico limpo. Conversa reiniciada.");
  // Mostra novamente o bloco de ajuda inicial
  addSystemMessage("Dica: digite /ajuda para ver comandos extras.");
}

function saveChatHistory() {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `chat_history_${timestamp}.txt`;
    let content = "";

    // Export mais limpo: exporta apenas user/bot (system não entra no cache)
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
  const trimmed = String(message || "").trim();
  if (!trimmed) return;

  // Comandos e encerramento (centralizado aqui)
  const lower = trimmed.toLowerCase();

  if (["sair", "exit", "fim"].includes(lower)) {
    addSystemMessage("> Chat encerrado. Até mais!");
    return;
  }

  if (trimmed.startsWith("/")) {
    switch (lower) {
      case "/ajuda":
        showHelp();
        return;
      case "/limpar":
        clearChat();
        return;
      case "/exportar":
        saveChatHistory();
        return;
      default:
        addSystemMessage("⚠️ Comando não reconhecido. Digite /ajuda.");
        return;
    }
  }

  // Rate limit
  const now = Date.now();
  if (now - lastMessageTime < 15000) {
    addSystemMessage("⚠️ Aguarde 15 segundos entre mensagens");
    return;
  }
  setLastSendTime(now);

  // Render no chat
  addMessage("user", trimmed);
  showTyping();

  // Escolhe modelo aleatório 
  const modeloAtual = escolherModeloAleatorio();
  console.log(`Usando modelo: ${modeloAtual}`);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modeloAtual}:generateContent?key=${configuracoesAcesso}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // >>> APENAS a mensagem atual do usuário <<<
          contents: [
            {
              role: "user",
              parts: [{ text: trimmed }],
            },
          ],
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

    // tenta capturar JSON mesmo quando não ok (melhor diagnóstico)
    let data = null;
    try {
      data = await response.json();
    } catch (_) {
      // ignore
    }

    if (!response.ok) {
      const apiMsg =
        data?.error?.message ||
        (typeof data === "string" ? data : null) ||
        `API request failed with status ${response.status}`;
      throw new Error(apiMsg);
    }

    const botResponse =
      data?.candidates?.[0]?.content?.parts?.[0]?.text || "⚠️ Resposta inesperada";

    hideTyping();
    addMessage("bot", botResponse);
  } catch (error) {
    hideTyping();
    addSystemMessage(`❌ Erro: ${error.message}`);
    console.error("Error:", error);
  }
}


// ========== UI Events ==========
sendButton.addEventListener("click", () => {
  const message = textInput.value; // NÃO apaga aqui
  const trimmed = String(message || "").trim();
  if (!trimmed) return;

 
  textInput.value = "";

  
  const before = lastMessageTime;
  sendMessage(trimmed).then(() => {
    
    const lower = trimmed.toLowerCase();
    const isCommand = trimmed.startsWith("/") || ["sair", "exit", "fim"].includes(lower);
    const isProbablyRateLimited = !isCommand && lastMessageTime === before;

    if (isProbablyRateLimited) {
      textInput.value = trimmed;
      textInput.focus();
    }
  });
});

textInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendButton.click();
});

clearButton.addEventListener("click", clearChat);
saveButton.addEventListener("click", saveChatHistory);


// 
document.addEventListener("keydown", function (e) {
  if (
    e.key === "F12" ||
    (e.ctrlKey && e.shiftKey && e.key === "I") ||
    (e.ctrlKey && e.shiftKey && e.key === "J") ||
    (e.ctrlKey && e.key === "u")
  ) {
    e.preventDefault();
    addSystemMessage("🔒 Todos os direitos reservados");
  }
});


// ========== Start ==========
initChat();
