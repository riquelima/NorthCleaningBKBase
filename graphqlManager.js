// graphqlManager.js - Centralização de chamadas assíncronas ao Facebook Comet GraphQL

/**
 * Realiza uma requisição POST genérica para a API GraphQL do Facebook.
 * @param {string} fb_dtsg Token de autenticação
 * @param {string} docId ID da query GraphQL
 * @param {Object} variables Variáveis da query
 * @returns {Promise<string>} Resposta de texto cru (pode ser NDJSON)
 */
async function fetchGraphQL(fb_dtsg, docId, variables) {
  const url = 'https://www.facebook.com/api/graphql/';
  const body = new URLSearchParams();
  body.append('fb_dtsg', fb_dtsg);
  body.append('doc_id', docId);
  body.append('variables', JSON.stringify(variables));

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  });

  if (!response.ok) {
    throw new Error(`Facebook API GraphQL HTTP Error: ${response.status}`);
  }

  return await response.text();
}

/**
 * Consulta comentários de um post via GraphQL Comet.
 * @param {string} postId ID do post/target feedback
 * @param {string} fb_dtsg Token de autenticação
 * @param {string} docId ID da query de comentários
 * @param {Object} variablesTemplate Variáveis de template
 * @param {string|null} cursor Cursor para paginação
 * @returns {Promise<Object>} { comments: Array, hasNext: boolean, endCursor: string|null }
 */
async function fetchPostCommentsGraphQL(postId, fb_dtsg, docId, variablesTemplate, cursor = null) {
  const variables = typeof variablesTemplate === 'string' ? JSON.parse(variablesTemplate) : JSON.parse(JSON.stringify(variablesTemplate));
  
  const keysToReplace = ['feedbackTargetID', 'feedbackID', 'feedback_id', 'id', 'nodeID'];
  let replaced = false;
  for (const key of keysToReplace) {
    if (key in variables) {
      variables[key] = postId;
      replaced = true;
    }
  }
  if (!replaced) {
    variables['feedbackTargetID'] = postId;
  }

  // Configura paginação
  if ('after' in variables) variables['after'] = cursor;
  if ('cursor' in variables) variables['cursor'] = cursor;
  
  // Aumenta a quantidade padrão para reduzir requisições
  if ('first' in variables) variables['first'] = 50;
  if ('limit' in variables) variables['limit'] = 50;

  const text = await fetchGraphQL(fb_dtsg, docId, variables);
  
  // Parseia a resposta
  let jsonObj = null;
  const comments = [];
  let hasNext = false;
  let endCursor = null;

  try {
    jsonObj = JSON.parse(text);
    const parsedComments = extractCommentsFromGQLJSON(jsonObj);
    comments.push(...parsedComments);
    const pag = findGraphQLPaginationCursor(jsonObj);
    hasNext = pag.hasNextPage;
    endCursor = pag.endCursor;
  } catch (e) {
    // Caso seja formato NDJSON (uma linha por JSON)
    const lines = text.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        const parsedComments = extractCommentsFromGQLJSON(parsed);
        comments.push(...parsedComments);
        const pag = findGraphQLPaginationCursor(parsed);
        if (pag.hasNextPage) {
          hasNext = true;
          endCursor = pag.endCursor;
        }
      } catch (err) {}
    }
  }

  // Garante o ID do post correspondente a todos os comentários
  comments.forEach(c => c.post_id = postId);

  return { comments, hasNext, endCursor };
}

/**
 * Varre recursivamente o JSON de resposta para extrair comentários estruturados.
 * @param {Object} jsonObj
 * @returns {Array} Array de comentários
 */
