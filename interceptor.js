// interceptor.js - Interceptador de Fetch registrado nativamente no contexto MAIN da página do Facebook

(function() {
  if (window.__fb_graphql_interceptor_active) return;
  window.__fb_graphql_interceptor_active = true;

  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const url = args[0];
    if (typeof url === 'string' && url.includes('/api/graphql/')) {
      const options = args[1];
      if (options && options.body) {
        try {
          let bodyText = '';
          if (typeof options.body === 'string') {
            bodyText = options.body;
          } else if (options.body instanceof URLSearchParams) {
            bodyText = options.body.toString();
          }
          
          const params = new URLSearchParams(bodyText);
          const friendlyName = params.get('fb_api_req_friendly_name');
          const doc_id = params.get('doc_id');
          const fb_dtsg = params.get('fb_dtsg');
          const variables = params.get('variables');
          
          if (friendlyName && doc_id && fb_dtsg) {
            window.dispatchEvent(new CustomEvent('FB_GRAPHQL_INTERCEPT', {
              detail: { friendlyName, doc_id, fb_dtsg, variables }
            }));
          }
        } catch (e) {}
      }
    }
    return originalFetch.apply(this, args);
  };

  // Rotina de extração ativa direta do token fb_dtsg no contexto MAIN do Facebook Comet
  const checkDtsgDirectly = () => {
    try {
      const token = window.DTSGInitData?.token || 
                    window.require?.("DTSGInitData")?.token || 
                    window.require?.("DTSGInitDataForASD")?.token;
                    
      if (token) {
        window.dispatchEvent(new CustomEvent('FB_GRAPHQL_INTERCEPT', {
          detail: { fb_dtsg: token }
        }));
        console.log('[FB Downloader] Token fb_dtsg obtido ativamente do contexto MAIN.');
        return true;
      }
    } catch (e) {}
    return false;
  };

  // Tenta extrair imediatamente e agenda tentativas subsequentes de verificação
  if (!checkDtsgDirectly()) {
    const intervalId = setInterval(() => {
      if (checkDtsgDirectly()) clearInterval(intervalId);
    }, 1000);
    // Cancela após 15 segundos para economizar ciclos de CPU do usuário
    setTimeout(() => clearInterval(intervalId), 15000);
  }

  console.log('[FB Downloader] Interceptador de fetch registrado nativamente no contexto MAIN.');
})();
