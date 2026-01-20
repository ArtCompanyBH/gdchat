
// Configuration - CHAVE API (uso interno)
const configuracoesAcesso = (function () {
  const partes = ["AIzaSyAF", "AuWmUJ6c", "6opWGOPj", "8nMLdYha", "lmWxA-8"];
  return partes.join("");
})();

// Lista de modelos disponíveis com limites de tokens
const MODELOS_CONFIG = {
  "gemini-2.5-flash": { maxTokens: 8192, priority: 1 },
  "gemini-2.5-flash-lite": { maxTokens: 8192, priority: 1 },
  "gemini-3-flash-preview": { maxTokens: 8192, priority: 1 },
};

const MODELOS_DISPONIVEIS = Object.keys(MODELOS_CONFIG);

// Configurações para correção de textos
const CONFIG_CORRECAO = {
  temperature: 0.2,
  topK: 1,
  topP: 1,
};

// Limites e configurações
const MAX_HISTORY_ITEMS = 100;               // limite de itens guardados localmente
const RATE_LIMIT_MS = 15000;                 // rate limit entre chamadas remotas
const TEXTO_GRANDE_THRESHOLD = 2000;         // chars p/ sugerir modo especial
const MAX_TOKENS_PADRAO = 8192;              // max output tokens quando texto grande
const MAX_USER_INPUT_CHARS = 10000;          // chars do input do usuário
const MAX_API_CONTEXT_CHARS = 24000;         // corte heurístico do histórico (chars)
const MAX_CONTINUE_ATTEMPTS = 2;             // auto-continue quando truncar
const LARGE_TEXT_PART_MAX_CHARS = 3800;      // tamanho de parte p/ correção (heurístico)
const LARGE_TEXT_OVERLAP_CHARS = 250;        // overlap opcional entre partes (correção)

// Controle de uso de modelos para rodízio
let modeloUsageCount = {};
let lastModelUsed = null;

// DOM Elements
const chatOutput = document.getElementById("chat-output");
const textInput = document.getElementById("text-input");
const sendButton = document.getElementById("send-button");
const clearButton = document.getElementById("clear-button");
const saveButton = document.getElementById("save-button");
const quickRepliesContainer = document.getElementById("quick-replies");

// Chat state
// chatHistory = apenas user/bot (para API)
// chatDisplayHistory = tudo (para UI e export)
let chatHistory = [];
let chatDisplayHistory = [];
let lastMessageTime = 0;
let isLoading = false;

// Scroll control variables
let userScrolledUp = false;
let lastScrollPosition = 0;
let scrollTimeout;

// Quick replies
const quickReplies = [
  "Corrigir textos gramaticalmente e retornar apenas o texto pronto: ",
  "Em que você pode me ajudar?",
  "Explique de forma simples: ",
  "Resuma este texto: ",
];

// ============================================
// UTIL: segurança / formatação
// ============================================

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// Markdown ultra básico : aplica APÓS escapeHtml
// Observação: mantém simples para não quebrar textos; evita regex agressivo.
function renderSafeBasicMarkdown(escapedText) {
  let t = escapedText;

  // negrito **texto**
  t = t.replace(/\*\*([^\n*][\s\S]*?[^\n*])\*\*/g, "<strong>$1</strong>");
  // itálico *texto*
  t = t.replace(/\*([^\n*][\s\S]*?[^\n*])\*/g, "<em>$1</em>");

  // listas simples "- item" ou "• item" no início da linha
  t = t.replace(/^\s*[-•]\s+(.*)$/gm, "• $1");

  // quebra de linha: preserva \n
  // (a UI pode estar em CSS com white-space: pre-wrap; se não estiver, usamos <br>)
  t = t.replace(/\n/g, "<br>");

  // colapsar múltiplos <br>
  t = t.replace(/(<br>){3,}/g, "<br><br>");

  return t.trim();
}

function sanitizeInput(text) {
  return String(text || "").trim().slice(0, MAX_USER_INPUT_CHARS);
}

function nowTimeLabel() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// ============================================
// HISTÓRICO: load/save 
// ============================================

