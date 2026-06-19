/**
 * Aguarda um determinado número de milissegundos.
 * @param {number} ms 
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Aguarda um atraso aleatório entre min e max milissegundos.
 * @param {number} min 
 * @param {number} max 
 * @returns {Promise<void>}
 */
async function randomDelay(min = 1000, max = 3000) {
  const ms = Math.floor(Math.random() * (max - min + 1) + min);
  return sleep(ms);
}

/**
 * Sanitiza o nome de um arquivo removendo caracteres ilegais para sistemas operacionais.
 * @param {string} filename 
 * @returns {string}
 */
function sanitizeFilename(filename) {
  if (!filename) return 'unnamed_file';
  // Remove caracteres inválidos: \ / : * ? " < > |
  let sanitized = filename.replace(/[\\/:*?"<>|]/g, '_');
  // Remove quebras de linha e tabs
  sanitized = sanitized.replace(/[\r\n\t]/g, ' ');
  // Limita tamanho
  if (sanitized.length > 150) {
    const extIdx = sanitized.lastIndexOf('.');
    if (extIdx !== -1 && (sanitized.length - extIdx) <= 5) {
      const ext = sanitized.substring(extIdx);
      sanitized = sanitized.substring(0, 140) + ext;
    } else {
      sanitized = sanitized.substring(0, 145);
    }
  }
  return sanitized.trim();
}

/**
 * Executa uma função assíncrona com tentativas em caso de erro.
 * @param {Function} fn 
 * @param {number} retries 
 * @param {number} delayMs 
 * @returns {Promise<any>}
 */
async function retry(fn, retries = 3, delayMs = 1500) {
  try {
    return await fn();
  } catch (error) {
    if (retries <= 1) throw error;
    await sleep(delayMs);
    return retry(fn, retries - 1, delayMs * 1.5);
  }
}

/**
 * Extrai o ID de um post do Facebook a partir de sua URL.
 * Ex: https://www.facebook.com/groups/bookingkoala/permalink/3074811802773229/ -> 3074811802773229
 * @param {string} url 
 * @returns {string|null}
 */
function extractFacebookPostId(url) {
  if (!url) return null;
  
  // Casos comuns de grupos: /permalink/ID/ ou /posts/ID/
  const permalinkMatch = url.match(/\/permalink\/(\d+)/);
  if (permalinkMatch) return permalinkMatch[1];
  
  const postsMatch = url.match(/\/posts\/(\d+)/);
  if (postsMatch) return postsMatch[1];

  const storyFbidMatch = url.match(/story_fbid=(\d+)/);
  if (storyFbidMatch) return storyFbidMatch[1];

  const fbidMatch = url.match(/fbid=(\d+)/);
  if (fbidMatch) return fbidMatch[1];
  
  return null;
}

/**
 * Converte strings numéricas do Facebook como "1,2 mil" ou "1.2K" em números reais.
 * @param {string} text 
 * @returns {number}
 */
function parseFacebookNumber(text) {
  if (!text) return 0;
  
  // Limpa o texto, mantendo apenas números, pontos, vírgulas e as letras multiplicadoras (K, M, mil, mi, etc.)
  let cleanText = text.trim().toLowerCase();
  
  // Se for apenas dígitos simples
  if (/^\d+$/.test(cleanText)) {
    return parseInt(cleanText, 10);
  }

  // Substitui vírgula por ponto para parsear corretamente floats
  cleanText = cleanText.replace(',', '.');

  // Encontra os dígitos numéricos (incluindo pontos decímais)
  const numMatch = cleanText.match(/^([\d.]+)/);
  if (!numMatch) return 0;

  const value = parseFloat(numMatch[1]);
  
  // Multiplicadores em inglês/português
  if (cleanText.includes('k') || cleanText.includes('mil')) {
    return Math.round(value * 1000);
  }
  if (cleanText.includes('m') || cleanText.includes('mi') || cleanText.includes('milhão') || cleanText.includes('milhões')) {
    return Math.round(value * 1000000);
  }

  return Math.round(value);
}

/**
 * Gera um hash determinístico rápido para identificação e deduplicação de comentários.
 * @param {string} author 
 * @param {string} text 
 * @returns {string}
 */
function hashComment(author, text) {
  const authorStr = (author || '').trim().toLowerCase();
  const textStr = (text || '').trim().toLowerCase();
  const input = `${authorStr}:${textStr}`;
  
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Converte para inteiro de 32 bits
  }
  return 'h_' + Math.abs(hash).toString(36);
}

self.hashComment = hashComment;
window = typeof window !== 'undefined' ? window : self;
window.hashComment = hashComment;
