// content.js - Injetor e Manipulador Visual do DOM Híbrido para Facebook Group Downloader

// Escuta os eventos disparados no contexto MAIN pelo interceptor nativo
window.addEventListener('FB_GRAPHQL_INTERCEPT', (event) => {
  const { friendlyName, doc_id, fb_dtsg, variables } = event.detail;
  
  const isFeed = friendlyName && friendlyName.includes('Feed') && friendlyName.includes('Pagination');
  const isComment = friendlyName && (friendlyName.includes('Comment') || friendlyName.includes('UFI') || friendlyName.includes('UFIPayground'));
  
  if (isFeed || isComment || fb_dtsg) {
    chrome.runtime.sendMessage({
      action: 'SAVE_GRAPHQL_CREDENTIALS',
      data: { friendlyName, doc_id, fb_dtsg, variables }
    }).catch(() => {});
  }
});

// Busca redundante do token fb_dtsg no DOM isolado do Facebook Comet (inputs hidden de formulários)
(function detectDtsgInDOM() {
  try {
    const input = document.querySelector('input[name="fb_dtsg"]');
    if (input && input.value) {
      chrome.runtime.sendMessage({
        action: 'SAVE_GRAPHQL_CREDENTIALS',
        data: { fb_dtsg: input.value }
      }).catch(() => {});
      console.log('[FB Downloader] Token fb_dtsg detectado de forma redundante no DOM.');
    }
  } catch (e) {}
})();

// --- FLUXO DE COMPUTAÇÃO VISUAL (Níveis 3 e 4) ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'GET_FACEBOOK_COOKIES_AND_URL') {
    try {
      const cookiesStr = document.cookie;
      const cookies = [];
      cookiesStr.split(';').forEach(c => {
        const parts = c.trim().split('=');
        const name = parts[0];
        const value = parts.slice(1).join('=');
        if (name && value) {
          cookies.push({
            name,
            value,
            domain: '.facebook.com',
            path: '/',
            secure: true
          });
        }
      });
      sendResponse({ 
        url: window.location.href, 
        cookies: cookies 
      });
    } catch (e) {
      sendResponse({ error: e.message });
    }
    return false;
  }

  if (message.action === 'EXECUTE_VISUAL_FLOW') {
    (async () => {
      try {
        console.log('[Content] Iniciando fluxo visual de extração. Meta:', message.targetCount);
        
        // 1. Nível 3: Expande visualmente os comentários clicando nos botões
        await expandCommentsVisually(message.targetCount);
        
        // Extrai dados do DOM após expandir
        const domComments = extractCommentsFromDOM();
        console.log('[Content] DOM Parser extraiu', domComments.length, 'comentários.');
        
        // 2. Nível 4: Captura fotos sequenciais da página em viewport
        const screenshots = await captureVisibleSegments();
        console.log('[Content] Loop de capturas gerou', screenshots.length, 'imagens.');
        
        sendResponse({ domComments, screenshots });
      } catch (err) {
        console.error('[Content] Erro no fluxo visual:', err);
        sendResponse({ error: err.message, domComments: [], screenshots: [] });
      }
    })();
    return true; // Resposta assíncrona
  }

  if (message.action === 'DISCOVER_POSTS_FROM_DOM') {
    (async () => {
      try {
        console.log('[Content] Iniciando descoberta de posts no feed do grupo via DOM com scroll gradual...');
        const posts = [];
        
        const scan = () => {
          const found = [];
          const links = document.querySelectorAll('a');
          
          links.forEach(link => {
            try {
              const href = link.getAttribute('href') || link.href;
              if (!href) return;
              
              // Resolve URLs relativas
              let absoluteUrl = href;
              if (!href.startsWith('http') && !href.startsWith('//')) {
                absoluteUrl = window.location.origin + (href.startsWith('/') ? '' : '/') + href;
              }
              
              // Ignora links de comentários e respostas
              if (absoluteUrl.includes('comment_id') || absoluteUrl.includes('reply_comment_id')) return;
              
              let postId = null;
              let cleanUrl = absoluteUrl;
              
              // Regex 1: /groups/nome_do_grupo/posts/ID_DO_POST
              const groupsPostsMatch = absoluteUrl.match(/\/groups\/[^/]+\/posts\/(\d+)/i);
              if (groupsPostsMatch) {
                postId = groupsPostsMatch[1];
                cleanUrl = absoluteUrl.split('/posts/')[0] + '/posts/' + postId + '/';
              }
              
              // Regex 2: /groups/nome_do_grupo/permalink/ID_DO_POST
              if (!postId) {
                const groupsPermalinkMatch = absoluteUrl.match(/\/groups\/[^/]+\/permalink\/(\d+)/i);
                if (groupsPermalinkMatch) {
                  postId = groupsPermalinkMatch[1];
                  cleanUrl = absoluteUrl.split('/permalink/')[0] + '/permalink/' + postId + '/';
                }
              }

              // Regex 3: /story_fbid=ID_DO_POST
              if (!postId) {
                const storyFbidMatch = absoluteUrl.match(/story_fbid=(\d+)/i);
                if (storyFbidMatch) {
                  postId = storyFbidMatch[1];
                }
              }

              // Regex 4: /fbid=ID_DO_POST
              if (!postId) {
                const fbidMatch = absoluteUrl.match(/fbid=(\d+)/i);
                if (fbidMatch) {
                  postId = fbidMatch[1];
                }
              }

              // Regex 5: /multi_permalinks=ID_DO_POST
              if (!postId) {
                const multiPermalinksMatch = absoluteUrl.match(/multi_permalinks=(\d+)/i);
                if (multiPermalinksMatch) {
                  postId = multiPermalinksMatch[1];
                }
              }
              
              if (postId) {
                if (!found.some(p => p.post_id === postId) && !posts.some(p => p.post_id === postId)) {
                  found.push({
                    post_id: postId,
                    url: cleanUrl,
                    author: 'Membro do Facebook'
                  });
                }
              }
            } catch (e) {}
          });
          return found;
        };

        // Varredura inicial no estado atual
        posts.push(...scan());

        // Rola feed gradualmente em 12 passos menores para ser muito resiliente ao lazy loading
        let lastHeight = document.body.scrollHeight;
        for (let i = 0; i < 12; i++) {
          window.scrollBy(0, 1000);
          await sleep(2200); // Dá tempo do Facebook carregar novos posts
          posts.push(...scan());

          // Se a altura não mudou após algumas rolagens, faz um micro-scroll para cima e para baixo para forçar carregamento
          if (document.body.scrollHeight === lastHeight && i % 4 === 0) {
            window.scrollBy(0, -200);
            await sleep(300);
            window.scrollBy(0, 400);
            await sleep(500);
          }
          lastHeight = document.body.scrollHeight;
        }

        // Deduplica os posts encontrados
        const uniquePosts = [];
        const seen = new Set();
        for (const p of posts) {
          if (!seen.has(p.post_id)) {
            seen.add(p.post_id);
            uniquePosts.push(p);
          }
        }

        console.log('[Content] Varredura DOM gradual do feed encontrou', uniquePosts.length, 'posts.');
        sendResponse({ success: true, posts: uniquePosts });
      } catch (err) {
        console.error('[Content] Erro na descoberta via DOM:', err);
        sendResponse({ error: err.message, posts: [] });
      }
    })();
    return true; // Resposta assíncrona
  }
});

