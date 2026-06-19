// mediaDownloader.js - Downloader Concorrente de Mídias com Concorrência 30 e Retry Exponencial

class MediaDownloader {
  constructor() {
    this.MAX_PARALLEL_MEDIA = 30;
    this.workers = [];
    this.isActive = false;
  }

  async start() {
    if (this.isActive) return;
    this.isActive = true;
    console.log(`mediaDownloader: Iniciando pool de download com ${this.MAX_PARALLEL_MEDIA} workers...`);

    const worker = async () => {
      while (this.isActive) {
        // Verifica se a extensão ainda está rodando globalmente
        const stats = stateManager.getStats();
        if (!stats.isRunning) {
          break;
        }

        // Dequea uma mídia pendente
        const items = await mediaQueue.dequeue(1);
        if (items.length === 0) {
          // Sem mídias pendentes, espera um pouco e tenta novamente
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }

        const mediaItem = items[0];
        
        // Aplica retry exponencial caso o item já tenha falhado anteriormente
        if (mediaItem.retry_count > 0) {
          const delays = [1000, 2000, 4000, 8000, 16000, 30000];
          const delayIdx = Math.min(mediaItem.retry_count - 1, delays.length - 1);
          const delay = delays[delayIdx];
          
          if (self.DEBUG) {
            console.warn(`mediaDownloader: Aguardando ${delay}ms (retry exponencial ${mediaItem.retry_count}) para: ${mediaItem.filename}`);
          }
          await new Promise(r => setTimeout(r, delay));
        }

        try {
          if (self.DEBUG) {
            console.log(`mediaDownloader: Baixando ${mediaItem.filename}...`);
          }
          
          const response = await fetch(mediaItem.url);
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const blob = await response.blob();
          
          // Salva no IndexedDB (Tabela media + blob)
          await db.updateMediaBlob(mediaItem.url, blob);
          
          // Marca na fila como concluído
          await mediaQueue.completed(mediaItem.url);
          
          // Incrementa as estatísticas
          stateManager.incrementMediaDownloaded(mediaItem.type, 1);
          
        } catch (err) {
          if (self.DEBUG || err.message.includes('HTTP 4') || err.message.includes('HTTP 5')) {
            console.warn(`mediaDownloader: Falha no download de ${mediaItem.filename}: ${err.message}`);
          }
          
          // Envia para tratamento de falhas (fila de retry)
          await mediaQueue.failed(mediaItem.url, err.message);
        }
      }
    };

    // Inicializa a pool de workers concorrentes
    this.workers = [];
    for (let i = 0; i < this.MAX_PARALLEL_MEDIA; i++) {
      this.workers.push(worker());
    }

    // Atualiza o estado dos workers ativos
    stateManager.updateWorkerCount(this.MAX_PARALLEL_MEDIA);

    Promise.all(this.workers).then(() => {
      this.isActive = false;
      stateManager.updateWorkerCount(0);
      console.log('mediaDownloader: Todos os workers de mídia finalizaram.');
    });
  }

  stop() {
    this.isActive = false;
    this.workers = [];
  }
}

const mediaDownloader = new MediaDownloader();
self.mediaDownloader = mediaDownloader;