function loadChatHistory() {
  try {
    const stored = localStorage.getItem("gdchat_history");
    if (!stored) return { display: [], api: [] };

    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) {
      localStorage.removeItem("gdchat_history");
      return { display: [], api: [] };
    }

    const displayHistory = parsed.slice(-(MAX_HISTORY_ITEMS + 10));
    const apiHistory = displayHistory.filter((m) => m && (m.role === "user" || m.role === "bot")).slice(-MAX_HISTORY_ITEMS);

    return { display: displayHistory, api: apiHistory };
  } catch (e) {
    console.error("Erro ao carregar histórico:", e);
    localStorage.removeItem("gdchat_history");
    return { display: [], api: [] };
  }
}

function saveChatToCache() {
  try {
    const historyToSave = chatDisplayHistory.slice(-(MAX_HISTORY_ITEMS + 10));
    localStorage.setItem("gdchat_history", JSON.stringify(historyToSave));
  } catch (e) {
    console.error("Erro ao salvar histórico:", e);
  }
}

// ============================================
// MODELOS: rodízio
// ============================================

function initModelCountersIfNeeded() {
  if (Object.keys(modeloUsageCount).length === 0) {
    MODELOS_DISPONIVEIS.forEach((modelo) => {
      modeloUsageCount[modelo] = 0;
    });
  }
}

function escolherModeloAleatorio() {
  initModelCountersIfNeeded();

  let availableModels = [...MODELOS_DISPONIVEIS];
  if (lastModelUsed && availableModels.length > 1) {
    availableModels = availableModels.filter((m) => m !== lastModelUsed);
  }

  const indice = Math.floor(Math.random() * availableModels.length);
  const modeloEscolhido = availableModels[indice];

  modeloUsageCount[modeloEscolhido] = (modeloUsageCount[modeloEscolhido] || 0) + 1;
  lastModelUsed = modeloEscolhido;

  console.log(`🎲 Modelo escolhido: ${modeloEscolhido}`);
  console.log(`📊 Estatísticas uso: ${JSON.stringify(modeloUsageCount)}`);

  return modeloEscolhido;
}

// ============================================
// SCROLL / UI
// ============================================

function smartScroll(forceScroll = false) {
  if (!chatOutput) return;

  const isNearBottom = chatOutput.scrollHeight - chatOutput.scrollTop - chatOutput.clientHeight < 100;
  if (forceScroll || !userScrolledUp || isNearBottom) {
    chatOutput.scrollTop = chatOutput.scrollHeight;
    userScrolledUp = false;
  }
}

function showTypingIndicator() {
  if (!chatOutput) return;
  const existing = document.getElementById("typing-indicator");
  if (existing) return;

  const indicator = document.createElement("div");
  indicator.id = "typing-indicator";
  indicator.className = "typing-indicator";
  indicator.textContent = "🤖 GDCHAT está digitando...";

  chatOutput.appendChild(indicator);
  smartScroll();
}

function hideTypingIndicator() {
  const indicator = document.getElementById("typing-indicator");
  if (indicator && chatOutput && indicator.parentNode === chatOutput) {
    chatOutput.removeChild(indicator);
  }
}

// ============================================
// MENSAGENS: render seguro 
// ============================================

// Renderiza um item na UI 
function renderMessageToUI({ role, content, timestampISO, isSystem = false }) {
  if (!chatOutput) return null;

  const messageDiv = document.createElement("div");

  if (role === "system") {
    messageDiv.className = "system-message";
    messageDiv.textContent = content;
  } 
  else if (role === "user") {
    messageDiv.className = "user-message";

    const rolePrefix = "👤 Você: ";
    const safe = renderSafeBasicMarkdown(escapeHtml(content));
    messageDiv.innerHTML = `${escapeHtml(rolePrefix)}${safe}`;
  } 
  else {
    // ===== BOT MESSAGE =====
    messageDiv.className = "bot-message";

    const rolePrefix = "🤖 GDCHAT: ";
    const safe = renderSafeBasicMarkdown(escapeHtml(content));
    messageDiv.innerHTML = `${escapeHtml(rolePrefix)}${safe}`;

    // 🔹 Botão COPIAR
    const copyBtn = document.createElement("button");
    copyBtn.className = "copy-btn";
    copyBtn.innerHTML = '<i class="fas fa-copy"></i>';
    copyBtn.title = "Copiar resposta";

    // Feedback "Copiado!"
    const feedback = document.createElement("span");
    feedback.className = "copy-feedback";
    feedback.textContent = "Copiado!";

    copyBtn.addEventListener("click", async (e) => {
      e.stopPropagation();

      try {
        await navigator.clipboard.writeText(content);
        feedback.style.opacity = "1";

        setTimeout(() => {
          feedback.style.opacity = "0";
        }, 1200);
      } catch (err) {
        console.error("Erro ao copiar:", err);
      }
    });

    messageDiv.appendChild(copyBtn);
    messageDiv.appendChild(feedback);
  }

  // Timestamp (exceto system)
  if (role !== "system") {
    const timeSpan = document.createElement("div");
    timeSpan.className = "timestamp";
    const ts = timestampISO ? new Date(timestampISO) : new Date();
    timeSpan.textContent = ts.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    messageDiv.appendChild(timeSpan);
  }

  hideTypingIndicator();
  chatOutput.appendChild(messageDiv);

  if (role === "bot") smartScroll(true);
  else smartScroll(false);

  return messageDiv;
}


