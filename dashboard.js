/* ==========================================================================
   Main Application Logic - SPA, Vis.js Graph, RAG Chat & Book Generator
   Booking Koala Knowledge Base - North Cleaning - Koala Hub
   ========================================================================== */

// Estado Global da Aplicação
let knowledgeBase = { themes: [], posts: [] };
let allTrainings = [];
let activeTab = 'graph';
let network = null;
let isPhysicsEnabled = true;
let aiConfig = { provider: 'none', apiKey: '' };

// Lista de Stopwords comuns em português e inglês para busca semântica simples
const STOPWORDS = new Set([
    'a', 'o', 'as', 'os', 'de', 'do', 'da', 'dos', 'das', 'em', 'um', 'uma', 'uns', 'umas',
    'com', 'para', 'por', 'que', 'se', 'na', 'no', 'nas', 'nos', 'ao', 'aos', 'ou', 'e',
    'is', 'the', 'of', 'in', 'to', 'for', 'with', 'on', 'at', 'by', 'an', 'and', 'how', 'what',
    'why', 'do', 'does', 'it', 'booking', 'koala', 'bookingkoala', 'bk', 'clean', 'cleaning'
]);

// Inicialização da Página
document.addEventListener("DOMContentLoaded", () => {
    // 1. Carregar Configurações de IA
    loadAIConfig();
    
    // 2. Carregar Base de Conhecimento do JSON
    fetchKnowledgeBase();

    // 3. Registrar Event Listeners dos Componentes
    setupEventListeners();
});

// 1. Carregamento e Configuração de IA (Local Storage)
function loadAIConfig() {
    const savedConfig = localStorage.getItem("koala_hub_ai_config");
    if (savedConfig) {
        try {
            aiConfig = JSON.parse(savedConfig);
            // Atualizar elementos da UI
            document.getElementById("select-ai-provider").value = aiConfig.provider;
            document.getElementById("input-api-key").value = aiConfig.apiKey;
            toggleAPIKeyField(aiConfig.provider);
        } catch (e) {
            console.error("Erro ao carregar configurações de IA do localStorage:", e);
        }
    }
}

function saveAIConfig() {
    const provider = document.getElementById("select-ai-provider").value;
    const apiKey = document.getElementById("input-api-key").value.trim();
    
    aiConfig = { provider, apiKey };
    localStorage.setItem("koala_hub_ai_config", JSON.stringify(aiConfig));
    
    closeModalSettings();
    
    // Adicionar mensagem no chat informando a mudança
    appendSystemMessage(`Configurações de IA atualizadas! Provedor ativo: ${getProviderFriendlyName(provider)}.`);
}

function getProviderFriendlyName(provider) {
    if (provider === 'gemini') return 'Google Gemini (RAG Ativo)';
    if (provider === 'openai') return 'OpenAI ChatGPT (RAG Ativo)';
    return 'Busca Semântica Local (Sem IA)';
}

function toggleAPIKeyField(provider) {
    const group = document.getElementById("api-key-form-group");
    if (provider === 'none') {
        group.style.display = "none";
    } else {
        group.style.display = "flex";
        document.getElementById("input-api-key").placeholder = 
            provider === 'gemini' ? "Digite sua Gemini API Key..." : "Digite sua OpenAI API Key...";
    }
}

// 2. Requisição do JSON de Base de Conhecimento
async function fetchKnowledgeBase() {
    try {
        const response = await fetch("knowledge_base.json");
        if (!response.ok) {
            throw new Error(`Falha ao ler o arquivo JSON: ${response.status}`);
        }
        knowledgeBase = await response.json();
        
        // Inicializar componentes com os dados carregados
        initGrafo();
        generateApostila();
        
        // Carregar Treinamentos
        await fetchTrainings();
        
        // Verificar se há aba especificada na URL (SPA Mandate)
        const urlParams = new URLSearchParams(window.location.search);
        const initialTab = urlParams.get('tab');
        if (initialTab && ['graph', 'chat', 'pdf', 'trainings'].includes(initialTab)) {
            switchTab(initialTab);
        } else {
            switchTab('graph'); // Padrão
        }
        
    } catch (error) {
        console.error("Erro ao carregar a base de conhecimento:", error);
        alert("Não foi possível carregar a base de conhecimento (knowledge_base.json). Verifique o console.");
    }
}

