# 🤖 Facebook Group Poster

Script de postagem automática em grupos do Facebook usando **OpenTabs**.

---

## ⚙️ Pré-requisitos

Antes de rodar, certifique-se de ter instalado:

- **Node.js** (v16 ou superior) — [nodejs.org](https://nodejs.org)
- **OpenTabs CLI** — instalado globalmente
- **Extensão do OpenTabs** — instalada no Google Chrome

---

## 🚀 Como Rodar (Passo a Passo)

### 1. Abra o terminal na pasta do projeto

No **PowerShell** ou **Prompt de Comando**, navegue até a pasta do projeto:

```powershell
cd "C:\Users\henri\.gemini\antigravity-ide\scratch\facebook-group-downloader"
```

### 2. Inicie o servidor OpenTabs (se não estiver rodando)

```powershell
opentabs start
```

> **Deixe o servidor rodando em segundo plano.** Abra outro terminal para os próximos passos.

### 3. Certifique-se de estar logado no Facebook

Abra o **Google Chrome**, acesse [facebook.com](https://facebook.com) e faça login na sua conta.

### 4. Configure o script antes de rodar

Abra o arquivo `facebook-poster.js` e edite as seções de configuração:

```javascript
// Opção A: Adicione URLs diretas dos grupos
const TARGET_GROUP_URLS = [
  'https://www.facebook.com/groups/SEU_GRUPO_1',
  'https://www.facebook.com/groups/SEU_GRUPO_2',
];

// Opção B: Adicione IDs e nomes dos grupos
const TARGET_GROUPS = [
  { id: '123456789', name: 'Nome do Grupo 1' },
  { id: '987654321', name: 'Nome do Grupo 2' },
];
```

> **Dica:** Se você deixar ambas as listas vazias (`[]`), o script tentará coletar os grupos automaticamente da sua página de grupos do Facebook.

### 5. Execute o script

```powershell
node facebook-poster.js
```

---

## 📋 O que o script faz

1. **Lista as abas** abertas no Chrome via OpenTabs
2. **Usa a aba do Facebook** (ou a primeira aba disponível)
3. **Para cada grupo** na lista:
   - Navega para o grupo
   - Clica na área de publicação
   - Digita o texto do post
   - Clica em **Publicar**
   - Aguarda 60 segundos antes do próximo (configurável)
4. Exibe um **relatório final** com sucessos e falhas

---

## ⚙️ Configurações disponíveis no script

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `POST_TEXT` | (texto do post) | Texto completo da publicação |
| `TARGET_GROUP_URLS` | `[]` | URLs diretas dos grupos |
| `TARGET_GROUPS` | `[]` | IDs e nomes dos grupos |
| `DELAY_BETWEEN_POSTS` | `60000` (60s) | Tempo entre cada post (em ms) |

---

## ⚠️ Avisos Importantes

- **Não feche o Chrome** enquanto o script estiver rodando
- **Não minimize** a janela do Chrome (pode causar falhas na detecção de elementos)
- O **delay de 60s** entre posts é recomendado para evitar bloqueio do Facebook
- Se postar em muitos grupos rapidamente, o Facebook pode **restringir sua conta**

---

## 🛠️ Resolução de Problemas

### "Nenhuma aba encontrada"
- Verifique se o Chrome está aberto
- Verifique se a extensão do OpenTabs está ativa (`chrome://extensions/`)
- Rode `opentabs start` novamente

### "Botão Publicar não encontrado"
- O Facebook pode ter mudado o layout — aguarde uma atualização do script
- Tente aumentar o `await sleep()` para dar mais tempo ao carregamento

### "Post não foi enviado"
- Verifique se você está logado no Facebook
- Verifique se tem permissão para postar no grupo