// Adiciona mensagem e salva nos históricos conforme flags
function addMessage(role, content, { saveToApiHistory = true, saveToDisplayHistory = true } = {}) {
  const timestampISO = new Date().toISOString();

  // Render na UI
  renderMessageToUI({ role, content, timestampISO, isSystem: role === "system" });

  // Histórico de display sempre que indicado
  if (saveToDisplayHistory) {
    chatDisplayHistory.push({
      role,
      content,
      timestamp: timestampISO,
      isSystem: role === "system",
    });
    chatDisplayHistory = chatDisplayHistory.slice(-(MAX_HISTORY_ITEMS + 10));
  }

  // Histórico de API apenas user/bot
  if (saveToApiHistory && (role === "user" || role === "bot")) {
    chatHistory.push({ role, content, timestamp: timestampISO });
    chatHistory = chatHistory.slice(-MAX_HISTORY_ITEMS);
  }

  saveChatToCache();
}

function addSystemMessage(content, { saveToDisplayHistory = true } = {}) {
  // system nunca vai pra API
  addMessage("system", content, { saveToApiHistory: false, saveToDisplayHistory });
}

// ============================================
// API: montar histórico com corte por tamanho
// ============================================

function buildApiHistoryTrimmed(extraUserMessage = null) {
  // Monta do fim para o começo, cortando por MAX_API_CONTEXT_CHARS (heurística).
  // Mantém a ordem correta no final.
  const msgs = [...chatHistory];

  if (extraUserMessage) {
    msgs.push({ role: "user", content: extraUserMessage, timestamp: new Date().toISOString() });
  }

  let totalChars = 0;
  const selected = [];

  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    const c = String(m.content || "");
    const approx = c.length + 50; // margem por estrutura
    if (selected.length > 0 && totalChars + approx > MAX_API_CONTEXT_CHARS) break;
    selected.push(m);
    totalChars += approx;
  }

  selected.reverse();

  // Converte para formato Gemini
  return selected.map((msg) => ({
    role: msg.role === "user" ? "user" : "model",
    parts: [{ text: msg.content }],
  }));
}

function extractGeminiText(data) {
  return data?.candidates?.[0]?.content?.parts?.map((p) => p?.text || "").join("") || "";
}

function extractFinishReason(data) {
  // v1beta costuma ter candidates[0].finishReason
  return data?.candidates?.[0]?.finishReason || data?.candidates?.[0]?.finish_reason || null;
}

// ============================================
// TEXTOS GRANDES: split com overlap opcional
// ============================================

function dividirTextoGrande(texto, maxChars = LARGE_TEXT_PART_MAX_CHARS, overlapChars = LARGE_TEXT_OVERLAP_CHARS) {
  const t = String(texto || "");
  if (t.length <= maxChars) return [{ chunk: t, overlapPrefix: "" }];

  const paragrafos = t.split(/\n\s*\n/);
  const partes = [];

  let parteAtual = "";

  for (const paragrafo of paragrafos) {
    const candidate = parteAtual ? `${parteAtual}\n\n${paragrafo}` : paragrafo;

    if (candidate.length > maxChars && parteAtual) {
      // fecha parte atual
      const overlapPrefix = parteAtual.slice(-overlapChars);
      partes.push({ chunk: parteAtual, overlapPrefix });
      parteAtual = paragrafo;
    } else {
      parteAtual = candidate;
    }
  }

  if (parteAtual) {
    const overlapPrefix = parteAtual.slice(-overlapChars);
    partes.push({ chunk: parteAtual, overlapPrefix });
  }

  // Para a primeira parte, overlapPrefix é inútil
  if (partes.length > 0) partes[0].overlapPrefix = "";

  return partes;
}