// 3. Configuração dos Event Listeners
function setupEventListeners() {
    // Configurações IA
    document.getElementById("btn-open-settings").addEventListener("click", openModalSettings);
    document.getElementById("btn-close-settings").addEventListener("click", closeModalSettings);
    document.getElementById("btn-cancel-settings").addEventListener("click", closeModalSettings);
    document.getElementById("btn-save-settings").addEventListener("click", saveAIConfig);
    document.getElementById("select-ai-provider").addEventListener("change", (e) => {
        toggleAPIKeyField(e.target.value);
    });

    // Controles do Grafo
    document.getElementById("btn-toggle-physics").addEventListener("click", togglePhysics);
    document.getElementById("btn-reset-graph").addEventListener("click", resetGraphZoom);

    // Fechar Drawer
    document.getElementById("btn-close-drawer").addEventListener("click", closeDrawer);
    document.getElementById("drawer-overlay").addEventListener("click", closeDrawer);

    // Chat
    document.getElementById("btn-send-message").addEventListener("click", handleUserSendMessage);
    const chatInputField = document.getElementById("chat-input-field");
    chatInputField.addEventListener("focus", () => {
        document.body.classList.add("chat-focus");
    });
    chatInputField.addEventListener("blur", () => {
        setTimeout(() => {
            document.body.classList.remove("chat-focus");
        }, 150);
    });
    chatInputField.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
            handleUserSendMessage();
        }
    });

    // Chips de Sugestões no Chat
    document.querySelectorAll(".suggestion-chip").forEach(chip => {
        chip.addEventListener("click", () => {
            const query = chip.getAttribute("data-query");
            document.getElementById("chat-input-field").value = query;
            handleUserSendMessage();
        });
    });

    // Imprimir Apostila PDF
    document.getElementById("btn-print-pdf").addEventListener("click", () => {
        window.print();
    });
}

// ==========================================================================
// SPA LÓGICA DE NAVEGAÇÃO HORIZONTAL (SPA_HORIZONTAL_MANDATE & NO_PHYSICAL_REDIRECTS)
// ==========================================================================
window.switchTab = function(tabId) {
    if (!['graph', 'chat', 'pdf', 'trainings'].includes(tabId)) return;
    
    activeTab = tabId;
    
    // 1. Atualizar active class na BottomNavBar
    document.querySelectorAll(".nav-item").forEach(btn => btn.classList.remove("active"));
    
    let navBtnId = "nav-graph";
    if (tabId === "chat") navBtnId = "nav-chat";
    if (tabId === "pdf") navBtnId = "nav-pdf";
    if (tabId === "trainings") navBtnId = "nav-trainings";
    
    const activeBtn = document.getElementById(navBtnId);
    if (activeBtn) activeBtn.classList.add("active");
    
    // 2. Mover o view-slider horizontal usando translate3d (Aceleração por hardware)
    const slider = document.getElementById("view-slider");
    let translateX = "0";
    if (tabId === "chat") translateX = "-100vw";
    if (tabId === "pdf") translateX = "-200vw";
    if (tabId === "trainings") translateX = "-300vw";
    
    slider.style.transform = `translate3d(${translateX}, 0, 0)`;
    
    // 3. Atualizar parâmetros da URL sem recarregar a página para manter o histórico limpo
    const newUrl = `${window.location.pathname}?tab=${tabId}`;
    window.history.replaceState({ tab: tabId }, "", newUrl);
    
    // 4. Trigger redimensionamento do Grafo ao voltar para aba dele (Vis.js precisa recalcular tamanho)
    if (tabId === 'graph' && network) {
        setTimeout(() => {
            network.redraw();
            network.fit();
        }, 300);
    }
};

// Modais Settings
function openModalSettings() {
    document.getElementById("modal-settings-overlay").classList.add("open");
}

function closeModalSettings() {
    document.getElementById("modal-settings-overlay").classList.remove("open");
}

