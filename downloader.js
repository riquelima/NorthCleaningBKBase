// FBExtractor - Auxiliar de extração DOM para o Facebook Group Downloader
window.FBExtractor = (function() {
  
  // Função auxiliar para procurar elementos por texto ou expressão regular
  function findElementByText(root, selector, regex) {
    const elements = root.querySelectorAll(selector);
    for (const el of elements) {
      if (regex.test(el.textContent)) {
        return el;
      }
    }
    return null;
  }

  // Função para limpar e converter texto numérico
  function parseNumber(text) {
    if (!text) return 0;
    // Remove tudo exceto dígitos, vírgulas, pontos e multiplicadores K/M
    let clean = text.trim().toLowerCase();
    
    // Simplificação para português/inglês
    clean = clean.replace(',', '.');
    const match = clean.match(/^([\d.]+)/);
    if (!match) return 0;
    
    const val = parseFloat(match[1]);
    if (clean.includes('k') || clean.includes('mil')) {
      return Math.round(val * 1000);
    }
    if (clean.includes('m') || clean.includes('mi') || clean.includes('milhão') || clean.includes('milhões')) {
      return Math.round(val * 1000000);
    }
    return Math.round(val);
  }

  // Extrai o maior link do srcset para obter imagem em alta resolução
  function getHighResImageFromSrcset(imgEl) {
    const srcset = imgEl.getAttribute('srcset');
    if (!srcset) return imgEl.src;
    
    // O srcset do FB vem no formato: url1 width1, url2 width2, ...
    const parts = srcset.split(',');
    let bestUrl = imgEl.src;
    let maxWid = 0;
    
    for (const part of parts) {
      const subParts = part.trim().split(' ');
      if (subParts.length >= 2) {
        const url = subParts[0];
        const width = parseInt(subParts[1].replace('w', ''), 10);
        if (!isNaN(width) && width > maxWid) {
          maxWid = width;
          bestUrl = url;
        }
      }
    }
    return bestUrl;
  }

  return {
    // 1. Verifica se o usuário está logado
    isLoggedIn() {
      // Se houver um formulário de login visível na página, não está logado
      if (document.querySelector('form[data-testid="royal_login_form"]') || 
          document.querySelector('input[name="login_source"]') ||
          window.location.pathname === '/login.php') {
        return false;
      }
      
      // Procura elementos comuns da barra superior que indicam sessão ativa
      const nav = document.querySelector('[role="navigation"]') || 
                  document.querySelector('[aria-label="Facebook"]') ||
                  document.querySelector('[aria-label="Perfil"]') ||
                  document.querySelector('a[href*="/me/"]');
      return !!nav;
    },

    // 2. Extrai metadados do grupo
    getGroupInfo() {
      const info = {
        name: '',
        description: '',
        members_count: 0,
        rules: [],
        admins: []
      };

      try {
        // Nome do grupo (geralmente o único H1 no cabeçalho)
        const h1 = document.querySelector('h1');
        if (h1) {
          info.name = h1.textContent.trim();
        }

        // Descrição do grupo (procura na seção sobre)
        // Se estivermos no /about, a descrição estará visível. Se estiver na home, pode estar em um painel lateral
        const descEl = document.querySelector('[aria-label="Sobre este grupo"] + div') ||
                       document.querySelector('[aria-label="About this group"] + div') ||
                       findElementByText(document, 'div,span', /Sobre este grupo/i)?.nextElementSibling ||
                       findElementByText(document, 'div,span', /About this group/i)?.nextElementSibling;
        if (descEl) {
          info.description = descEl.textContent.trim();
        }

        // Quantidade de membros (procura texto com "membros" ou "members")
        const membersEl = findElementByText(document, 'span,a,div', /(\d+([.,]\d+)?)\s*(mil\s+)?(membros|members)/i);
        if (membersEl) {
          const match = membersEl.textContent.match(/(\d+([.,]\d+)?\s*(mil)?)\s*(membros|members)/i);
          if (match) {
            info.members_count = parseNumber(match[1]);
          }
        }

        // Regras do grupo (geralmente em sanfonas com números ou títulos de regras)
        // Tentamos encontrar blocos que representem regras
        const ruleTitleEls = document.querySelectorAll('[role="button"] span[class*="x193iq5w"], div[class*="x193iq5w"]'); // classes comuns de títulos de regras ou texto bold
        const ruleRegex = /^\d+\.\s+(.+)/; // ex: "1. Respeite a todos"
        
        const possibleRules = [];
        document.querySelectorAll('span, div').forEach(el => {
          const txt = el.textContent.trim();
          if (ruleRegex.test(txt) && txt.length < 150) {
            possibleRules.push(txt);
          }
        });

        if (possibleRules.length > 0) {
          info.rules = [...new Set(possibleRules)];
        }

      } catch (err) {
        console.error('Erro ao extrair metadados do grupo:', err);
      }

      return info;
    },

    // 3. Extrai dados de um Post específico
    getPostData(postEl, postUrl = '') {
      const data = {
        post_id: '',
        url: postUrl || window.location.href,
        author: '',
        author_link: '',
        date: '',
        text: '',
        likes: 0,
        comments_count: 0,
        shares: 0,
        type: 'text',
        images: [], // formato: { url, filename }
        videos: [], // formato: { url, thumbnail, duration }
        attachments: [] // formato: { url, filename }
      };

      try {
        // ID do Post
        // Se postUrl for fornecido, tentamos extrair o ID. Senão, pegamos da URL atual.
        const urlToUse = data.url;
        const idMatch = urlToUse.match(/\/permalink\/(\d+)/) || urlToUse.match(/\/posts\/(\d+)/);
        if (idMatch) {
          data.post_id = idMatch[1];
        } else {
          // Fallback: tenta achar no DOM atributos como id ou data-testid
          data.post_id = 'post_' + Math.random().toString(36).substring(2, 9);
        }

        // Autor do Post
        // Geralmente o primeiro link de cabeçalho com texto em negrito (h2, h3, ou span com estilos de título)
        const authorLinkEl = postEl.querySelector('h2 a[role="link"]') || 
                             postEl.querySelector('h3 a[role="link"]') || 
                             postEl.querySelector('strong a') ||
                             postEl.querySelector('a[role="link"][tabindex="0"]');
        if (authorLinkEl) {
          data.author = authorLinkEl.textContent.trim();
          let href = authorLinkEl.getAttribute('href') || '';
          if (href && !href.startsWith('http')) {
            href = 'https://www.facebook.com' + href;
          }
          data.author_link = href.split('?')[0]; // Remove parâmetros de rastreamento
        }

        // Data/Hora do Post
        // O timestamp costuma ficar dentro de um link com aria-label ou texto relativo
        const dateEl = postEl.querySelector('a[role="link"] span[id]') ||
                       postEl.querySelector('span[id*="jsc_c"]') ||
                       postEl.querySelector('a[aria-label] span') ||
                       postEl.querySelector('[aria-label] a[role="link"]');
                       
        if (dateEl) {
          // Tenta pegar o aria-label do próprio elemento ou do pai dele
          const parentAria = dateEl.closest('[aria-label]') || dateEl.querySelector('[aria-label]');
          if (parentAria) {
            data.date = parentAria.getAttribute('aria-label');
          } else {
            data.date = dateEl.textContent.trim();
          }
        }

        // Texto do Post
        // Fica em um container com dir="auto" ou class contendo texto do post.
        // Procuramos por divs que contêm o texto principal do post.
        const textContainer = postEl.querySelector('[data-ad-preview="message"]') || 
                              postEl.querySelector('[dir="auto"][style*="text-align"]') || 
                              postEl.querySelector('.xv2mimd') || // classe clássica do texto de post
                              postEl.querySelector('div[id*="post_message"]');
        if (textContainer) {
          data.text = textContainer.textContent.trim();
        } else {
          // Fallback: tenta buscar o maior bloco de texto
          const blocks = postEl.querySelectorAll('div[dir="auto"]');
          let longestText = '';
          blocks.forEach(b => {
            // Ignora se for dentro de comentários ou curtidas
            if (!b.closest('[role="article"]') || b.closest('[role="article"]') === postEl) {
              const txt = b.textContent.trim();
              if (txt.length > longestText.length && !txt.startsWith('Comentários') && !txt.includes('Curtir')) {
                longestText = txt;
              }
            }
          });
          data.text = longestText;
        }

        // Curtidas/Reações
        // Fica em um container de reações. E.g. [aria-label*="reações"] ou [aria-label*="likes"]
        const reactionsEl = postEl.querySelector('[aria-label*="reações"]') || 
                            postEl.querySelector('[aria-label*="reactions"]') ||
                            postEl.querySelector('[aria-label*="likes"]') ||
                            postEl.querySelector('[class*="x1n2onr6"] span[class*="xi81z5g"]');
        if (reactionsEl) {
          const ariaVal = reactionsEl.getAttribute('aria-label');
          data.likes = parseNumber(ariaVal || reactionsEl.textContent);
        }

        // Comentários e Compartilhamentos
        // Procuramos links ou botões que contenham os textos
        const commentsLink = findElementByText(postEl, 'span, div, a', /(\d+([.,]\d+)?)\s*(comentário|comment)/i);
        if (commentsLink) {
          const m = commentsLink.textContent.match(/(\d+([.,]\d+)?)\s*(comentário|comment)/i);
          if (m) data.comments_count = parseNumber(m[1]);
        }

        const sharesLink = findElementByText(postEl, 'span, div, a', /(\d+([.,]\d+)?)\s*(compartilhamento|share)/i);
        if (sharesLink) {
          const m = sharesLink.textContent.match(/(\d+([.,]\d+)?)\s*(compartilhamento|share)/i);
          if (m) data.shares = parseNumber(m[1]);
        }

        // 4. Imagens
        // Encontra todas as imagens do post. Filtra imagens de perfil/ícones
        const imgEls = postEl.querySelectorAll('img');
        imgEls.forEach((img, index) => {
          const src = img.src;
          // Ignora imagens de perfil ou ícones comuns (geralmente pequenas ou com palavras chave)
          if (!src || src.includes('/emoji.php') || src.includes('/rsrc.php') || src.includes('profile') || img.width < 100) {
            return;
          }
          
          const highResUrl = getHighResImageFromSrcset(img);
          const ext = highResUrl.includes('.png') ? 'png' : 'jpg';
          const filename = `img_${data.post_id}_${index + 1}.${ext}`;
          
          data.images.push({
            url: highResUrl,
            filename: filename
          });
        });

        // 5. Vídeos
        const videoEls = postEl.querySelectorAll('video');
        videoEls.forEach((vid, index) => {
          // Vídeos do Facebook às vezes usam blob: ou URLs de CDN
          const src = vid.src || vid.getAttribute('src') || '';
          const poster = vid.getAttribute('poster') || '';
          
          // Duração (se houver algum marcador visual na tela)
          let duration = '0:00';
          const durationEl = vid.closest('div').querySelector('span[class*="x193iq5w"]'); // classe comum para crachá de tempo
          if (durationEl) {
            duration = durationEl.textContent.trim();
          }

          // Se a URL do vídeo for vazia ou for um blob:, salvamos a referência
          // No background.js, tentaremos baixar a URL. Se for blob:, usaremos a URL de imagem como backup
          const videoUrl = src;
          const filename = `video_${data.post_id}_${index + 1}.mp4`;
          const thumbFilename = `thumb_${data.post_id}_${index + 1}.jpg`;

          data.videos.push({
            url: videoUrl,
            thumbnail: poster,
            duration: duration,
            filename: filename,
            thumbnail_filename: thumbFilename
          });
        });

        // 6. Arquivos Anexados (PDF, DOCX, XLSX, ZIP)
        const fileLinks = postEl.querySelectorAll('a[href*="/download/"], a[href*="facebook.com/download/"]');
        fileLinks.forEach((link, index) => {
          const href = link.href;
          const text = link.textContent.trim();
          
          // Tenta determinar a extensão ou nome do arquivo
          let filename = `attachment_${data.post_id}_${index + 1}`;
          if (text) {
            // Se o texto parecer um arquivo (ex: "relatorio.pdf")
            if (/\.(pdf|docx|xlsx|zip|txt|csv)$/i.test(text)) {
              filename = text;
            } else {
              // Tenta descobrir a extensão pelo link ou adiciona pdf por padrão
              const extMatch = href.match(/\.(pdf|docx|xlsx|zip)/i);
              const ext = extMatch ? extMatch[0].substring(1) : 'bin';
              filename = `${text.substring(0, 30)}_${data.post_id}_${index + 1}.${ext}`;
            }
          }
          
          data.attachments.push({
            url: href,
            filename: filename
          });
        });

        // Determinar o Tipo do Post
        if (data.videos.length > 0) {
          data.type = 'video';
        } else if (data.images.length > 0) {
          data.type = 'image';
        } else if (data.attachments.length > 0) {
          data.type = 'attachment';
        } else if (postEl.querySelector('[role="progressbar"]') || postEl.querySelector('input[type="radio"]')) {
          data.type = 'poll'; // Enquete
        } else {
          data.type = 'text';
        }

      } catch (err) {
        console.error('Erro ao processar post:', err);
      }

      return data;
    },

    // 4. Extrai Comentários de um Post
    // Retorna um array de comentários estruturados
    getComments(postEl, postId) {
      const comments = [];
      try {
        // Encontra todos os blocos de comentários.
        // No FB, os comentários costumam ter uma estrutura parecida com blocos com role="article" aninhados dentro do post principal,
        // ou divs com atributos aria-label contendo "Comentário de" ou "Comment by".
        const commentWrappers = postEl.querySelectorAll('[role="article"]');
        
        commentWrappers.forEach((cEl) => {
          // Ignora o próprio post (que também tem role="article")
          if (cEl === postEl) return;
          
          // Evita processar elementos fora da seção de comentários
          if (!cEl.querySelector('a[role="link"]')) return;

          // Dados do comentário
          const comment = {
            post_id: postId,
            author: '',
            author_link: '',
            date: '',
            text: '',
            likes: 0,
            level: 'main', // 'main' ou 'reply'
            parent_comment: '' // se for reply, nome do autor pai ou ID do comentário pai
          };

          // Autor do comentário
          const authorEl = cEl.querySelector('a[role="link"][tabindex="0"] span') || 
                           cEl.querySelector('a[role="link"][tabindex="0"]') ||
                           cEl.querySelector('span[class*="x193iq5w"] a');
          if (authorEl) {
            comment.author = authorEl.textContent.trim();
            const linkEl = authorEl.closest('a');
            if (linkEl) {
              let href = linkEl.getAttribute('href') || '';
              if (href && !href.startsWith('http')) {
                href = 'https://www.facebook.com' + href;
              }
              comment.author_link = href.split('?')[0];
            }
          }

          if (!comment.author) return; // Se não achou o autor, provavelmente não é um comentário

          // Texto do comentário
          const textEl = cEl.querySelector('[dir="auto"][class*="x11i5rnm"]') || 
                         cEl.querySelector('span[lang]') ||
                         cEl.querySelector('div[dir="auto"] span');
          if (textEl) {
            comment.text = textEl.textContent.trim();
          }

          // Data do comentário
          const dateEl = findElementByText(cEl, 'span,a', /^(agora|\d+\s*[hmsd]|1\s*sem|[\d\s]+(de\s+)?\w+)/i);
          if (dateEl) {
            comment.date = dateEl.textContent.trim();
          }

          // Curtidas do comentário
          const likesEl = cEl.querySelector('[aria-label*="curtidas"]') ||
                           cEl.querySelector('[aria-label*="likes"]') ||
                           cEl.querySelector('span[class*="xi81z5g"]');
          if (likesEl) {
            comment.likes = parseNumber(likesEl.textContent);
          }

          // Nível de resposta (Verifica se está aninhado)
          // No FB, as respostas costumam estar dentro de uma lista aninhada (geralmente com classes de margem esquerda ou ul/li)
          // ou podemos olhar se o elemento pai contém atributos de thread.
          // Uma forma resiliente: verificar a hierarquia de tags ou se está dentro de uma div com margem indentada.
          let parentEl = cEl.parentElement;
          let isReply = false;
          let parentAuthor = '';

          while (parentEl && parentEl !== postEl) {
            // Se encontrar outro comentário acima dele antes de chegar ao post, é uma resposta!
            if (parentEl.getAttribute('role') === 'article' && parentEl !== cEl) {
              isReply = true;
              const parentAuthorEl = parentEl.querySelector('a[role="link"][tabindex="0"] span') || 
                                     parentEl.querySelector('a[role="link"][tabindex="0"]');
              if (parentAuthorEl) {
                parentAuthor = parentAuthorEl.textContent.trim();
              }
              break;
            }
            parentEl = parentEl.parentElement;
          }

          comment.level = isReply ? 'reply' : 'main';
          comment.parent_comment = parentAuthor;

          comments.push(comment);
        });

      } catch (err) {
        console.error('Erro ao extrair comentários:', err);
      }

      return comments;
    },

    // 5. Encontra botões de expansão de comentários e posts
    // Retorna botões de "Ver mais" de posts longos
    findSeeMoreButtons(root) {
      const buttons = [];
      const regex = /Ver mais|See more/i;
      root.querySelectorAll('div[role="button"], span[role="button"]').forEach(el => {
        if (regex.test(el.textContent)) {
          buttons.push(el);
        }
      });
      return buttons;
    },

    // Encontra botões de "Ver mais comentários" ou "Todos os comentários"
    findCommentExpandButtons(root) {
      const buttons = [];
      // Procura textos como "Ver mais comentários", "Mostrar mais comentários", "Escrever um comentário...",
      // ou o seletor de classificação "Mais relevantes" para mudar para "Todos os comentários".
      const regex = /Ver mais comentário|Mostrar mais comentário|View more comment|Show more comment/i;
      root.querySelectorAll('span, div[role="button"]').forEach(el => {
        if (regex.test(el.textContent) && el.offsetWidth > 0) {
          // Pega o elemento clicável mais próximo (geralmente ele mesmo ou o pai)
          const clickable = el.closest('[role="button"]') || el;
          buttons.push(clickable);
        }
      });

      // Também detecta o botão de "Mais relevantes" para alterar a filtragem de comentários
      const filterRegex = /Mais relevantes|Most relevant/i;
      root.querySelectorAll('div[role="button"], span').forEach(el => {
        if (filterRegex.test(el.textContent) && el.offsetWidth > 0) {
          const clickable = el.closest('[role="button"]') || el;
          buttons.push(clickable);
        }
      });

      return buttons;
    },

    // Encontra botões de "Ver mais respostas" de comentários
    findReplyExpandButtons(root) {
      const buttons = [];
      const regex = /(\d+\s+resposta|ver\s+respostas|view\s+\d+\s+repl|replies)/i;
      root.querySelectorAll('span, div[role="button"]').forEach(el => {
        if (regex.test(el.textContent) && el.offsetWidth > 0) {
          const clickable = el.closest('[role="button"]') || el;
          buttons.push(clickable);
        }
      });
      return buttons;
    }
  };
})();
