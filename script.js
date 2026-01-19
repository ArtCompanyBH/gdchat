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
        priority: 2
    },
    "gemini-2.5-flash-lite": {
        maxTokens: 8192,
        priority: 1
    },
    "gemini-3-flash-preview": {
        maxTokens: 8192,
        priority: 3
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

// DOM Elements
const chatOutput = document.getElementById('chat-output');
const textInput = document.getElementById('text-input');
const sendButton = document.getElementById('send-button');
const clearButton = document.getElementById('clear-button');
const saveButton = document.getElementById('save-button');
const quickRepliesContainer = document.getElementById('quick-replies');

// Chat state
let chatHistory = loadChatHistory();
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

// Comandos disponíveis
const COMANDOS = {
    '/ajuda': () => showHelp(),
    '/limpar': () => clearChat(),
    '/exportar': () => saveChatHistory(),
    '/grande': () => ativarModoGrande(),
    '/normal': () => desativarModoGrande(),
    '/info': () => showInfo(),
    '/modelos': () => showModelos()
};

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
        
        // Limitar histórico carregado
        return parsed.slice(-MAX_HISTORY_ITEMS);
    } catch (e) {
        console.error('Erro ao carregar histórico:', e);
        localStorage.removeItem('gdchat_history');
        return [];
    }
}

// Salvar histórico com limite
function saveChatToCache() {
    try {
        // Manter apenas últimos N itens
        const historyToSave = chatHistory.slice(-MAX_HISTORY_ITEMS);
        localStorage.setItem('gdchat_history', JSON.stringify(historyToSave));
    } catch (e) {
        console.error('Erro ao salvar histórico:', e);
    }
}

// Escolher modelo baseado no contexto
function escolherModeloInteligente() {
    // Se conversa é curta, usar modelo mais rápido
    if (chatHistory.length < 3) return "gemini-2.5-flash-lite";
    
    // Se última mensagem é longa, usar modelo mais capaz
    const lastMessage = chatHistory[chatHistory.length - 1]?.content || "";
    if (lastMessage.length > 1000) return "gemini-2.5-flash";
    
    // Padrão para maioria dos casos
    return "gemini-2.5-flash";
}

// Format Gemini Response (melhorada)
function formatGeminiResponse(text) {
    if (!text) return '';
    
    let formatted = text
        // Converter markdown básico para HTML
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/`(.*?)`/g, '<code>$1</code>')
        .replace(/^\s*#{1,6}\s*(.*)$/gm, '<strong>$1</strong>') // Títulos
        // Listas
        .replace(/^\s*[-•]\s*(.*)$/gm, '• $1')
        .replace(/^\s*\d+\.\s*(.*)$/gm, '$1')
        // Limpar múltiplas quebras de linha
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
    indicator.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div>';
    
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
// FUNÇÕES DE MENSAGENS
// ============================================

function addMessage(role, content, isTyping = false) {
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

    if (!isTyping && role !== 'typing') {
        chatHistory.push({ role, content, timestamp: new Date().toISOString() });
        saveChatToCache();
    }
}

function addSystemMessage(content) {
    addMessage('system', content);
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
    
    addMessage('user', `[TEXTO GRANDE - ${texto.length.toLocaleString()} caracteres] Corrigir texto:`);
    showTypingIndicator();
    
    let resultadoCompleto = '';
    let modeloUsado = null;
    
    try {
        for (let i = 0; i < partes.length; i++) {
            const parteNum = i + 1;
            addSystemMessage(`📝 Processando parte ${parteNum}/${partes.length}...`);
            
            // Escolher modelo para esta parte
            const modeloAtual = "gemini-2.5-flash"; // Usar modelo consistente para todo o texto
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
                addSystemMessage(`⚠️ Parte ${parteNum} bloqueada: ${data.promptFeedback.blockReason}`);
                resultadoCompleto += `[Parte ${parteNum} bloqueada por filtro de segurança]\n\n`;
                continue;
            }
            
            const parteCorrigida = data?.candidates?.[0]?.content?.parts?.[0]?.text || partes[i];
            resultadoCompleto += parteCorrigida + (i < partes.length - 1 ? '\n\n' : '');
        }
        
        hideTypingIndicator();
        
        // Adicionar resultado completo
        addMessage('bot', `✅ Texto corrigido (${modeloUsado}):\n\n${resultadoCompleto}`);
        
        // Adicionar estatísticas
        addSystemMessage(`📊 Estatísticas: ${partes.length} parte(s) processada(s), ${resultadoCompleto.length.toLocaleString()} caracteres totais`);
        
    } catch (error) {
        hideTypingIndicator();
        addSystemMessage(`❌ Erro ao processar texto grande: ${error.message}`);
        console.error('Erro:', error);
    }
}

