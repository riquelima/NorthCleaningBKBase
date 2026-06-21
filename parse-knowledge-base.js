/**
 * Parser: BookingKoala-Base-de-Conhecimento.md → knowledge_base.json
 * Booking Koala Knowledge Base - North Cleaning - Koala Hub
 */

const fs = require('fs');
const path = require('path');

// ============================================================
// CONFIG: mapeamento de nomes de categorias → IDs e cores
// ============================================================
const CATEGORY_MAP = [
  { id: 'theme-primeiros-passos',  name: 'Primeiros Passos & Novos no BK',            color: '#06b6d4' },
  { id: 'theme-migracao',          name: 'Migração de Plataforma',                    color: '#f59e0b' },
  { id: 'theme-precificacao',      name: 'Precificação & Orçamentos',                 color: '#3b82f6' },
  { id: 'theme-tipos-servico',     name: 'Tipos de Serviço & Escopo',                 color: '#10b981' },
  { id: 'theme-agendamento',       name: 'Reservas, Agendamento & Calendário',        color: '#ec4899' },
  { id: 'theme-pagamentos',        name: 'Pagamentos & Faturamento',                  color: '#8b5cf6' },
  { id: 'theme-equipe',            name: 'Equipe: Cleaners, Contractors & VAs',       color: '#f97316' },
  { id: 'theme-marketing-anuncios',name: 'Marketing — Anúncios Pagos (Google/Meta)',  color: '#0ea5e9' },
  { id: 'theme-marketing-seo',     name: 'Marketing — Google Profile, SEO & Avaliações', color: '#14b8a6' },
  { id: 'theme-marketing-leads',   name: 'Marketing — Leads Orgânicos & Prospecção',  color: '#a855f7' },
  { id: 'theme-automacao-ia',      name: 'Automação, IA & Integrações',               color: '#ef4444' },
  { id: 'theme-website',           name: 'Website, Tema & Domínio',                   color: '#eab308' },
  { id: 'theme-funcionalidades',   name: 'Funcionalidades, Configs & Pedidos ao BK',  color: '#6366f1' },
  { id: 'theme-suporte',           name: 'Suporte, Bugs & Problemas Técnicos',        color: '#64748b' },
  { id: 'theme-equipamentos',      name: 'Equipamentos, Produtos & Suprimentos',      color: '#84cc16' },
  { id: 'theme-danos',             name: 'Danos, Reclamações & Disputas',             color: '#dc2626' },
  { id: 'theme-financas',          name: 'Finanças, Crescimento & Gestão',            color: '#0891b2' },
  { id: 'theme-conteudo',          name: 'Conteúdo, YouTube & Comunidade',            color: '#d946ef' },
  { id: 'theme-discussoes-gerais', name: 'Discussões Gerais, Mindset & Outros',       color: '#78716c' },
];

const NON_CATEGORY_SECTIONS = [
  '📊 Visão geral',
  '📖 Glossário de termos recorrentes',
  '🗂️ Índice de categorias'
];

// ============================================================
// HELPERS
// ============================================================

function extractAuthor(line) {
  const m = line.match(/\*\*([^*]+)\*\*/);
  return m ? m[1].trim() : 'Desconhecido';
}

function extractLink(line) {
  const m = line.match(/\(https:\/\/www\.facebook\.com[^)]+\)/);
  return m ? m[0].slice(1, -1) : null;
}

function extractMediaType(line) {
  if (line.includes('🖼️')) return 'image';
  if (line.includes('🎥')) return 'video';
  if (line.includes('🔗')) return 'link';
  return 'text';
}

function extractImageCount(line) {
  const m = line.match(/🖼️×(\d+)/);
  return m ? parseInt(m[1]) : 0;
}

