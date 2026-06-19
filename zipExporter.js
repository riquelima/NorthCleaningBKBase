// zipExporter.js - Geração Incremental de ZIP de Base de Conhecimento e Datasets de IA

/**
 * Gera o arquivo ZIP contendo metadados JSON, CSV, datasets RAG e base de conhecimento.
 * Utiliza leitura por streaming via cursor para evitar o carregamento massivo de arrays na RAM.
 * @returns {Promise<Blob>}
 */
async function generateExportZip() {
  if (typeof JSZip === 'undefined') {
    throw new Error('A biblioteca JSZip não foi carregada. Certifique-se de que jszip.min.js esteja incluído.');
  }

  const zip = new JSZip();
  const exportFolder = zip.folder('facebook_group_export');

  // 1. Grava info do grupo
  const groupInfo = await db.getGroupInfo() || {
    name: 'Grupo Não Identificado',
    description: '',
    members_count: 0,
    rules: [],
    admins: []
  };
  exportFolder.file('group_info.json', JSON.stringify(groupInfo, null, 2));

  // Arrays temporários para amostra de análise de IA
  const samplePosts = [];
  const sampleCommentsMap = new Map();

  // --- EXPORTAÇÃO DE POSTS (JSON E CSV) ---
  let postsJsonStr = '[\n';
  let postsCsvStr = '"post_id","author","author_id","date","text","likes","shares","comments_count","media_refs"\n';
  let isFirstPost = true;
  
  await db.forEachPost(post => {
    // Coleta amostra dos posts mais engajados para análise de IA posterior
    if (samplePosts.length < 30) {
      samplePosts.push(post);
    } else {
      // Substitui se o post atual tiver mais engajamento
      const minEngagementIdx = samplePosts.findIndex(p => p.likes + p.comments_count < post.likes + post.comments_count);
      if (minEngagementIdx !== -1) {
        samplePosts[minEngagementIdx] = post;
      }
    }

    if (!isFirstPost) {
      postsJsonStr += ',\n';
    }
    
    // Normalização no JSON do ZIP
    const formatted = {
      post_id: post.post_id,
      author: post.author || '',
      author_id: post.author_id || '',
      date: post.date || '',
      text: post.text || '',
      likes: post.likes || 0,
      shares: post.shares || 0,
      comments_count: post.comments_count || 0,
      media_refs: post.media_refs || []
    };
    
    postsJsonStr += '  ' + JSON.stringify(formatted);
    postsCsvStr += `${escapeCSV(formatted.post_id)},${escapeCSV(formatted.author)},${escapeCSV(formatted.author_id)},${escapeCSV(formatted.date)},${escapeCSV(formatted.text)},${formatted.likes},${formatted.shares},${formatted.comments_count},${escapeCSV(JSON.stringify(formatted.media_refs))}\n`;
    
    isFirstPost = false;
  });
  
  postsJsonStr += '\n]';
  exportFolder.file('posts.json', postsJsonStr);
  exportFolder.file('posts.csv', postsCsvStr);
  postsJsonStr = null; // Libera RAM
  postsCsvStr = null;

  // --- EXPORTAÇÃO DE COMENTÁRIOS (JSON E CSV) ---
  let commentsJsonStr = '[\n';
  let commentsCsvStr = '"comment_id","post_id","parent_comment","author","author_id","date","text","likes","source","confidence"\n';
  let isFirstComment = true;
  
  await db.forEachComment(comment => {
    // Guarda amostra de comentários para os posts de amostra
    const postId = comment.post_id;
    if (!sampleCommentsMap.has(postId)) {
      sampleCommentsMap.set(postId, []);
    }
    const list = sampleCommentsMap.get(postId);
    if (list.length < 15) {
      list.push(comment);
    }

    if (!isFirstComment) {
      commentsJsonStr += ',\n';
    }
    
    // Normalização no JSON
    const formatted = {
      comment_id: comment.comment_id || comment.id,
      post_id: comment.post_id,
      parent_comment: comment.parent_comment || '',
      author: comment.author || '',
      author_id: comment.author_id || '',
      date: comment.date || '',
      text: comment.text || '',
      likes: comment.likes || 0,
      source: comment.source || 'dom',
      confidence: comment.confidence !== undefined ? comment.confidence : 0.85
    };
    
    commentsJsonStr += '  ' + JSON.stringify(formatted);
    commentsCsvStr += `${escapeCSV(formatted.comment_id)},${escapeCSV(formatted.post_id)},${escapeCSV(formatted.parent_comment)},${escapeCSV(formatted.author)},${escapeCSV(formatted.author_id)},${escapeCSV(formatted.date)},${escapeCSV(formatted.text)},${formatted.likes},${escapeCSV(formatted.source)},${formatted.confidence}\n`;
    
    isFirstComment = false;
  });
  
  commentsJsonStr += '\n]';
  exportFolder.file('comments.json', commentsJsonStr);
  exportFolder.file('comments.csv', commentsCsvStr);
  commentsJsonStr = null;
  commentsCsvStr = null;

  // --- CHUNKING E DATASET RAG (rag_dataset.jsonl) ---
  let ragJsonlStr = '';
  
  // Itera posts novamente para fazer chunking semântico com seus comentários associados
  await db.forEachPost(async (post) => {
    const pComments = await db.getCommentsForPost(post.post_id);
    
    // Chunk 0: Post Principal
    const postHeader = `[POST PRINCIPAL - ID: ${post.post_id}]\nAutor: ${post.author} | Data: ${post.date}\nLikes: ${post.likes} | Compartilhamentos: ${post.shares}\nCONTEÚDO:\n${post.text}\n`;
    
    // Se o post principal for muito longo, divide em pedaços de ~1000 caracteres
    const postChunks = splitTextIntoSize(post.text || '', 900);
    postChunks.forEach((chunkText, idx) => {
      const content = idx === 0 
        ? postHeader 
        : `[POST PRINCIPAL CONTINUAÇÃO - ID: ${post.post_id} - Parte ${idx + 1}]\n${chunkText}`;
        
      const line = {
        post_id: post.post_id,
        chunk_id: `chunk_${post.post_id}_post_${idx}`,
        content: content,
        metadata: {
          author: post.author,
          date: post.date,
          type: 'post',
          likes: post.likes
        }
      };
      ragJsonlStr += JSON.stringify(line) + '\n';
    });

    // Chunks de Comentários: Agrupa comentários em blocos de ~1000 caracteres preservando contexto
    if (pComments && pComments.length > 0) {
      let currentChunkText = `[CONTEXTO POST - ID: ${post.post_id} | Autor: ${post.author}]\nResumo do Post: ${post.text ? post.text.substring(0, 150) + '...' : ''}\n\n[COMENTÁRIOS E RESPOSTAS]:\n`;
      let currentChunkCommentsCount = 0;
      let commentIdx = 0;
      let chunkCounter = 0;

      for (const comment of pComments) {
        const commentLine = `- [${comment.author}]: "${comment.text}" (Reações: ${comment.likes || 0}, Confiança: ${comment.confidence || 0.85}, Origem: ${comment.source || 'dom'})\n`;
        
        // Verifica se a adição estoura o tamanho de ~1000 caracteres
        if ((currentChunkText + commentLine).length > 1050 && currentChunkCommentsCount > 0) {
          // Salva chunk anterior
          const line = {
            post_id: post.post_id,
            chunk_id: `chunk_${post.post_id}_comments_${chunkCounter}`,
            content: currentChunkText,
            metadata: {
              type: 'comments',
              comments_in_chunk: currentChunkCommentsCount,
              post_author: post.author
            }
          };
          ragJsonlStr += JSON.stringify(line) + '\n';
          
          // Reseta para novo chunk de comentários
          chunkCounter++;
          currentChunkText = `[CONTEXTO POST - ID: ${post.post_id} | Autor: ${post.author}]\n[COMENTÁRIOS E RESPOSTAS CONTINUAÇÃO - Parte ${chunkCounter + 1}]:\n` + commentLine;
          currentChunkCommentsCount = 1;
        } else {
          currentChunkText += commentLine;
          currentChunkCommentsCount++;
        }
        commentIdx++;
      }

      // Salva resto se houver
      if (currentChunkCommentsCount > 0) {
        const line = {
          post_id: post.post_id,
          chunk_id: `chunk_${post.post_id}_comments_${chunkCounter}`,
          content: currentChunkText,
          metadata: {
            type: 'comments',
            comments_in_chunk: currentChunkCommentsCount,
            post_author: post.author
          }
        };
        ragJsonlStr += JSON.stringify(line) + '\n';
      }
    }
  });

  exportFolder.file('rag_dataset.jsonl', ragJsonlStr);
  ragJsonlStr = null; // Libera RAM

  // --- GERAÇÃO DE KNOWLEDGE BASE E FAQ SEED (Gemini ou Fallback Local) ---
  const storage = await chrome.storage.local.get(['gemini_api_key']);
  const apiKey = storage.gemini_api_key;
  
  let faqContent = '';
  let knowledgeContent = '';

  if (apiKey && samplePosts.length > 0) {
    try {
      console.log('zipExporter: Solicitando análise estruturada de temas ao Gemini...');
      const analysisData = prepareAIPayload(samplePosts, sampleCommentsMap);
      
      faqContent = await generateFAQSeedViaGemini(analysisData, apiKey);
      knowledgeContent = await generateKnowledgeBaseViaGemini(analysisData, apiKey);
      
    } catch (aiErr) {
      console.warn('zipExporter: Falha ao chamar o Gemini para Base de Conhecimento. Usando fallback heurístico local:', aiErr);
      faqContent = generateFAQSeedLocal(samplePosts, sampleCommentsMap);
      knowledgeContent = generateKnowledgeBaseLocal(samplePosts, sampleCommentsMap);
    }
  } else {
    console.log('zipExporter: API Key ausente. Gerando FAQ e Apostila via rotina heurística local...');
    faqContent = generateFAQSeedLocal(samplePosts, sampleCommentsMap);
    knowledgeContent = generateKnowledgeBaseLocal(samplePosts, sampleCommentsMap);
  }

  exportFolder.file('faq_seed.md', faqContent);
  exportFolder.file('knowledge_base.md', knowledgeContent);

  // --- PASTAS DE MÍDIAS FÍSICAS (Apenas se a opção estiver ativada e houver blobs) ---
  const imagesFolder = exportFolder.folder('images');
  const videosFolder = exportFolder.folder('videos');
  const attachmentsFolder = exportFolder.folder('attachments');
  const mediaMetadata = { images: [], videos: [], attachments: [] };

  await db.forEachMedia(item => {
    if (item.blob && item.blob.size > 0) {
      if (item.type === 'image') {
        imagesFolder.file(item.filename, item.blob);
        mediaMetadata.images.push({ url: item.url, filename: item.filename, post_id: item.post_id });
      } else if (item.type === 'video') {
        videosFolder.file(item.filename, item.blob);
        mediaMetadata.videos.push({ url: item.url, filename: item.filename, post_id: item.post_id });
      } else if (item.type === 'attachment') {
        attachmentsFolder.file(item.filename, item.blob);
        mediaMetadata.attachments.push({ url: item.url, filename: item.filename, post_id: item.post_id });
      }
    }
  });
  exportFolder.file('media_metadata.json', JSON.stringify(mediaMetadata, null, 2));

  // Gera ZIP final com compressão STORE (desativada para velocidade e RAM)
  return await zip.generateAsync({ 
    type: 'blob',
    compression: 'STORE'
  });
}

