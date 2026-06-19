// workerPool.js - Pool de Workers Híbridos Concorrentes para Extração de Larga Escala

class WorkerPool {
  constructor() {
    this.MAX_PARALLEL_POSTS = 10;
    this.MAX_PARALLEL_VISION = 3;
    
    this.isActive = false;
    this.postWorkers = [];
    this.visionWorkers = [];
    this.feedPaginationActive = false;
    this.visualTabInProgress = false; // Controle de concorrência visual física (máximo 1 aba aberta por vez)
  }

  async start(fb_dtsg, feedDocId, commentDocId, feedVarsTemplate, commentVarsTemplate) {
    if (this.isActive) return;
    this.isActive = true;
    
    // Desvio para extração via Apify (Nuvem) se ativado nas preferências
    const storage = await chrome.storage.local.get(['use_apify_extraction', 'apify_api_key', 'post_limit']);
    const useApify = storage.use_apify_extraction === true;
    const apifyToken = storage.apify_api_key;

    if (useApify && apifyToken) {
      await db.addLog('info', '[Apify] Extração via Apify (Nuvem) ativada. Inicializando...');
      this.runApifyExtraction(apifyToken, storage.post_limit);
      return;
    }

    console.log(`workerPool: Iniciando extração híbrida com ${this.MAX_PARALLEL_POSTS} workers de posts...`);
    
    // Inicia a descoberta de posts via feed do grupo (Nível 1)
    this.startFeedDiscovery(fb_dtsg, feedDocId, feedVarsTemplate);

    // Inicia o downloader de mídias (Nível 7)
    mediaDownloader.start();

    // Worker para Processamento Híbrido Rápido (Nível 1 - GraphQL & Nível 2 - Embedded JSON)
    const postWorker = async () => {
      while (this.isActive) {
        const stats = stateManager.getStats();
        if (!stats.isRunning) break;

        // Limite de posts atingido
        if (stats.postLimit > 0 && stats.postsProcessed >= stats.postLimit) {
          break;
        }

        // Obtém um post da fila
        const items = await postQueue.dequeue(1);
        if (items.length === 0) {
          if (!this.feedPaginationActive) {
            const pendingSize = await postQueue.size('pending');
            if (pendingSize === 0) break;
          }
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }

        const postItem = items[0];
        try {
          if (self.DEBUG) {
            console.log(`workerPool: Processando post ${postItem.post_id}...`);
          }

          // Executa Nível 1 (GraphQL) e Nível 2 (Embedded JSON) em background
          const success = await this.runBackgroundExtraction(
            postItem,
            fb_dtsg,
            commentDocId,
            commentVarsTemplate
          );

          if (success) {
            // Completado em background, marca como concluído
            await postQueue.completed(postItem.url);
            const postData = await db.getPost(postItem.post_id);
            await stateManager.incrementPostsProcessed(postData);
          } else {
            // Se falhar ou faltar comentários, envia para a fila de refinamento visual (Fase 14)
            await postQueue.completed(postItem.url); // Tira da postQueue
            await visionQueue.enqueue({
              post_id: postItem.post_id,
              url: postItem.url,
              author: postItem.author
            });
            await db.addLog('info', `[Fusion] Post ${postItem.post_id} necessita de refinamento visual. Enfileirado na visionQueue.`);
          }

        } catch (err) {
          console.error(`workerPool: Erro no post ${postItem.url}:`, err);
          await postQueue.failed(postItem.url, err.message);
        }
      }
    };

    // Worker para Processamento de Visão Multimodal (Nível 3, 4 e 5)
    // Para evitar que múltiplas abas fiquem tentando ficar visíveis na tela ao mesmo tempo (o que quebra a captura),
    // nós limitamos a concorrência visual física a 1 aba ativa por vez, mas rodamos a análise na API de Vision em paralelo (máximo 3).
    const visionWorker = async () => {
      while (this.isActive) {
        const stats = stateManager.getStats();
        if (!stats.isRunning) break;

        const items = await visionQueue.dequeue(1);
        if (items.length === 0) {
          // Se as outras filas e a paginação acabaram, encerra
          const postPending = await postQueue.size('pending');
          const postProcessing = await postQueue.size('processing');
          const visionPending = await visionQueue.size('pending');
          if (!this.feedPaginationActive && postPending === 0 && postProcessing === 0 && visionPending === 0) {
            break;
          }
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }

        const visionItem = items[0];
        
        // Semáforo visual físico para garantir apenas 1 captura ocorrendo por vez na tela do usuário
        while (this.visualTabInProgress && this.isActive) {
          await new Promise(r => setTimeout(r, 1000));
        }

        this.visualTabInProgress = true;
        try {
          await db.addLog('info', `[Vision] Iniciando processamento visual do post: ${visionItem.post_id}`);
          await this.runVisualExtraction(visionItem, fb_dtsg, commentDocId, commentVarsTemplate);
          await visionQueue.completed(visionItem.post_id);
          const postData = await db.getPost(visionItem.post_id);
          await stateManager.incrementPostsProcessed(postData);
        } catch (err) {
          console.error(`workerPool [Vision]: Falha na análise visual do post ${visionItem.post_id}:`, err);
          await visionQueue.failed(visionItem.post_id, err.message);
        } finally {
          this.visualTabInProgress = false;
        }
      }
    };

    // Inicia os postWorkers
    this.postWorkers = [];
    for (let i = 0; i < this.MAX_PARALLEL_POSTS; i++) {
      this.postWorkers.push(postWorker());
    }

    // Inicia os visionWorkers
    this.visionWorkers = [];
    for (let i = 0; i < this.MAX_PARALLEL_VISION; i++) {
      this.visionWorkers.push(visionWorker());
    }

    // Monitora encerramento
    Promise.all([...this.postWorkers, ...this.visionWorkers]).then(async () => {
      this.isActive = false;
      console.log('workerPool: Todos os workers híbridos finalizaram.');
      
      const pPending = await postQueue.size('pending');
      const pProcessing = await postQueue.size('processing');
      const vPending = await visionQueue.size('pending');
      const vProcessing = await visionQueue.size('processing');
      
      if (pPending === 0 && pProcessing === 0 && vPending === 0 && vProcessing === 0) {
        await stateManager.setRunning(false);
        await db.addLog('info', 'Parabéns! Todos os posts do grupo selecionado foram extraídos com sucesso. Pronto para exportação do ZIP.');
      }
    });
  }

