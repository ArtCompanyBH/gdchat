// Configuration - CHAVE API (uso interno)
const configuracoesAcesso = (function() {
    const partes = [
        "AIzaSyAF", 
        "AuWmUJ6c", 
        "6opWGOPj",
        "8nMLdYha",
        "lmWxA-8"
    ]; 
    return partes.join('');
})();

// Lista de modelos disponíveis com limites de tokens
const MODELOS_CONFIG = {
    "gemini-2.5-flash": {
        maxTokens: 8192,
        priority: 1
    },
    "gemini-2.5-flash-lite": {
        maxTokens: 8192,
        priority: 1
    },
    "gemini-3-flash-preview": {
        maxTokens: 8192,
        priority: 1
    }
};

const MODELOS_DISPONIVEIS = Object.keys(MODELOS_CONFIG);

// Configurações para correção de textos
const CONFIG_CORRECAO = {
    temperature: 0.2,
    topK: 1,
    topP: 1
};

// Limites e configurações
const MAX_HISTORY_ITEMS = 100;
const RATE_LIMIT_MS = 15000;
const TEXTO_GRANDE_THRESHOLD = 2000;
const MAX_TOKENS_PADRAO = 8192;

// Controle de uso de modelos para rodízio
let modeloUsageCount = {};
let lastModelUsed = null;

// DOM Elements
const chatOutput = document.getElementById('chat-output');
const textInput = document.getElementById('text-input');
const sendButton = document.getElementById('send-button');
const clearButton = document.getElementById('clear-button');
const saveButton = document.getElementById('save-button');
const quickRepliesContainer = document.getElementById('quick-replies');

// Chat state - mensagens de sistema NÃO são salvas no histórico da API
let chatHistory = []; // Apenas user/bot (para API)
let chatDisplayHistory = []; // Todas as mensagens (para display)
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
    "Resuma este texto: "
];

// ============================================
// FUNÇÕES DE UTILIDADE E GESTÃO
// ============================================

// Carregar histórico com validação
function loadChatHistory() {
    try {
        const stored = localStorage.getItem('gdchat_history');
        if (!stored) return [];
        
        const parsed = JSON.parse(stored);
        if (!Array.isArray(parsed)) {
            localStorage.removeItem('gdchat_history');
            return [];
        }
        
        // Separar históricos: apenas user/bot para API, todas para display
        const apiHistory = [];
        const displayHistory = [];
        
        parsed.forEach(msg => {
            displayHistory.push(msg);
            if (msg.role === 'user' || msg.role === 'bot') {
                apiHistory.push(msg);
            }
        });
        
        chatHistory = apiHistory.slice(-MAX_HISTORY_ITEMS);
        chatDisplayHistory = displayHistory.slice(-(MAX_HISTORY_ITEMS + 10)); // +10 para mensagens de sistema
        
        return displayHistory;
    } catch (e) {
        console.error('Erro ao carregar histórico:', e);
        localStorage.removeItem('gdchat_history');
        return [];
    }
}

// Salvar histórico com limite - APENAS para display
function saveChatToCache() {
    try {
        // Salvar apenas histórico de display (que tem tudo)
        const historyToSave = chatDisplayHistory.slice(-(MAX_HISTORY_ITEMS + 10));
        localStorage.setItem('gdchat_history', JSON.stringify(historyToSave));
    } catch (e) {
        console.error('Erro ao salvar histórico:', e);
    }
}

// Escolher modelo aleatório para rodízio
function escolherModeloAleatorio() {
    // Se é o primeiro uso, inicializar contador
    if (Object.keys(modeloUsageCount).length === 0) {
        MODELOS_DISPONIVEIS.forEach(modelo => {
            modeloUsageCount[modelo] = 0;
        });
    }
    
    // Encontrar modelo menos usado recentemente
    let availableModels = [...MODELOS_DISPONIVEIS];
    
    // Se usamos um modelo na última vez, tentar não repetir
    if (lastModelUsed && availableModels.length > 1) {
        availableModels = availableModels.filter(modelo => modelo !== lastModelUsed);
    }
    
    // Escolher aleatoriamente entre os disponíveis
    const indice = Math.floor(Math.random() * availableModels.length);
    const modeloEscolhido = availableModels[indice];
    
    // Atualizar contadores
    modeloUsageCount[modeloEscolhido] = (modeloUsageCount[modeloEscolhido] || 0) + 1;
    lastModelUsed = modeloEscolhido;
    
    console.log(`🎲 Modelo escolhido: ${modeloEscolhido}`);
    console.log(`📊 Estatísticas uso: ${JSON.stringify(modeloUsageCount)}`);
    
    return modeloEscolhido;
}