// --- FUNÇÕES AUXILIARES ---

// Escapa aspas no formato CSV
function escapeCSV(val) {
  if (val === undefined || val === null) return '""';
  const str = String(val);
  return '"' + str.replace(/"/g, '""').replace(/\r/g, '').replace(/\n/g, ' ') + '"';
}

// Divide texto longo em fatias sem quebrar palavras
function splitTextIntoSize(text, size) {
  const chunks = [];
  let index = 0;
  while (index < text.length) {
    let end = index + size;
    if (end < text.length) {
      // Ajusta para não quebrar palavra no meio
      const nextSpace = text.lastIndexOf(' ', end);
      if (nextSpace > index) {
        end = nextSpace;
      }
    }
    chunks.push(text.substring(index, end).trim());
    index = end;
  }
  return chunks;
}

// Prepara o payload resumido para as chamadas de clustering da IA
function prepareAIPayload(posts, commentsMap) {
  const list = [];
  posts.forEach(p => {
    const postComments = commentsMap.get(p.post_id) || [];
    list.push({
      post_id: p.post_id,
      author: p.author,
      text: p.text ? p.text.substring(0, 500) : '',
      engagement: (p.likes || 0) + (p.shares || 0) + (p.comments_count || 0),
      comments: postComments.map(c => ({
        author: c.author,
        text: c.text ? c.text.substring(0, 200) : '',
        likes: c.likes
      }))
    });
  });
  return list;
}

// API Gemini: Gera FAQ Seed
async function generateFAQSeedViaGemini(analysisData, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${apiKey}`;
  const prompt = `Você é um engenheiro de IA especialista em RAG. Analise a seguinte lista de posts e comentários de um grupo do Facebook e identifique as perguntas mais recorrentes/comuns dos usuários e as respostas consolidadas baseadas nas threads.

Retorne uma estrutura Markdown bonita de FAQ contendo Título, Introdução e pelo menos 5 tópicos de Perguntas e Respostas. Agrupe dúvidas que forem similares.

Formato esperado:
# Semente de FAQ do Grupo (FAQ Seed)
...
## 1. [Pergunta Recorrente]
**Resposta:** ...

Dados do grupo:
${JSON.stringify(analysisData, null, 2)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const json = await response.json();
  if (json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts[0]) {
    return json.candidates[0].content.parts[0].text;
  }
  throw new Error('Retorno inválido');
}

// API Gemini: Gera Apostila Knowledge Base
async function generateKnowledgeBaseViaGemini(analysisData, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${apiKey}`;
  const prompt = `Você é um arquiteto de conhecimento. Analise estes posts e comentários e organize-os em uma Apostila / Base de Conhecimento didática em Markdown.
Separe obrigatoriamente pelas seguintes seções:
- Onboarding (como começar, apresentações)
- Problemas recorrentes (reclamações ou dificuldades relatadas)
- Erros frequentes (falhas comuns cometidas por novatos)
- Boas práticas (dicas e metodologias sugeridas)
- Casos de sucesso (depoimentos e conquistas)

Use tópicos elegantes e cite brevemente exemplos baseados nos dados.

Dados do grupo:
${JSON.stringify(analysisData, null, 2)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const json = await response.json();
  if (json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts[0]) {
    return json.candidates[0].content.parts[0].text;
  }
  throw new Error('Retorno inválido');
}

// Fallback Heurístico Local: FAQ Seed
function generateFAQSeedLocal(posts, commentsMap) {
  let md = `# Semente de FAQ do Grupo (Geração Heurística Local)\n\nEste FAQ foi gerado por meio de uma varredura local nos posts com maior engajamento que continham dúvidas.\n\n`;
  let questionCount = 0;
  
  posts.forEach(p => {
    // Procura posts ou comentários que têm interrogação
    const hasQuestionMark = (p.text || '').includes('?');
    if (hasQuestionMark && questionCount < 10) {
      const comments = commentsMap.get(p.post_id) || [];
      // Procura a resposta (comentário mais curtido)
      const bestAnswer = comments.reduce((best, cur) => (cur.likes || 0) > (best.likes || 0) ? cur : best, { text: 'Nenhuma resposta conclusiva encontrada nas threads.', likes: -1 });
      
      const lines = (p.text || '').split('\n').filter(l => l.includes('?'));
      const questionText = lines[0] ? lines[0].trim() : p.text.substring(0, 100) + '...';
      
      md += `## P: ${questionText}\n`;
      md += `**R (Baseado em thread de ${bestAnswer.author || 'Membro'}):** ${bestAnswer.text}\n\n`;
      questionCount++;
    }
  });

  if (questionCount === 0) {
    md += `*Nenhum padrão claro de perguntas e respostas foi detectado por heurística. Certifique-se de extrair posts que contenham o caractere '?' para alimentar a semente de FAQ.*\n`;
  }
  
  return md;
}

// Fallback Heurístico Local: Apostila de Conhecimento
function generateKnowledgeBaseLocal(posts, commentsMap) {
  const categories = {
    onboarding: { title: '1. Onboarding e Introdução', posts: [], keywords: /boas vindas|iniciar|cadastro|começar|novo membro|entrar|onboarding/i },
    problemas: { title: '2. Problemas Recorrentes', posts: [], keywords: /problema|erro|falha|bug|travando|quebrou|não funciona/i },
    erros: { title: '3. Erros Frequentes', posts: [], keywords: /inválido|incorreto|senha|esqueci|tentativa|negado|bloqueado/i },
    praticas: { title: '4. Boas Práticas', posts: [], keywords: /dica|tutorial|guia|boas práticas|recomendo|melhor forma|aprendi/i },
    sucesso: { title: '5. Casos de Sucesso e Conquistas', posts: [], keywords: /sucesso|consegui|faturamento|resultado|agradeço|depoimento|vendas/i }
  };

  // Classifica os posts pelas keywords
  posts.forEach(p => {
    const text = (p.text || '').toLowerCase();
    let categorized = false;
    for (const key in categories) {
      if (categories[key].keywords.test(text)) {
        categories[key].posts.push(p);
        categorized = true;
      }
    }
    // Se não bateu nenhuma, joga em boas práticas por padrão
    if (!categorized) {
      categories.praticas.posts.push(p);
    }
  });

  let md = `# Apostila de Conhecimento do Grupo (Clustering Heurístico Local)\n\nEsta apostila agrupa de forma estruturada as discussões e conhecimentos compartilhados no grupo, categorizados por temas de interesse comum.\n\n`;

  for (const key in categories) {
    const cat = categories[key];
    md += `## ${cat.title}\n\n`;
    if (cat.posts.length === 0) {
      md += `*Nenhum post relevante classificado neste tema até o momento.*\n\n`;
    } else {
      cat.posts.forEach(p => {
        md += `### ${p.author || 'Membro'} - Post ID: ${p.post_id}\n`;
        md += `> ${p.text ? p.text.substring(0, 300).replace(/\n/g, '\n> ') : ''}...\n\n`;
        
        // Adiciona as melhores discussões / comentários do post
        const comments = commentsMap.get(p.post_id) || [];
        const topComments = comments.sort((a,b) => (b.likes || 0) - (a.likes || 0)).slice(0, 2);
        if (topComments.length > 0) {
          md += `**Principais contribuições na discussão:**\n`;
          topComments.forEach(c => {
            md += `* **${c.author}**: "${c.text}"\n`;
          });
        }
        md += `\n---\n\n`;
      });
    }
  }

  return md;
}