// ==========================================================================
// SEÇÃO 1: GRAFO DE CONHECIMENTO (Obsidian Style via Vis.js)
// ==========================================================================
function initGrafo() {
    const container = document.getElementById("graph-container");
    if (!container) return;

    const nodesArray = [];
    const edgesArray = [];

    // Mapeamento de cores de temas para consistência (11 categorias da nova base de conhecimento)
    const themeColors = {
        'theme-migracao': '#06b6d4',      // Ciano (Migração)
        'theme-pagamentos': '#eab308',     // Dourado (Stripe/Cobrança)
        'theme-agendamento': '#3b82f6',    // Azul (Reservas/Calendário)
        'theme-equipe': '#10b981',         // Verde (Cleaners/VAs/1099)
        'theme-marketing': '#ec4899',      // Rosa (SEO/Anúncios/Reviews)
        'theme-automacao-ia': '#8b5cf6',   // Roxo (Zapier/IA/API)
        'theme-website': '#f97316',        // Laranja (Tema/Customização CSS)
        'theme-config': '#0ea5e9',         // Ciano claro (Configurações BK)
        'theme-negocio': '#ef4444',        // Vermelho (Precificação/Negócios)
        'theme-suporte': '#64748b',        // Slate (Bugs/Suporte)
        'theme-outros': '#a855f7'          // Lilás (Gerais/Outros)
    };

    // Adiciona o nó central unificado (Knowledge Base - Raiz da teia)
    nodesArray.push({
        id: 'node-central-kb',
        label: 'Knowledge Base',
        title: 'Central de Conhecimento Booking Koala (Raiz)',
        group: 'kb_root',
        size: 24, // Maior de todos para destaque como raiz
        borderWidth: 3,
        borderWidthSelected: 4,
        color: {
            background: '#ffffff',
            border: '#8b5cf6',
            highlight: {
                background: '#ffffff',
                border: '#a78bfa'
            },
            hover: {
                background: '#ffffff',
                border: '#a78bfa'
            }
        },
        font: {
            color: '#ffffff',
            size: 16,
            face: 'Outfit',
            weight: '800'
        },
        shadow: {
            enabled: true,
            color: '#8b5cf6',
            size: 16,
            x: 0,
            y: 0
        }
    });

    // Adiciona nós das Categorias (Temas) - Nós Principais (Maiores e Coloridos)
    knowledgeBase.themes.forEach(theme => {
        const color = themeColors[theme.id] || '#8b5cf6';

        nodesArray.push({
            id: theme.id,
            label: theme.name.split(' (')[0], // Rótulo visível apenas nas categorias
            title: `<b>${theme.name}</b><br>${theme.description}`,
            group: 'theme',
            size: 16, // Tamanho físico fixo elegante em pixels
            borderWidth: 2,
            borderWidthSelected: 3,
            color: {
                background: color,
                border: '#ffffff',
                highlight: {
                    background: color,
                    border: '#ffffff'
                },
                hover: {
                    background: color,
                    border: '#ffffff'
                }
            },
            font: {
                color: '#f8fafc',
                size: 14,
                face: 'Outfit',
                weight: '600'
            },
            shadow: {
                enabled: true,
                color: color,
                size: 8,
                x: 0,
                y: 0
            }
        });

        // Conecta a categoria ao nó central da Base de Conhecimento
        edgesArray.push({
            from: 'node-central-kb',
            to: theme.id,
            color: {
                color: 'rgba(255, 255, 255, 0.15)', // Linha de espinha dorsal mais marcante
                highlight: color,
                hover: color
            },
            width: 1.5,
            length: 130 // Distância maior da mola para separar os clusters em torno da raiz
        });
    });

    // Adiciona nós dos Posts - Estilo Obsidian (Dots Minúsculos e Sem Rótulos Permanentes)
    knowledgeBase.posts.forEach((post, i) => {
        const themeColor = themeColors[post.theme_id] || '#8b5cf6';
        
        // Criar elemento HTML para o tooltip para que o Vis.js exiba HTML de forma nativa e sem bugs
        const tooltipEl = document.createElement("div");
        tooltipEl.style.padding = "10px";
        tooltipEl.style.maxWidth = "280px";
        tooltipEl.style.fontFamily = "'Inter', sans-serif";
        tooltipEl.style.fontSize = "12px";
        tooltipEl.style.color = "#f8fafc";
        tooltipEl.style.lineHeight = "1.5";
        tooltipEl.style.borderRadius = "8px";
        
        const titleText = post.title || "Discussão";
        
        tooltipEl.innerHTML = `
            <div style="font-weight: 700; color: #a78bfa; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">Publicado por ${post.author}</div>
            <div style="font-weight: 600; color: #ffffff; margin-bottom: 6px; font-family: 'Outfit', sans-serif; font-size: 13px;">${titleText}</div>
            <div style="color: #94a3b8; font-size: 11px;">${post.content.substring(0, 130)}${post.content.length > 130 ? '...' : ''}</div>
        `;

        nodesArray.push({
            id: post.post_id,
            label: '', 
            title: tooltipEl, 
            group: 'post',
            size: 4.5, // Bolinhas minúsculas e limpas como no Obsidian
            borderWidth: 0,
            borderWidthSelected: 1.5,
            color: {
                background: '#4b5563', // Cinza neutro no estado normal
                border: '#4b5563',
                highlight: {
                    background: themeColor, // Acende com a cor do tema ao ser selecionado
                    border: '#ffffff'
                },
                hover: {
                    background: themeColor, // Acende com a cor do tema no mouse hover
                    border: '#ffffff'
                }
            }
        });

        // Conecta o post ao seu respectivo tema
        edgesArray.push({
            from: post.post_id,
            to: post.theme_id,
            color: {
                color: 'rgba(255, 255, 255, 0.06)', // Linhas finas quase invisíveis
                highlight: themeColor,
                hover: themeColor
            },
            width: 0.6,
            hoverWidth: 1.2,
            selectionWidth: 1.5
        });
    });

    const data = {
        nodes: new vis.DataSet(nodesArray),
        edges: new vis.DataSet(edgesArray)
    };

    const options = {
        nodes: {
            shape: 'dot'
            // Sem escala automática para garantir pontos uniformes e limpos
        },
        edges: {
            arrows: {
                to: { enabled: false }
            },
            smooth: false // Arestas retas e limpas como no Obsidian
        },
        physics: {
            enabled: true,
            solver: 'barnesHut',
            barnesHut: {
                gravitationalConstant: -2800, // Repulsão forte para espalhar os nós no fundo escuro
                centralGravity: 0.15,          // Mantém a teia centralizada na tela
                springLength: 95,             // Espaçamento confortável
                springConstant: 0.05,         // Força de atração moderada das molas
                damping: 0.88,                // Amortecimento forte para parar a trepidação rapidamente
                avoidOverlap: 1.0             // Impede sobreposição física dos nós
            },
            minVelocity: 0.75,                // Congela a animação quando desacelera, economizando CPU
            stabilization: {
                enabled: true,
                iterations: 150,              // Executa iterações de pré-estabilização para evitar saltos visuais ao carregar
                updateInterval: 25,
                fit: true
            }
        },
        interaction: {
            hover: true,
            tooltipDelay: 150,
            zoomView: true,
            dragView: true
        }
    };

    // Criar a rede Vis.js
    network = new vis.Network(container, data, options);

    // Evento de Clique no Nó
    network.on("click", (params) => {
        if (params.nodes.length > 0) {
            const clickedNodeId = params.nodes[0];
            // Se for um nó de post (não é um tema)
            if (!clickedNodeId.startsWith('theme-')) {
                openPostDrawer(clickedNodeId);
            }
        }
    });
}

