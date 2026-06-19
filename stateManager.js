// stateManager.js - Módulo de Estado e Estatísticas em Tempo Real Híbrido
class StateManager {
  constructor() {
    this.state = {
      isRunning: false,
      isDiscovering: false,
      groupUrl: '',
      postLimit: 0,
      postsFound: 0,
      postsProcessed: 0,
      
      // Contadores detalhados por tipo de extração
      commentsGQL: 0,
      commentsJSON: 0,
      commentsDOM: 0,
      commentsVision: 0,
      commentsOCR: 0,
      commentsProcessed: 0, // Total geral
      
      imagesDownloaded: 0,
      videosDownloaded: 0,
      attachmentsDownloaded: 0,
      activeWorkers: 0,
      speed: 0, // Posts/min
      commentsSpeed: 0, // Comentários/min
      recoveryRate: 100, // Taxa de recuperação de comentários em %
      datasetSizeKB: 0, // Tamanho do dataset de texto em KB
      embeddingChunks: 0, // Estimativa de chunks/embeddings
      eta: 0, 
      memoryUsage: 0 
    };
    this.totalTextLength = 0;
    this.startTime = null;
    this.speedInterval = null;
    this.lastProcessedCount = 0;
  }

  async init() {
    try {
      const isRunning = await db.getState('isRunning') || false;
      const groupUrl = await db.getState('groupUrl') || '';
      const postLimit = await db.getState('postLimit') || 0;
      
      const postsList = await db.getAllPosts();
      const postsCount = postsList.length;
      
      // Conta os comentários detalhados a partir das configurações salvas
      this.state.commentsGQL = await db.getState('commentsGQL') || 0;
      this.state.commentsJSON = await db.getState('commentsJSON') || 0;
      this.state.commentsDOM = await db.getState('commentsDOM') || 0;
      this.state.commentsVision = await db.getState('commentsVision') || 0;
      this.state.commentsOCR = await db.getState('commentsOCR') || 0;
      
      const commentsCount = await db.getQueueSize('comments');
      const mediaList = await db.getAllMedia();
      
      const imagesCount = mediaList.filter(m => m.type === 'image' && m.downloaded).length;
      const videosCount = mediaList.filter(m => m.type === 'video' && m.downloaded).length;
      const attachmentsCount = mediaList.filter(m => m.type === 'attachment' && m.downloaded).length;
      
      const pendingQueue = await db.getQueueSize('post_queue');
      
      this.state.isRunning = isRunning;
      this.state.groupUrl = groupUrl;
      this.state.postLimit = postLimit;
      this.state.postsFound = pendingQueue + postsCount;
      this.state.postsProcessed = postsCount;
      this.state.commentsProcessed = commentsCount;
      this.state.imagesDownloaded = imagesCount;
      this.state.videosDownloaded = videosCount;
      this.state.attachmentsDownloaded = attachmentsCount;
      
      // Calcula tamanho do texto e chunks estimados
      let textLen = 0;
      postsList.forEach(p => {
        textLen += (p.text || '').length + (p.author || '').length;
      });
      const commentsList = await db.getAllComments();
      commentsList.forEach(c => {
        textLen += (c.text || '').length + (c.author || '').length;
      });
      
      this.totalTextLength = textLen;
      this.state.datasetSizeKB = Math.round((textLen * 2) / 102.4) / 10;
      this.state.embeddingChunks = Math.round(textLen / 1000) || Math.ceil(textLen / 1000);

      // Calcula taxa de recuperação de comentários
      const totalDeclared = postsList.reduce((acc, p) => acc + (p.comments_count || 0), 0);
      if (totalDeclared > 0) {
        this.state.recoveryRate = Math.min(100, Math.round((commentsCount / totalDeclared) * 100));
      } else {
        this.state.recoveryRate = 100;
      }
      
      if (isRunning) {
        this.startSpeedTracking();
      }
    } catch (err) {
      console.error('stateManager: Erro ao inicializar estado:', err);
    }
  }

  updateWorkerCount(activeCount) {
    this.state.activeWorkers = activeCount;
  }

  async setRunning(isRunning) {
    this.state.isRunning = isRunning;
    await db.saveState('isRunning', isRunning);
    if (isRunning) {
      this.startSpeedTracking();
    } else {
      this.stopSpeedTracking();
    }
  }

  async setDiscovering(isDiscovering) {
    this.state.isDiscovering = isDiscovering;
    await db.saveState('isDiscovering', isDiscovering);
  }

  incrementPostsFound(count = 1) {
    this.state.postsFound += count;
  }