  stop() {
    this.isActive = false;
    this.feedPaginationActive = false;
    this.postWorkers = [];
    this.visionWorkers = [];
  }

  // Descoberta e paginação de feed do grupo (Nível 1)
  async startFeedDiscovery(fb_dtsg, feedDocId, feedVarsTemplate) {
    if (this.feedPaginationActive) return;
    if (!fb_dtsg || !feedDocId) {
      // Descoberta feita alternativamente via DOM do feed da aba ativa. Ignora paginação GraphQL.
      return;
    }
    this.feedPaginationActive = true;
    await stateManager.setDiscovering(true);
    await db.saveState('checkpoint_status', 'running');

    try {
      // Tenta retomar a partir do último cursor de checkpoint salvo
      let cursor = await db.getState('checkpoint_last_cursor') || null;
      let hasNext = true;
      let pagesProcessed = 0;
      const maxPages = 2000; 

      let variables = null;
      try {
        variables = typeof feedVarsTemplate === 'string' ? JSON.parse(feedVarsTemplate) : JSON.parse(JSON.stringify(feedVarsTemplate));
      } catch (e) {
        variables = feedVarsTemplate;
      }

      while (hasNext && pagesProcessed < maxPages && this.isActive) {
        const stats = stateManager.getStats();
        if (stats.postLimit > 0 && stats.postsFound >= stats.postLimit) {
          break;
        }

        if (cursor) {
          if ('cursor' in variables) variables['cursor'] = cursor;
          if ('after' in variables) variables['after'] = cursor;
        }

        const responseText = await graphqlManager.fetchGraphQL(fb_dtsg, feedDocId, variables);
        let jsonObj = null;
        try {
          jsonObj = JSON.parse(responseText);
        } catch (e) {
          const lines = responseText.split('\n');
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const parsed = JSON.parse(trimmed);
              if (JSON.stringify(parsed).includes('group_feed') || JSON.stringify(parsed).includes('edges')) {
                jsonObj = parsed;
                break;
              }
            } catch (err) {}
          }
        }

        if (!jsonObj) break;

        const extractedPosts = graphqlManager.extractMultiplePostsFromGQLJSON(jsonObj);
        if (extractedPosts.length === 0) break;

        let postsToEnqueue = extractedPosts;
        if (stats.postLimit > 0) {
          const currentTotal = stats.postsFound;
          if (currentTotal >= stats.postLimit) break;
          const allowed = stats.postLimit - currentTotal;
          if (postsToEnqueue.length > allowed) {
            postsToEnqueue = postsToEnqueue.slice(0, allowed);
          }
        }

        // Salva metadados dos posts descobertos na post_queue e posts no IndexedDB
        const queueItems = postsToEnqueue.map(p => ({
          url: p.url,
          post_id: p.post_id,
          author: p.author
        }));
        await postQueue.enqueueBatch(queueItems);
        await db.savePostsBatch(postsToEnqueue);

        stateManager.incrementPostsFound(postsToEnqueue.length);

        const pag = graphqlManager.findGraphQLPaginationCursor(jsonObj);
        cursor = pag.endCursor;
        hasNext = pag.hasNextPage;
        pagesProcessed++;

        // Salva checkpoint atualizado
        await db.saveState('checkpoint_last_cursor', cursor);
        if (postsToEnqueue.length > 0) {
          await db.saveState('checkpoint_last_post_id', postsToEnqueue[postsToEnqueue.length - 1].post_id);
        }
        await db.saveState('checkpoint_timestamp', Date.now());

        await new Promise(r => setTimeout(r, 1000));
      }

    } catch (err) {
      console.error('workerPool [Feed]: Erro na paginação:', err);
    } finally {
      this.feedPaginationActive = false;
      await stateManager.setDiscovering(false);
      
      const stats = stateManager.getStats();
      if (stats.postsProcessed >= stats.postsFound && stats.postsFound > 0) {
        await db.saveState('checkpoint_status', 'completed');
      } else {
        await db.saveState('checkpoint_status', 'paused');
      }
    }
  }

  // Nível 1 (GraphQL) & Nível 2 (Embedded JSON) em background (sem abrir abas)
  async runBackgroundExtraction(postItem, fb_dtsg, commentDocId, commentVarsTemplate) {
    const postId = postItem.post_id;
    const url = postItem.url;

    const postData = await db.getPost(postId);
    if (!postData) return false;

    let commentsExtracted = [];
    let extractionMethod = 'none';

    // --- NÍVEL 1: GRAPHQL ---
    if (postData.comments_count > 0 && commentDocId && commentVarsTemplate) {
      try {
        let cursor = null;
        let hasNext = true;
        let gqlComments = [];
        let pages = 0;

        while (hasNext && pages < 100 && this.isActive) {
          const result = await graphqlManager.fetchPostCommentsGraphQL(
            postId,
            fb_dtsg,
            commentDocId,
            commentVarsTemplate,
            cursor
          );

          if (result.comments && result.comments.length > 0) {
            gqlComments.push(...result.comments);
          }
          cursor = result.endCursor;
          hasNext = result.hasNext;
          pages++;
          
          if (hasNext) await new Promise(r => setTimeout(r, 150));
        }

        if (gqlComments.length > 0) {
          gqlComments.forEach(c => {
            c.source = 'graphql';
            c.confidence = 1.0;
          });
          commentsExtracted = gqlComments;
          extractionMethod = 'gql';
          await db.addLog('info', `[GraphQL] Encontrados ${commentsExtracted.length} comentários para o post ${postId}.`);
        }
      } catch (err) {
        console.warn(`workerPool [GQL]: Falha na consulta GraphQL do post ${postId}: ${err.message}`);
      }
    }

    // --- NÍVEL 2: EMBEDDED JSON (Fallback Primário) ---
    if (commentsExtracted.length === 0) {
      try {
        const response = await fetch(url);
        if (response.ok) {
          const htmlText = await response.text();
          const jsonBlobs = graphqlManager.extractJSONFromHTMLScripts(htmlText);
          
          let jsonComments = [];
          for (const blob of jsonBlobs) {
            const extracted = graphqlManager.extractCommentsFromGQLJSON(blob);
            if (extracted && extracted.length > 0) {
              jsonComments.push(...extracted);
            }
          }

          if (jsonComments.length > 0) {
            // Deduplica e vincula
            jsonComments.forEach(c => {
              c.post_id = postId;
              c.source = 'embedded_json';
              c.confidence = 0.95;
            });
            commentsExtracted = this.deduplicateComments(jsonComments);
            extractionMethod = 'json';
            await db.addLog('info', `[Embedded JSON] Encontrados ${commentsExtracted.length} comentários para o post ${postId}.`);
          }
        }
      } catch (err) {
        console.warn(`workerPool [JSON]: Falha ao buscar HTML do post ${postId}: ${err.message}`);
      }
    }

    // --- SALVAMENTO E VERIFICAÇÃO DE METAS ---
    if (commentsExtracted.length > 0) {
      // Salva os comentários no IndexedDB
      await db.saveCommentsBatch(commentsExtracted);
      await stateManager.incrementCommentsProcessed(extractionMethod, commentsExtracted.length);
      
      // Enfileira mídias para download
      await this.enqueuePostMedia(postId);

      // Fusion / Merge: Verifica se recuperamos a quantidade declarada de comentários
      // Se obtivemos pelo menos 95% do declarado, consideramos um sucesso completo
      const declaration = postData.comments_count || 0;
      const threshold = Math.max(1, Math.floor(declaration * 0.95));
      
      if (commentsExtracted.length >= threshold || declaration === 0) {
        await db.addLog('info', `[Fusion] Total final: ${commentsExtracted.length} comentários extraídos via ${extractionMethod.toUpperCase()} (Meta Atingida).`);
        return true;
      } else {
        // Envia para refinamento visual porque faltaram comentários
        return false;
      }
    }

    return false; // Sem comentários recuperados, necessita de fluxo visual
  }

  // Nível 3 (DOM), Nível 4 (Gemini Vision) & Nível 5 (OCR) - Abre aba física e automatiza
  async runVisualExtraction(visionItem, fb_dtsg, commentDocId, commentVarsTemplate) {
    const postId = visionItem.post_id;
    const url = visionItem.url;

    // Recupera contagem inicial de comentários salvos no IndexedDB para este post
    const existingComments = await db.getCommentsForPost(postId);
    const postData = await db.getPost(postId);
    const declaration = postData ? postData.comments_count : 0;
    const threshold = Math.max(1, Math.floor(declaration * 0.95));

    await db.addLog('info', `[Fusion] Iniciando fluxo visual para post ${postId}. Comentários declarados: ${declaration}. Já extraídos: ${existingComments.length}. Meta de threshold: ${threshold}.`);

    // Abre a aba com a URL do post do Facebook de forma visível
    const tab = await chrome.tabs.create({ url: url, active: true });
    
    let result = null;
    try {
      // Espera carregar e injetar o content script. Avisa o content script para processar visualmente.
      result = await this.executeContentVisualScraping(tab.id, declaration, existingComments.length);
      
      if (!result) {
        throw new Error(`VisualScraping: Falha no retorno do script de conteúdo da aba ${tab.id}.`);
      }
    } finally {
      // Fecha a aba após processamento visual, independentemente de erros no script de conteúdo
      try {
        await chrome.tabs.remove(tab.id);
      } catch (removeErr) {
        console.warn(`workerPool: Falha ao remover aba ${tab.id}: ${removeErr.message}`);
      }
    }

    let currentComments = [...existingComments];

    // --- NÍVEL 3: DOM ---
    if (result.domComments && result.domComments.length > 0) {
      result.domComments.forEach(c => {
        c.source = 'dom';
        c.confidence = 0.85;
      });
      const mergedDOM = this.mergeCommentSets(currentComments, result.domComments);
      const newDOMCount = mergedDOM.length - currentComments.length;
      if (newDOMCount > 0) {
        const newOnlyDOM = mergedDOM.slice(currentComments.length);
        await db.saveCommentsBatch(newOnlyDOM);
        await stateManager.incrementCommentsProcessed('dom', newDOMCount);
        await db.addLog('info', `[DOM] Encontrados ${newDOMCount} comentários novos para o post ${postId}.`);
        currentComments = mergedDOM;
      }
    }

    // Verifica se meta foi batida após o DOM
    if (currentComments.length >= threshold || declaration === 0) {
      await db.addLog('info', `[Fusion] Total final: ${currentComments.length} comentários consolidados (Meta batida via DOM).`);
      // Enfileira mídias
      await this.enqueuePostMedia(postId);
      return;
    }

    // --- NÍVEL 4: SCREENSHOT + GEMINI VISION ---
    if (result.screenshots && result.screenshots.length > 0) {
      const storage = await chrome.storage.local.get(['use_ai_extraction', 'gemini_api_key']);
      const useAi = storage.use_ai_extraction !== false; // Habilitado por padrão se não configurado explicitamente
      const apiKey = storage.gemini_api_key;

      if (useAi && apiKey) {
        try {
          await db.addLog('info', `[Vision] Analisando ${result.screenshots.length} capturas de tela do post ${postId} com Gemini 2.5 Pro Vision...`);
          const visionData = await this.callGeminiVisionAPI(result.screenshots);
          
          if (visionData && visionData.comments && visionData.comments.length > 0) {
            const parsedVisionComments = visionData.comments.map(c => ({
              post_id: postId,
              author: c.author || 'Membro do Grupo',
              text: c.text || '',
              level: c.level === 1 ? 'reply' : 'main',
              parent_comment: c.reply_to || '',
              date: '',
              likes: 0,
              source: 'vision',
              confidence: 0.75
            }));

            const mergedVision = this.mergeCommentSets(currentComments, parsedVisionComments);
            const newVisionCount = mergedVision.length - currentComments.length;
            if (newVisionCount > 0) {
              const newOnlyVision = mergedVision.slice(currentComments.length);
              await db.saveCommentsBatch(newOnlyVision);
              await stateManager.incrementCommentsProcessed('vision', newVisionCount);
              await db.addLog('info', `[Vision] Encontrados ${newVisionCount} comentários novos via IA Vision.`);
              currentComments = mergedVision;
            }
          }
        } catch (err) {
          console.warn(`workerPool [Vision]: Falha na análise de imagens pelo Gemini: ${err.message}`);
          await db.addLog('warn', `[Vision] Falha ao analisar com Gemini Vision: ${err.message}`);
        }
      } else {
        await db.addLog('info', `[Vision] Gemini Vision ignorado (Configuração desativada ou API Key ausente).`);
      }
    }

    // Verifica se meta foi batida após o Gemini Vision
    if (currentComments.length >= threshold || declaration === 0) {
      await db.addLog('info', `[Fusion] Total final: ${currentComments.length} comentários consolidados (Meta batida via Vision).`);
      // Enfileira mídias
      await this.enqueuePostMedia(postId);
      return;
    }

    // --- NÍVEL 5: OCR (Tesseract.js - Último recurso) ---
    if (result.screenshots && result.screenshots.length > 0) {
      try {
        await db.addLog('info', `[OCR] Chamando OCR Tesseract local nas capturas do post ${postId} (Faltam comentários para bater meta)...`);
        let ocrTextCombined = '';
        for (const base64 of result.screenshots) {
          const text = await this.runLocalOCR(base64);
          ocrTextCombined += text + '\n';
        }

        // Tenta estruturar o texto do OCR em blocos de comentários usando heurísticas simples
        const ocrComments = this.parseOCRTextToComments(ocrTextCombined, postId);
        if (ocrComments.length > 0) {
          ocrComments.forEach(c => {
            c.source = 'ocr';
            c.confidence = 0.60;
          });
          const mergedOCR = this.mergeCommentSets(currentComments, ocrComments);
          const newOCRCount = mergedOCR.length - currentComments.length;
          if (newOCRCount > 0) {
            const newOnlyOCR = mergedOCR.slice(currentComments.length);
            await db.saveCommentsBatch(newOnlyOCR);
            await stateManager.incrementCommentsProcessed('ocr', newOCRCount);
            await db.addLog('info', `[OCR] Encontrados ${newOCRCount} comentários novos via transcrição local.`);
            currentComments = mergedOCR;
          }
        }
      } catch (err) {
        console.error('workerPool [OCR]: Falha no OCR:', err);
        await db.addLog('error', `[OCR] Erro no Tesseract OCR: ${err.message}`);
      }
    }

    // --- FINALIZAÇÃO ---
    await db.addLog('info', `[Fusion] Total final: ${currentComments.length} comentários consolidados.`);
    
    // Enfileira mídias
    await this.enqueuePostMedia(postId);
  }

  // Executa mensagens sequenciais na aba aberta para controle visual
  executeContentVisualScraping(tabId, targetCommentsCount, currentCount) {
    return new Promise((resolve) => {
      let checkCount = 0;
      
      const checkReady = setInterval(() => {
        chrome.tabs.sendMessage(tabId, { 
          action: 'EXECUTE_VISUAL_FLOW', 
          targetCount: targetCommentsCount,
          currentCount: currentCount
        }, (response) => {
          if (chrome.runtime.lastError) {
            checkCount++;
            if (checkCount > 40) { // Aumentado para 40 segundos para suportar o carregamento lento do Facebook
              clearInterval(checkReady);
              resolve(null);
            }
          } else {
            clearInterval(checkReady);
            resolve(response);
          }
        });
      }, 1000);
    });
  }

  // Enfileira as mídias do post no banco de download
  async enqueuePostMedia(postId) {
    const storage = await chrome.storage.local.get(['use_media_download']);
    const useMediaDownload = storage.use_media_download === true;
    
    if (!useMediaDownload) {
      if (self.DEBUG) {
        console.log(`workerPool: Download de mídias desativado. Pulando enfileiramento para o post ${postId}.`);
      }
      return;
    }

    const mediaList = await db.getAllMedia();
    const postMedia = mediaList.filter(m => m.post_id === postId && !m.downloaded);
    if (postMedia.length > 0) {
      const mediaQueueItems = postMedia.map(m => ({
        url: m.url,
        post_id: m.post_id,
        type: m.type,
        filename: m.filename
      }));
      await mediaQueue.enqueueBatch(mediaQueueItems);
    }
  }

  // Faz a chamada à API do Gemini Vision com múltiplas imagens em paralelo
  async callGeminiVisionAPI(screenshotsArray) {
    const storage = await chrome.storage.local.get(['gemini_api_key']);
    const apiKey = storage.gemini_api_key;
    if (!apiKey) {
      throw new Error('Chave de API do Gemini não configurada.');
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${apiKey}`;
    
    const parts = [
      {
        text: `Extraia todos os comentários e respostas visíveis desta captura do Facebook.

Retorne somente JSON no formato especificado.

Formato:
{
  "comments":[
    {
      "author":"",
      "text":"",
      "reply_to":"",
      "level":0
    }
  ]
}

Não invente informações. Extraia todos os comentários visíveis.
level=0 significa comentário principal.
level=1 significa resposta.
reply_to deve conter o autor do comentário principal ao qual esta resposta se destina.`
      }
    ];

    // Adiciona as capturas de tela base64 como partes inlineData
    for (const base64 of screenshotsArray) {
      // Remove o prefixo se existir
      const cleanBase64 = base64.includes('base64,') ? base64.split('base64,')[1] : base64;
      parts.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: cleanBase64
        }
      });
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseMimeType: "application/json"
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API Gemini Vision retornou HTTP ${response.status}: ${errorText}`);
    }

    const json = await response.json();
    if (json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts[0]) {
      let text = json.candidates[0].content.parts[0].text;
      // Remove blocos markdown de JSON caso a IA os coloque de forma teimosa
      text = text.replace(/```json/g, '').replace(/```/g, '').trim();
      return JSON.parse(text);
    }
    throw new Error('Formato de resposta inválido retornado pelo Gemini.');
  }

  // Executa o Tesseract OCR local (ou fallback devido a restrições de CSP)
  async runLocalOCR(base64Image) {
    if (typeof Tesseract === 'undefined') {
      // O Tesseract local foi desativado no background do Manifest V3 para evitar erros graves de CSP do Chrome.
      // Em vez disso, informamos que o pipeline híbrido utiliza o Gemini Vision como o OCR inteligente e estruturado (Nível 4).
      console.warn('workerPool: Tesseract local indisponível por CSP do MV3. O motor híbrido de fallback foi direcionado para o Gemini Vision.');
      throw new Error('Tesseract local desativado por restrições de CSP do Manifest V3. O Gemini Vision é o motor de OCR inteligente recomendado.');
    }

    try {
      const worker = await Tesseract.createWorker({
        workerPath: chrome.runtime.getURL('tesseract.min.js'),
        logger: m => { if (self.DEBUG) console.log('OCR progress:', m); }
      });
      
      await worker.loadLanguage('eng');
      await worker.initialize('eng');
      
      const { data: { text } } = await worker.recognize(base64Image);
      await worker.terminate();
      
      return text;
    } catch (ocrErr) {
      throw ocrErr;
    }
  }

  // Parser heurístico simples de texto bruto do OCR
  parseOCRTextToComments(rawText, postId) {
    const comments = [];
    const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    let currentAuthor = '';
    let currentText = '';

    for (const line of lines) {
      // Ignora linhas de cabeçalho do FB
      if (line.includes('Curtir') || line.includes('Responder') || line.includes('Compartilhar') || line.includes('Visualizações')) {
        if (currentAuthor && currentText) {
          comments.push({
            post_id: postId,
            author: currentAuthor,
            text: currentText,
            level: 'main',
            parent_comment: '',
            date: '',
            likes: 0
          });
          currentAuthor = '';
          currentText = '';
        }
        continue;
      }

      // Se a linha for curta e parecer um nome próprio
      if (line.length > 3 && line.length < 30 && !currentAuthor && /^[A-Z][a-z]+(\s[A-Z][a-z]+)+$/.test(line)) {
        currentAuthor = line;
      } else if (currentAuthor) {
        currentText += (currentText ? ' ' : '') + line;
      }
    }

    if (currentAuthor && currentText) {
      comments.push({
        post_id: postId,
        author: currentAuthor,
        text: currentText,
        level: 'main',
        parent_comment: '',
        date: '',
        likes: 0
      });
    }

    return comments;
  }

  // Deduplicação (Fase 14: Merge de conjuntos)
  mergeCommentSets(existing, visual) {
    const merged = [...existing];
    const uniqueKeys = new Set(existing.map(c => `${c.author.trim().toLowerCase()}_${c.text.trim().toLowerCase()}`));

    for (const c of visual) {
      const key = `${c.author.trim().toLowerCase()}_${c.text.trim().toLowerCase()}`;
      if (!uniqueKeys.has(key)) {
        uniqueKeys.add(key);
        merged.push(c);
      }
    }
    return merged;
  }

  deduplicateComments(commentsArray) {
    const unique = [];
    const set = new Set();
    for (const c of commentsArray) {
      const key = `${c.author.trim().toLowerCase()}_${c.text.trim().toLowerCase()}`;
      if (!set.has(key)) {
        set.add(key);
        unique.push(c);
      }
    }
    return unique;
  }

  // --- EXTRAÇÃO VIA NUVEM DO APIFY ---
  async runApifyExtraction(apifyToken, postLimit) {
    try {
      await db.addLog('info', '[Apify] Iniciando conexão com a API do Apify...');
      
      // 1. Obtém cookies e URL da aba ativa do grupo
      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        const activeTab = tabs[0];
        if (!activeTab || !activeTab.url || !activeTab.url.includes('facebook.com/groups/')) {
          await db.addLog('error', '[Apify] A aba ativa atual não é um grupo do Facebook válido. Certifique-se de estar com a aba do grupo aberta e em foco.');
          this.stop();
          return;
        }

        const groupUrl = activeTab.url;
        await db.addLog('info', `[Apify] Capturando cookies de sessão do Facebook...`);

        let cookies = null;
        try {
          // Tenta capturar usando a API nativa chrome.cookies buscando pela URL principal
          const rawCookies = await chrome.cookies.getAll({ url: 'https://www.facebook.com' });
          if (rawCookies && rawCookies.length > 0) {
            cookies = rawCookies.map(c => ({
              name: c.name,
              value: c.value,
              domain: c.domain,
              path: c.path,
              secure: c.secure,
              httpOnly: c.httpOnly
            }));
            const hasCUser = rawCookies.some(c => c.name === 'c_user');
            const hasXS = rawCookies.some(c => c.name === 'xs');
            await db.addLog('info', `[Apify] Cookies de sessão capturados nativamente (${cookies.length} chaves). Login detectado: c_user=${hasCUser}, xs=${hasXS}`);
          }
        } catch (cookieErr) {
          console.warn('Erro ao ler cookies nativamente:', cookieErr);
        }

        const proceedWithApify = async (cookiesList) => {
          await db.addLog('info', `[Apify] Disparando Actor na nuvem do Apify para o grupo: ${groupUrl}`);

          // 2. Dispara a execução do Actor
          const runUrl = `https://api.apify.com/v2/acts/apify~facebook-groups-scraper/runs?token=${apifyToken}`;
          const limit = parseInt(postLimit, 10) || 0;
          
          const payload = {
            startUrls: [{ url: groupUrl }],
            maxPosts: limit > 0 ? limit : 99999, // Se for 0 (Todos), define um limite muito alto para extrair o máximo possível
            maxCommentsPerPost: 1000, // Aumentado para 1000 para capturar o máximo de comentários
            cookies: cookiesList
          };

          try {
            const res = await fetch(runUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });

            if (!res.ok) {
              const errTxt = await res.text();
              throw new Error(`API Apify retornou HTTP ${res.status}: ${errTxt}`);
            }

            const runResult = await res.json();
            const runId = runResult.data.id;
            const datasetId = runResult.data.defaultDatasetId || runResult.data.datasetId;

            await db.addLog('info', `[Apify] Execução do robô disparada na nuvem! ID da Execução: ${runId}`);
            
            // 3. Loop de Polling para monitorar o status
            let completed = false;
            let startTime = Date.now();
            let checkInterval = 6000; // a cada 6 segundos

            while (this.isActive && !completed) {
              await new Promise(r => setTimeout(r, checkInterval));
              
              const statusUrl = `https://api.apify.com/v2/actor-runs/${runId}?token=${apifyToken}`;
              const statusRes = await fetch(statusUrl);
              if (!statusRes.ok) continue;

              const statusResult = await statusRes.json();
              const runData = statusResult.data;
              const status = runData.status; // RUNNING, SUCCEEDED, FAILED, TIMED-OUT, ABORTED
              const elapsed = Math.round((Date.now() - startTime) / 1000);

              await db.addLog('info', `[Apify] Status do robô na nuvem: ${status} (Tempo: ${elapsed}s)...`);

              if (status === 'SUCCEEDED') {
                completed = true;
                await db.addLog('info', `[Apify] Robô na nuvem concluiu a extração com status SUCCEEDED! Baixando dados extraídos...`);
                
                // 4. Baixa os itens do dataset
                const itemsUrl = `https://api.apify.com/v2/datasets/${datasetId}/items?token=${apifyToken}`;
                const itemsRes = await fetch(itemsUrl);
                if (!itemsRes.ok) {
                  throw new Error(`Falha ao baixar dados do dataset do Apify: HTTP ${itemsRes.status}`);
                }

                const items = await itemsRes.json();
                await db.addLog('info', `[Apify] Dataset baixado! Total de ${items.length} posts processados pelo Apify.`);

                // Diagnóstico: se retornar 0 posts ou apenas 1 post vazio, busca logs de execução do Apify
                if (items.length === 0 || (items.length === 1 && (!items[0].text && !items[0].message))) {
                  await db.addLog('warn', `[Apify] A extração na nuvem não retornou posts válidos. Buscando logs do robô para diagnóstico...`);
                  try {
                    const logUrl = `https://api.apify.com/v2/actor-runs/${runId}/log`;
                    const logRes = await fetch(logUrl);
                    if (logRes.ok) {
                      const logText = await logRes.text();
                      const logLines = logText.split('\n').slice(-15).join('\n');
                      await db.addLog('error', `[Apify Diagnostics] Últimas 15 linhas do log do Actor na nuvem:\n${logLines}`);
                    }
                  } catch (logErr) {
                    console.error('Erro ao buscar log do Apify:', logErr);
                  }
                }

                // 5. Normaliza e grava no IndexedDB
                await this.importApifyDataset(items, groupUrl);
                
                await db.addLog('info', `[Apify] Sucesso! Importação e normalização concluídas.`);
                await stateManager.setRunning(false);
                this.isActive = false;
              } else if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
                throw new Error(`Robô na nuvem terminou com status de erro: ${status}`);
              }
            }
          } catch (apiErr) {
            await db.addLog('error', `[Apify] Falha crítica na extração via nuvem: ${apiErr.message}`);
            this.stop();
          }
        };

        // Fallback: se a API nativa não retornou cookies, tenta enviar mensagem para a aba ativa
        if (!cookies || cookies.length === 0) {
          await db.addLog('info', `[Apify] Tentando capturar cookies via script de conteúdo na página...`);
          chrome.tabs.sendMessage(activeTab.id, { action: 'GET_FACEBOOK_COOKIES_AND_URL' }, async (response) => {
            if (chrome.runtime.lastError || !response || response.error || !response.cookies) {
              const errMsg = response && response.error ? response.error : (chrome.runtime.lastError ? chrome.runtime.lastError.message : 'Falha ao obter cookies do content script.');
              await db.addLog('error', `[Apify] Falha crítica ao capturar cookies: ${errMsg}`);
              this.stop();
              return;
            }
            cookies = response.cookies;
            const hasCUser = cookies.some(c => c.name === 'c_user');
            const hasXS = cookies.some(c => c.name === 'xs');
            await db.addLog('info', `[Apify] Cookies capturados com sucesso via content script (${cookies.length} chaves). Login detectado: c_user=${hasCUser}, xs=${hasXS}`);
            proceedWithApify(cookies);
          });
        } else {
          proceedWithApify(cookies);
        }
      });
    } catch (err) {
      await db.addLog('error', `[Apify] Erro na rotina: ${err.message}`);
      this.stop();
    }
  }

  async importApifyDataset(items, groupUrl) {
    if (!items || items.length === 0) {
      await db.addLog('warn', '[Apify] O dataset retornado pela nuvem está vazio ou não pôde ser lido. Verifique se o login do Facebook expirou ou se o scraper encontrou posts.');
      return;
    }

    // Salva metadados básicos do grupo no IndexedDB
    const groupInfo = {
      name: 'Grupo do Facebook',
      description: 'Extraído via API Apify na Nuvem',
      members_count: 0,
      rules: [],
      admins: []
    };
    const nameMatch = groupUrl.match(/\/groups\/([^/]+)/);
    if (nameMatch) {
      groupInfo.name = nameMatch[1];
    }
    await db.saveGroupInfo(groupInfo);

    const postsToSave = [];
    const commentsToSave = [];
    let totalCommentsCount = 0;

    for (const item of items) {
      // 1. Normaliza Post
      const postId = item.id || item.postId || 'post_' + Math.random().toString(36).substring(2, 9);
      
      const post = {
        post_id: postId,
        url: item.url || (groupUrl.endsWith('/') ? groupUrl : groupUrl + '/') + 'posts/' + postId + '/',
        author: item.authorName || item.user?.name || 'Membro do Grupo',
        author_id: item.facebookId || item.user?.id || '',
        date: item.time || item.date || '',
        text: item.text || item.message || '',
        likes: item.likesCount || item.reactionsCount || 0,
        shares: item.sharesCount || 0,
        comments_count: item.commentsCount || (item.comments ? item.comments.length : 0),
        media_refs: []
      };

      // Mapeia mídias e anexos se houver
      if (item.attachments && Array.isArray(item.attachments)) {
        item.attachments.forEach(att => {
          if (att.style === 'photo' || att.media?.image) {
            post.media_refs.push({
              url: att.media?.image?.src || att.url,
              thumbnail: att.media?.image?.src || att.url,
              type: 'image',
              post_id: postId
            });
          } else if (att.style === 'video_inline' || att.media?.playable_url) {
            post.media_refs.push({
              url: att.media?.playable_url || att.url,
              thumbnail: att.media?.image?.src || '',
              type: 'video',
              post_id: postId
            });
          }
        });
      }
      
      postsToSave.push(post);

      // 2. Normaliza Comentários
      if (item.comments && Array.isArray(item.comments)) {
        const hasher = (auth, txt) => {
          const str = `${auth || ''}:${txt || ''}`;
          let hash = 0;
          for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0;
          }
          return 'h_' + Math.abs(hash).toString(36);
        };

        for (const comment of item.comments) {
          const commentId = comment.id || hasher(comment.authorName || comment.name, comment.text);
          
          const normalComment = {
            comment_id: commentId,
            post_id: postId,
            parent_comment: '',
            author: comment.name || comment.authorName || 'Membro do Facebook',
            author_id: comment.facebookId || '',
            date: comment.date || '',
            text: comment.text || '',
            likes: comment.likesCount || 0,
            source: 'apify',
            confidence: 1.00
          };
          
          commentsToSave.push(normalComment);
          totalCommentsCount++;

          // Respostas (Replies)
          const replies = comment.replies || comment.answers;
          if (replies && Array.isArray(replies)) {
            for (const reply of replies) {
              const replyId = reply.id || hasher(reply.authorName || reply.name, reply.text);
              
              const normalReply = {
                comment_id: replyId,
                post_id: postId,
                parent_comment: normalComment.author,
                author: reply.name || reply.authorName || 'Membro do Facebook',
                author_id: reply.facebookId || '',
                date: reply.date || '',
                text: reply.text || '',
                likes: reply.likesCount || 0,
                source: 'apify',
                confidence: 1.00
              };
              
              commentsToSave.push(normalReply);
              totalCommentsCount++;
            }
          }
        }
      }
    }

    // Salva posts e comentários em batch no IndexedDB local
    await db.savePostsBatch(postsToSave);
    await db.saveCommentsBatch(commentsToSave);

    // Salva mídias no IndexedDB se o download de mídias estiver ativado
    const mediaStorage = await chrome.storage.local.get(['use_media_download']);
    if (mediaStorage.use_media_download === true) {
      const allMediaRefs = [];
      postsToSave.forEach(p => {
        if (p.media_refs && p.media_refs.length > 0) {
          allMediaRefs.push(...p.media_refs);
        }
      });
      if (allMediaRefs.length > 0) {
        await db.saveMediaBatch(allMediaRefs);
      }
    }

    // Calcula tamanho total de texto e estatísticas de IA
    let textLen = 0;
    postsToSave.forEach(p => {
      textLen += (p.text || '').length + (p.author || '').length;
    });
    commentsToSave.forEach(c => {
      textLen += (c.text || '').length + (c.author || '').length;
    });
    
    stateManager.totalTextLength = textLen;
    stateManager.state.datasetSizeKB = Math.round((textLen * 2) / 102.4) / 10;
    stateManager.state.embeddingChunks = Math.round(textLen / 1000) || Math.ceil(textLen / 1000);

    // Incrementa contadores no stateManager
    stateManager.state.postsFound = postsToSave.length;
    stateManager.state.postsProcessed = postsToSave.length;
    stateManager.state.commentsProcessed = totalCommentsCount;
    stateManager.state.commentsGQL = totalCommentsCount; // contabiliza como GQL
    
    // Salva o estado e sincroniza
    await stateManager.saveStateToDB();
  }
}

const workerPool = new WorkerPool();
self.workerPool = workerPool;