// Format Gemini Response (melhorada)
function formatGeminiResponse(text) {
    if (!text) return '';
    
    let formatted = text
        // Converter markdown básico
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        // Listas
        .replace(/^\s*[-•]\s*(.*)$/gm, '• $1')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    
    return formatted;
}

// Sanitizar entrada do usuário
function sanitizeInput(text) {
    return text.trim().slice(0, 10000); // Limitar a 10K caracteres
}

// ============================================
// FUNÇÕES DE SCROLL E UI
// ============================================

// Smart scroll function com debounce
function smartScroll(forceScroll = false) {
    if (!chatOutput) return;
    
    const isNearBottom = chatOutput.scrollHeight - chatOutput.scrollTop - chatOutput.clientHeight < 100;
    
    if (forceScroll || !userScrolledUp || isNearBottom) {
        chatOutput.scrollTop = chatOutput.scrollHeight;
        userScrolledUp = false;
    }
}

// Mostrar indicador de digitação
function showTypingIndicator() {
    const existing = document.getElementById('typing-indicator');
    if (existing) return;
    
    const indicator = document.createElement('div');
    indicator.id = 'typing-indicator';
    indicator.className = 'typing-indicator';
    indicator.innerHTML = '🤖 GDCHAT está digitando...';
    
    if (chatOutput) {
        chatOutput.appendChild(indicator);
        smartScroll();
    }
}

// Esconder indicador de digitação
function hideTypingIndicator() {
    const indicator = document.getElementById('typing-indicator');
    if (indicator && chatOutput && indicator.parentNode === chatOutput) {
        chatOutput.removeChild(indicator);
    }
}

// ============================================
// FUNÇÕES DE MENSAGENS (REVISADA)
// ============================================

function addMessage(role, content, isTyping = false, saveToApiHistory = true) {
    if (!chatOutput) return;
    
    const messageDiv = document.createElement('div');
    const timestamp = new Date().toLocaleTimeString([], { 
        hour: '2-digit', 
        minute: '2-digit',
        second: '2-digit' 
    });

    if (isTyping) {
        messageDiv.className = 'typing-indicator';
        messageDiv.id = 'typing-indicator';
    } else if (role === 'system') {
        messageDiv.className = 'system-message';
    } else {
        messageDiv.className = role === 'user' ? 'user-message' : 'bot-message';
    }

    const rolePrefix = role === 'user' ? '👤 Você' : '🤖 GDCHAT';
    const displayContent = role === 'system' ? content : `${rolePrefix}: ${formatGeminiResponse(content)}`;

    messageDiv.innerHTML = displayContent;

    if (!isTyping && role !== 'system') {
        const timeSpan = document.createElement('div');
        timeSpan.className = 'timestamp';
        timeSpan.textContent = timestamp;
        messageDiv.appendChild(timeSpan);
    }

    if (isTyping) {
        const existingTyping = document.getElementById('typing-indicator');
        if (existingTyping) {
            chatOutput.replaceChild(messageDiv, existingTyping);
        } else {
            chatOutput.appendChild(messageDiv);
        }
    } else {
        hideTypingIndicator();
        chatOutput.appendChild(messageDiv);
    }

    if (role === 'bot' && !isTyping) {
        smartScroll(true);
    } else {
        smartScroll();
    }

    if (!isTyping) {
        // SEMPRE salvar no display history (para mostrar)
        chatDisplayHistory.push({ 
            role, 
            content, 
            timestamp: new Date().toISOString(),
            isSystem: role === 'system'
        });
        
        // SALVAR APENAS user/bot no API history (para enviar à API)
        if (saveToApiHistory && (role === 'user' || role === 'bot')) {
            chatHistory.push({ 
                role, 
                content, 
                timestamp: new Date().toISOString() 
            });
        }
        
        saveChatToCache();
    }
}

