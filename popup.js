// popup.js carregado de forma clássica

// Elementos da Interface
const statusBadge = document.getElementById('status-badge');
const groupUrlInput = document.getElementById('group-url');
const btnStart = document.getElementById('btn-start');
const postLimitSelect = document.getElementById('post-limit');

// Elementos de Configuração do Gemini
const toggleSettings = document.getElementById('toggle-settings');
const settingsContent = document.getElementById('settings-content');
const settingsArrow = document.getElementById('settings-arrow');
const geminiApiKeyInput = document.getElementById('gemini-api-key');
const useAiExtractionCheckbox = document.getElementById('use-ai-extraction');
const useMediaDownloadCheckbox = document.getElementById('use-media-download');

// Elementos de Configuração do Apify
const toggleApifySettings = document.getElementById('toggle-apify-settings');
const apifySettingsContent = document.getElementById('apify-settings-content');
const apifySettingsArrow = document.getElementById('apify-settings-arrow');
const apifyApiKeyInput = document.getElementById('apify-api-key');
const useApifyExtractionCheckbox = document.getElementById('use-apify-extraction');

const activeControls = document.getElementById('active-controls');
const btnPause = document.getElementById('btn-pause');
const btnResume = document.getElementById('btn-resume');
const btnCancel = document.getElementById('btn-cancel');
const progressPanel = document.getElementById('progress-panel');
const progressPercentage = document.getElementById('progress-percentage');
const timeRemaining = document.getElementById('time-remaining');
const progressBarFill = document.getElementById('progress-bar-fill');
const logBox = document.getElementById('log-box');
const btnClearLogs = document.getElementById('btn-clear-logs');
const btnExport = document.getElementById('btn-export');

// Contadores de estatísticas
const statFound = document.getElementById('stat-found');
const statProcessed = document.getElementById('stat-processed');
const statComments = document.getElementById('stat-comments');
const statPhotos = document.getElementById('stat-photos');
const statVideos = document.getElementById('stat-videos');

let statsInterval = null;