function togglePhysics() {
    isPhysicsEnabled = !isPhysicsEnabled;
    const btn = document.getElementById("btn-toggle-physics");
    
    if (network) {
        network.setOptions({ physics: { enabled: isPhysicsEnabled } });
    }
    
    if (isPhysicsEnabled) {
        btn.innerHTML = `
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="6" y="4" width="4" height="16"></rect>
                <rect x="14" y="4" width="4" height="16"></rect>
            </svg>
            Congelar Grafo
        `;
    } else {
        btn.innerHTML = `
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
            Soltar Grafo
        `;
    }
}

function resetGraphZoom() {
    if (network) {
        network.fit({ animation: true });
    }
}

// ==========================================================================
// DRAWER DE DETALHES DO POST (Obsidian Style Drawer)
// ==========================================================================
function openPostDrawer(postId) {
    const post = knowledgeBase.posts.find(p => p.post_id === postId);
    if (!post) return;

    // Preenche dados do post
    document.getElementById("drawer-post-id").innerText = `Post ID: ${post.post_id}`;
    document.getElementById("drawer-post-author").innerText = post.author;
    document.getElementById("drawer-post-title").innerText = post.title || "Discussão";
    
    const theme = knowledgeBase.themes.find(t => t.id === post.theme_id);
    const themeLabel = document.getElementById("drawer-post-theme");
    themeLabel.innerText = theme ? theme.name.split(' (')[0] : "Discussão";
    
    // Cor do label do tema no drawer (obtido dinamicamente das cores do tema)
    const themeColor = themeColors[post.theme_id] || '#8b5cf6';
    themeLabel.style.backgroundColor = `${themeColor}20`;
    themeLabel.style.color = themeColor;

    document.getElementById("drawer-post-content").innerText = post.content;
    
    const fbLink = document.getElementById("drawer-post-link");
    if (post.group_link) {
        fbLink.href = post.group_link;
        fbLink.style.display = "inline-flex";
    } else {
        fbLink.style.display = "none";
    }

    // Preenche comentários ignorando reticências inúteis
    const validComments = post.comments.filter(c => {
        const txt = c.text ? c.text.trim() : "";
        return txt !== "" && !/^\.+$/.test(txt);
    });

    const countSpan = document.getElementById("drawer-comments-count");
    countSpan.innerText = validComments.length;

    const listDiv = document.getElementById("drawer-comments-list");
    listDiv.innerHTML = "";

    if (validComments.length === 0) {
        listDiv.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--text-muted); font-size: 13px;">Nenhum comentário registrado nesta publicação.</div>`;
    } else {
        validComments.forEach(comment => {
            const commentCard = document.createElement("div");
            commentCard.className = "comment-card";
            commentCard.innerHTML = `
                <div class="comment-meta">
                    <span class="comment-author">${comment.author}</span>
                </div>
                <div class="comment-text">${comment.text}</div>
            `;
            listDiv.appendChild(commentCard);
        });
    }

    // Abre Drawer e Overlay
    document.getElementById("drawer-overlay").classList.add("open");
    const drawer = document.getElementById("drawer-details");
    drawer.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
}

function closeDrawer() {
    document.getElementById("drawer-overlay").classList.remove("open");
    const drawer = document.getElementById("drawer-details");
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
}

