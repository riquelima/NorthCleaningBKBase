// background.js - Coordenador Principal do Facebook Group Downloader Híbrido

// Flag global para debug (Fase 11)
self.DEBUG = false; 

console.log('background.js: Carregando dependências de extensão via importScripts...');

try {
  importScripts(
    'db.js',
    'utils.js',
    // 'tesseract.min.js', // Biblioteca local para OCR (Nível 5) - Desativada devido a restrições de CSP do Manifest V3 do Chrome
    'stateManager.js',
    'graphqlManager.js',
    'queueManager.js',
    'mediaDownloader.js',
    'workerPool.js',
    'messageHandlers.js'
  );
  console.log('background.js: Todos os módulos híbridos carregados com sucesso.');
} catch (e) {
  console.error('background.js: Falha crítica ao carregar scripts de dependências:', e);
}

// Inicialização da extensão
chrome.runtime.onInstalled.addListener(async () => {
  console.log('Facebook Group Downloader Híbrido instalado.');
  try {
    await db.addLog('info', 'Extensão híbrida de alta performance instalada e pronta.');
    await resetAllQueuesOnStartup();
    await stateManager.init();
  } catch (err) {
    console.error('background.js: Erro no onInstalled:', err);
  }
});

// Alarme para manter o Service Worker acordado
chrome.alarms.create('keepAlive', { periodInMinutes: 0.25 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'keepAlive') {
    const stats = stateManager.getStats();
    if (stats.isRunning) {
      if (self.DEBUG) {
        console.log('Keep-alive: Processo de extração ativo...');
      }
      
      // Reinicia se o Service Worker tiver sido suspenso indevidamente
      if (!workerPool.isActive) {
        console.warn('Keep-alive: Reiniciando workerPool suspenso...');
        await messageHandlers.restoreCredentials();
        const fb_dtsg = await db.getState('fb_dtsg');
        const feedDocId = await db.getState('query_GroupsCometFeedRegularStoriesPaginationQuery');
        const commentDocId = await db.getState('query_CommentListV2Query');
        const feedVars = await db.getState('feedVarsTemplate');
        const commentVars = await db.getState('commentVarsTemplate');
        
        if (fb_dtsg && feedDocId) {
          workerPool.start(fb_dtsg, feedDocId, commentDocId, feedVars, commentVars);
        }
      }
      
      if (!mediaDownloader.isActive) {
        mediaDownloader.start();
      }
    }
  }
});

// Listener central de mensagens (repasse completo para messageHandlers.js)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  messageHandlers.handleIncomingMessage(message, sender, sendResponse);
  return true; // Canal assíncrono
});

// Inicialização imediata ao recarregar o Service Worker
(async () => {
  try {
    await db.init();
    await resetAllQueuesOnStartup();
    await stateManager.init();
  } catch (err) {
    console.error('background.js: Erro na inicialização do worker:', err);
  }
})();