// Função para formatar logs na janela de console
function appendLog(level, text, timestamp = null) {
  const line = document.createElement('div');
  const time = timestamp ? new Date(timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();
  line.className = `log-line log-${level}`;
  line.textContent = `[${time}] ${text}`;
  logBox.appendChild(line);
  logBox.scrollTop = logBox.scrollHeight;
}

// Inicializa a UI do popup
async function initPopup() {
  console.log('popup.js: initPopup() iniciado.');

  // 1. Registra Listeners de Eventos do Usuário IMEDIATAMENTE (não bloqueia por await)
  btnStart.addEventListener('click', startProcess);
  btnPause.addEventListener('click', pauseProcess);
  btnResume.addEventListener('click', resumeProcess);
  btnCancel.addEventListener('click', cancelProcess);
  btnClearLogs.addEventListener('click', clearLogs);
  btnExport.addEventListener('click', exportZip);

  // Configurações do Gemini (Toggle expand/collapse)
  toggleSettings.addEventListener('click', () => {
    const isHidden = settingsContent.classList.contains('hidden');
    if (isHidden) {
      settingsContent.classList.remove('hidden');
      settingsContent.style.display = 'flex';
      settingsArrow.style.transform = 'rotate(90deg)';
    } else {
      settingsContent.classList.add('hidden');
      settingsContent.style.display = 'none';
      settingsArrow.style.transform = 'rotate(0deg)';
    }
  });

  // Configurações do Apify (Toggle expand/collapse)
  toggleApifySettings.addEventListener('click', () => {
    const isHidden = apifySettingsContent.classList.contains('hidden');
    if (isHidden) {
      apifySettingsContent.classList.remove('hidden');
      apifySettingsContent.style.display = 'flex';
      apifySettingsArrow.style.transform = 'rotate(90deg)';
    } else {
      apifySettingsContent.classList.add('hidden');
      apifySettingsContent.style.display = 'none';
      apifySettingsArrow.style.transform = 'rotate(0deg)';
    }
  });

  // Salvar configurações no chrome.storage.local
  geminiApiKeyInput.addEventListener('input', () => {
    chrome.storage.local.set({ gemini_api_key: geminiApiKeyInput.value.trim() });
  });

  useAiExtractionCheckbox.addEventListener('change', () => {
    chrome.storage.local.set({ use_ai_extraction: useAiExtractionCheckbox.checked });
  });

  useMediaDownloadCheckbox.addEventListener('change', () => {
    chrome.storage.local.set({ use_media_download: useMediaDownloadCheckbox.checked });
  });

  apifyApiKeyInput.addEventListener('input', () => {
    chrome.storage.local.set({ apify_api_key: apifyApiKeyInput.value.trim() });
  });

  useApifyExtractionCheckbox.addEventListener('change', () => {
    chrome.storage.local.set({ use_apify_extraction: useApifyExtractionCheckbox.checked });
  });

  // Salvar limite de posts no chrome.storage.local ao mudar
  postLimitSelect.addEventListener('change', () => {
    chrome.storage.local.set({ post_limit: postLimitSelect.value });
  });

  // Carregar configurações salvas
  chrome.storage.local.get([
    'gemini_api_key', 
    'use_ai_extraction', 
    'post_limit', 
    'use_media_download',
    'apify_api_key',
    'use_apify_extraction'
  ], (result) => {
    if (result.gemini_api_key) {
      geminiApiKeyInput.value = result.gemini_api_key;
    }
    if (result.use_ai_extraction !== undefined) {
      useAiExtractionCheckbox.checked = result.use_ai_extraction;
    }
    if (result.use_media_download !== undefined) {
      useMediaDownloadCheckbox.checked = result.use_media_download;
    } else {
      useMediaDownloadCheckbox.checked = false; // Desabilitado por padrão
    }
    
    // Configurações do Apify com os padrões fornecidos pelo usuário
    if (result.apify_api_key) {
      apifyApiKeyInput.value = result.apify_api_key;
    } else {
      // Deixa vazio por padrão para segurança e para evitar detecção no GitHub
      const defaultToken = '';
      apifyApiKeyInput.value = defaultToken;
      chrome.storage.local.set({ apify_api_key: defaultToken });
    }
    
    if (result.use_apify_extraction !== undefined) {
      useApifyExtractionCheckbox.checked = result.use_apify_extraction;
    } else {
      // Ativado por padrão já que ele solicitou essa funcionalidade
      useApifyExtractionCheckbox.checked = true;
      chrome.storage.local.set({ use_apify_extraction: true });
    }

    if (result.post_limit !== undefined) {
      postLimitSelect.value = result.post_limit;
    } else {
      postLimitSelect.value = "0";
      chrome.storage.local.set({ post_limit: "0" });
    }
  });

  // Escuta atualizações de logs em tempo real
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'LOG_UPDATE' && message.data) {
      appendLog(message.data.level, message.data.text);
    }
  });

  console.log('popup.js: Event listeners registrados com sucesso.');

  // 2. Tenta obter estado inicial do background
  try {
    console.log('popup.js: Solicitando estado inicial ao background...');
    const response = await chrome.runtime.sendMessage({ action: 'POPUP_OPENED' });
    console.log('popup.js: Resposta do estado inicial recebida:', response);
    if (response && response.state) {
      updateUI(response.state);
    }
  } catch (err) {
    console.error('popup.js: Erro ao obter estado inicial:', err);
  }

  // 3. Configura logs iniciais do DB
  console.log('popup.js: Tentando ler logs do IndexedDB...');
  try {
    const logs = await db.getLogs(50);
    console.log('popup.js: Logs obtidos com sucesso do IndexedDB:', logs.length);
    logBox.innerHTML = '';
    if (logs.length === 0) {
      appendLog('info', 'Aguardando início do processo...');
    } else {
      logs.forEach(log => appendLog(log.level, log.message, log.timestamp));
    }
  } catch (dbError) {
    console.error('popup.js: Erro crítico ao ler logs do IndexedDB:', dbError);
  }

  // Atualiza contadores imediatamente e inicia intervalo de polling
  try {
    await pollStats();
    statsInterval = setInterval(pollStats, 1000);
  } catch (pollErr) {
    console.error('popup.js: Erro ao iniciar polling de estatísticas:', pollErr);
  }
}