// ==========================================================================
// SEÇÃO 2: CHAT INTELIGENTE COM RAG (LOCAL OU API KEY)
// ==========================================================================
async function handleUserSendMessage() {
    const inputField = document.getElementById("chat-input-field");
    const query = inputField.value.trim();
    if (!query) return;

    // Limpar campo
    inputField.value = "";

    // 1. Adicionar mensagem do usuário na tela
    appendMessage(query, 'user');

    // 2. Adicionar indicador de digitação
    const typingId = appendTypingIndicator();

    // Rolar container de mensagens
    const msgContainer = document.getElementById("chat-messages");
    msgContainer.scrollTop = msgContainer.scrollHeight;

    // 3. Fazer RAG / Busca
    try {
        // Encontrar as discussões mais semelhantes localmente
        const contextPosts = searchLocalKnowledge(query, 4);

        let replyText = "";

        if (aiConfig.provider === 'none') {
            // Resposta Sintetizada Local (Sem API Key)
            replyText = formatLocalSynthesizedResponse(query, contextPosts);
        } else {
            // Chamada de API Oficial (RAG de Verdade com LLM)
            replyText = await callAIChatAPI(query, contextPosts);
        }

        // Remover indicador de digitação e adicionar resposta da IA
        removeTypingIndicator(typingId);
        appendMessage(replyText, 'assistant');

    } catch (error) {
        console.error("Erro ao gerar resposta do Chat:", error);
        removeTypingIndicator(typingId);
        appendMessage(`Desculpe, ocorreu um erro ao gerar a resposta: ${error.message}. Por favor, verifique sua API Key ou conexão com o provedor.`, 'system-error');
    }

    // Rolar container após inserção
    msgContainer.scrollTop = msgContainer.scrollHeight;
}

// Algoritmo de busca simplificada baseada em palavras-chave
function searchLocalKnowledge(query, limit = 3) {
    // Normalizar query: minúscula, remover pontuação
    const cleanQuery = query.toLowerCase().replace(/[^\w\s]/g, ' ');
    const queryWords = cleanQuery.split(/\s+/).filter(w => w.length > 2 && !STOPWORDS.has(w));

    if (queryWords.length === 0) {
        // Fallback: se não sobrou nenhuma palavra-chave, retorna posts aleatórios ou primeiros
        return knowledgeBase.posts.slice(0, limit);
    }

    const scoredPosts = knowledgeBase.posts.map(post => {
        let score = 0;
        const postText = (post.content + " " + post.author).toLowerCase();
        
        // Frequência de correspondência no post principal (peso alto = 3)
        queryWords.forEach(word => {
            const regex = new RegExp(word, 'g');
            const count = (postText.match(regex) || []).length;
            score += count * 3;
        });

        // Frequência de correspondência nos comentários (peso menor = 1)
        post.comments.forEach(c => {
            const commentText = (c.text + " " + c.author).toLowerCase();
            queryWords.forEach(word => {
                const regex = new RegExp(word, 'g');
                const count = (commentText.match(regex) || []).length;
                score += count * 1.2;
            });
        });

        return { post, score };
    });

    // Ordena de forma decrescente pelo score e filtra scores > 0
    const filtered = scoredPosts
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score);

    // Se nenhum post deu match, retorna as primeiras discussões
    if (filtered.length === 0) {
        return knowledgeBase.posts.slice(0, limit);
    }

    return filtered.slice(0, limit).map(item => item.post);
}

// Formatação da Resposta Sintetizada Local (Offline)
function formatLocalSynthesizedResponse(query, posts) {
    if (posts.length === 0) {
        return "Não encontrei nenhuma discussão relevante específica para sua pergunta na base de conhecimento. Tente reformular usando termos mais comuns de Booking Koala.";
    }

    let response = `Com base na base de conhecimento do grupo Booking Koala, encontrei as seguintes discussões relevantes:\n\n`;

    posts.forEach((post, index) => {
        const theme = knowledgeBase.themes.find(t => t.id === post.theme_id);
        const themeName = theme ? theme.name.split(' (')[0] : "Geral";
        
        response += `### ${index + 1}. [Discussão de ${post.author}] (${themeName})\n`;
        response += `> *"${post.content}"*\n\n`;
        
        const validComments = post.comments.filter(c => {
            const txt = c.text ? c.text.trim() : "";
            return txt !== "" && !/^\.+$/.test(txt);
        });

        if (validComments.length > 0) {
            response += `**Principais Soluções/Comentários compartilhados:**\n`;
            // Pega até 2 comentários mais importantes
            validComments.slice(0, 2).forEach(c => {
                response += `- **${c.author}**: "${c.text}"\n`;
            });
        } else {
            response += `*Nesta publicação, os membros ainda não haviam compartilhado soluções nos comentários.*\n`;
        }
        response += `\n---\n\n`;
    });

    response += `💡 *Dica: Configure uma API Key do Google Gemini ou OpenAI no botão "Configurar IA" no cabeçalho superior para que eu possa sintetizar uma resposta única baseada nessas discussões de forma automática.*`;

    return response;
}

