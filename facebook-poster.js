/**
 * facebook-poster.js
 * 
 * Script de postagem automática em grupos do Facebook usando OpenTabs.
 * 
 * COMO USAR:
 *   1. Certifique-se de que o OpenTabs está rodando: opentabs start
 *   2. Abra o Chrome com sua conta do Facebook logada
 *   3. Configure o texto do post e os grupos abaixo
 *   4. Execute: node facebook-poster.js
 * 
 * REQUISITOS:
 *   - Node.js instalado
 *   - OpenTabs CLI instalado (npm install -g @opentabs-dev/cli)
 *   - Extensão do OpenTabs instalada no Chrome
 */

const { execSync } = require('child_process');

// ============================================================
// ⚙️  CONFIGURAÇÃO - Edite aqui antes de rodar
// ============================================================

const POST_TEXT = `🚀 Automação Inteligente para seu Negócio

Sou Henrique Lima, profissional com mais de 7 anos na área de tecnologia. Cansado de processos manuais que consomem tempo e dinheiro?

✅ Automatizo processos repetitivos e burocráticos
✅ Integro sistemas que não se comunicam entre si
✅ Crio dashboards e relatórios automáticos
✅ Implemento IA para atendimento e análise de dados

💡 Já ajudei empresas a economizar dezenas de horas por mês com automações personalizadas.

Quer saber como posso ajudar o seu negócio? Me manda uma mensagem! 👇

#automacao #inteligenciaartificial #produtividade #tecnologia #empreendedorismo`;

// IDs dos grupos alvo (obtidos da sessão anterior)
// Você pode adicionar mais IDs ou nomes de grupos aqui
const TARGET_GROUPS = [
  // Formato: { id: 'ID_DO_GRUPO', name: 'Nome do Grupo' }
  // Exemplo: { id: '123456789', name: 'Empreendedores Brasil' }
];

// URLs diretas dos grupos para postar (alternativa mais simples)
const TARGET_GROUP_URLS = [
  // Adicione as URLs dos grupos aqui, ex:
  // 'https://www.facebook.com/groups/123456789',
  // 'https://www.facebook.com/groups/empreendedores.brasil',
];

// Delay entre posts (em milissegundos) para evitar bloqueio
const DELAY_BETWEEN_POSTS = 60000; // 60 segundos

// ============================================================
// 🛠️  Funções auxiliares
// ============================================================

/**
 * Executa um comando OpenTabs e retorna o resultado
 */