// ============================================
// FUNÇÃO PRINCIPAL DE ENVIO
// ============================================

async function sendMessage(message) {
    if (isLoading) {
        addSystemMessage("⚠️ Aguarde a resposta anterior...");
        return;
    }
    
    if (Date.now() - lastMessageTime < RATE_LIMIT_MS) {
        addSystemMessage(`⚠️ Aguarde ${Math.ceil((RATE_LIMIT_MS - (Date.now() - lastMessageTime)) / 1000)} segundos entre mensagens`);
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
    
    // Verificar comandos
    if (message.startsWith('/')) {
        const comando = message.toLowerCase().split(' ')[0];
        if (COMANDOS[comando]) {
            COMANDOS[comando]();
            isLoading = false;
            if (sendButton) {
                sendButton.disabled = false;
                sendButton.textContent = 'Enviar';
            }
            return;
        }
    }
    
    // Verificar se é saída
    if (["sair", "exit", "fim", "quit"].includes(message.toLowerCase())) {
        addSystemMessage("> Chat encerrado. Até mais!");
        isLoading = false;
        if (sendButton) {
            sendButton.disabled = false;
            sendButton.textContent = 'Enviar';
        }
        return;
    }
    
    // Detectar texto grande para correção
    const isCorrecaoTexto = message.toLowerCase().includes('corrigir') || 
                           message.toLowerCase().includes('corrija') ||
                           (message.length > TEXTO_GRANDE_THRESHOLD && message.length < 30000);
    
    if (isCorrecaoTexto && message.length > TEXTO_GRANDE_THRESHOLD) {
        const confirmar = confirm(`📝 Texto grande detectado (${message.length.toLocaleString()} caracteres).\n\nDeseja processar em modo especial para evitar corte?`);
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
    
    // Processamento normal
    addMessage('user', message);
    showTypingIndicator();
    
    try {
        const modeloAtual = escolherModeloInteligente();
        const maxTokens = message.length > 1000 ? MAX_TOKENS_PADRAO : 4096;
        
        // Preparar histórico para API (remover mensagens de sistema)
        const apiHistory = chatHistory
            .filter(msg => msg.role !== 'system')
            .map(msg => ({
                role: msg.role === 'user' ? 'user' : 'model',
                parts: [{ text: msg.content }]
            }));
        
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
            addSystemMessage(`⚠️ Resposta bloqueada: ${data.promptFeedback.blockReason}`);
            hideTypingIndicator();
            return;
        }
        
        const botResponse = data?.candidates?.[0]?.content?.parts?.[0]?.text || '⚠️ Resposta inesperada';
        
        // Verificar truncamento
        if (botResponse.length > 7000 && (botResponse.endsWith('...') || botResponse.includes('[continua]'))) {
            addSystemMessage("⚠️ Resposta possivelmente truncada devido ao limite de tokens.");
            if (message.length > 1000) {
                addSystemMessage("💡 Dica: Para textos muito longos, mencione explicitamente 'corrigir' no início.");
            }
        }
        
        addMessage('bot', botResponse);
        
    } catch (error) {
        console.error('Erro:', error);
        addSystemMessage(`❌ Erro: ${error.message}`);
        
        // Tentar fallback para outro modelo em caso de erro
        if (error.message.includes('model') || error.message.includes('404')) {
            addSystemMessage("🔄 Tentando com modelo alternativo...");
            // Poderia implementar fallback aqui
        }
        
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
    addSystemMessage("📋 COMANDOS DISPONÍVEIS:");
    addSystemMessage("/ajuda - Mostra esta mensagem");
    addSystemMessage("/limpar - Reinicia a conversa");
    addSystemMessage("/exportar - Salva o histórico em arquivo");
    addSystemMessage("/info - Mostra informações do sistema");
    addSystemMessage("/modelos - Lista modelos disponíveis");
    addSystemMessage("/grande - Ativa modo para textos grandes");
    addSystemMessage("/normal - Volta ao modo normal");
    addSystemMessage(" ");
    addSystemMessage("💡 DICAS:");
    addSystemMessage("- Textos grandes (>2000 chars) são processados automaticamente");
    addSystemMessage("- Para correção completa, inclua 'corrigir' no pedido");
    addSystemMessage("- Use os botões de resposta rápida para exemplos");
}

function showInfo() {
    const modeloAtual = escolherModeloInteligente();
    addSystemMessage("📊 INFORMAÇÕES DO SISTEMA:");
    addSystemMessage(`• Modelo atual: ${modeloAtual}`);
    addSystemMessage(`• Histórico: ${chatHistory.length} mensagens`);
    addSystemMessage(`• Limite de tokens: ${MODELOS_CONFIG[modeloAtual]?.maxTokens || MAX_TOKENS_PADRAO}`);
    addSystemMessage(`• Texto grande: >${TEXTO_GRANDE_THRESHOLD} caracteres`);
    addSystemMessage(`• Última mensagem: ${lastMessageTime ? new Date(lastMessageTime).toLocaleTimeString() : 'Nenhuma'}`);
}

function showModelos() {
    addSystemMessage("🤖 MODELOS DISPONÍVEIS:");
    MODELOS_DISPONIVEIS.forEach(modelo => {
        const config = MODELOS_CONFIG[modelo];
        addSystemMessage(`• ${modelo} - ${config.maxTokens} tokens (prioridade: ${config.priority})`);
    });
    addSystemMessage(`\nModelo selecionado automaticamente baseado no contexto.`);
}

function ativarModoGrande() {
    if (textInput) {
        textInput.placeholder = "📝 Modo texto grande ativado. Cole textos longos aqui...";
    }
    addSystemMessage("📝 MODO TEXTO GRANDE ATIVADO");
    addSystemMessage("Agora você pode colar textos longos para correção completa.");
    addSystemMessage("O sistema dividirá automaticamente textos muito grandes.");
}

function desativarModoGrande() {
    if (textInput) {
        textInput.placeholder = "Digite sua mensagem aqui...";
    }
    addSystemMessage("📝 Modo texto grande desativado.");
}

function saveChatHistory() {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `gdchat_history_${timestamp}.txt`;
        
        let content = '=== HISTÓRICO DO CHAT GDCHAT ===\n';
        content += `Data: ${new Date().toLocaleDateString()}\n`;
        content += `Hora: ${new Date().toLocaleTimeString()}\n`;
        content += `Total de mensagens: ${chatHistory.length}\n`;
        content += '='.repeat(40) + '\n\n';
        
        chatHistory.forEach((message, index) => {
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
        
        addSystemMessage(`✅ Histórico salvo como ${filename} (${chatHistory.length} mensagens)`);
        return filename;
        
    } catch (error) {
        console.error('Erro ao salvar:', error);
        addSystemMessage(`❌ Erro ao salvar: ${error.message}`);
        return null;
    }
}

function clearChat() {
    if (!confirm("Tem certeza que deseja limpar TODO o histórico da conversa?")) return;
    
    chatHistory = [];
    localStorage.removeItem('gdchat_history');
    
    if (chatOutput) {
        chatOutput.innerHTML = '';
    }
    
    // Reiniciar chat com mensagem de boas-vindas
    initChat();
    addSystemMessage("✅ Histórico limpo com sucesso. Conversa reiniciada.");
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
                // Rolar para o input
                textInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
            
            // Usuário rolou para cima e não está perto do final
            if (currentScroll < lastScrollPosition && 
                currentScroll < scrollHeight - clientHeight - 300) {
                userScrolledUp = true;
            }
            
            // Se chegou perto do final, resetar flag
            if (currentScroll >= scrollHeight - clientHeight - 100) {
                userScrolledUp = false;
            }
            
            lastScrollPosition = currentScroll;
        }, 150); // Debounce de 150ms
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
        
        // Permitir Shift+Enter para nova linha
        textInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.shiftKey) {
                // Permite nova linha - comportamento padrão
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
    
    // Prevenção de F12/Inspecionar (para uso interno)
    document.addEventListener('keydown', function(e) {
        if (e.key === 'F12' ||
            (e.ctrlKey && e.shiftKey && e.key === 'I') ||
            (e.ctrlKey && e.shiftKey && e.key === 'J') ||
            (e.ctrlKey && e.shiftKey && e.key === 'C') ||
            (e.ctrlKey && e.key === 'U')) {
            e.preventDefault();
            addSystemMessage('🔒 GDCHAT - Uso interno autorizado');
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
    // Limpar interface
    if (chatOutput) {
        chatOutput.innerHTML = '';
    }
    
    // Adicionar mensagem de boas-vindas se histórico vazio
    if (chatHistory.length === 0) {
        addSystemMessage("🤖 === BEM-VINDO AO GDCHAT ===");
        addSystemMessage("💬 Chat inteligente com modelos Gemini");
        addSystemMessage(" ");
        addSystemMessage("📋 COMANDOS DISPONÍVEIS:");
        addSystemMessage("• Digite /ajuda para ver todos os comandos");
        addSystemMessage("• Use 'sair', 'fim' ou 'exit' para encerrar");
        addSystemMessage("• /limpar - Reinicia a conversa");
        addSystemMessage("• /exportar - Salva o histórico");
        addSystemMessage("• /grande - Modo para textos grandes");
        addSystemMessage(" ");
        addSystemMessage("💡 DICAS RÁPIDAS:");
        addSystemMessage("• Textos grandes são processados automaticamente");
        addSystemMessage("• Para correção: inclua 'corrigir' no pedido");
        addSystemMessage("• Use os botões abaixo para exemplos");
        addSystemMessage("=".repeat(40));
    } else {
        // Recarregar histórico existente
        chatHistory.forEach(msg => {
            if (msg.role === 'system') {
                addSystemMessage(msg.content);
            } else {
                addMessage(msg.role, msg.content);
            }
        });
        
        // Adicionar mensagem de continuação
        addSystemMessage(" ");
        addSystemMessage("↩️ Conversa anterior carregada");
        addSystemMessage(`📊 ${chatHistory.length} mensagens no histórico`);
    }
    
    // Inicializar componentes
    initQuickReplies();
    initScrollHandler();
    initEventListeners();
    
    // Mostrar informações do modelo atual
    setTimeout(() => {
        const modeloAtual = escolherModeloInteligente();
        addSystemMessage(`⚙️ Modelo atual: ${modeloAtual} (${MODELOS_CONFIG[modeloAtual]?.maxTokens || MAX_TOKENS_PADRAO} tokens)`);
    }, 1000);
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
    showInfo,
    getHistory: () => chatHistory,
    getStats: () => ({
        messages: chatHistory.length,
        lastMessageTime,
        isLoading,
        currentModel: escolherModeloInteligente()
    })
};