// Chamada de API RAG (Gemini ou OpenAI)
async function callAIChatAPI(query, contextPosts) {
    const provider = aiConfig.provider;
    const apiKey = aiConfig.apiKey;

    if (!apiKey) {
        throw new Error("API Key não configurada. Vá em 'Configurar IA' no cabeçalho superior.");
    }

    // Preparar o Contexto das discussões para injetar no Prompt da IA
    let contextString = "";
    contextPosts.forEach((post, i) => {
        contextString += `DISCUSSÃO #${i + 1}:\n`;
        contextString += `Autor: ${post.author}\n`;
        contextString += `Conteúdo: ${post.content}\n`;
        const validComments = post.comments.filter(c => {
            const txt = c.text ? c.text.trim() : "";
            return txt !== "" && !/^\.+$/.test(txt);
        });
        if (validComments.length > 0) {
            contextString += `Respostas e Comentários:\n`;
            validComments.forEach(c => {
                contextString += `- ${c.author}: ${c.text}\n`;
            });
        }
        contextString += `\n`;
    });

    const systemPrompt = `Você é um assistente virtual especialista no software Booking Koala (BK) e em gestão de negócios de limpeza.
Você tem acesso a trechos de discussões reais do grupo de Facebook do Booking Koala.
Responda à pergunta do usuário baseando-se estritamente nas discussões fornecidas no CONTEXTO. 
Seja prestativo, profissional e escreva em Português do Brasil.
Se a informação não estiver no contexto, use o contexto do site oficial do Booking Koala (bookingkoala.com) ou informe que a comunidade de usuários não detalhou esse ponto na base de dados disponível.
Sempre cite o nome dos membros que deram as dicas importantes nas discussões (ex: "Conforme Scott Saladik sugeriu...").

Aqui está o CONTEXTO contendo as discussões do grupo de Facebook:
\"\"\"
${contextString}
\"\"\"`;

    if (provider === 'gemini') {
        // Chamada API do Gemini 1.5 Flash
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                contents: [
                    {
                        role: "user",
                        parts: [
                            { text: `${systemPrompt}\n\nPergunta do Usuário: ${query}` }
                        ]
                    }
                ],
                generationConfig: {
                    temperature: 0.3,
                    maxOutputTokens: 1000
                }
            })
        });

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error?.message || `HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        return data.candidates[0].content.parts[0].text;
        
    } else if (provider === 'openai') {
        // Chamada API da OpenAI GPT-4o-mini
        const url = "https://api.openai.com/v1/chat/completions";
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: query }
                ],
                temperature: 0.3,
                max_tokens: 800
            })
        });

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error?.message || `HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        return data.choices[0].message.content;
    }

    throw new Error("Provedor de IA desconhecido.");
}

// Auxiliares de UI do Chat
function formatMarkdownToHTML(text) {
    const lines = text.split('\n');
    const htmlLines = lines.map(line => {
        const trimmed = line.trim();
        
        // 1. Títulos H3
        if (trimmed.startsWith('### ')) {
            return `<h3>${parseInlineMarkdown(trimmed.substring(4))}</h3>`;
        }
        
        // 2. Títulos H2
        if (trimmed.startsWith('## ')) {
            return `<h2>${parseInlineMarkdown(trimmed.substring(3))}</h2>`;
        }
        
        // 3. Blockquotes
        if (trimmed.startsWith('> ')) {
            let content = trimmed.substring(2);
            // Limpa aspas e itálicos hardcoded extras
            if (content.startsWith('*') && content.endsWith('*')) {
                content = content.slice(1, -1);
            }
            if (content.startsWith('"') && content.endsWith('"')) {
                content = content.slice(1, -1);
            }
            return `<blockquote>${parseInlineMarkdown(content)}</blockquote>`;
        }
        
        // 4. Itens de lista
        if (trimmed.startsWith('- ')) {
            return `<div class="chat-list-item"><span class="chat-list-bullet">•</span><span class="chat-list-text">${parseInlineMarkdown(trimmed.substring(2))}</span></div>`;
        }
        
        // 5. Linha em branco ou separador
        if (trimmed === '---') {
            return '<hr class="chat-divider">';
        }
        
        if (trimmed === '') {
            return '';
        }
        
        return `<p>${parseInlineMarkdown(line)}</p>`;
    });

    return htmlLines.filter(l => l !== '').join('');
}

function parseInlineMarkdown(text) {
    return text
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>');
}