function opentabsCall(tool, params) {
  try {
    const paramsStr = JSON.stringify(params).replace(/"/g, '\\"');
    const result = execSync(`opentabs tool call ${tool} "${paramsStr}"`, {
      encoding: 'utf8',
      timeout: 30000
    });
    return JSON.parse(result);
  } catch (error) {
    console.error(`❌ Erro ao chamar ${tool}:`, error.message);
    return null;
  }
}

/**
 * Aguarda um determinado tempo
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Lista todas as abas abertas no Chrome
 */
async function listTabs() {
  const result = opentabsCall('browser_list_tabs', {});
  return result?.tabs || [];
}

/**
 * Navega para uma URL em uma aba específica
 */
async function navigateTo(tabId, url) {
  return opentabsCall('browser_navigate', { tabId, url });
}

/**
 * Executa JavaScript em uma aba
 */
async function executeScript(tabId, script) {
  return opentabsCall('browser_execute_script', { tabId, script });
}

/**
 * Clica em um elemento pelo seletor CSS
 */
async function clickElement(tabId, selector) {
  const script = `
    (function() {
      const el = document.querySelector('${selector}');
      if (el) {
        el.click();
        return true;
      }
      return false;
    })()
  `;
  return executeScript(tabId, script);
}

/**
 * Digita texto em um campo
 */
async function typeText(tabId, selector, text) {
  const escaped = text.replace(/`/g, '\\`').replace(/\\/g, '\\\\');
  const script = `
    (function() {
      const el = document.querySelector('${selector}');
      if (!el) return false;
      el.focus();
      el.click();
      
      // Simula digitação caractere por caractere para evitar detecção
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLElement.prototype, 'textContent'
      );
      
      // Usa execCommand para inserir o texto (mais compatível com React)
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, \`${escaped}\`);
      return true;
    })()
  `;
  return executeScript(tabId, script);
}

// ============================================================
// 🚀  Lógica principal de postagem
// ============================================================

/**
 * Posta em um grupo específico do Facebook
 * @param {number} tabId - ID da aba do Chrome
 * @param {string} groupUrl - URL do grupo
 * @param {string} groupName - Nome do grupo (para log)
 * @returns {boolean} - true se postou com sucesso
 */
async function postInGroup(tabId, groupUrl, groupName) {
  console.log(`\n📤 Postando no grupo: ${groupName}`);
  console.log(`   URL: ${groupUrl}`);

  try {
    // 1. Navega para o grupo
    console.log('   → Navegando para o grupo...');
    await navigateTo(tabId, groupUrl);
    await sleep(4000); // Aguarda carregar

    // 2. Clica na área de nova publicação
    console.log('   → Clicando na área de publicação...');
    const postAreaScript = `
      (function() {
        // Tenta diferentes seletores para o botão de nova publicação
        const selectors = [
          '[data-testid="status-attachment-mentions-input"]',
          'div[aria-label="Criar uma publicação"]',
          'div[aria-label="Create a post"]',
          'div[data-placeholder="Escreva algo..."]',
          'div[data-placeholder="Write something..."]',
          'form[method="POST"] div[contenteditable="true"]'
        ];
        
        for (const selector of selectors) {
          const el = document.querySelector(selector);
          if (el) {
            el.click();
            return { success: true, selector };
          }
        }
        
        // Tenta encontrar o botão de criar post pelo texto
        const spans = Array.from(document.querySelectorAll('span'));
        const createBtn = spans.find(s => 
          s.textContent === 'Criar uma publicação' || 
          s.textContent === 'Create a post' ||
          s.textContent === 'Escreva algo...' ||
          s.textContent === 'Write something...'
        );
        if (createBtn) {
          createBtn.closest('[role="button"]')?.click();
          return { success: true, selector: 'text-based' };
        }
        
        return { success: false };
      })()
    `;
    
    const clickResult = await executeScript(tabId, postAreaScript);
    if (!clickResult?.success) {
      console.log('   ⚠️  Não encontrou botão de publicação, tentando rolar a página...');
      await executeScript(tabId, 'window.scrollTo(0, 0)');
      await sleep(1000);
      await executeScript(tabId, postAreaScript);
    }
    
    await sleep(2000); // Aguarda abrir o modal/área de digitação

    // 3. Digita o texto do post
    console.log('   → Digitando o texto do post...');
    const typeScript = `
      (function() {
        const textAreas = document.querySelectorAll('div[contenteditable="true"]');
        let targetArea = null;
        
        for (const area of textAreas) {
          // Pega a área de texto principal (não comentários)
          const rect = area.getBoundingClientRect();
          if (rect.width > 200 && rect.height > 30) {
            targetArea = area;
            break;
          }
        }
        
        if (!targetArea) return { success: false, error: 'Nenhuma área de texto encontrada' };
        
        targetArea.focus();
        targetArea.click();
        
        const text = ${JSON.stringify(POST_TEXT)};
        document.execCommand('insertText', false, text);
        
        // Dispara eventos para o React reconhecer
        targetArea.dispatchEvent(new Event('input', { bubbles: true }));
        targetArea.dispatchEvent(new Event('change', { bubbles: true }));
        
        return { success: true, textLength: targetArea.textContent.length };
      })()
    `;
    
    const typeResult = await executeScript(tabId, typeScript);
    console.log(`   → Texto digitado: ${typeResult?.success ? '✅' : '❌'} (${typeResult?.textLength || 0} chars)`);
    
    if (!typeResult?.success) {
      console.log(`   ❌ Falhou ao digitar texto no grupo: ${groupName}`);
      return false;
    }
    
    await sleep(2000); // Aguarda o texto ser processado

    // 4. Clica no botão POSTAR
    console.log('   → Clicando em Postar...');
    const submitScript = `
      (function() {
        // Tenta diferentes seletores para o botão de publicar
        const selectors = [
          'div[aria-label="Publicar"]',
          'div[aria-label="Post"]',
          'button[aria-label="Publicar"]',
          'button[aria-label="Post"]',
        ];
        
        for (const selector of selectors) {
          const btn = document.querySelector(selector);
          if (btn && !btn.disabled) {
            btn.click();
            return { success: true, selector };
          }
        }
        
        // Tenta encontrar pelo texto do botão
        const buttons = Array.from(document.querySelectorAll('div[role="button"], button'));
        const postBtn = buttons.find(b => {
          const text = b.textContent?.trim();
          return (text === 'Publicar' || text === 'Post') && !b.disabled;
        });
        
        if (postBtn) {
          postBtn.click();
          return { success: true, selector: 'text-based' };
        }
        
        return { success: false, error: 'Botão Publicar não encontrado' };
      })()
    `;
    
    const submitResult = await executeScript(tabId, submitScript);
    
    if (submitResult?.success) {
      console.log(`   ✅ Post enviado com sucesso! (via ${submitResult.selector})`);
      await sleep(3000); // Aguarda confirmação
      return true;
    } else {
      console.log(`   ❌ Falhou ao clicar em Publicar: ${submitResult?.error}`);
      return false;
    }

  } catch (error) {
    console.error(`   ❌ Erro ao postar em ${groupName}:`, error.message);
    return false;
  }
}

/**
 * Coleta grupos do Facebook a partir da página de grupos do usuário
 */
async function collectFacebookGroups(tabId) {
  console.log('\n📋 Coletando grupos do Facebook...');
  
  await navigateTo(tabId, 'https://www.facebook.com/groups/joins/?nav_source=tab&ordering=viewer_added');
  await sleep(4000);
  
  // Rola a página para carregar mais grupos
  for (let i = 0; i < 5; i++) {
    await executeScript(tabId, 'window.scrollTo(0, document.body.scrollHeight)');
    await sleep(2000);
  }
  
  const collectScript = `
    (function() {
      const groups = [];
      
      // Seletores para encontrar links de grupos
      const groupLinks = document.querySelectorAll('a[href*="/groups/"]');
      
      groupLinks.forEach(link => {
        const href = link.href;
        const match = href.match(/facebook\\.com\\/groups\\/([^/?]+)/);
        if (match && match[1] && !match[1].includes('joins') && !match[1].includes('feed')) {
          const groupId = match[1];
          const nameEl = link.querySelector('span') || link;
          const name = nameEl.textContent?.trim() || groupId;
          
          if (name && groupId && !groups.find(g => g.id === groupId)) {
            groups.push({
              id: groupId,
              name: name,
              url: \`https://www.facebook.com/groups/\${groupId}\`
            });
          }
        }
      });
      
      return groups;
    })()
  `;
  
  const groups = await executeScript(tabId, collectScript);
  console.log(`   → Encontrados ${groups?.length || 0} grupos`);
  return groups || [];
}

// ============================================================
// 🎯  Função principal
// ============================================================

async function main() {
  console.log('============================================================');
  console.log('🤖 Facebook Group Poster - Iniciando...');
  console.log('============================================================');
  
  // 1. Lista as abas abertas
  const tabs = await listTabs();
  
  if (tabs.length === 0) {
    console.error('❌ Nenhuma aba do Chrome encontrada. Verifique se:');
    console.error('   1. O Chrome está aberto');
    console.error('   2. A extensão do OpenTabs está instalada e ativa');
    console.error('   3. O servidor OpenTabs está rodando (opentabs start)');
    process.exit(1);
  }
  
  console.log(`\n📌 Abas encontradas: ${tabs.length}`);
  
  // 2. Encontra ou usa a primeira aba disponível
  let facebookTab = tabs.find(t => t.url?.includes('facebook.com'));
  
  if (!facebookTab) {
    // Usa a primeira aba disponível
    facebookTab = tabs[0];
    console.log(`   → Usando aba: ${facebookTab.title} (ID: ${facebookTab.id})`);
  } else {
    console.log(`   → Usando aba do Facebook: ${facebookTab.title} (ID: ${facebookTab.id})`);
  }
  
  const tabId = facebookTab.id;
  
  // 3. Define os grupos para postar
  let groupsToPost = [];
  
  if (TARGET_GROUP_URLS.length > 0) {
    // Usa as URLs configuradas manualmente
    groupsToPost = TARGET_GROUP_URLS.map(url => ({
      url,
      name: url.split('/groups/')[1]?.replace(/\//g, '') || url
    }));
    console.log(`\n📋 Usando ${groupsToPost.length} grupos configurados manualmente`);
  } else if (TARGET_GROUPS.length > 0) {
    // Usa os IDs configurados manualmente
    groupsToPost = TARGET_GROUPS.map(g => ({
      url: `https://www.facebook.com/groups/${g.id}`,
      name: g.name
    }));
    console.log(`\n📋 Usando ${groupsToPost.length} grupos por ID`);
  } else {
    // Coleta automaticamente os grupos do Facebook
    console.log('\n📋 Coletando grupos automaticamente do Facebook...');
    const collected = await collectFacebookGroups(tabId);
    groupsToPost = collected;
    
    if (groupsToPost.length === 0) {
      console.error('❌ Nenhum grupo encontrado. Configure TARGET_GROUP_URLS ou TARGET_GROUPS no script.');
      process.exit(1);
    }
  }
  
  console.log(`\n🎯 Total de grupos para postar: ${groupsToPost.length}`);
  console.log('   Aguardando 5 segundos antes de iniciar...\n');
  await sleep(5000);
  
  // 4. Posta em cada grupo (apenas UMA VEZ por grupo)
  const results = {
    success: [],
    failed: []
  };
  
  for (let i = 0; i < groupsToPost.length; i++) {
    const group = groupsToPost[i];
    console.log(`\n[${i + 1}/${groupsToPost.length}] Processando: ${group.name}`);
    
    const success = await postInGroup(tabId, group.url, group.name);
    
    if (success) {
      results.success.push(group.name);
    } else {
      results.failed.push(group.name);
    }
    
    // Aguarda entre posts (exceto no último)
    if (i < groupsToPost.length - 1) {
      const delaySeconds = DELAY_BETWEEN_POSTS / 1000;
      console.log(`\n⏳ Aguardando ${delaySeconds}s antes do próximo post...`);
      await sleep(DELAY_BETWEEN_POSTS);
    }
  }
  
  // 5. Relatório final
  console.log('\n============================================================');
  console.log('📊 RELATÓRIO FINAL');
  console.log('============================================================');
  console.log(`✅ Posts bem-sucedidos: ${results.success.length}`);
  results.success.forEach(name => console.log(`   - ${name}`));
  
  if (results.failed.length > 0) {
    console.log(`\n❌ Posts com falha: ${results.failed.length}`);
    results.failed.forEach(name => console.log(`   - ${name}`));
  }
  
  console.log('\n🏁 Script finalizado!');
}

// Executa o script
main().catch(error => {
  console.error('❌ Erro fatal:', error);
  process.exit(1);
});