// Expande os comentários clicando recursivamente nos botões visíveis
async function expandCommentsVisually(targetCount = 0) {
  console.log('[Content] Expandindo comentários de forma visual...');
  
  // 1. Clicar no filtro de classificação (Mais relevantes -> Todos os comentários)
  const filterBtn = findCommentFilterButton();
  if (filterBtn) {
    console.log('[Content] Alterando filtro para "Todos os comentários"...');
    try {
      filterBtn.scrollIntoView({ behavior: 'auto', block: 'center' });
      await sleep(500);
    } catch (e) {}
    filterBtn.click();
    await sleep(2000);
    
    const allCommentsItem = findAllCommentsMenuItem();
    if (allCommentsItem) {
      try {
        allCommentsItem.scrollIntoView({ behavior: 'auto', block: 'center' });
        await sleep(500);
      } catch (e) {}
      allCommentsItem.click();
      console.log('[Content] Filtro selecionado.');
      await sleep(3000);
    }
  }

  // 2. Expandir repetidamente botões "Ver mais comentários" ou "Ver respostas"
  let expanded = true;
  let safetyCounter = 0;
  const maxIterations = 40; 
  
  while (expanded && safetyCounter < maxIterations) {
    expanded = false;
    
    const btns = findExpandButtons();
    if (btns.length > 0) {
      console.log(`[Content] Expandindo comentários (${safetyCounter + 1}/${maxIterations})...`);
      
      // Rola até o botão para forçar a renderização na tela (crucial para virtualizadores do React do Facebook)
      try {
        btns[0].scrollIntoView({ behavior: 'auto', block: 'center' });
        await sleep(600); // Aguarda renderizar pós-scroll
      } catch (e) {}
      
      try {
        btns[0].click();
      } catch (clickErr) {
        console.warn('[Content] Erro ao tentar clicar no botão de expansão:', clickErr);
      }
      
      await sleep(2200); // Aguarda carregar dados e renderizar
      expanded = true;
      safetyCounter++;
      
      if (targetCount > 0) {
        const visCount = document.querySelectorAll('[role="article"]').length - 1; 
        if (visCount >= targetCount) {
          console.log('[Content] Meta visual atingida no DOM. Parando expansão.');
          break;
        }
      }
    }
  }
  
  // 3. Expandir "Ver mais" de textos longos
  const seeMoreTextBtns = document.querySelectorAll('div[role="button"], span[role="button"]');
  seeMoreTextBtns.forEach(btn => {
    if (/Ver mais|See more/i.test(btn.textContent)) {
      try {
        btn.scrollIntoView({ behavior: 'auto', block: 'center' });
        btn.click();
      } catch (e) {}
    }
  });
  
  await sleep(1000);
}