function appendMessage(text, sender) {
    const container = document.getElementById("chat-messages");
    const msgDiv = document.createElement("div");
    msgDiv.className = `message ${sender}`;
    
    const contentDiv = document.createElement("div");
    contentDiv.className = "message-content";
    contentDiv.innerHTML = formatMarkdownToHTML(text);
    msgDiv.appendChild(contentDiv);

    const metaDiv = document.createElement("div");
    metaDiv.className = "message-meta";
    metaDiv.innerText = sender === 'user' ? 'Você' : (aiConfig.provider !== 'none' ? 'IA Koala' : 'Sistema');
    msgDiv.appendChild(metaDiv);

    container.appendChild(msgDiv);
}

function appendSystemMessage(text) {
    const container = document.getElementById("chat-messages");
    const msgDiv = document.createElement("div");
    msgDiv.className = "message assistant";
    msgDiv.style.borderLeft = "3px solid var(--accent-blue)";
    
    const contentDiv = document.createElement("div");
    contentDiv.className = "message-content";
    contentDiv.innerHTML = text;
    msgDiv.appendChild(contentDiv);
    
    const metaDiv = document.createElement("div");
    metaDiv.className = "message-meta";
    metaDiv.innerText = "Sistema";
    msgDiv.appendChild(metaDiv);
    
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
}

function appendTypingIndicator() {
    const container = document.getElementById("chat-messages");
    const msgDiv = document.createElement("div");
    const id = "typing-" + Date.now();
    msgDiv.id = id;
    msgDiv.className = "message assistant";
    msgDiv.innerHTML = `
        <div style="display: flex; gap: 4px; align-items: center; padding: 4px 10px;">
            <span>North Cleaning - Koala Hub está buscando e analisando as discussões</span>
            <span class="typing-dot" style="width:6px;height:6px;background:var(--text-muted);border-radius:50%;animation:typingBounce 1.4s infinite 0.2s;"></span>
            <span class="typing-dot" style="width:6px;height:6px;background:var(--text-muted);border-radius:50%;animation:typingBounce 1.4s infinite 0.4s;"></span>
            <span class="typing-dot" style="width:6px;height:6px;background:var(--text-muted);border-radius:50%;animation:typingBounce 1.4s infinite 0.6s;"></span>
        </div>
    `;
    
    // Adiciona animação de bouncing no documento temporariamente se não houver
    if (!document.getElementById("style-typing-anim")) {
        const style = document.createElement("style");
        style.id = "style-typing-anim";
        style.innerHTML = `
            @keyframes typingBounce {
                0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
                40% { transform: scale(1); opacity: 1; }
            }
        `;
        document.head.appendChild(style);
    }

    container.appendChild(msgDiv);
    return id;
}

function removeTypingIndicator(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
}

// ==========================================================================
// SEÇÃO 3: APOSTILA PDF (Injeção Dinâmica de Conteúdo Curado)
// ==========================================================================
function generateApostila() {
    const container = document.getElementById("apostila-chapters-container");
    if (!container) return;

    container.innerHTML = "";

    knowledgeBase.themes.forEach((theme, index) => {
        const themePosts = knowledgeBase.posts.filter(p => p.theme_id === theme.id);
        
        // Pega os posts mais significativos (comentados ou longos)
        const relevantPosts = themePosts
            .sort((a, b) => b.comments.length - a.comments.length)
            .slice(0, 10); // Exibe até 10 posts principais por capítulo para manter a apostila concisa

        const chapterDiv = document.createElement("div");
        chapterDiv.className = "chapter";

        // Cabeçalho do capítulo
        const chHeader = document.createElement("div");
        chHeader.className = "chapter-header";
        chHeader.innerHTML = `
            <div class="chapter-number">Capítulo ${index + 1}</div>
            <h3 class="chapter-title">${theme.name.split(' (')[0]}</h3>
        `;
        chapterDiv.appendChild(chHeader);

        // Introdução do capítulo baseada no tema
        const chIntro = document.createElement("div");
        chIntro.className = "chapter-intro";
        chIntro.innerHTML = `
            <strong>Resumo do Capítulo:</strong> ${theme.description} 
            Este capítulo compila as discussões mais importantes e as principais dores de cabeças resolvidas pelos membros do grupo de Booking Koala em relação a este tópico.
        `;
        chapterDiv.appendChild(chIntro);

        // Lista de Posts do Capítulo
        const postsContainer = document.createElement("div");
        postsContainer.className = "chapter-posts";

        if (relevantPosts.length === 0) {
            postsContainer.innerHTML = `<p style="font-size: 13px; color: var(--text-muted); font-style: italic;">Nenhuma discussão relevante cadastrada neste capítulo ainda.</p>`;
        } else {
            relevantPosts.forEach(post => {
                const postCard = document.createElement("div");
                postCard.className = "book-post-card";
                
                const validComments = post.comments.filter(c => {
                    const txt = c.text ? c.text.trim() : "";
                    return txt !== "" && !/^\.+$/.test(txt);
                });

                let commentsHtml = "";
                if (validComments.length > 0) {
                    commentsHtml = `<div class="book-replies-list">`;
                    validComments.forEach(c => {
                        commentsHtml += `
                            <div class="book-reply">
                                <div class="book-reply-author">${c.author}</div>
                                <div class="book-reply-text">${c.text}</div>
                            </div>
                         `;
                    });
                    commentsHtml += `</div>`;
                }

                postCard.innerHTML = `
                    <div class="book-post-meta">
                        Publicado por <span class="book-post-author">${post.author}</span>
                    </div>
                    <div class="book-post-text">${post.content}</div>
                    ${commentsHtml}
                `;
                postsContainer.appendChild(postCard);
            });
        }

        chapterDiv.appendChild(postsContainer);
        container.appendChild(chapterDiv);
    });
}