function addSystemMessage(content, saveToApiHistory = false) {
    addMessage('system', content, false, saveToApiHistory);
}

// ============================================
// FUNÇÕES PARA TEXTOS GRANDES
// ============================================

// Dividir textos grandes em partes
function dividirTextoGrande(texto, maxChars = 4000) {
    if (texto.length <= maxChars) return [texto];
    
    const partes = [];
    // Tentar dividir em parágrafos naturais
    const paragrafos = texto.split('\n\n');
    
    let parteAtual = '';
    
    for (const paragrafo of paragrafos) {
        if ((parteAtual + paragrafo).length > maxChars && parteAtual) {
            partes.push(parteAtual);
            parteAtual = paragrafo;
        } else {
            parteAtual += (parteAtual ? '\n\n' : '') + paragrafo;
        }
    }
    
    if (parteAtual) {
        partes.push(parteAtual);
    }
    
    return partes;
}

// Prompt otimizado para correção
function criarPromptCorrecao(texto, parte = null, totalPartes = null) {
    let prompt = `Corrija o seguinte texto gramaticalmente, ortograficamente e estilisticamente. 
Mantenha o estilo, tom, formatação e estrutura original exatamente como está.
Retorne APENAS o texto corrigido, sem comentários, explicações ou marcações adicionais.

TEXTO PARA CORRIGIR:`;

    if (parte !== null && totalPartes !== null) {
        prompt += ` [Parte ${parte}/${totalPartes}]`;
    }
    
    prompt += `\n${texto}\n\nTEXTO CORRIGIDO:`;
    
    return prompt;
}

// Função especializada para correção de textos grandes
async function corrigirTextoGrande(texto) {
    const partes = dividirTextoGrande(texto);
    
    // Apenas uma mensagem no chat, não no histórico da API
    addSystemMessage(`📝 Processando texto grande (${texto.length.toLocaleString()} caracteres em ${partes.length} partes)...`, false);
    
    let resultadoCompleto = '';
    let modeloUsado = null;
    
    try {
        for (let i = 0; i < partes.length; i++) {
            const parteNum = i + 1;
            
            // Mostrar progresso apenas se tiver muitas partes
            if (partes.length > 1) {
                // Atualizar a mesma mensagem de sistema
                const lastSystemMsg = document.querySelector('.system-message:last-child');
                if (lastSystemMsg && i > 0) {
                    lastSystemMsg.textContent = `📝 Processando parte ${parteNum}/${partes.length}...`;
                }
            }
            
            // Usar modelo aleatório para cada parte (para rodízio)
            const modeloAtual = escolherModeloAleatorio();
            if (!modeloUsado) modeloUsado = modeloAtual;
            
            const prompt = criarPromptCorrecao(partes[i], parteNum, partes.length);
            
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modeloAtual}:generateContent?key=${configuracoesAcesso}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        role: 'user',
                        parts: [{ text: prompt }]
                    }],
                    generationConfig: {
                        ...CONFIG_CORRECAO,
                        maxOutputTokens: MODELOS_CONFIG[modeloAtual].maxTokens
                    },
                    safetySettings: [
                        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
                        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
                        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
                        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" }
                    ]
                })
            });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error?.message || `Status ${response.status}`);
            }
            
            const data = await response.json();
            
            // Verificar bloqueios
            if (data.promptFeedback?.blockReason) {
                addSystemMessage(`⚠️ Parte ${parteNum} bloqueada: ${data.promptFeedback.blockReason}`, false);
                resultadoCompleto += `[Parte ${parteNum} bloqueada por filtro de segurança]\n\n`;
                continue;
            }
            
            const parteCorrigida = data?.candidates?.[0]?.content?.parts?.[0]?.text || partes[i];
            resultadoCompleto += parteCorrigida + (i < partes.length - 1 ? '\n\n' : '');
        }
        
        // Limpar mensagem de processamento
        const processingMsg = document.querySelector('.system-message:last-child');
        if (processingMsg && processingMsg.textContent.includes('Processando')) {
            processingMsg.remove();
        }
        
        // Adicionar resultado completo (não é mensagem de sistema, vai para histórico da API)
        addMessage('bot', `✅ Texto corrigido completo:\n\n${resultadoCompleto}`, false, true);
        
        // Apenas uma mensagem de confirmação simples
        if (partes.length > 1) {
            addSystemMessage(`📊 ${partes.length} partes processadas com sucesso.`, false);
        }
        
    } catch (error) {
        // Limpar mensagem de processamento em caso de erro
        const processingMsg = document.querySelector('.system-message:last-child');
        if (processingMsg && processingMsg.textContent.includes('Processando')) {
            processingMsg.remove();
        }
        
        addSystemMessage(`❌ Erro ao processar texto grande: ${error.message}`, false);
        console.error('Erro:', error);
    }
}