// Rola a página em partes e solicita screenshots ao background com timeout de segurança
async function captureVisibleSegments() {
  console.log('[Content] Iniciando capturas de segmentos visíveis...');
  const screenshots = [];
  
  // Rola ao topo do post
  window.scrollTo(0, 0);
  await sleep(800);
 
  let lastScrollY = window.scrollY;
  let reachedEnd = false;
  let safetyLimit = 35; // Proteção contra loops de prints em páginas gigantes
  let count = 0;
 
  while (!reachedEnd && count < safetyLimit) {
    try {
      // Promise.race para evitar travar se a resposta de screenshot do background demorar ou o canal falhar
      const response = await Promise.race([
        chrome.runtime.sendMessage({ action: 'TAKE_SCREENSHOT' }),
        new Promise(r => setTimeout(() => r({ error: 'TIMEOUT_SCREENSHOT' }), 3500))
      ]);
      
      if (response && response.dataUrl) {
        screenshots.push(response.dataUrl);
      } else if (response && response.error) {
        console.error('[Content] Falha ao capturar screenshot:', response.error);
      }
    } catch (e) {
      console.error('[Content] Erro na requisição de screenshot:', e);
    }
 
    // Rola uma viewport para baixo com sobreposição de 20%
    const scrollAmount = Math.floor(window.innerHeight * 0.8);
    window.scrollBy(0, scrollAmount);
    await sleep(650); // Aguarda renderizar o scroll
 
    if (window.scrollY === lastScrollY) {
      reachedEnd = true;
    } else {
      lastScrollY = window.scrollY;
    }
    count++;
  }
 
  return screenshots;
}

// Localiza botões de expansão por heurística de texto
function findExpandButtons() {
  const buttons = [];
  const regex = /Ver mais comentário|Mostrar mais comentário|resposta|respostas|View more comment|Show more comment|replies|reply/i;
  
  document.querySelectorAll('span, div[role="button"]').forEach(el => {
    if (regex.test(el.textContent) && el.offsetWidth > 0 && !/Mais relevantes|Most relevant/i.test(el.textContent)) {
      const clickable = el.closest('[role="button"]') || el;
      buttons.push(clickable);
    }
  });
  return buttons;
}

function findCommentFilterButton() {
  const regex = /Mais relevantes|Most relevant/i;
  let found = null;
  document.querySelectorAll('div[role="button"], span').forEach(el => {
    if (regex.test(el.textContent) && el.offsetWidth > 0) {
      found = el.closest('[role="button"]') || el;
    }
  });
  return found;
}

function findAllCommentsMenuItem() {
  const menuItems = document.querySelectorAll('[role="menuitem"], [role="menuitemradio"], span, div');
  for (const item of menuItems) {
    if (/Todos os comentários|All comments/i.test(item.textContent)) {
      return item.closest('[role="menuitem"]') || item.closest('[role="menuitemradio"]') || item;
    }
  }
  return null;
}

// Extrai comentários do DOM expandido (Nível 3)
function extractCommentsFromDOM() {
  const comments = [];
  const wrappers = document.querySelectorAll('[role="article"]');
  
  wrappers.forEach(cEl => {
    // Ignora o post principal
    if (cEl.querySelector('h2 a[role="link"]') || cEl.querySelector('h3 a[role="link"]')) {
      return;
    }

    const comment = {
      author: '',
      text: '',
      level: 'main',
      parent_comment: ''
    };

    const authorEl = cEl.querySelector('a[role="link"][tabindex="0"] span') || 
                     cEl.querySelector('a[role="link"][tabindex="0"]');
    if (authorEl) {
      comment.author = authorEl.textContent.trim();
    }

    if (!comment.author) return;

    const textEl = cEl.querySelector('[dir="auto"][class*="x11i5rnm"]') || 
                   cEl.querySelector('span[lang]') ||
                   cEl.querySelector('div[dir="auto"] span');
    if (textEl) {
      comment.text = textEl.textContent.trim();
    }

    let parentEl = cEl.parentElement;
    let isReply = false;
    let parentAuthor = '';

    while (parentEl && parentEl !== document.body) {
      if (parentEl.getAttribute('role') === 'article' && parentEl !== cEl) {
        isReply = true;
        const pAuthorEl = parentEl.querySelector('a[role="link"][tabindex="0"] span') || 
                          parentEl.querySelector('a[role="link"][tabindex="0"]');
        if (pAuthorEl) {
          parentAuthor = pAuthorEl.textContent.trim();
        }
        break;
      }
      parentEl = parentEl.parentElement;
    }

    comment.level = isReply ? 'reply' : 'main';
    comment.parent_comment = parentAuthor;

    comments.push(comment);
  });

  return comments;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