// ==========================================================================
// SEÇÃO 4: TREINAMENTOS (Carregamento Dinâmico, Player e Busca Reativa)
// ==========================================================================

// Carregar Treinamentos do JSON e renderizar
async function fetchTrainings() {
    try {
        const response = await fetch("treinamentos.json");
        if (!response.ok) {
            throw new Error(`Falha ao ler o arquivo JSON de treinamentos: ${response.status}`);
        }
        allTrainings = await response.json();
        renderTrainings(allTrainings);
        setupTrainingsSearch();
    } catch (error) {
        console.error("Erro ao carregar os treinamentos:", error);
        const container = document.getElementById("trainings-container");
        if (container) {
            container.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: var(--text-muted); font-family: var(--font-outfit);">Erro ao carregar os tutoriais em vídeo.</div>`;
        }
    }
}

// Renderizar cards de treinamentos no container
function renderTrainings(trainingsList) {
    const container = document.getElementById("trainings-container");
    if (!container) return;
    
    container.innerHTML = "";
    
    if (trainingsList.length === 0) {
        container.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: var(--text-muted); font-family: var(--font-outfit); font-size: 15px;">Nenhum tutorial encontrado para a pesquisa informada.</div>`;
        return;
    }
    
    trainingsList.forEach(training => {
        const card = document.createElement("div");
        card.className = "training-card";
        card.setAttribute("data-index", training.index);
        
        // Formata os passos em HTML
        let stepsHtml = "";
        if (training.steps && training.steps.length > 0) {
            stepsHtml = `
                <div class="training-steps">
                    <h4>Passo a Passo:</h4>
                    ${training.steps.map((step, idx) => `
                        <div class="step-item">
                            <span class="step-num">${idx + 1}.</span>
                            <span class="step-text">${step}</span>
                        </div>
                    `).join('')}
                </div>
            `;
        }
        
        // Formata a transcrição com timestamps
        const transcriptText = training.transcript || "Transcrição não disponível para este vídeo.";
        
        card.innerHTML = `
            <div class="video-container">
                <iframe src="https://www.youtube.com/embed/${training.video_id}" title="${training.title_pt}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe>
            </div>
            <div class="training-info">
                <div class="training-header">
                    <span class="training-num">Tutorial #${training.index}</span>
                    <h3 class="training-title">${training.title_pt}</h3>
                </div>
                <p class="training-description">${training.description_pt}</p>
                ${stepsHtml}
                <details class="training-transcript-details">
                    <summary class="training-transcript-summary">Ver Transcrição Completa</summary>
                    <div class="training-transcript-content">${transcriptText}</div>
                </details>
            </div>
        `;
        
        container.appendChild(card);
    });
}

// Configurar a busca de treinamentos reativa
function setupTrainingsSearch() {
    const searchInput = document.getElementById("input-search-trainings");
    if (!searchInput) return;
    
    searchInput.addEventListener("input", (e) => {
        const query = e.target.value.toLowerCase().trim();
        if (!query) {
            renderTrainings(allTrainings);
            return;
        }
        
        // Divide a query em palavras para correspondência mais flexível
        const queryWords = query.split(/\s+/).filter(w => w.length > 1);
        
        const filtered = allTrainings.filter(training => {
            const titlePt = (training.title_pt || "").toLowerCase();
            const titleEn = (training.title || "").toLowerCase();
            const desc = (training.description_pt || "").toLowerCase();
            const transcript = (training.transcript || "").toLowerCase();
            const stepsText = (training.steps || []).join(" ").toLowerCase();
            
            // Cada palavra da pesquisa deve bater em algum dos campos
            return queryWords.every(word => {
                return titlePt.includes(word) || 
                       titleEn.includes(word) || 
                       desc.includes(word) || 
                       transcript.includes(word) || 
                       stepsText.includes(word);
            });
        });
        
        renderTrainings(filtered);
    });
}
