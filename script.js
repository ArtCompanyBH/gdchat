// Configuration
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

const MODEL_NAME = "gemini-2.5-flash";

// DOM Elements
const chatOutput = document.getElementById('chat-output');
const textInput = document.getElementById('text-input');
const sendButton = document.getElementById('send-button');
const clearButton = document.getElementById('clear-button');
const saveButton = document.getElementById('save-button');
const quickRepliesContainer = document.getElementById('quick-replies');

// Chat state
let chatHistory = JSON.parse(localStorage.getItem('gdchat_history')) || [];
let lastMessageTime = 0;

// Scroll control variables
let userScrolledUp = false;
let lastScrollPosition = 0;

// Quick replies
const quickReplies = [
    "Corrigir textos gramaticalmente e retornar apenas o texto pronto: ", 
    "Em que você pode me ajudar?" 
];

// Format Gemini Response
function formatGeminiResponse(text) {
    return text
        .replace(/\*{1,2}/g, '')
        .replace(/^\s*[-•]\s*/gm, '• ')
        .replace(/\n{2,}/g, '\n\n')
        .trim();
}

// Smart scroll function
function smartScroll(forceScroll = false) {
    const chat = chatOutput;
    const isNearBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 100;
    if (forceScroll || !userScrolledUp || isNearBottom) {
        chat.scrollTop = chat.scrollHeight;
        userScrolledUp = false;
    }
}

function initChat() {
    chatOutput.innerHTML = '';
    if (chatHistory.length === 1) {
        addSystemMessage("=== Bem-vindo ao GDCHAT ===");
        addSystemMessage("Comandos especiais:");
        addSystemMessage("- 'sair', 'fim' ou 'exit' para encerrar");
        addSystemMessage("- Use 'Limpar' para reiniciar a conversa");
        addSystemMessage("- 'Salvar' guarda o histórico no arquivo");
        addSystemMessage("- Digite /ajuda para ver comandos extras");
    } else {
        chatHistory.forEach(msg => {
            if (msg.role === 'system') {
                addSystemMessage(msg.content);
            } else {
                addMessage(msg.role, msg.content);
            }
        });
    }
    quickReplies.forEach(reply => {
        const btn = document.createElement('button');
        btn.textContent = reply;
        btn.addEventListener('click', () => {
            textInput.value = reply;
            textInput.focus();
        });
        quickRepliesContainer.appendChild(btn);
    });
    chatOutput.addEventListener('scroll', () => {
        const currentScroll = chatOutput.scrollTop;
        if (currentScroll < lastScrollPosition && 
            currentScroll < chatOutput.scrollHeight - chatOutput.clientHeight - 200) {
            userScrolledUp = true;
        }
        lastScrollPosition = currentScroll;
    });
}

function addMessage(role, content, isTyping = false) {
    const messageDiv = document.createElement('div');
    const timestamp = new Date().toLocaleTimeString();

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
        const typingIndicator = document.getElementById('typing-indicator');
        if (typingIndicator) {
            chatOutput.removeChild(typingIndicator);
        }
        chatOutput.appendChild(messageDiv);
    }

    if (role === 'bot' && !isTyping) {
        smartScroll(true);
    } else {
        smartScroll();
    }

    if (!isTyping) {
        chatHistory.push({ role, content });
        saveChatToCache();
    }
}

function addSystemMessage(content) {
    addMessage('system', content);
}

function saveChatToCache() {
    localStorage.setItem('gdchat_history', JSON.stringify(chatHistory));
}

async function sendMessage(message) {
    if (Date.now() - lastMessageTime < 15000) {
        addSystemMessage("⚠️ Aguarde 15 segundos entre mensagens");
        return;
    }
    lastMessageTime = Date.now();

    if (message.startsWith('/')) {
        switch(message.toLowerCase()) {
            case '/ajuda':
                addSystemMessage("📋 Comandos disponíveis:");
                addSystemMessage("/limpar - Reinicia a conversa");
                addSystemMessage("/exportar - Salva o histórico");
                addSystemMessage("/ajuda - Mostra esta mensagem");
                return;
            case '/limpar':
                clearChat();
                return;
            case '/exportar':
                saveChatHistory();
                return;
        }
    }

    addMessage('user', message);
    addMessage('bot', 'Carregando resposta...', true);

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${configuracoesAcesso}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: chatHistory.filter(msg => msg.role !== 'system').map(msg => ({
                    role: msg.role === 'user' ? 'user' : 'model',
                    parts: [{ text: msg.content }]
                })),
                generationConfig: {
                    temperature: 0.9,
                    topK: 1,
                    topP: 1,
                    maxOutputTokens: 2048
                },
                safetySettings: [
                    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" }
                ]
            })
        });

        if (!response.ok) throw new Error(`API request failed with status ${response.status}`);
        const data = await response.json();
        const botResponse = data?.candidates?.[0]?.content?.parts?.[0]?.text || '⚠️ Resposta inesperada';
        addMessage('bot', botResponse);
    } catch (error) {
        addSystemMessage(`❌ Erro: ${error.message}`);
        console.error('Error:', error);
    }
}

function saveChatHistory() {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `chat_history_${timestamp}.txt`;
        let content = '';

        chatHistory.forEach(message => {
            const role = message.role === 'user' ? 'Você' : (message.role === 'system' ? 'Sistema' : 'GDCHAT');
            content += `${role}: ${message.content}\n\n`;
        });

        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
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

function clearChat() {
    if (!confirm("Tem certeza que deseja limpar todo o histórico?")) return;
    chatHistory = [];
    localStorage.removeItem('gdchat_history');
    chatOutput.innerHTML = '';
    addSystemMessage("> Histórico limpo. Conversa reiniciada.");
}

sendButton.addEventListener('click', () => {
    const message = textInput.value.trim();
    textInput.value = '';
    if (!message) return;
    if (["sair", "exit", "fim"].includes(message.toLowerCase())) {
        addSystemMessage("> Chat encerrado. Até mais!");
        return;
    }
    sendMessage(message);
});

textInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendButton.click();
});

clearButton.addEventListener('click', clearChat);
saveButton.addEventListener('click', saveChatHistory);



document.addEventListener('keydown', function(e) {
    if (
        e.key === 'F12' ||
        (e.ctrlKey && e.shiftKey && e.key === 'I') ||
        (e.ctrlKey && e.shiftKey && e.key === 'J') ||
        (e.ctrlKey && e.key === 'u')
    ) {
        e.preventDefault();
        addSystemMessage('🔒 Todos os direitos reservados, Yuri Antoniazzi');
    }
});

initChat();