function extractPostNumber(line) {
  const m = line.match(/^### (\d+)\.\s+/);
  return m ? parseInt(m[1]) : null;
}

function extractPostTitle(line) {
  const m = line.match(/^### \d+\.\s+(.+)/);
  if (!m) return 'Sem título';
  return m[1].trim().replace(/…$/, '');
}

function matchCategory(sectionName) {
  for (const cat of CATEGORY_MAP) {
    // Match by checking if either contains the other
    const a = cat.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const b = sectionName.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (a.includes(b) || b.includes(a)) return cat.id;
  }
  return null;
}

// ============================================================
// MAIN PARSER
// ============================================================

function parseMarkdown(filePath) {
  const text = fs.readFileSync(filePath, 'utf-8');
  const lines = text.split('\n');

  const posts = [];
  let currentCategory = null;
  let currentPost = null;
  let contentLines = [];
  let awaitingPostMeta = false;
  let inComments = false;
  let stats = { totalPosts: 0, postsWithComments: 0, totalComments: 0 };

  function tryFinalizePost() {
    if (!currentPost) return;
    currentPost.theme_id = currentCategory || 'theme-discussoes-gerais';
    currentPost.content = contentLines.join('\n').trim() || 'Sem conteúdo disponível.';
    // Deduplicate comments
    const seen = new Set();
    currentPost.comments = currentPost.comments.filter(c => {
      const key = c.author + '|' + c.text;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (currentPost.comments.length > 0) stats.postsWithComments++;
    stats.totalComments += currentPost.comments.length;
    posts.push({ ...currentPost });
    stats.totalPosts++;
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();

    // --- Category headers ---
    const catMatch = trimmed.match(/^##\s+(.+)/);
    if (catMatch) {
      const sectionName = catMatch[1].trim();
      tryFinalizePost();
      currentPost = null;
      contentLines = [];
      inComments = false;

      if (NON_CATEGORY_SECTIONS.includes(sectionName)) {
        currentCategory = null;
      } else {
        currentCategory = matchCategory(sectionName);
        if (!currentCategory) {
          console.warn(`⚠️ Categoria não mapeada: "${sectionName}"`);
        }
      }
      continue;
    }

    if (!currentCategory) continue;

    // --- Post start ---
    const postNum = extractPostNumber(trimmed);
    if (postNum !== null) {
      tryFinalizePost();
      const title = extractPostTitle(trimmed);
      currentPost = {
        post_id: `post-${postNum}`,
        title: title,
        author: 'Desconhecido',
        content: '',
        media_type: 'text',
        image_count: 0,
        group_link: null,
        comments: []
      };
      contentLines = [];
      inComments = false;
      awaitingPostMeta = true;
      continue;
    }

    if (!currentPost) continue;

    // --- Metadata line ---
    if (awaitingPostMeta) {
      if (trimmed.startsWith('📝') || trimmed.startsWith('🖼️') || trimmed.startsWith('🎥') || trimmed.startsWith('🔗') || trimmed.startsWith('**')) {
        currentPost.author = extractAuthor(trimmed);
        currentPost.media_type = extractMediaType(trimmed);
        currentPost.image_count = extractImageCount(trimmed);
        const link = extractLink(trimmed);
        if (link) currentPost.group_link = link;
        awaitingPostMeta = false;
        continue;
      }
      if (trimmed === '') {
        awaitingPostMeta = false;
        continue;
      }
    }

    // --- Content (blockquotes) ---
    if (trimmed.startsWith('> ')) {
      inComments = false;
      contentLines.push(trimmed.slice(2));
      continue;
    }

    // --- Comments section ---
    if (trimmed.includes('💬 Respostas da comunidade')) {
      inComments = true;
      continue;
    }

    if (inComments) {
      if (trimmed === '---' || trimmed === '') continue;

      // Comment: "- **Name** ..."
      const commentMatch = trimmed.match(/^-\s+\*\*([^*]+)\*\*(.*)/);
      if (commentMatch && !raw.startsWith('  -')) {
        const author = commentMatch[1].trim();
        const rest = commentMatch[2].trim();

        let likes = 0;
        const likesMatch = rest.match(/👍(\d+)/);
        if (likesMatch) likes = parseInt(likesMatch[1]);

        let badge = '';
        const badgeMatch = rest.match(/(📈Colaborador em ascensão|🌟Colaborador especial|⭐Supercolaborador)/);
        if (badgeMatch) badge = badgeMatch[1];

        let text = rest;
        if (badgeMatch) text = text.replace(badgeMatch[0], '').trim();
        text = text.replace(/👍\d+/g, '').trim();
        text = text.replace(/^·\s*/, '').trim();
        text = text.replace(/^:\s*/, '').trim();

        currentPost.comments.push({ author, text, likes, badge, replies: [] });
        continue;
      }

      // Reply: "  - ↳ **Name:** text"
      const replyMatch = raw.match(/^\s{2,}-\s+↳\s+\*\*([^*]+)\*\*:\s*(.*)/);
      if (replyMatch && currentPost.comments.length > 0) {
        const last = currentPost.comments[currentPost.comments.length - 1];
        last.replies.push({ author: replyMatch[1].trim(), text: replyMatch[2].trim() });
        continue;
      }

      // "(+N respostas)" — skip
      if (/\(\+\d+ respostas?/.test(trimmed)) continue;
    }
  }

  // Finalize last post
  tryFinalizePost();

  console.log(`📊 Stats: ${stats.totalPosts} posts, ${stats.postsWithComments} com comentários, ${stats.totalComments} comentários`);
  return posts;
}

// ============================================================
// EXECUTE
// ============================================================

const inputFile = process.argv[2] || path.join(__dirname, 'BookingKoala-Base-de-Conhecimento.md');
const outputFile = process.argv[3] || path.join(__dirname, 'knowledge_base.json');

console.log(`📖 Lendo: ${inputFile}`);

const parsedPosts = parseMarkdown(inputFile);

const themes = CATEGORY_MAP.map(cat => ({
  id: cat.id,
  name: cat.name,
  description: `${parsedPosts.filter(p => p.theme_id === cat.id).length} publicações sobre ${cat.name.toLowerCase()}.`,
  color: cat.color
}));

// Sort posts by post_id numerically
const posts = parsedPosts.sort((a, b) => {
  const na = parseInt(a.post_id.replace('post-', ''));
  const nb = parseInt(b.post_id.replace('post-', ''));
  return na - nb;
}).map(p => ({
  post_id: p.post_id,
  theme_id: p.theme_id,
  author: p.author,
  title: p.title,
  content: p.content,
  media_type: p.media_type,
  image_count: p.image_count,
  group_link: p.group_link,
  comments: p.comments
}));

const output = { themes, posts };

fs.writeFileSync(outputFile, JSON.stringify(output, null, 2), 'utf-8');
const sizeMB = (fs.statSync(outputFile).size / 1024 / 1024).toFixed(1);
console.log(`💾 Salvo: ${outputFile} (${sizeMB} MB)`);
console.log(`📁 Categorias: ${themes.length}`);
console.log(`📝 Posts: ${posts.length}`);

// Per-category breakdown
themes.forEach(t => {
  const count = posts.filter(p => p.theme_id === t.id).length;
  console.log(`   ${t.id}: ${count} posts`);
});
