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
let isApostilaGenerated = false;
let isTrainingsRendered = false;
let hoveredNodeId = null;
let dimmedNodes = new Set();

// ==========================================================================
// CONFIG DE FÍSICA DO GRAFO — ajuste estes valores para tunar o movimento
// Biblioteca: vis-network (engine Barnes-Hut interna)
// Nota: valores diferentes do d3-force! damping 0.5–0.9, não 0.3–0.4.
// ==========================================================================
const GRAPH_PHYSICS = {
    // Barnes-Hut (repulsão) — vis-network semantics
    gravitationalConstant: -4000,  // Repulsão forte para clusters bem separados
    centralGravity:        0.08,   // Atrai suavemente pro centro
    springLength:          100,    // Comprimento base das molas
    springConstant:        0.01,   // Molas macias (orgânico)
    damping:               0.85,   // 0.5–0.9 (vis-network default: 0.88. 0.85 = suave mas estável)
    avoidOverlap:          1.5,    // Separação extra entre nós

    // Drag reativo
    springConstantDrag:    0.08,   // Molas mais rígidas durante drag (reação imediata)
    dragRecoverMs:         2000,   // Tempo para voltar ao springConstant normal após drag

    // Hover highlight
    hover: {
        dimmedOpacity: 0.08  // Opacidade dos nós não conectados
    }
};

// Mapeamento de cores de temas para consistência (19 categorias)
const themeColors = {
    'theme-primeiros-passos':  '#06b6d4',
    'theme-migracao':          '#f59e0b',
    'theme-precificacao':      '#3b82f6',
    'theme-tipos-servico':     '#10b981',
    'theme-agendamento':       '#ec4899',
    'theme-pagamentos':        '#8b5cf6',
    'theme-equipe':            '#f97316',
    'theme-marketing-anuncios':'#0ea5e9',
    'theme-marketing-seo':     '#14b8a6',
    'theme-marketing-leads':   '#a855f7',
    'theme-automacao-ia':      '#ef4444',
    'theme-website':           '#eab308',
    'theme-funcionalidades':   '#6366f1',
    'theme-suporte':           '#64748b',
    'theme-equipamentos':      '#84cc16',
    'theme-danos':             '#dc2626',
    'theme-financas':          '#0891b2',
    'theme-conteudo':          '#d946ef',
    'theme-discussoes-gerais': '#78716c'
};

// Lista de Stopwords comuns em português e inglês para busca semântica simples
const STOPWORDS = new Set([
    'a', 'o', 'as', 'os', 'de', 'do', 'da', 'dos', 'das', 'em', 'um', 'uma', 'uns', 'umas',
    'com', 'para', 'por', 'que', 'se', 'na', 'no', 'nas', 'nos', 'ao', 'aos', 'ou', 'e',
    'is', 'the', 'of', 'in', 'to', 'for', 'with', 'on', 'at', 'by', 'an', 'and', 'how', 'what',
    'why', 'do', 'does', 'it', 'booking', 'koala', 'bookingkoala', 'bk', 'clean', 'cleaning'
]);