// Inicia polling de estatísticas e progresso
async function pollStats() {
  try {
    const stats = await chrome.runtime.sendMessage({ action: 'GET_STATE' });
    if (stats) {
      statFound.textContent = stats.postsFound;
      statProcessed.textContent = stats.postsProcessed;
      
      // Contadores individuais de comentários por tipo (Fase 13)
      document.getElementById('stat-comments-gql').textContent = stats.commentsGQL;
      document.getElementById('stat-comments-json').textContent = stats.commentsJSON;
      document.getElementById('stat-comments-dom').textContent = stats.commentsDOM;
      document.getElementById('stat-comments-vision').textContent = stats.commentsVision;
      document.getElementById('stat-comments-ocr').textContent = stats.commentsOCR;
      
      statComments.textContent = stats.commentsProcessed;
      statPhotos.textContent = stats.imagesDownloaded;
      statVideos.textContent = stats.videosDownloaded;
      
      // Workers ativos e velocidade (Fase 13)
      document.getElementById('stat-workers-active').textContent = stats.activeWorkers;
      document.getElementById('stat-speed').textContent = stats.speed;

      // Novas métricas de IA e RAG
      document.getElementById('stat-comments-speed').textContent = stats.commentsSpeed || 0;
      document.getElementById('stat-recovery-rate').textContent = (stats.recoveryRate !== undefined ? stats.recoveryRate : 100) + '%';
      
      const kbSize = stats.datasetSizeKB || 0;
      if (kbSize > 1024) {
        document.getElementById('stat-dataset-size').textContent = (kbSize / 1024).toFixed(2) + ' MB';
      } else {
        document.getElementById('stat-dataset-size').textContent = kbSize.toFixed(1) + ' KB';
      }
      
      document.getElementById('stat-embedding-chunks').textContent = stats.embeddingChunks || 0;

      // Habilita export se houver posts processados
      btnExport.disabled = stats.postsProcessed === 0;

      // Atualiza status badge
      if (stats.isRunning) {
        statusBadge.textContent = 'Executando';
        statusBadge.className = 'badge status-running';
        
        btnStart.classList.add('hidden');
        activeControls.classList.remove('hidden');
        btnPause.classList.remove('hidden');
        btnResume.classList.add('hidden');
        progressPanel.classList.remove('hidden');
      } else if (stats.postsProcessed > 0 && stats.postsProcessed < stats.postsFound) {
        statusBadge.textContent = 'Pausado';
        statusBadge.className = 'badge status-paused';
        
        btnStart.classList.add('hidden');
        activeControls.classList.remove('hidden');
        btnPause.classList.add('hidden');
        btnResume.classList.remove('hidden');
        progressPanel.classList.remove('hidden');
      } else {
        statusBadge.textContent = 'Pronto';
        statusBadge.className = 'badge status-ready';
        
        btnStart.classList.remove('hidden');
        activeControls.classList.add('hidden');
        progressPanel.classList.add('hidden');
      }

      // Calcula progresso e tempo restante
      if (stats.postsFound > 0) {
        const pct = Math.round((stats.postsProcessed / stats.postsFound) * 100);
        progressPercentage.textContent = `${pct}% concluído`;
        progressBarFill.style.width = `${pct}%`;

        const remaining = stats.postsFound - stats.postsProcessed;
        if (remaining > 0) {
          if (stats.eta > 0) {
            const min = Math.floor(stats.eta / 60);
            const sec = stats.eta % 60;
            timeRemaining.textContent = `Tempo restante est.: ~${min}m ${sec}s`;
          } else {
            timeRemaining.textContent = 'Tempo restante: Calculando...';
          }
        } else {
          timeRemaining.textContent = 'Finalizado';
        }
      }
    }
  } catch (err) {
    console.error('Erro ao consultar estatísticas:', err);
  }
}