  async incrementPostsProcessed(post) {
    this.state.postsProcessed += 1;
    if (post) {
      const addedLen = (post.text || '').length + (post.author || '').length;
      this.totalTextLength = (this.totalTextLength || 0) + addedLen;
      this.state.datasetSizeKB = Math.round((this.totalTextLength * 2) / 102.4) / 10;
      this.state.embeddingChunks = Math.round(this.totalTextLength / 1000) || Math.ceil(this.totalTextLength / 1000);
      
      // Atualiza taxa de recuperação
      const postsList = await db.getAllPosts();
      const totalDeclared = postsList.reduce((acc, p) => acc + (p.comments_count || 0), 0);
      if (totalDeclared > 0) {
        this.state.recoveryRate = Math.min(100, Math.round((this.state.commentsProcessed / totalDeclared) * 100));
      } else {
        this.state.recoveryRate = 100;
      }
    }
  }

  async incrementCommentsProcessed(type, count = 1) {
    if (count <= 0) return;
    
    if (type === 'gql') {
      this.state.commentsGQL += count;
      await db.saveState('commentsGQL', this.state.commentsGQL);
    } else if (type === 'json') {
      this.state.commentsJSON += count;
      await db.saveState('commentsJSON', this.state.commentsJSON);
    } else if (type === 'dom') {
      this.state.commentsDOM += count;
      await db.saveState('commentsDOM', this.state.commentsDOM);
    } else if (type === 'vision') {
      this.state.commentsVision += count;
      await db.saveState('commentsVision', this.state.commentsVision);
    } else if (type === 'ocr') {
      this.state.commentsOCR += count;
      await db.saveState('commentsOCR', this.state.commentsOCR);
    }
    
    this.state.commentsProcessed += count;

    // Estimativa de 150 caracteres por comentário para a estatística incremental
    const addedLen = count * 150;
    this.totalTextLength = (this.totalTextLength || 0) + addedLen;
    this.state.datasetSizeKB = Math.round((this.totalTextLength * 2) / 102.4) / 10;
    this.state.embeddingChunks = Math.round(this.totalTextLength / 1000) || Math.ceil(this.totalTextLength / 1000);
    
    // Atualiza taxa de recuperação
    const postsList = await db.getAllPosts();
    const totalDeclared = postsList.reduce((acc, p) => acc + (p.comments_count || 0), 0);
    if (totalDeclared > 0) {
      this.state.recoveryRate = Math.min(100, Math.round((this.state.commentsProcessed / totalDeclared) * 100));
    } else {
      this.state.recoveryRate = 100;
    }
  }

  incrementMediaDownloaded(type, count = 1) {
    if (type === 'image') this.state.imagesDownloaded += count;
    if (type === 'video') this.state.videosDownloaded += count;
    if (type === 'attachment') this.state.attachmentsDownloaded += count;
  }

  startSpeedTracking() {
    this.startTime = Date.now();
    this.lastProcessedCount = this.state.postsProcessed;
    
    if (this.speedInterval) clearInterval(this.speedInterval);
    
    this.speedInterval = setInterval(() => {
      this.calculatePerformanceMetrics();
    }, 2000);
  }

  stopSpeedTracking() {
    if (this.speedInterval) {
      clearInterval(this.speedInterval);
      this.speedInterval = null;
    }
    this.state.speed = 0;
    this.state.commentsSpeed = 0;
    this.state.eta = 0;
  }

  calculatePerformanceMetrics() {
    if (!this.startTime) return;
    
    const elapsedMs = Date.now() - this.startTime;
    
    if (elapsedMs > 0) {
      const minutes = elapsedMs / 60000;
      this.state.speed = Math.round((this.state.postsProcessed / minutes) * 10) / 10 || 0;
      this.state.commentsSpeed = Math.round((this.state.commentsProcessed / minutes) * 10) / 10 || 0;
      
      const limit = this.state.postLimit > 0 ? this.state.postLimit : this.state.postsFound;
      const remaining = limit - this.state.postsProcessed;
      
      if (remaining > 0 && this.state.speed > 0) {
        this.state.eta = Math.round((remaining / this.state.speed) * 60);
      } else {
        this.state.eta = 0;
      }
    }
    
    if (self.performance && self.performance.memory) {
      this.state.memoryUsage = Math.round(self.performance.memory.usedJSHeapSize / 1048576);
    } else {
      this.state.memoryUsage = 0;
    }
  }

  async saveStateToDB() {
    try {
      await db.saveState('isRunning', this.state.isRunning);
      await db.saveState('isDiscovering', this.state.isDiscovering);
      await db.saveState('groupUrl', this.state.groupUrl);
      await db.saveState('postLimit', this.state.postLimit);
      await db.saveState('commentsGQL', this.state.commentsGQL);
      await db.saveState('commentsJSON', this.state.commentsJSON);
      await db.saveState('commentsDOM', this.state.commentsDOM);
      await db.saveState('commentsVision', this.state.commentsVision);
      await db.saveState('commentsOCR', this.state.commentsOCR);
    } catch (err) {
      console.error('stateManager: Erro ao salvar estado no DB:', err);
    }
  }

  getStats() {
    this.calculatePerformanceMetrics();
    return { ...this.state };
  }
}

const stateManager = new StateManager();
self.stateManager = stateManager;
