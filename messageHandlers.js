// messageHandlers.js - Roteador de Mensagens Híbrido Modular

let graphqlCredentials = {
  fb_dtsg: null,
  queries: {},
  commentVarsTemplate: null,
  feedVarsTemplate: null
};

// Carrega as credenciais salvas no indexedDB ao inicializar
async function restoreCredentials() {
  try {
    const fb_dtsg = await db.getState('fb_dtsg');
    if (fb_dtsg) graphqlCredentials.fb_dtsg = fb_dtsg;

    const feedId = await db.getState('query_GroupsCometFeedRegularStoriesPaginationQuery');
    if (feedId) graphqlCredentials.queries['GroupsCometFeedRegularStoriesPaginationQuery'] = feedId;

    const commentId = await db.getState('query_CommentListV2Query');
    if (commentId) graphqlCredentials.queries['CommentListV2Query'] = commentId;

    const savedCommentVars = await db.getState('commentVarsTemplate');
    if (savedCommentVars) graphqlCredentials.commentVarsTemplate = savedCommentVars;

    const savedFeedVars = await db.getState('feedVarsTemplate');
    if (savedFeedVars) graphqlCredentials.feedVarsTemplate = savedFeedVars;
    
    console.log('messageHandlers: Credenciais GraphQL restauradas com sucesso.');
  } catch (e) {
    console.error('messageHandlers: Erro ao restaurar credenciais:', e);
  }
}

async function handleIncomingMessage(message, sender, sendResponse) {
  if (self.DEBUG && message.action !== 'GET_STATE') {
    console.log('messageHandlers: Ação recebida:', message.action);
  }

  try {
    switch (message.action) {
      case 'START':
        await handleStartAction(message.groupUrl, message.postLimit, sendResponse);
        break;

      case 'PAUSE':
        await handlePauseAction(sendResponse);
        break;

      case 'RESUME':
        await handleResumeAction(sendResponse);
        break;

      case 'CANCEL':
        await handleCancelAction(sendResponse);
        break;

      case 'GET_STATE':
        const stats = stateManager.getStats();
        sendResponse(stats);
        break;

      case 'POPUP_OPENED':
        sendResponse({ state: stateManager.getStats(), creds: graphqlCredentials });
        break;

      case 'SAVE_GRAPHQL_CREDENTIALS':
        await handleSaveGraphQLCredentials(message.data, sendResponse);
        break;

      case 'GET_GRAPHQL_CREDS':
        sendResponse({
          fb_dtsg: graphqlCredentials.fb_dtsg,
          commentDocId: graphqlCredentials.queries['CommentListV2Query'] || null,
          commentVarsTemplate: graphqlCredentials.commentVarsTemplate || null,
          feedDocId: graphqlCredentials.queries['GroupsCometFeedRegularStoriesPaginationQuery'] || null,
          feedVarsTemplate: graphqlCredentials.feedVarsTemplate || null
        });
        break;

      case 'LOG':
        await db.addLog(message.level || 'info', message.text);
        sendResponse({ success: true });
        break;

      // Nível 4: Captura da Aba Ativa (Solicitada pelo Content Script da Aba do Post)
      case 'TAKE_SCREENSHOT':
        chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 80 }, (dataUrl) => {
          if (chrome.runtime.lastError) {
            sendResponse({ error: chrome.runtime.lastError.message });
          } else {
            sendResponse({ dataUrl });
          }
        });
        break;

      default:
        sendResponse({ error: 'Ação desconhecida em messageHandlers' });
    }
  } catch (err) {
    console.error('messageHandlers: Erro:', message.action, err);
    sendResponse({ error: err.message });
  }
}