// ============================================
// FUNÇÃO PRINCIPAL DE ENVIO (REVISADA)
// ============================================

async function sendMessage(message) {
    if (isLoading) {
        addSystemMessage("⚠️ Aguarde a resposta anterior...", false);
        return;
    }
    
    if (Date.now() - lastMessageTime < RATE_LIMIT_MS) {
        addSystemMessage(`⚠️ Aguarde ${Math.ceil((RATE_LIMIT_MS - (Date.now() - lastMessageTime)) / 1000)} segundos`, false);
        return;
    }
    
    message = sanitizeInput(message);
    if (!message) return;
    
    lastMessageTime = Date.now();
    isLoading = true;
    
    // Desabilitar botão durante envio
    if (sendButton) {
        sendButton.disabled = true;
        sendButton.textContent = 'Enviando...';
    }
    
    // Verificar comandos especiais
    if (message.startsWith('/')) {
        const comando = message.toLowerCase();
        switch(comando) {
            case '/ajuda':
                showHelp();
                break;
            case '/limpar':
                clearChat();
                break;
            case '/exportar':
                saveChatHistory();
                break;
            case '/sair':
            case '/exit':
            case '/fim':
                addSystemMessage("> Chat encerrado. Até mais!", false);
                break;
            default:
                addSystemMessage(`❌ Comando desconhecido: ${message}`, false);
                addSystemMessage("Digite /ajuda para ver comandos disponíveis", false);
        }
        isLoading = false;
        if (sendButton) {
            sendButton.disabled = false;
            sendButton.textContent = 'Enviar';
        }
        return;
    }
    
    // Verificar se é saída (sem barra)
    if (["sair", "exit", "fim", "quit"].includes(message.toLowerCase())) {
        addSystemMessage("> Chat encerrado. Até mais!", false);
        isLoading = false;
        if (sendButton) {
            sendButton.disabled = false;
            sendButton.textContent = 'Enviar';
        }
        return;
    }
    
    // Detectar texto grande para correção
    const isCorrecaoTexto = message.toLowerCase().includes('corrigir') || 
                           message.toLowerCase().includes('corrija');
    
    if (isCorrecaoTexto && message.length > TEXTO_GRANDE_THRESHOLD) {
        // Mostrar apenas uma mensagem de confirmação
        const confirmar = confirm(`📝 Texto grande detectado (${message.length.toLocaleString()} caracteres).\n\nDeseja processar em modo especial?`);
        if (confirmar) {
            await corrigirTextoGrande(message);
            isLoading = false;
            if (sendButton) {
                sendButton.disabled = false;
                sendButton.textContent = 'Enviar';
            }
            return;
        }
    }
    
    // Processamento normal - mensagem do usuário VAI para histórico da API
    addMessage('user', message, false, true);
    showTypingIndicator();
    
    try {
        const modeloAtual = escolherModeloAleatorio();
        const maxTokens = message.length > 1000 ? MAX_TOKENS_PADRAO : 4096;
        
        // Preparar histórico para API (APENAS user/bot, SEM system messages)
        const apiHistory = chatHistory.map(msg => ({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: msg.content }]
        }));
        
        console.log(`Enviando para API (modelo: ${modeloAtual}):`, {
            messageCount: apiHistory.length,
            lastMessage: message.substring(0, 100) + '...',
            maxTokens: maxTokens
        });
        
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modeloAtual}:generateContent?key=${configuracoesAcesso}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: apiHistory,
                generationConfig: {
                    temperature: isCorrecaoTexto ? 0.2 : 0.7,
                    topK: 40,
                    topP: 0.95,
                    maxOutputTokens: maxTokens
                },
                safetySettings: [
                    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" }
                ]
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error?.message || `Status ${response.status}`);
        }
        
        const data = await response.json();
        
        // Verificar bloqueios
        if (data.promptFeedback?.blockReason) {
            addSystemMessage(`⚠️ Resposta bloqueada: ${data.promptFeedback.blockReason}`, false);
            hideTypingIndicator();
            return;
        }
        
        const botResponse = data?.candidates?.[0]?.content?.parts?.[0]?.text || '⚠️ Resposta inesperada';
        
        // Verificar truncamento (apenas log)
        if (botResponse.length > 7000 && (botResponse.endsWith('...') || botResponse.includes('[continua]'))) {
            console.warn('Possível truncamento detectado na resposta');
        }
        
        // Resposta do bot VAI para histórico da API
        addMessage('bot', botResponse, false, true);
        
    } catch (error) {
        console.error('Erro:', error);
        addSystemMessage(`❌ Erro: ${error.message}`, false);
        
    } finally {
        hideTypingIndicator();
        isLoading = false;
        
        if (sendButton) {
            sendButton.disabled = false;
            sendButton.textContent = 'Enviar';
        }
    }
}