function criarPromptCorrecao(texto, parte = null, totalPartes = null, overlapPrefix = "") {
  let prompt = `Corrija o seguinte texto gramaticalmente, ortograficamente e estilisticamente.
Mantenha o estilo, tom, formatação e estrutura original exatamente como está.
Retorne APENAS o texto corrigido, sem comentários, explicações ou marcações adicionais.`;

  if (parte !== null && totalPartes !== null) {
    prompt += `\n\n[Parte ${parte}/${totalPartes}]`;
  }

  if (overlapPrefix) {
    prompt += `\n\nContexto final da parte anterior (NÃO REPITA NA SAÍDA, serve apenas de referência):\n${overlapPrefix}`;
  }

  prompt += `\n\nTEXTO PARA CORRIGIR:\n${texto}\n\nTEXTO CORRIGIDO:`;

  return prompt;
}

async function corrigirTextoGrande(texto) {
  const partes = dividirTextoGrande(texto);
  const total = partes.length;

  // Mensagem de progresso (guardando referência DOM)
  addSystemMessage(`📝 Processando texto grande (${String(texto).length.toLocaleString()} caracteres em ${total} partes)...`);
  const progressNode = chatOutput ? chatOutput.lastElementChild : null;

  let resultadoCompleto = "";

  try {
    for (let i = 0; i < total; i++) {
      const parteNum = i + 1;
      if (progressNode && total > 1) {
        progressNode.textContent = `📝 Processando parte ${parteNum}/${total}...`;
      }

      const modeloAtual = escolherModeloAleatorio();
      const prompt = criarPromptCorrecao(partes[i].chunk, parteNum, total, partes[i].overlapPrefix);

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modeloAtual}:generateContent?key=${configuracoesAcesso}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
              ...CONFIG_CORRECAO,
              maxOutputTokens: MODELOS_CONFIG[modeloAtual].maxTokens,
            },
            safetySettings: [
              { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
              { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
              { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
              { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
            ],
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `Status ${response.status}`);
      }

      const data = await response.json();

      if (data.promptFeedback?.blockReason) {
        resultadoCompleto += `[Parte ${parteNum} bloqueada por filtro de segurança]\n\n`;
        continue;
      }

      const parteCorrigida = extractGeminiText(data) || partes[i].chunk;
      resultadoCompleto += parteCorrigida + (i < total - 1 ? "\n\n" : "");
    }

    // Remove progresso
    if (progressNode && progressNode.parentNode === chatOutput && progressNode.classList.contains("system-message")) {
      progressNode.remove();
    }

    addMessage("bot", `✅ Texto corrigido completo:\n\n${resultadoCompleto}`, { saveToApiHistory: true, saveToDisplayHistory: true });

    if (total > 1) addSystemMessage(`📊 ${total} partes processadas com sucesso.`);
  } catch (error) {
    if (progressNode && progressNode.parentNode === chatOutput && progressNode.classList.contains("system-message")) {
      progressNode.remove();
    }
    addSystemMessage(`❌ Erro ao processar texto grande: ${error.message}`);
    console.error("Erro:", error);
  }
}

// ============================================
// ENVIO PRINCIPAL: comandos, rate limit, continue
// ============================================

function isLocalCommand(message) {
  const m = String(message || "").trim().toLowerCase();
  if (!m) return false;
  if (m.startsWith("/")) return true;
  return ["sair", "exit", "fim", "quit"].includes(m);
}

async function callGemini({ modeloAtual, contents, generationConfig, safetySettings }) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modeloAtual}:generateContent?key=${configuracoesAcesso}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents, generationConfig, safetySettings }),
    }
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `Status ${response.status}`);
  }

  return await response.json();
}

