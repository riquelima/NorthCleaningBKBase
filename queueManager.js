// queueManager.js - Módulo de Gerenciamento de Filas Persistidas no IndexedDB Híbrido

class IndexedDBQueue {
  constructor(storeName) {
    this.storeName = storeName;
  }

  /**
   * Adiciona um item único na fila.
   * @param {Object} item 
   * @returns {Promise<number>} Quantidade de itens adicionados (0 ou 1)
   */
  async enqueue(item) {
    return await db.enqueueQueueItems(this.storeName, [item]);
  }

  /**
   * Adiciona múltiplos itens na fila em lote.
   * @param {Array} items 
   * @returns {Promise<number>} Quantidade de itens adicionados
   */
  async enqueueBatch(items) {
    return await db.enqueueQueueItems(this.storeName, items);
  }

  /**
   * Retorna até N itens com status 'pending', alterando-os para 'processing'.
   * @param {number} limit Limite de itens a extrair
   * @returns {Promise<Array>} Itens extraídos
   */
  async dequeue(limit = 1) {
    return await db.dequeueQueueItems(this.storeName, limit);
  }

  /**
   * Retorna o tamanho total da fila (geral ou filtrado por status).
   * @param {string|null} status 
   * @returns {Promise<number>}
   */
  async size(status = null) {
    return await db.getQueueSize(this.storeName, status);
  }

  /**
   * Marca o item como concluído com sucesso.
   * @param {string} key Chave do item
   * @returns {Promise<void>}
   */
  async completed(key) {
    return await db.updateQueueItemStatus(this.storeName, key, 'completed');
  }

  /**
   * Gerencia falha do item: tenta recolocar na fila ou marca como falhado se estourar tentativas.
   * @param {string} key Chave do item
   * @param {string} errorMsg Descrição do erro
   * @returns {Promise<void>}
   */
  async failed(key, errorMsg = '') {
    return this.retry(key, errorMsg);
  }

  /**
   * Incrementa o número de tentativas e recoloca na fila ou marca como falha definitiva.
   * @param {string} key 
   * @param {string} errorMsg 
   */
  async retry(key, errorMsg = '') {
    await db.init();
    const storeName = this.storeName;
    return new Promise((resolve, reject) => {
      const transaction = db.db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.get(key);
      request.onsuccess = () => {
        const item = request.result;
        if (item) {
          item.retry_count = (item.retry_count || 0) + 1;
          if (item.retry_count >= 5) {
            item.status = 'failed';
            item.error = errorMsg || 'Excedeu limite de retentativas (5).';
          } else {
            item.status = 'pending'; // Volta para a fila
          }
          const putReq = store.put(item);
          putReq.onsuccess = () => resolve();
          putReq.onerror = () => reject(putReq.error);
        } else {
          resolve();
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Reseta todos os itens travados no status 'processing' para 'pending'.
   * @returns {Promise<void>}
   */
  async resetProcessingToPending() {
    return await db.resetProcessingQueueItems(this.storeName);
  }
}

// Criação das instâncias das quatro filas
const postQueue = new IndexedDBQueue('post_queue');
const commentQueue = new IndexedDBQueue('comment_queue');
const visionQueue = new IndexedDBQueue('vision_queue');
const mediaQueue = new IndexedDBQueue('media_queue');

// Reseta os estados de processamento travados em lote na inicialização do script
async function resetAllQueuesOnStartup() {
  try {
    await postQueue.resetProcessingToPending();
    await commentQueue.resetProcessingToPending();
    await visionQueue.resetProcessingToPending();
    await mediaQueue.resetProcessingToPending();
    console.log('queueManager: Todas as 4 filas foram recuperadas e reiniciadas para pending.');
  } catch (err) {
    console.error('queueManager: Erro ao recuperar filas no startup:', err);
  }
}

// Vincula ao escopo global
self.postQueue = postQueue;
self.commentQueue = commentQueue;
self.visionQueue = visionQueue;
self.mediaQueue = mediaQueue;
self.resetAllQueuesOnStartup = resetAllQueuesOnStartup;