// ============================================
// FUNÇÕES DE COMANDOS E UTILIDADES
// ============================================

function showHelp() {
    // Limpar ajuda anterior se existir
    const existingHelp = document.querySelectorAll('.system-message');
    existingHelp.forEach(msg => {
        if (msg.textContent.includes('COMANDOS DISPONÍVEIS')) {
            msg.remove();
        }
    });
    
    // Adicionar nova ajuda (não salva no histórico da API)
    addSystemMessage("📋 COMANDOS DISPONÍVEIS:", false);
    addSystemMessage("/ajuda - Mostra esta mensagem", false);
    addSystemMessage("/limpar - Reinicia a conversa", false);
    addSystemMessage("/exportar - Salva o histórico em arquivo", false);
    addSystemMessage("sair, exit, fim - Encerra o chat", false);
    addSystemMessage(" ", false);
    addSystemMessage("💡 Para textos grandes (>2000 chars), inclua 'corrigir' no pedido", false);
}

function saveChatHistory() {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `gdchat_history_${timestamp}.txt`;
        
        let content = '=== HISTÓRICO DO CHAT GDCHAT ===\n';
        content += `Data: ${new Date().toLocaleDateString()}\n`;
        content += `Hora: ${new Date().toLocaleTimeString()}\n`;
        content += `Mensagens: ${chatDisplayHistory.length} (${chatHistory.length} para API)\n`;
        content += '='.repeat(40) + '\n\n';
        
        chatDisplayHistory.forEach((message, index) => {
            const role = message.role === 'user' ? '👤 VOCÊ' : 
                        message.role === 'system' ? '⚙️ SISTEMA' : '🤖 GDCHAT';
            
            content += `[${index + 1}] ${role}\n`;
            content += `Hora: ${message.timestamp ? new Date(message.timestamp).toLocaleTimeString() : 'N/A'}\n`;
            content += '-'.repeat(40) + '\n';
            content += message.content + '\n\n';
            content += '='.repeat(40) + '\n\n';
        });
        
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        addSystemMessage(`✅ Histórico salvo como ${filename}`, false);
        return filename;
        
    } catch (error) {
        console.error('Erro ao salvar:', error);
        addSystemMessage(`❌ Erro ao salvar: ${error.message}`, false);
        return null;
    }
}

function clearChat() {
    if (!confirm("Tem certeza que deseja limpar TODO o histórico da conversa?")) return;
    
    chatHistory = [];
    chatDisplayHistory = [];
    modeloUsageCount = {};
    lastModelUsed = null;
    
    localStorage.removeItem('gdchat_history');
    
    if (chatOutput) {
        chatOutput.innerHTML = '';
    }
    
    // Reiniciar chat com mensagem de boas-vindas mínima
    addSystemMessage("=== BEM-VINDO AO GDCHAT ===", false);
    addSystemMessage("Digite /ajuda para ver comandos disponíveis", false);
    
    initQuickReplies();
}