async function sendMessage(message) {
  // Não limpa input aqui; quem chama decide (para não perder texto)
  message = sanitizeInput(message);
  if (!message) return;

  // Comandos locais não devem consumir rate limit nem isLoading (mas bloqueamos se estiver carregando p/ UX)
  if (isLocalCommand(message)) {
    const comando = message.toLowerCase();

    if (comando.startsWith("/")) {
      switch (comando) {
        case "/ajuda":
          showHelp();
          return;
        case "/limpar":
          clearChat();
          return;
        case "/exportar":
          saveChatHistory();
          return;
        case "/sair":
        case "/exit":
        case "/fim":
          addSystemMessage("> Chat encerrado. Até mais!");
          return;
        default:
          addSystemMessage(`❌ Comando desconhecido: ${message}`);
          addSystemMessage("Digite /ajuda para ver comandos disponíveis");
          return;
      }
    } else {
      // sair/exit/fim/quit
      addSystemMessage("> Chat encerrado. Até mais!");
      return;
    }
  }

  // Bloqueio se já está carregando
  if (isLoading) {
    addSystemMessage("⚠️ Aguarde a resposta anterior...");
    return;
  }

  // Rate limit remoto
  const delta = Date.now() - lastMessageTime;
  if (delta < RATE_LIMIT_MS) {
    addSystemMessage(`⚠️ Aguarde ${Math.ceil((RATE_LIMIT_MS - delta) / 1000)} segundos`);
    return;
  }

  // Detectar texto grande para correção
  const isCorrecaoTexto = message.toLowerCase().includes("corrigir") || message.toLowerCase().includes("corrija");
  if (isCorrecaoTexto && message.length > TEXTO_GRANDE_THRESHOLD) {
    const confirmar = confirm(
      `📝 Texto grande detectado (${message.length.toLocaleString()} caracteres).\n\nDeseja processar em modo especial?`
    );
    if (confirmar) {
      // Marca como loading apenas durante o fluxo
      isLoading = true;
      if (sendButton) {
        sendButton.disabled = true;
        sendButton.textContent = "Processando...";
      }
      try {
        // salva a mensagem do usuário no histórico (opcional; aqui salva)
        addMessage("user", message, { saveToApiHistory: true, saveToDisplayHistory: true });
        await corrigirTextoGrande(message);
      } finally {
        isLoading = false;
        if (sendButton) {
          sendButton.disabled = false;
          sendButton.textContent = "Enviar";
        }
      }
      return;
    }
  }

  // A partir daqui: chamada remota
  isLoading = true;
  lastMessageTime = Date.now(); // contabiliza rate limit somente em chamada remota

  // Desabilitar botão durante envio
  if (sendButton) {
    sendButton.disabled = true;
    sendButton.textContent = "Enviando...";
  }

  try {
    // Adiciona mensagem do usuário no histórico/UI
    addMessage("user", message, { saveToApiHistory: true, saveToDisplayHistory: true });
    showTypingIndicator();

    const modeloAtual = escolherModeloAleatorio();
    const maxTokens = message.length > 1000 ? MAX_TOKENS_PADRAO : 4096;

    // Histórico cortado por tamanho (reduz truncamento / erro por contexto)
    const apiHistory = buildApiHistoryTrimmed(null);

    console.log(`Enviando para API (modelo: ${modeloAtual}):`, {
      messageCount: apiHistory.length,
      lastMessage: message.substring(0, 120) + (message.length > 120 ? "..." : ""),
      maxTokens,
    });

    const baseConfig = {
      temperature: isCorrecaoTexto ? 0.2 : 0.7,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: maxTokens,
    };

    const safetySettings = [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
    ];

    let data = await callGemini({
      modeloAtual,
      contents: apiHistory,
      generationConfig: baseConfig,
      safetySettings,
    });

    if (data.promptFeedback?.blockReason) {
      addSystemMessage(`⚠️ Resposta bloqueada: ${data.promptFeedback.blockReason}`);
      hideTypingIndicator();
      return;
    }

    let botResponse = extractGeminiText(data) || "⚠️ Resposta inesperada";
    let finishReason = extractFinishReason(data);
    let continueAttempts = 0;

    // Auto-continue se truncou por MAX_TOKENS
    while (finishReason && String(finishReason).toUpperCase().includes("MAX_TOKENS") && continueAttempts < MAX_CONTINUE_ATTEMPTS) {
      continueAttempts++;

      // Acrescenta um pedido de continuação (sem repetir)
      const continuePrompt =
        "Continue exatamente de onde você parou. Não repita o que já foi dito. " +
        "Retorne apenas a continuação, mantendo o mesmo formato.";

      // Atualiza histórico local TEMPORARIAMENTE: inclui a resposta parcial do modelo (para ele saber onde parou)
      const tempHistory = buildApiHistoryTrimmed(null);
      tempHistory.push({ role: "model", parts: [{ text: botResponse }] });
      tempHistory.push({ role: "user", parts: [{ text: continuePrompt }] });

      const data2 = await callGemini({
        modeloAtual,
        contents: tempHistory,
        generationConfig: baseConfig,
        safetySettings,
      });

      if (data2.promptFeedback?.blockReason) break;

      const cont = extractGeminiText(data2);
      if (!cont) break;

      botResponse += "\n" + cont;
      finishReason = extractFinishReason(data2);
    }

    // Log de truncamento possível (mesmo que não tenha finishReason)
    if (botResponse.length > 7000 && (botResponse.endsWith("...") || botResponse.includes("[continua]"))) {
      console.warn("Possível truncamento detectado na resposta (heurística).");
    }

    addMessage("bot", botResponse, { saveToApiHistory: true, saveToDisplayHistory: true });
  } catch (error) {
    console.error("Erro:", error);
    addSystemMessage(`❌ Erro: ${error.message}`);
  } finally {
    hideTypingIndicator();
    isLoading = false;

    if (sendButton) {
      sendButton.disabled = false;
      sendButton.textContent = "Enviar";
    }
  }
}