// Handlers Individuais
async function handleStartAction(groupUrl, postLimit, sendResponse) {
  await db.clearAll();
  await stateManager.init();
  
  await stateManager.setRunning(true);
  stateManager.state.groupUrl = groupUrl;
  stateManager.state.postLimit = postLimit || 0;
  
  await db.saveState('groupUrl', groupUrl);
  await db.saveState('postLimit', postLimit || 0);
  
  await db.addLog('info', `Iniciando processo de extração híbrida para o grupo: ${groupUrl}`);

  // Verifica se a extração via Apify (Nuvem) está ativada nas preferências
  const storage = await chrome.storage.local.get(['use_apify_extraction', 'apify_api_key']);
  const useApify = storage.use_apify_extraction === true;
  const apifyToken = storage.apify_api_key;

  if (useApify && apifyToken) {
    workerPool.start(null, null, null, null, null);
    sendResponse({ success: true });
    return;
  }

  const feedDocId = graphqlCredentials.queries['GroupsCometFeedRegularStoriesPaginationQuery'];
  const commentDocId = graphqlCredentials.queries['CommentListV2Query'];

  // Se não temos credenciais do GraphQL de feed para background, vasculha a aba ativa via DOM
  if (!graphqlCredentials.fb_dtsg || !feedDocId) {
    await db.addLog('warn', 'GraphQL de paginação indisponível (Sessão de feed ainda não interceptada).');
    await db.addLog('info', 'Tentando descobrir posts de forma alternativa vasculhando o DOM da aba ativa do grupo...');

    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const activeTab = tabs[0];
      if (activeTab && activeTab.url && activeTab.url.includes('facebook.com/groups/')) {
        await db.addLog('info', 'Disparando varredura e scroll de feed na aba ativa...');
        
        chrome.tabs.sendMessage(activeTab.id, { action: 'DISCOVER_POSTS_FROM_DOM' }, async (response) => {
          if (chrome.runtime.lastError || !response || !response.posts || response.posts.length === 0) {
            const errMsg = chrome.runtime.lastError ? chrome.runtime.lastError.message : 'Nenhum post retornado do DOM.';
            await db.addLog('error', `Falha ao descobrir posts via DOM: ${errMsg}. Por favor, verifique se você está na página do grupo do Facebook no navegador e tente novamente.`);
            await stateManager.setRunning(false);
          } else {
            await db.addLog('info', `[DOM] Descobertos ${response.posts.length} posts no feed. Iniciando extração híbrida individual...`);
            
            let postsToEnqueue = response.posts;
            const stats = stateManager.getStats();
            if (stats.postLimit > 0 && postsToEnqueue.length > stats.postLimit) {
              postsToEnqueue = postsToEnqueue.slice(0, stats.postLimit);
            }
            
            const queueItems = postsToEnqueue.map(p => ({
              url: p.url,
              post_id: p.post_id,
              author: p.author
            }));
            
            await postQueue.enqueueBatch(queueItems);
            // Salva posts iniciais no IndexedDB
            await db.savePostsBatch(postsToEnqueue.map(p => ({
              post_id: p.post_id,
              url: p.url,
              author: p.author,
              comments_count: 0
            })));
            
            stateManager.incrementPostsFound(postsToEnqueue.length);
            
            // Dispara os workers concorrentes de posts de forma híbrida baseando-se no DOM!
            workerPool.start(
              graphqlCredentials.fb_dtsg || null,
              feedDocId || null,
              commentDocId || null,
              graphqlCredentials.feedVarsTemplate || null,
              graphqlCredentials.commentVarsTemplate || null
            );
          }
        });
      } else {
        await db.addLog('error', 'A aba ativa atual não é um grupo do Facebook válido. Certifique-se de estar com a aba do grupo aberta e em foco ao clicar em Iniciar.');
        await stateManager.setRunning(false);
      }
    });

    sendResponse({ success: true, warning: 'Sem credenciais GraphQL, acionando varredura DOM do feed na aba ativa.' });
    return;
  }

  // Dispara Workers concorrentes com credenciais do GraphQL
  workerPool.start(
    graphqlCredentials.fb_dtsg,
    feedDocId,
    commentDocId,
    graphqlCredentials.feedVarsTemplate,
    graphqlCredentials.commentVarsTemplate
  );

  sendResponse({ success: true });
}

async function handlePauseAction(sendResponse) {
  await stateManager.setRunning(false);
  workerPool.stop();
  mediaDownloader.stop();
  await db.addLog('info', 'Processo de extração pausado.');
  sendResponse({ success: true });
}

async function handleResumeAction(sendResponse) {
  await stateManager.setRunning(true);
  
  const feedDocId = graphqlCredentials.queries['GroupsCometFeedRegularStoriesPaginationQuery'];
  const commentDocId = graphqlCredentials.queries['CommentListV2Query'];

  workerPool.start(
    graphqlCredentials.fb_dtsg,
    feedDocId,
    commentDocId,
    graphqlCredentials.feedVarsTemplate,
    graphqlCredentials.commentVarsTemplate
  );

  await db.addLog('info', 'Processo de extração retomado.');
  sendResponse({ success: true });
}

async function handleCancelAction(sendResponse) {
  await stateManager.setRunning(false);
  workerPool.stop();
  mediaDownloader.stop();
  
  await db.clearAll();
  await stateManager.init();
  await db.addLog('info', 'Processo de extração cancelado.');
  
  sendResponse({ success: true });
}

async function handleSaveGraphQLCredentials(data, sendResponse) {
  const { friendlyName, doc_id, fb_dtsg, variables } = data;
  let changed = false;

  if (fb_dtsg && graphqlCredentials.fb_dtsg !== fb_dtsg) {
    graphqlCredentials.fb_dtsg = fb_dtsg;
    await db.saveState('fb_dtsg', fb_dtsg);
    changed = true;
  }

  if (friendlyName && doc_id) {
    let keyName = friendlyName;
    if (friendlyName.includes('Comment') || friendlyName.includes('UFI') || friendlyName.includes('UFIPayground')) {
      keyName = 'CommentListV2Query';
    }

    if (graphqlCredentials.queries[keyName] !== doc_id) {
      graphqlCredentials.queries[keyName] = doc_id;
      await db.saveState(`query_${keyName}`, doc_id);
      await db.addLog('info', `Facebook API: Conexão estabelecida para a query ${keyName}.`);
      changed = true;
    }

    let parsedVars = null;
    try {
      parsedVars = typeof variables === 'string' ? JSON.parse(variables) : variables;
    } catch (e) {
      parsedVars = variables;
    }

    if (parsedVars) {
      if (friendlyName.includes('Feed')) {
        graphqlCredentials.feedVarsTemplate = parsedVars;
        await db.saveState('feedVarsTemplate', parsedVars);
      } else if (friendlyName.includes('Comment') || friendlyName.includes('UFI')) {
        graphqlCredentials.commentVarsTemplate = parsedVars;
        await db.saveState('commentVarsTemplate', parsedVars);
      }
    }
  }

  const stats = stateManager.getStats();
  if (stats.isRunning && !workerPool.isActive && graphqlCredentials.fb_dtsg && graphqlCredentials.queries['GroupsCometFeedRegularStoriesPaginationQuery']) {
    workerPool.start(
      graphqlCredentials.fb_dtsg,
      graphqlCredentials.queries['GroupsCometFeedRegularStoriesPaginationQuery'],
      graphqlCredentials.queries['CommentListV2Query'],
      graphqlCredentials.feedVarsTemplate,
      graphqlCredentials.commentVarsTemplate
    );
  }

  sendResponse({ success: true, changed });
}

// Inicializa a restauração ao carregar o script
restoreCredentials();

self.messageHandlers = {
  handleIncomingMessage,
  restoreCredentials
};