function extractCommentsFromGQLJSON(jsonObj) {
  const comments = [];
  
  function traverse(obj) {
    if (!obj || typeof obj !== 'object') return;
    
    let text = '';
    if (obj.body && typeof obj.body === 'object' && typeof obj.body.text === 'string') {
      text = obj.body.text;
    } else if (obj.message && typeof obj.message === 'object' && typeof obj.message.text === 'string') {
      text = obj.message.text;
    }
    
    let authorName = '';
    let authorUrl = '';
    const authorObj = obj.author || obj.actor;
    if (authorObj && typeof authorObj === 'object' && authorObj.name) {
      authorName = authorObj.name;
      authorUrl = authorObj.url || '';
    }
    
    if (text && authorName) {
      const date = obj.created_time ? new Date(obj.created_time * 1000).toLocaleString() : '';
      let likes = 0;
      if (obj.feedback && obj.feedback.reactors && typeof obj.feedback.reactors.count === 'number') {
        likes = obj.feedback.reactors.count;
      } else if (obj.like_count) {
        likes = obj.like_count;
      }

      let replyCount = 0;
      const repliesObj = obj.replies || obj.comment_replies || obj.threaded_comments;
      if (repliesObj && repliesObj.count) {
        replyCount = repliesObj.count;
      }
      
      comments.push({
        comment_id: obj.id || 'c_' + Math.random().toString(36).substring(2, 9),
        author: authorName,
        author_link: authorUrl.split('?')[0],
        date: date,
        text: text,
        likes: likes,
        level: 'main',
        parent_comment: '',
        reply_count: replyCount
      });
      
      // Processa respostas se houver
      if (repliesObj) {
        const subComments = extractCommentsFromGQLJSON(repliesObj);
        for (const sc of subComments) {
          sc.level = 'reply';
          sc.parent_comment = authorName;
          comments.push(sc);
        }
      }
      return; 
    }
    
    if (Array.isArray(obj)) {
      for (const item of obj) {
        traverse(item);
      }
    } else {
      for (const key in obj) {
        traverse(obj[key]);
      }
    }
  }
  
  traverse(jsonObj);
  return comments;
}

/**
 * Extrai dados estruturados do post a partir do JSON.
 */
function extractPostFromGQLJSON(jsonObj, postId, url) {
  const post = {
    post_id: postId,
    url: url,
    author: '',
    author_link: '',
    date: '',
    text: '',
    likes: 0,
    comments_count: 0,
    shares: 0,
    type: 'text',
    images: [],
    videos: [],
    attachments: []
  };

  let foundStory = false;

  function traverse(obj) {
    if (!obj || typeof obj !== 'object' || foundStory) return;

    if ((obj.message && typeof obj.message === 'object' && typeof obj.message.text === 'string' ||
         obj.body && typeof obj.body === 'object' && typeof obj.body.text === 'string') &&
        (obj.actors && Array.isArray(obj.actors) && obj.actors.length > 0)) {
      
      foundStory = true;

      if (obj.message && obj.message.text) {
        post.text = obj.message.text;
      } else if (obj.body && obj.body.text) {
        post.text = obj.body.text;
      }

      const actor = obj.actors[0];
      if (actor) {
        post.author = actor.name || '';
        let href = actor.url || '';
        if (href && !href.startsWith('http')) {
          href = 'https://www.facebook.com' + href;
        }
        post.author_link = href.split('?')[0];
      }

      if (obj.creation_time) {
        post.date = new Date(obj.creation_time * 1000).toLocaleString();
      } else if (obj.created_time) {
        post.date = new Date(obj.created_time * 1000).toLocaleString();
      }

      if (obj.feedback) {
        if (obj.feedback.reactors && typeof obj.feedback.reactors.count === 'number') {
          post.likes = obj.feedback.reactors.count;
        }
        if (obj.feedback.comments && typeof obj.feedback.comments.count === 'number') {
          post.comments_count = obj.feedback.comments.count;
        }
      }

      if (obj.attachments && Array.isArray(obj.attachments)) {
        obj.attachments.forEach((att, index) => {
          const media = att.media || (att.styles && att.styles.attachment && att.styles.attachment.media);
          if (media) {
            if (media.image && media.image.uri) {
              post.images.push({
                url: media.image.uri,
                filename: `img_${postId}_${index + 1}.jpg`
              });
            } else if (media.uri) {
              post.images.push({
                url: media.uri,
                filename: `img_${postId}_${index + 1}.jpg`
              });
            }
            if (media.playable_url || media.playable_url_w_dash_manifest) {
              const videoUrl = media.playable_url || media.playable_url_w_dash_manifest;
              const thumbnail = media.preferred_thumbnail ? media.preferred_thumbnail.image.uri : (media.image ? media.image.uri : '');
              post.videos.push({
                url: videoUrl,
                thumbnail: thumbnail,
                duration: media.duration ? `${Math.floor(media.duration / 60)}:${media.duration % 60}` : '0:00',
                filename: `video_${postId}_${index + 1}.mp4`,
                thumbnail_filename: `thumb_${postId}_${index + 1}.jpg`
              });
            }
          }
        });
      }

      if (post.videos.length > 0) {
        post.type = 'video';
      } else if (post.images.length > 0) {
        post.type = 'image';
      } else {
        post.type = 'text';
      }

      return;
    }

    if (Array.isArray(obj)) {
      for (const item of obj) {
        traverse(item);
      }
    } else {
      for (const key in obj) {
        traverse(obj[key]);
      }
    }
  }

  traverse(jsonObj);
  return foundStory ? post : null;
}