// Atualiza elementos visuais com base no estado básico
function updateUI(stateObj) {
  if (stateObj.isRunning) {
    statusBadge.textContent = 'Executando';
    statusBadge.className = 'badge status-running';
    btnStart.classList.add('hidden');
    activeControls.classList.remove('hidden');
    btnPause.classList.remove('hidden');
    btnResume.classList.add('hidden');
  } else {
    statusBadge.textContent = 'Pronto';
    statusBadge.className = 'badge status-ready';
    btnStart.classList.remove('hidden');
    activeControls.classList.add('hidden');
  }
}

// Ações do Usuário
async function startProcess() {
  console.log('popup.js: Botão Iniciar clicado!');
  const url = groupUrlInput.value.trim();
  const limit = parseInt(postLimitSelect.value, 10) || 0;
  console.log('popup.js: URL do grupo:', url, 'Limite de posts:', limit);
  if (!url) {
    appendLog('error', 'Por favor, insira uma URL de grupo válida.');
    return;
  }
  
  appendLog('info', `Solicitando início do download (limite: ${limit > 0 ? limit : 'Tudo'})...`);
  try {
    console.log('popup.js: Enviando mensagem START para o background...');
    const response = await chrome.runtime.sendMessage({ action: 'START', groupUrl: url, postLimit: limit });
    console.log('popup.js: Resposta recebida do background:', response);
    
    if (response && response.error) {
      appendLog('error', `Erro ao iniciar: ${response.error}`);
    } else if (response && response.warning) {
      appendLog('warn', response.warning);
    } else {
      appendLog('info', 'Processo de extração híbrida inicializado com sucesso.');
    }
  } catch (err) {
    console.error('popup.js: Erro crítico ao enviar START:', err);
    appendLog('error', `Erro ao iniciar no background: ${err.message}`);
  }
  await pollStats();
}


async function pauseProcess() {
  appendLog('info', 'Solicitando pausa...');
  await chrome.runtime.sendMessage({ action: 'PAUSE' });
  await pollStats();
}

async function resumeProcess() {
  appendLog('info', 'Solicitando retomada...');
  await chrome.runtime.sendMessage({ action: 'RESUME' });
  await pollStats();
}

async function cancelProcess() {
  if (confirm('Tem certeza de que deseja cancelar? O progresso atual será mantido para exportação, mas a fila pendente será esvaziada.')) {
    appendLog('info', 'Cancelando processo...');
    await chrome.runtime.sendMessage({ action: 'CANCEL' });
    await pollStats();
  }
}

async function clearLogs() {
  if (confirm('Deseja limpar todos os dados salvos no IndexedDB (Posts, Comentários, Mídias e logs)? Isso apagará todo o progresso.')) {
    await db.clearAll();
    logBox.innerHTML = '';
    appendLog('info', 'IndexedDB limpo e resetado.');
    await pollStats();
  }
}

async function exportZip() {
  btnExport.disabled = true;
  const originalText = btnExport.textContent;
  btnExport.textContent = 'Gerando ZIP...';
  appendLog('info', 'Gerando arquivo ZIP de exportação...');

  try {
    const zipBlob = await generateExportZip();
    const url = URL.createObjectURL(zipBlob);
    
    // Dispara o download do arquivo ZIP
    chrome.downloads.download({
      url: url,
      filename: 'facebook_group_export.zip',
      saveAs: true
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        appendLog('error', `Falha no download do ZIP: ${chrome.runtime.lastError.message}`);
      } else {
        appendLog('info', `ZIP gerado e enviado para download (ID: ${downloadId}).`);
      }
      btnExport.disabled = false;
      btnExport.textContent = originalText;
    });
  } catch (err) {
    appendLog('error', `Erro ao exportar ZIP: ${err.message}`);
    btnExport.disabled = false;
    btnExport.textContent = originalText;
  }
}

// Finaliza pooling ao descarregar a janela
window.addEventListener('unload', () => {
  if (statsInterval) {
    clearInterval(statsInterval);
  }
});

// Inicialização resiliente
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    console.log('popup.js: DOMContentLoaded disparado.');
    initPopup();
  });
} else {
  console.log('popup.js: DOM já estava carregado. Inicializando initPopup() imediatamente.');
  initPopup();
}