// ============================================
// COMANDOS / UTILIDADES
// ============================================

function showHelp() {
  addSystemMessage("📋 COMANDOS DISPONÍVEIS:");
  addSystemMessage("/ajuda - Mostra esta mensagem");
  addSystemMessage("/limpar - Reinicia a conversa");
  addSystemMessage("/exportar - Salva o histórico em arquivo");
  addSystemMessage("sair, exit, fim - Encerra o chat");
  addSystemMessage(" ");
  addSystemMessage("💡 Para textos grandes (>2000 chars), inclua 'corrigir' no pedido");
}

function saveChatHistory() {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `gdchat_history_${timestamp}.txt`;

    let content = "=== HISTÓRICO DO CHAT GDCHAT ===\n";
    content += `Data: ${new Date().toLocaleDateString()}\n`;
    content += `Hora: ${new Date().toLocaleTimeString()}\n`;
    content += `Mensagens: ${chatDisplayHistory.length} (${chatHistory.length} para API)\n`;
    content += "=".repeat(40) + "\n\n";

    chatDisplayHistory.forEach((message, index) => {
      const role = message.role === "user" ? "👤 VOCÊ" : message.role === "system" ? "⚙️ SISTEMA" : "🤖 GDCHAT";
      content += `[${index + 1}] ${role}\n`;
      content += `Hora: ${message.timestamp ? new Date(message.timestamp).toLocaleTimeString() : "N/A"}\n`;
      content += "-".repeat(40) + "\n";
      content += message.content + "\n\n";
      content += "=".repeat(40) + "\n\n";
    });

    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    addSystemMessage(`✅ Histórico salvo como ${filename}`);
    return filename;
  } catch (error) {
    console.error("Erro ao salvar:", error);
    addSystemMessage(`❌ Erro ao salvar: ${error.message}`);
    return null;
  }
}

function clearChat() {
  if (!confirm("Tem certeza que deseja limpar TODO o histórico da conversa?")) return;

  chatHistory = [];
  chatDisplayHistory = [];
  modeloUsageCount = {};
  lastModelUsed = null;

  localStorage.removeItem("gdchat_history");

  if (chatOutput) chatOutput.innerHTML = "";

  addSystemMessage("=== BEM-VINDO AO GDCHAT ===");
  addSystemMessage("Digite /ajuda para ver comandos disponíveis");
  initQuickReplies();
}

// ============================================
// INIT: quick replies / scroll / listeners
// ============================================