// Inicialização da Página
document.addEventListener("DOMContentLoaded", () => {
    // 0. Esconder loading screen
    const loadingEl = document.getElementById("loading-screen");
    if (loadingEl) {
        loadingEl.classList.add("hidden");
        setTimeout(() => { loadingEl.style.display = "none"; }, 500);
    }
    
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
    let needsUpdate = false;
    
    if (savedConfig) {
        try {
            aiConfig = JSON.parse(savedConfig);
            // Se a chave for diferente da fornecida pelo usuário ou o provedor for diferente de 'glm', força a atualização
            if (aiConfig.provider !== 'glm' || aiConfig.apiKey !== '7c1111237d10418cb82a36a12597d25e.TczJzDaxvIEIRaZC') {
                needsUpdate = true;
            }
        } catch (e) {
            console.error("Erro ao carregar configurações de IA do localStorage:", e);
            needsUpdate = true;
        }
    } else {
        needsUpdate = true;
    }
    
    if (needsUpdate) {
        // Pré-configura a chave Zhipu GLM fornecida pelo usuário como padrão
        aiConfig = {
            provider: 'glm',
            apiKey: '7c1111237d10418cb82a36a12597d25e.TczJzDaxvIEIRaZC'
        };
        localStorage.setItem("koala_hub_ai_config", JSON.stringify(aiConfig));
    }
    
    // Atualizar elementos da UI
    const providerSelect = document.getElementById("select-ai-provider");
    const apiKeyInput = document.getElementById("input-api-key");
    if (providerSelect && apiKeyInput) {
        providerSelect.value = aiConfig.provider;
        apiKeyInput.value = aiConfig.apiKey;
        toggleAPIKeyField(aiConfig.provider);
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
    if (provider === 'glm') return 'Zhipu GLM 4.5 Flash (RAG Ativo)';
    return 'Busca Semântica Local (Sem IA)';
}

function toggleAPIKeyField(provider) {
    const group = document.getElementById("api-key-form-group");
    if (provider === 'none') {
        group.style.display = "none";
    } else {
        group.style.display = "flex";
        let placeholder = "Digite sua OpenAI API Key...";
        if (provider === 'gemini') placeholder = "Digite sua Gemini API Key...";
        if (provider === 'glm') placeholder = "Digite sua Zhipu GLM API Key...";
        document.getElementById("input-api-key").placeholder = placeholder;
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
        // generateApostila() e renderização de treinamentos foram movidos para carregamento lazy na mudança de aba
        
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

    // Controles do Grafo — stopPropagation para evitar que o canvas do vis-network intercepte
    const graphControls = document.querySelector(".graph-controls");
    if (graphControls) {
        graphControls.addEventListener("mousedown", (e) => e.stopPropagation());
        graphControls.addEventListener("mouseup", (e) => e.stopPropagation());
        graphControls.addEventListener("click", (e) => e.stopPropagation());
    }

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
    
    // Lazy Generation da Apostila PDF ao acessar a aba correspondente
    if (tabId === 'pdf' && !isApostilaGenerated) {
        generateApostila();
        isApostilaGenerated = true;
    }
    
    // Lazy Rendering dos cartões de Treinamentos ao acessar a aba correspondente
    if (tabId === 'trainings' && !isTrainingsRendered) {
        renderTrainings(allTrainings);
        isTrainingsRendered = true;
    }
    
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

// Gerar legenda dinâmica com cores reais das categorias existentes
function generateGraphLegend() {
    const legend = document.getElementById('graph-legend');
    if (!legend || !knowledgeBase.themes) return;

    let html = '';
    // Nó central
    html += `<div class="legend-item">
        <div class="legend-dot" style="background:#ffffff; box-shadow:0 0 10px rgba(255,255,255,0.7); border:2px solid #8b5cf6;"></div>
        <span>Base de Conhecimento</span>
    </div>`;

    // Categorias com suas cores
    knowledgeBase.themes.forEach(theme => {
        const color = themeColors[theme.id] || '#8b5cf6';
        const shortName = theme.name.split(' (')[0];
        html += `<div class="legend-item">
            <div class="legend-dot" style="background:${color}; box-shadow:0 0 8px ${color}80;"></div>
            <span>${shortName}</span>
        </div>`;
    });

    legend.innerHTML = html;
}

function initGrafo() {
    const container = document.getElementById("graph-container");
    if (!container) return;

    const nodesArray = [];
    const edgesArray = [];

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
            label: theme.name.split(' (')[0],
            title: `<b>${theme.name}</b><br>${theme.description}`,
            group: 'theme',
            size: 18,
            borderWidth: 2,
            borderWidthSelected: 4,
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
                size: 13,
                face: 'Outfit',
                weight: '600'
            },
            shadow: {
                enabled: true,
                color: color,
                size: 12,
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
            <div style="font-weight: 700; color: ${themeColor}; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">Publicado por ${post.author}</div>
            <div style="font-weight: 600; color: #ffffff; margin-bottom: 6px; font-family: 'Outfit', sans-serif; font-size: 13px;">${titleText}</div>
            <div style="color: #94a3b8; font-size: 11px;">${post.content.substring(0, 130)}${post.content.length > 130 ? '...' : ''}</div>
        `;

        nodesArray.push({
            id: post.post_id,
            label: '', 
            title: tooltipEl, 
            group: 'post',
            size: 5,
            borderWidth: 1,
            borderWidthSelected: 2,
            color: {
                background: themeColor,  // Cor do tema (mesma cor da categoria)
                border: 'rgba(255,255,255,0.15)',
                highlight: {
                    background: themeColor,
                    border: '#ffffff'
                },
                hover: {
                    background: themeColor,
                    border: '#ffffff'
                }
            }
        });

        // Conecta o post ao seu respectivo tema — edges coloridas com a cor do tema
        edgesArray.push({
            from: post.post_id,
            to: post.theme_id,
            color: {
                color: themeColor + '25',       // 15% opacidade da cor do tema
                highlight: themeColor,
                hover: themeColor
            },
            width: 0.6,
            hoverWidth: 1.5,
            selectionWidth: 2
        });
    });

    const data = {
        nodes: new vis.DataSet(nodesArray),
        edges: new vis.DataSet(edgesArray)
    };

    const options = {
        layout: {
            improvedLayout: false
        },
        nodes: {
            shape: 'dot'
        },
        edges: {
            arrows: { to: { enabled: false } },
            smooth: false
        },
        physics: {
            enabled: true,
            solver: 'barnesHut',
            barnesHut: {
                gravitationalConstant: GRAPH_PHYSICS.gravitationalConstant,
                centralGravity:        GRAPH_PHYSICS.centralGravity,
                springLength:          GRAPH_PHYSICS.springLength,
                springConstant:        GRAPH_PHYSICS.springConstant,
                damping:               GRAPH_PHYSICS.damping,
                avoidOverlap:          GRAPH_PHYSICS.avoidOverlap,
                theta: 0.5  // Barnes-Hut accuracy (0.5 = equilíbrio speed/quality)
            },
            stabilization: {
                enabled: true,
                iterations: 150,
                updateInterval: 25,
                fit: true
            }
        },
        interaction: {
            hover: true,
            tooltipDelay: 120,
            zoomView: true,
            dragView: true,
            dragNodes: true,
            hideEdgesOnDrag: false,
            navigationButtons: false
        }
    };

    // Criar a rede Vis.js
    network = new vis.Network(container, data, options);

    // Gerar legenda dinâmica com cores reais das categorias
    generateGraphLegend();

    // ---- FASE 1: Após estabilização, manter physics ativo para flutuação contínua ----
    network.once("stabilizationIterationsDone", () => {
        // Manter física ativo mas com estabilização desligada
        // minVelocity > 0 para evitar overflow recursivo no Barnes-Hut
        network.setOptions({
            physics: {
                enabled: true,
                stabilization: { enabled: false }
            }
        });
        isPhysicsEnabled = true;

        const btn = document.getElementById("btn-toggle-physics");
        if (btn) {
            btn.innerHTML = `
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="6" y="4" width="4" height="16"></rect>
                    <rect x="14" y="4" width="4" height="16"></rect>
                </svg>
                Congelar Grafo
            `;
        }
    });

    // ---- DRAG: manter física reativa durante arrasto ----
    network.on("dragStart", (params) => {
        if (params.nodes.length > 0) {
            // Molas mais rígidas durante drag para reatividade imediata
            network.setOptions({
                physics: {
                    barnesHut: { springConstant: GRAPH_PHYSICS.springConstantDrag }
                }
            });
        }
    });

    network.on("dragEnd", (params) => {
        if (params.nodes.length > 0) {
            const nodeId = params.nodes[0];
            // Liberar nó para voltar a flutuar
            network.releaseNode(nodeId);
            // Relaxar molas gradualmente
            setTimeout(() => {
                if (isPhysicsEnabled) {
                    network.setOptions({
                        physics: {
                            barnesHut: { springConstant: GRAPH_PHYSICS.springConstant }
                        }
                    });
                }
            }, GRAPH_PHYSICS.dragRecoverMs);
        }
    });

    // ---- HOVER: highlight nó + conexões, escurecer resto ----
    network.on("hoverNode", (params) => {
        hoveredNodeId = params.node;
        applyHoverHighlight(params.node, true);
    });

    network.on("blurNode", () => {
        hoveredNodeId = null;
        applyHoverHighlight(null, false);
    });

    // Evento de Clique no Nó
    network.on("click", (params) => {
        if (params.nodes.length > 0) {
            const clickedNodeId = params.nodes[0];
            if (!clickedNodeId.startsWith('theme-')) {
                openPostDrawer(clickedNodeId);
            }
        }
    });
}

// ---- HOVER HIGHLIGHT: glow no nó focado, fade nos demais ----
function applyHoverHighlight(focusedNodeId, isHover) {
    if (!network) return;
    const allNodes = network.body.data.nodes;

    if (!isHover || focusedNodeId === null) {
        // Restaurar opacidade de todos
        const resets = [];
        allNodes.forEach(node => {
            if (node.hidden) return;
            resets.push({ id: node.id, opacity: undefined });
        });
        allNodes.update(resets);
        dimmedNodes.clear();
        return;
    }

    // Encontrar nós conectados ao focado
    const connectedIds = new Set([focusedNodeId]);
    const allEdges = network.body.data.edges;
    allEdges.forEach(edge => {
        if (edge.from === focusedNodeId) connectedIds.add(edge.to);
        if (edge.to === focusedNodeId) connectedIds.add(edge.from);
    });

    // Escurecer nós não conectados
    const updates = [];
    dimmedNodes.clear();
    allNodes.forEach(node => {
        if (node.hidden) return;
        if (!connectedIds.has(node.id)) {
            updates.push({ id: node.id, opacity: GRAPH_PHYSICS.hover.dimmedOpacity });
            dimmedNodes.add(node.id);
        } else {
            updates.push({ id: node.id, opacity: undefined }); // restaurar
        }
    });
    allNodes.update(updates);
}

function togglePhysics() {
    isPhysicsEnabled = !isPhysicsEnabled;
    const btn = document.getElementById("btn-toggle-physics");
    
    if (network) {
        if (isPhysicsEnabled) {
            // Reativar flutuação idle
            network.setOptions({
                physics: {
                    enabled: true,
                    stabilization: { enabled: false }
                }
            });
        } else {
            // Congelar: desligar física
            network.setOptions({ physics: { enabled: false } });
        }
    }
    
    if (btn) {
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
}

function resetGraphZoom() {
    if (network) {
        network.fit();
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
        // Encontrar as discussões e treinamentos mais semelhantes localmente
        const contextData = searchLocalKnowledge(query);

        let replyText = "";

        if (aiConfig.provider === 'none') {
            // Resposta Sintetizada Local (Sem API Key)
            replyText = formatLocalSynthesizedResponse(query, contextData);
        } else {
            // Chamada de API Oficial (RAG de Verdade com LLM)
            replyText = await callAIChatAPI(query, contextData);
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

// Algoritmo de busca simplificada baseada em palavras-chave unificada (posts + treinamentos)
function searchLocalKnowledge(query) {
    // Normalizar query: minúscula, remover pontuação
    const cleanQuery = query.toLowerCase().replace(/[^\w\s]/g, ' ');
    const queryWords = cleanQuery.split(/\s+/).filter(w => w.length > 2 && !STOPWORDS.has(w));

    if (queryWords.length === 0) {
        // Fallback: se não sobrou nenhuma palavra-chave, retorna os primeiros itens de cada
        return {
            posts: knowledgeBase.posts.slice(0, 15),
            trainings: (allTrainings || []).slice(0, 8)
        };
    }

    // 1. Pontuação de Posts do Facebook
    const scoredPosts = knowledgeBase.posts.map(post => {
        let score = 0;
        const postText = (post.content + " " + post.author).toLowerCase();
        
        queryWords.forEach(word => {
            // Contagem segura de ocorrências usando split em vez de regex
            const count = postText.split(word).length - 1;
            score += count * 3; // Peso 3 para texto do post principal
        });

        post.comments.forEach(c => {
            const commentText = (c.text + " " + c.author).toLowerCase();
            queryWords.forEach(word => {
                const count = commentText.split(word).length - 1;
                score += count * 1.5; // Peso 1.5 para comentários (aumentado para melhor RAG)
            });
        });

        return { post, score };
    });

    const filteredPosts = scoredPosts
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .map(item => item.post);

    // 2. Pontuação de Tutoriais de Treinamento
    const scoredTrainings = (allTrainings || []).map(tr => {
        let score = 0;
        const titlePt = (tr.title_pt || "").toLowerCase();
        const titleEn = (tr.title || "").toLowerCase();
        const desc = (tr.description_pt || "").toLowerCase();
        const stepsText = (tr.steps || []).join(" ").toLowerCase();
        const transcript = (tr.transcript || "").toLowerCase();
        
        const fullText = `${titlePt} ${titleEn} ${desc} ${stepsText} ${transcript}`;
        
        queryWords.forEach(word => {
            const count = fullText.split(word).length - 1;
            score += count * 4; // Peso 4 para guias oficiais e passo a passos
        });
        
        return { training: tr, score };
    });

    const filteredTrainings = scoredTrainings
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .map(item => item.training);

    // Retorna os top 15 posts e top 8 treinamentos para cobrir o máximo possível do banco de dados no RAG
    return {
        posts: filteredPosts.length > 0 ? filteredPosts.slice(0, 15) : knowledgeBase.posts.slice(0, 15),
        trainings: filteredTrainings.length > 0 ? filteredTrainings.slice(0, 8) : (allTrainings || []).slice(0, 8)
    };
}

// Formatação da Resposta Sintetizada Local (Offline)
function formatLocalSynthesizedResponse(query, contextData) {
    const { posts, trainings } = contextData;
    let response = "";
    
    if (trainings.length > 0) {
        response += `### 🎓 Tutoriais de Treinamento Encontrados:\n`;
        trainings.forEach((tr, index) => {
            response += `**${index + 1}. ${tr.title_pt}**\n`;
            response += `> *"${tr.description_pt}"*\n`;
            if (tr.steps && tr.steps.length > 0) {
                response += `**Passos sugeridos:**\n`;
                tr.steps.slice(0, 3).forEach(step => {
                    response += `- ${step}\n`;
                });
            }
            response += `[Ver vídeo no YouTube](${tr.url})\n\n`;
        });
        response += `\n---\n\n`;
    }

    if (posts.length > 0) {
        response += `### 💬 Discussões Relevantes da Comunidade:\n`;
        posts.forEach((post, index) => {
            const theme = knowledgeBase.themes.find(t => t.id === post.theme_id);
            const themeName = theme ? theme.name.split(' (')[0] : "Geral";
            
            response += `**${index + 1}. Discussão de ${post.author}** (${themeName})\n`;
            response += `> *"${post.content.substring(0, 180)}..."*\n`;
            
            const validComments = post.comments.filter(c => {
                const txt = c.text ? c.text.trim() : "";
                return txt !== "" && !/^\.+$/.test(txt);
            });

            if (validComments.length > 0) {
                response += `**Principais Respostas:**\n`;
                validComments.slice(0, 1).forEach(c => {
                    response += `- **${c.author}**: "${c.text.substring(0, 140)}..."\n`;
                });
            }
            response += `\n`;
        });
    }

    if (response === "") {
        return "Não encontrei nenhuma discussão ou tutorial relevante específica para sua pergunta na base de conhecimento. Tente reformular usando termos mais comuns de Booking Koala.";
    }

    response += `\n---\n💡 *Dica: Ative o Zhipu GLM 4.5 Flash ou outro provedor em "Configurar IA" no cabeçalho superior para que eu possa gerar uma resposta unificada baseada nessas discussões de forma automática.*`;

    return response;
}

// Chamada de API RAG (Gemini, OpenAI ou GLM)
async function callAIChatAPI(query, contextData) {
    const provider = aiConfig.provider;
    const apiKey = aiConfig.apiKey;

    if (!apiKey) {
        throw new Error("API Key não configurada. Vá em 'Configurar IA' no cabeçalho superior.");
    }

    const { posts, trainings } = contextData;

    // Preparar o Contexto das discussões e treinamentos para injetar no Prompt da IA
    let contextString = "";
    
    if (posts && posts.length > 0) {
        contextString += "=== DISCUSSÕES RELEVANTES DA COMUNIDADE (FACEBOOK) ===\n";
        posts.forEach((post, i) => {
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
    }
    
    if (trainings && trainings.length > 0) {
        contextString += "=== TUTORIAIS OFICIAIS DE CONFIGURAÇÃO (TREINAMENTOS) ===\n";
        trainings.forEach((tr, i) => {
            contextString += `TUTORIAL #${i + 1}: ${tr.title_pt} (${tr.title})\n`;
            contextString += `Descrição: ${tr.description_pt}\n`;
            if (tr.steps && tr.steps.length > 0) {
                contextString += `Passo a Passo:\n`;
                tr.steps.forEach((step, idx) => {
                    contextString += `  ${idx + 1}. ${step}\n`;
                });
            }
            contextString += `Link do vídeo no YouTube: https://www.youtube.com/watch?v=${tr.video_id}\n\n`;
        });
    }

    const systemPrompt = `Você é um assistente virtual especialista no software Booking Koala (BK) e em gestão de negócios de limpeza.
Você tem acesso a trechos de discussões reais do grupo de Facebook do Booking Koala e tutoriais passo a passo em português extraídos dos vídeos de treinamento oficiais da plataforma.
Responda à pergunta do usuário baseando-se estritamente no CONTEXTO fornecido (que inclui discussões da comunidade e tutoriais passo a passo).
Seja prestativo, profissional e escreva em Português do Brasil.
Sempre que usar informações dos tutoriais de treinamento, cite que há um tutorial em vídeo disponível sobre o assunto (ex: "De acordo com o Tutorial de Treinamento sobre 'Desativar Popup na Seleção de Categorias'...").
Sempre cite o nome dos membros do grupo de Facebook que deram as dicas importantes nas discussões (ex: "Conforme Scott Saladik sugeriu...").
Se a informação não estiver no contexto, use o contexto do site oficial do Booking Koala (bookingkoala.com) ou informe que a comunidade de usuários não detalhou esse ponto na base de dados disponível.

Aqui está o CONTEXTO contendo as discussões e tutoriais:
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
        
    } else if (provider === 'glm') {
        // Chamada API da Zhipu AI GLM-4.5-Flash via gateway Z.ai
        const url = "https://api.z.ai/api/paas/v4/chat/completions";
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: "glm-4.5-flash",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: query }
                ],
                temperature: 0.3,
                max_tokens: 1000
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

    // Avatar
    const avatarDiv = document.createElement("div");
    avatarDiv.className = "message-avatar";
    if (sender === 'user') {
        avatarDiv.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
    } else {
        avatarDiv.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a4 4 0 0 1 4 4v1a1 1 0 0 0 1 1h1a4 4 0 0 1 0 8h-1a1 1 0 0 0-1 1v1a4 4 0 0 1-8 0v-1a1 1 0 0 0-1-1H5a4 4 0 0 1 0-8h1a1 1 0 0 0 1-1V6a4 4 0 0 1 4-4z"/></svg>`;
    }
    msgDiv.appendChild(avatarDiv);

    // Body
    const bodyDiv = document.createElement("div");
    bodyDiv.className = "message-body";

    const senderDiv = document.createElement("div");
    senderDiv.className = "message-sender";
    senderDiv.innerText = sender === 'user' ? 'Você' : 'Booking Koala AI';
    bodyDiv.appendChild(senderDiv);

    const contentDiv = document.createElement("div");
    contentDiv.className = "message-content";
    contentDiv.innerHTML = formatMarkdownToHTML(text);
    bodyDiv.appendChild(contentDiv);

    const metaDiv = document.createElement("div");
    metaDiv.className = "message-meta";
    metaDiv.innerText = sender === 'user' ? 'Você' : (aiConfig.provider !== 'none' ? 'IA Koala' : 'Sistema');
    bodyDiv.appendChild(metaDiv);

    msgDiv.appendChild(bodyDiv);
    container.appendChild(msgDiv);
}

function appendSystemMessage(text) {
    const container = document.getElementById("chat-messages");
    const msgDiv = document.createElement("div");
    msgDiv.className = "message assistant";
    msgDiv.style.borderLeft = "3px solid var(--accent-blue)";

    const avatarDiv = document.createElement("div");
    avatarDiv.className = "message-avatar";
    avatarDiv.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
    msgDiv.appendChild(avatarDiv);

    const bodyDiv = document.createElement("div");
    bodyDiv.className = "message-body";

    const senderDiv = document.createElement("div");
    senderDiv.className = "message-sender";
    senderDiv.innerText = "Sistema";
    bodyDiv.appendChild(senderDiv);

    const contentDiv = document.createElement("div");
    contentDiv.className = "message-content";
    contentDiv.innerHTML = text;
    bodyDiv.appendChild(contentDiv);

    msgDiv.appendChild(bodyDiv);
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
}

function appendTypingIndicator() {
    const container = document.getElementById("chat-messages");
    const msgDiv = document.createElement("div");
    const id = "typing-" + Date.now();
    msgDiv.id = id;
    msgDiv.className = "message assistant";

    const avatarDiv = document.createElement("div");
    avatarDiv.className = "message-avatar";
    avatarDiv.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a4 4 0 0 1 4 4v1a1 1 0 0 0 1 1h1a4 4 0 0 1 0 8h-1a1 1 0 0 0-1 1v1a4 4 0 0 1-8 0v-1a1 1 0 0 0-1-1H5a4 4 0 0 1 0-8h1a1 1 0 0 0 1-1V6a4 4 0 0 1 4-4z"/></svg>`;
    msgDiv.appendChild(avatarDiv);

    const bodyDiv = document.createElement("div");
    bodyDiv.className = "message-body";
    bodyDiv.innerHTML = `
        <div class="message-sender">Booking Koala AI</div>
        <div style="display: flex; gap: 5px; align-items: center; padding: 6px 0;">
            <span class="typing-dot" style="width:6px;height:6px;background:var(--accent-purple);border-radius:50%;animation:typingBounce 1.4s infinite 0.2s;"></span>
            <span class="typing-dot" style="width:6px;height:6px;background:var(--accent-purple);border-radius:50%;animation:typingBounce 1.4s infinite 0.4s;"></span>
            <span class="typing-dot" style="width:6px;height:6px;background:var(--accent-purple);border-radius:50%;animation:typingBounce 1.4s infinite 0.6s;"></span>
            <span style="margin-left: 6px; font-size: 13px; color: var(--text-muted);">buscando e analisando discussões</span>
        </div>
    `;
    msgDiv.appendChild(bodyDiv);
    
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

// Carregar Treinamentos do JSON sem renderizar imediatamente (Lazy Loading de DOM)
async function fetchTrainings() {
    try {
        const response = await fetch("treinamentos.json");
        if (!response.ok) {
            throw new Error(`Falha ao ler o arquivo JSON de treinamentos: ${response.status}`);
        }
        allTrainings = await response.json();
        // Apenas configura a busca e adia a renderização de elementos pesados do DOM
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
            <div class="video-container" onclick="loadYoutubeVideo(this, '${training.video_id}', '${training.title_pt.replace(/'/g, "\\'")}')">
                <div class="video-thumbnail-container">
                    <img class="video-thumbnail" src="https://img.youtube.com/vi/${training.video_id}/mqdefault.jpg" alt="${training.title_pt}" loading="lazy">
                </div>
                <div class="play-btn">
                    <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                </div>
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

// Carregar o iframe do YouTube sob demanda (Lazy Loading no clique)
window.loadYoutubeVideo = function(container, videoId, title) {
    if (container.querySelector('iframe')) return; // Já carregou
    
    // Injeta o iframe e inicia com autoplay
    container.innerHTML = `
        <iframe src="https://www.youtube.com/embed/${videoId}?autoplay=1" title="${title}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
    `;
};

// Configurar a busca de treinamentos reativa
function setupTrainingsSearch() {
    const searchInput = document.getElementById("input-search-trainings");
    if (!searchInput) return;
    
    searchInput.addEventListener("input", (e) => {
        isTrainingsRendered = true; // Marca que já renderizou, pois a pesquisa forçará o render dos itens filtrados
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
