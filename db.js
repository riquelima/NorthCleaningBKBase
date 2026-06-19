const DB_NAME = 'FacebookGroupDownloaderDB';
const DB_VERSION = 4; // Aumentado para 4 para suportar vision_queue e comment_queue

class AppDB {
  constructor() {
    this.db = null;
  }

  async init() {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = (event) => {
        console.error('Erro ao abrir o banco de dados:', event.target.error);
        reject(event.target.error);
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // Store de informações do grupo
        if (!db.objectStoreNames.contains('group_info')) {
          db.createObjectStore('group_info', { keyPath: 'id' });
        }

        // Store de posts
        if (!db.objectStoreNames.contains('posts')) {
          db.createObjectStore('posts', { keyPath: 'post_id' });
        }

        // Store de comentários
        if (!db.objectStoreNames.contains('comments')) {
          const commentStore = db.createObjectStore('comments', { keyPath: 'id', autoIncrement: true });
          commentStore.createIndex('post_id', 'post_id', { unique: false });
        }

        // Store de arquivos de mídia (imagens, vídeos, anexos)
        if (!db.objectStoreNames.contains('media')) {
          const mediaStore = db.createObjectStore('media', { keyPath: 'url' });
          mediaStore.createIndex('post_id', 'post_id', { unique: false });
          mediaStore.createIndex('downloaded', 'downloaded', { unique: false });
        }

        // Store de estado da aplicação (urls pendentes, filtros, configurações)
        if (!db.objectStoreNames.contains('state')) {
          db.createObjectStore('state', { keyPath: 'key' });
        }

        // Store de logs de execução
        if (!db.objectStoreNames.contains('logs')) {
          db.createObjectStore('logs', { keyPath: 'id', autoIncrement: true });
        }

        // --- Stores de Filas Persistidas ---
        // Fila de posts a serem processados
        if (!db.objectStoreNames.contains('post_queue')) {
          const postQueue = db.createObjectStore('post_queue', { keyPath: 'url' });
          postQueue.createIndex('status', 'status', { unique: false });
        }

        // Fila de comentários a serem paginados
        if (!db.objectStoreNames.contains('comment_queue')) {
          const commentQueue = db.createObjectStore('comment_queue', { keyPath: 'post_id' });
          commentQueue.createIndex('status', 'status', { unique: false });
        }

        // Fila de posts aguardando análise multimodal
        if (!db.objectStoreNames.contains('vision_queue')) {
          const visionQueue = db.createObjectStore('vision_queue', { keyPath: 'post_id' });
          visionQueue.createIndex('status', 'status', { unique: false });
        }

        // Fila de mídias a serem baixadas
        if (!db.objectStoreNames.contains('media_queue')) {
          const mediaQueue = db.createObjectStore('media_queue', { keyPath: 'url' });
          mediaQueue.createIndex('post_id', 'post_id', { unique: false });
          mediaQueue.createIndex('status', 'status', { unique: false });
        }
      };
    });
  }

  // Métodos para Group Info
  async saveGroupInfo(info) {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('group_info', 'readwrite');
      const store = transaction.objectStore('group_info');
      const request = store.put({ id: 'metadata', ...info });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getGroupInfo() {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('group_info', 'readonly');
      const store = transaction.objectStore('group_info');
      const request = store.get('metadata');
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  // Métodos para Posts (Unitário e Batch)
  // Métodos para Posts (Unitário e Batch)
  async savePost(post) {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('posts', 'readwrite');
      const store = transaction.objectStore('posts');
      
      const normalized = {
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

      // Se vier com imagens/vídeos antigos, normaliza para media_refs
      if (!normalized.media_refs.length) {
        if (post.images && Array.isArray(post.images)) {
          post.images.forEach(img => {
            normalized.media_refs.push({
              url: img.url,
              thumbnail: img.url,
              type: 'image',
              post_id: post.post_id
            });
          });
        }
        if (post.videos && Array.isArray(post.videos)) {
          post.videos.forEach(vid => {
            normalized.media_refs.push({
              url: vid.url,
              thumbnail: vid.thumbnail || '',
              type: 'video',
              post_id: post.post_id
            });
          });
        }
      }

      const request = store.put(normalized);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async savePostsBatch(posts) {
    if (!posts || posts.length === 0) return;
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('posts', 'readwrite');
      const store = transaction.objectStore('posts');
      
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      
      for (const post of posts) {
        const normalized = {
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

        if (!normalized.media_refs.length) {
          if (post.images && Array.isArray(post.images)) {
            post.images.forEach(img => {
              normalized.media_refs.push({
                url: img.url,
                thumbnail: img.url,
                type: 'image',
                post_id: post.post_id
              });
            });
          }
          if (post.videos && Array.isArray(post.videos)) {
            post.videos.forEach(vid => {
              normalized.media_refs.push({
                url: vid.url,
                thumbnail: vid.thumbnail || '',
                type: 'video',
                post_id: post.post_id
              });
            });
          }
        }
        store.put(normalized);
      }
    });
  }

  async getPost(postId) {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('posts', 'readonly');
      const store = transaction.objectStore('posts');
      const request = store.get(postId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async getAllPosts() {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('posts', 'readonly');
      const store = transaction.objectStore('posts');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // Iteração por Cursor (Streaming)
  async forEachPost(callback) {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('posts', 'readonly');
      const store = transaction.objectStore('posts');
      const request = store.openCursor();
      request.onsuccess = async (event) => {
        const cursor = event.target.result;
        if (cursor) {
          try {
            await callback(cursor.value);
            cursor.continue();
          } catch (err) {
            reject(err);
          }
        } else {
          resolve();
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  // Métodos para Comentários (Unitário e Batch)
  async saveComment(comment) {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('comments', 'readwrite');
      const store = transaction.objectStore('comments');
      
      const hasher = self.hashComment || ((auth, txt) => {
        const str = `${auth || ''}:${txt || ''}`;
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
          hash = ((hash << 5) - hash) + str.charCodeAt(i);
          hash |= 0;
        }
        return 'h_' + Math.abs(hash).toString(36);
      });

      const normalized = {
        comment_id: comment.comment_id || comment.id || hasher(comment.author, comment.text),
        post_id: comment.post_id,
        parent_comment: comment.parent_comment || '',
        author: comment.author || 'Membro do Facebook',
        author_id: comment.author_id || '',
        date: comment.date || '',
        text: comment.text || '',
        likes: comment.likes || 0,
        source: comment.source || 'dom',
        confidence: comment.confidence !== undefined ? comment.confidence : 0.85
      };
      normalized.id = normalized.comment_id;

      const request = store.put(normalized);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async saveCommentsBatch(comments) {
    if (!comments || comments.length === 0) return;
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('comments', 'readwrite');
      const store = transaction.objectStore('comments');
      
      const hasher = self.hashComment || ((auth, txt) => {
        const str = `${auth || ''}:${txt || ''}`;
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
          hash = ((hash << 5) - hash) + str.charCodeAt(i);
          hash |= 0;
        }
        return 'h_' + Math.abs(hash).toString(36);
      });

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      
      for (const comment of comments) {
        const normalized = {
          comment_id: comment.comment_id || comment.id || hasher(comment.author, comment.text),
          post_id: comment.post_id,
          parent_comment: comment.parent_comment || '',
          author: comment.author || 'Membro do Facebook',
          author_id: comment.author_id || '',
          date: comment.date || '',
          text: comment.text || '',
          likes: comment.likes || 0,
          source: comment.source || 'dom',
          confidence: comment.confidence !== undefined ? comment.confidence : 0.85
        };
        normalized.id = normalized.comment_id;
        store.put(normalized);
      }
    });
  }

  async getCommentsForPost(postId) {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('comments', 'readonly');
      const store = transaction.objectStore('comments');
      const index = store.index('post_id');
      const request = index.getAll(postId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getAllComments() {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('comments', 'readonly');
      const store = transaction.objectStore('comments');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async forEachComment(callback) {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('comments', 'readonly');
      const store = transaction.objectStore('comments');
      const request = store.openCursor();
      request.onsuccess = async (event) => {
        const cursor = event.target.result;
        if (cursor) {
          try {
            await callback(cursor.value);
            cursor.continue();
          } catch (err) {
            reject(err);
          }
        } else {
          resolve();
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  // Métodos para Mídia (Unitário e Batch)
  async saveMedia(mediaItem) {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('media', 'readwrite');
      const store = transaction.objectStore('media');
      const request = store.put({ downloaded: false, blob: null, ...mediaItem });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async saveMediaBatch(mediaItems) {
    if (!mediaItems || mediaItems.length === 0) return;
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('media', 'readwrite');
      const store = transaction.objectStore('media');
      
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      
      for (const item of mediaItems) {
        store.put({ downloaded: false, blob: null, ...item });
      }
    });
  }

  async getAllMedia() {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('media', 'readonly');
      const store = transaction.objectStore('media');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async forEachMedia(callback) {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('media', 'readonly');
      const store = transaction.objectStore('media');
      const request = store.openCursor();
      request.onsuccess = async (event) => {
        const cursor = event.target.result;
        if (cursor) {
          try {
            await callback(cursor.value);
            cursor.continue();
          } catch (err) {
            reject(err);
          }
        } else {
          resolve();
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getPendingMedia() {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('media', 'readonly');
      const store = transaction.objectStore('media');
      const index = store.index('downloaded');
      const request = index.getAll(0);
      request.onsuccess = () => {
        const results = request.result.filter(item => !item.downloaded);
        resolve(results);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async updateMediaBlob(url, blob) {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('media', 'readwrite');
      const store = transaction.objectStore('media');
      
      const getReq = store.get(url);
      getReq.onsuccess = () => {
        const item = getReq.result;
        if (item) {
          item.blob = blob;
          item.downloaded = true;
          const putReq = store.put(item);
          putReq.onsuccess = () => resolve();
          putReq.onerror = () => reject(putReq.error);
        } else {
          resolve();
        }
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  // --- Operações de Filas no IndexedDB ---
  async getQueueSize(storeName, status = null) {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      
      if (status) {
        const index = store.index('status');
        const request = index.count(status);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      } else {
        const request = store.count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }
    });
  }

  async enqueueQueueItems(storeName, items) {
    if (!items || items.length === 0) return 0;
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      
      let added = 0;
      transaction.oncomplete = () => resolve(added);
      transaction.onerror = () => reject(transaction.error);
      
      for (const item of items) {
        store.put({
          status: 'pending',
          retry_count: 0,
          added_time: Date.now(),
          ...item
        });
        added++;
      }
    });
  }

  async dequeueQueueItems(storeName, limit = 1) {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const index = store.index('status');
      
      const results = [];
      const request = index.openCursor(IDBKeyRange.only('pending'));
      
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor && results.length < limit) {
          const item = cursor.value;
          item.status = 'processing';
          cursor.update(item);
          results.push(item);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  async updateQueueItemStatus(storeName, key, status, extraFields = {}) {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      
      const getReq = store.get(key);
      getReq.onsuccess = () => {
        const item = getReq.result;
        if (item) {
          Object.assign(item, { status, ...extraFields });
          const putReq = store.put(item);
          putReq.onsuccess = () => resolve();
          putReq.onerror = () => reject(putReq.error);
        } else {
          resolve();
        }
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  async resetProcessingQueueItems(storeName) {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const index = store.index('status');
      
      const request = index.openCursor(IDBKeyRange.only('processing'));
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          const item = cursor.value;
          item.status = 'pending';
          cursor.update(item);
          cursor.continue();
        } else {
          resolve();
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  // Métodos para Estado da Extensão
  async saveState(key, val) {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('state', 'readwrite');
      const store = transaction.objectStore('state');
      const request = store.put({ key, value: val });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getState(key) {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('state', 'readonly');
      const store = transaction.objectStore('state');
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result ? request.result.value : null);
      request.onerror = () => reject(request.error);
    });
  }

  // Logs
  async addLog(level, message) {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('logs', 'readwrite');
      const store = transaction.objectStore('logs');
      const timestamp = new Date().toISOString();
      const request = store.add({
        timestamp,
        level,
        message
      });
      request.onsuccess = () => {
        // Envia o log em tempo real para o popup se ele estiver aberto
        try {
          chrome.runtime.sendMessage({
            action: 'LOG_UPDATE',
            data: { level, text: message, timestamp }
          }).catch(() => {}); // Ignora erros se o popup estiver fechado
        } catch (e) {}
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getLogs(limit = 100) {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('logs', 'readonly');
      const store = transaction.objectStore('logs');
      const request = store.getAll();
      request.onsuccess = () => {
        const logs = request.result;
        if (logs.length > limit) {
          resolve(logs.slice(-limit));
        } else {
          resolve(logs);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  // Limpeza
  async clearAll() {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(
        ['group_info', 'posts', 'comments', 'media', 'state', 'logs', 'post_queue', 'comment_queue', 'vision_queue', 'media_queue'],
        'readwrite'
      );
      
      transaction.objectStore('group_info').clear();
      transaction.objectStore('posts').clear();
      transaction.objectStore('comments').clear();
      transaction.objectStore('media').clear();
      transaction.objectStore('state').clear();
      transaction.objectStore('logs').clear();
      transaction.objectStore('post_queue').clear();
      transaction.objectStore('comment_queue').clear();
      transaction.objectStore('vision_queue').clear();
      transaction.objectStore('media_queue').clear();

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }
}

const db = new AppDB();
self.db = db;