function initQuickReplies() {
  if (!quickRepliesContainer) return;

  quickRepliesContainer.innerHTML = "";

  quickReplies.forEach((reply) => {
    const btn = document.createElement("button");
    btn.className = "quick-reply-btn";
    btn.textContent = reply.length > 40 ? reply.slice(0, 40) + "…" : reply;
    btn.title = "Clique para usar esta sugestão";

    btn.addEventListener("click", () => {
      if (!textInput) return;
      textInput.value = reply;
      textInput.focus();
    });

    quickRepliesContainer.appendChild(btn);
  });
}

function initScrollHandler() {
  if (!chatOutput) return;

  chatOutput.addEventListener("scroll", () => {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      if (!chatOutput) return;

      const currentScroll = chatOutput.scrollTop;
      const scrollHeight = chatOutput.scrollHeight;
      const clientHeight = chatOutput.clientHeight;

      if (currentScroll < lastScrollPosition && currentScroll < scrollHeight - clientHeight - 300) {
        userScrolledUp = true;
      }

      if (currentScroll >= scrollHeight - clientHeight - 100) {
        userScrolledUp = false;
      }

      lastScrollPosition = currentScroll;
    }, 150);
  });
}

function initEventListeners() {
  // Botão enviar
  if (sendButton) {
    sendButton.addEventListener("click", async () => {
      if (!textInput) return;

      const raw = textInput.value; // não limpa ainda
      const message = sanitizeInput(raw);

      if (!message) return;

      // Se estiver carregando, não apaga o texto (evita perder)
      if (isLoading) {
        addSystemMessage("⚠️ Aguarde a resposta anterior...");
        return;
      }

      // Limpa o input somente quando vamos processar (local ou remoto)
      textInput.value = "";

      await sendMessage(message);
    });
  }

  // Enter no input
  if (textInput) {
    textInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (sendButton) sendButton.click();
      }
    });
  }

  // Botões de ação
  if (clearButton) clearButton.addEventListener("click", clearChat);
  if (saveButton) saveButton.addEventListener("click", saveChatHistory);

  // Prevenção de F12/Inspecionar (mantido, mas menos intrusivo)
  document.addEventListener("keydown", function (e) {
    const blocked =
      e.key === "F12" ||
      (e.ctrlKey && e.shiftKey && ["I", "J", "C"].includes(String(e.key).toUpperCase())) ||
      (e.ctrlKey && String(e.key).toUpperCase() === "U");

    if (blocked) {
      e.preventDefault();
      addSystemMessage("🔒 GDCHAT - Uso interno");
    }
  });

  // Auto-foco no input ao carregar
  setTimeout(() => {
    if (textInput) textInput.focus();
  }, 250);
}

function initChat() {
  // Carregar históricos (sem duplicar)
  const loaded = loadChatHistory();
  chatDisplayHistory = loaded.display;
  chatHistory = loaded.api;

  // Limpar interface
  if (chatOutput) chatOutput.innerHTML = "";

  if (chatDisplayHistory.length === 0) {
    addSystemMessage("=== BEM-VINDO AO GDCHAT ===", { saveToDisplayHistory: true });
    addSystemMessage("Digite /ajuda para ver comandos disponíveis", { saveToDisplayHistory: true });
    addSystemMessage(" ", { saveToDisplayHistory: true });
  } else {
    // Renderiza histórico existente sem re-adicionar no histórico (não duplica)
    chatDisplayHistory.forEach((msg) => {
      renderMessageToUI({
        role: msg.role,
        content: msg.content,
        timestampISO: msg.timestamp,
        isSystem: !!msg.isSystem,
      });
    });
    addSystemMessage(`↩️ Conversa anterior carregada (${chatDisplayHistory.length} mensagens)`);
  }

  initQuickReplies();
  initScrollHandler();
  initEventListeners();

  const modeloInicial = escolherModeloAleatorio();
  console.log(`🚀 GDCHAT iniciado. Modelo inicial: ${modeloInicial}`);
}

// ============================================
// INICIALIZAÇÃO AUTOMÁTICA
// ============================================

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initChat);
} else {
  initChat();
}

// Exportar funções para uso global (se necessário)
window.GDCHAT = {
  sendMessage,
  clearChat,
  saveChatHistory,
  addSystemMessage,
  corrigirTextoGrande,
  showHelp,
  getHistory: () => ({
    api: chatHistory.length,
    display: chatDisplayHistory.length,
  }),
  getModelStats: () => modeloUsageCount,
};