// ============================================
// INICIALIZAÇÃO
// ============================================

function initQuickReplies() {
    if (!quickRepliesContainer) return;
    
    quickRepliesContainer.innerHTML = '';
    
    quickReplies.forEach(reply => {
        const btn = document.createElement('button');
        btn.className = 'quick-reply-btn';
        btn.textContent = reply;
        btn.title = "Clique para usar esta sugestão";
        
        btn.addEventListener('click', () => {
            if (textInput) {
                textInput.value = reply;
                textInput.focus();
            }
        });
        
        quickRepliesContainer.appendChild(btn);
    });
}

function initScrollHandler() {
    if (!chatOutput) return;
    
    chatOutput.addEventListener('scroll', () => {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
            if (!chatOutput) return;
            
            const currentScroll = chatOutput.scrollTop;
            const scrollHeight = chatOutput.scrollHeight;
            const clientHeight = chatOutput.clientHeight;
            
            if (currentScroll < lastScrollPosition && 
                currentScroll < scrollHeight - clientHeight - 300) {
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
        sendButton.addEventListener('click', () => {
            if (!textInput || isLoading) return;
            
            const message = textInput.value.trim();
            textInput.value = '';
            
            if (message) {
                sendMessage(message);
            }
        });
    }
    
    // Enter no input
    if (textInput) {
        textInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (sendButton && !isLoading) {
                    sendButton.click();
                }
            }
        });
    }
    
    // Botões de ação
    if (clearButton) {
        clearButton.addEventListener('click', clearChat);
    }
    
    if (saveButton) {
        saveButton.addEventListener('click', saveChatHistory);
    }
    
    // Prevenção de F12/Inspecionar
    document.addEventListener('keydown', function(e) {
        if (e.key === 'F12' ||
            (e.ctrlKey && e.shiftKey && e.key === 'I') ||
            (e.ctrlKey && e.shiftKey && e.key === 'J') ||
            (e.ctrlKey && e.shiftKey && e.key === 'C') ||
            (e.ctrlKey && e.key === 'U')) {
            e.preventDefault();
            addSystemMessage('🔒 GDCHAT - Uso interno', false);
        }
    });
    
    // Auto-foco no input ao carregar
    setTimeout(() => {
        if (textInput) {
            textInput.focus();
        }
    }, 500);
}

function initChat() {
    // Carregar históricos
    const loadedHistory = loadChatHistory();
    
    // Limpar interface
    if (chatOutput) {
        chatOutput.innerHTML = '';
    }
    
    // Se não há histórico, mostrar mensagem mínima de boas-vindas
    if (loadedHistory.length === 0) {
        addSystemMessage("=== BEM-VINDO AO GDCHAT ===", false);
        addSystemMessage("Digite /ajuda para ver comandos disponíveis", false);
        addSystemMessage(" ", false);
    } else {
        // Recarregar histórico existente (todas as mensagens)
        loadedHistory.forEach(msg => {
            // Reenviar mensagens na tela, mas não recriar histórico da API
            if (msg.role === 'system') {
                addMessage('system', msg.content, false, false);
            } else {
                addMessage(msg.role, msg.content, false, msg.role !== 'system');
            }
        });
        
        // Apenas uma mensagem de confirmação
        addSystemMessage(`↩️ Conversa anterior carregada (${loadedHistory.length} mensagens)`, false);
    }
    
    // Inicializar componentes
    initQuickReplies();
    initScrollHandler();
    initEventListeners();
    
    // Log do modelo inicial (apenas console)
    const modeloInicial = escolherModeloAleatorio();
    console.log(`🚀 GDCHAT iniciado. Modelo inicial: ${modeloInicial}`);
}

// ============================================
// INICIALIZAÇÃO AUTOMÁTICA
// ============================================

// Esperar DOM carregar
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initChat);
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
        display: chatDisplayHistory.length 
    }),
    getModelStats: () => modeloUsageCount
};