/**
 * Varre o JSON do Feed de posts extraindo vários posts de uma só vez.
 */
function extractMultiplePostsFromGQLJSON(jsonObj) {
  const posts = [];
  
  function traverse(obj) {
    if (!obj || typeof obj !== 'object') return;
    
    if (obj.__typename === 'GroupStory' || obj.__typename === 'Story' || (obj.post_id && obj.actors)) {
      const postId = obj.id || obj.post_id || (obj.feedback && obj.feedback.id);
      if (postId) {
        const url = obj.url || `https://www.facebook.com/groups/bookingkoala/permalink/${postId}/`;
        const postData = extractPostFromGQLJSON(obj, postId, url);
        if (postData && postData.author) {
          posts.push(postData);
        }
      }
    }
    
    if (Array.isArray(obj)) {
      for (const item of obj) {
        traverse(item);
      }
    } else {
      for (const key in obj) {
        traverse(obj[key]);
      }
    }
  }
  
  traverse(jsonObj);
  return posts;
}

/**
 * Varre o HTML bruto em busca de scripts de cache de hidratação React para JSON.
 */
function extractJSONFromHTMLScripts(htmlText) {
  const jsonObjects = [];
  
  // 1. Tags script type="application/json" via regex (compatível com service workers MV3)
  try {
    const jsonScriptRegex = /<script\s+type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = jsonScriptRegex.exec(htmlText)) !== null) {
      const content = match[1].trim();
      if (!content) continue;
      try {
        const parsed = JSON.parse(content);
        if (parsed) {
          jsonObjects.push(parsed);
        }
      } catch (e) {}
    }
  } catch (err) {
    console.error('Erro ao ler scripts application/json com regex:', err);
  }

  // 2. Caches Relay inline via regex
  try {
    const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = scriptRegex.exec(htmlText)) !== null) {
      const scriptContent = match[1].trim();
      if (!scriptContent) continue;
      
      if (scriptContent.includes('RelayPrefetchedStreamCache') || scriptContent.includes('__bbox') || scriptContent.includes('feedback')) {
        let index = 0;
        while (true) {
          const start = scriptContent.indexOf('{"', index);
          if (start === -1) break;
          
          let openBraces = 0;
          let end = -1;
          
          for (let i = start; i < scriptContent.length; i++) {
            if (scriptContent[i] === '{') openBraces++;
            else if (scriptContent[i] === '}') {
              openBraces--;
              if (openBraces === 0) {
                end = i;
                break;
              }
            }
          }
          
          if (end !== -1) {
            const candidate = scriptContent.substring(start, end + 1);
            try {
              const parsed = JSON.parse(candidate);
              jsonObjects.push(parsed);
            } catch (e) {}
            index = end + 1;
          } else {
            index = start + 2;
          }
        }
      }
    }
  } catch (regexErr) {
    console.error('Erro ao varrer scripts inline com regex:', regexErr);
  }
  
  return jsonObjects.filter(obj => {
    try {
      const str = JSON.stringify(obj);
      return str.includes('feedback') || str.includes('story') || str.includes('group_feed') || str.includes('actors');
    } catch (e) {
      return false;
    }
  });
}

/**
 * Localiza recursivamente as informações de cursor de paginação GraphQL.
 */
function findGraphQLPaginationCursor(jsonObj) {
  let endCursor = null;
  let hasNextPage = false;
  
  function traverse(obj) {
    if (!obj || typeof obj !== 'object' || (endCursor && hasNextPage)) return;
    
    if (obj.page_info && typeof obj.page_info === 'object') {
      const pi = obj.page_info;
      if (pi.end_cursor !== undefined || pi.has_next_page !== undefined) {
        endCursor = pi.end_cursor;
        hasNextPage = !!pi.has_next_page;
        return;
      }
    }
    
    if (Array.isArray(obj)) {
      for (const item of obj) {
        traverse(item);
      }
    } else {
      for (const key in obj) {
        traverse(obj[key]);
      }
    }
  }
  
  traverse(jsonObj);
  return { endCursor, hasNextPage };
}

// Vincula ao escopo global
self.graphqlManager = {
  fetchGraphQL,
  fetchPostCommentsGraphQL,
  extractCommentsFromGQLJSON,
  extractPostFromGQLJSON,
  extractMultiplePostsFromGQLJSON,
  extractJSONFromHTMLScripts,
  findGraphQLPaginationCursor
};
