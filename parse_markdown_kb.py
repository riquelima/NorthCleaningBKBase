import re
import json

# Mapeamento do título da categoria para o ID e descrição correspondentes
CATEGORIES_MAP = {
    "Migração & Onboarding": {
        "id": "theme-migracao",
        "description": "Trocar de Launch27/Jobber para o BookingKoala, importar dados, primeiros passos."
    },
    "Pagamentos & Faturamento": {
        "id": "theme-pagamentos",
        "description": "Stripe, cobranças, cartões, reembolsos, gorjetas, gift cards e taxas."
    },
    "Reservas & Agendamento": {
        "id": "theme-agendamento",
        "description": "Agendamentos, regras de recorrência, alocação de serviços e calendário."
    },
    "Provedores, Equipe & Prestadores": {
        "id": "theme-equipe",
        "description": "Recrutamento, contratação de VA, políticas de subcontratados 1099/W2 e gestão de cleaners."
    },
    "Marketing, Leads & Avaliações": {
        "id": "theme-marketing",
        "description": "Google LSA, Meta Ads, SEO, reputação, reviews e atração de clientes."
    },
    "Automação, IA & API": {
        "id": "theme-automacao-ia",
        "description": "Zapier, Make, n8n, webhooks, conexões de API e inteligência artificial."
    },
    "Website, Tema & Customização": {
        "id": "theme-website",
        "description": "Ajustes de design, CSS personalizado no BookingKoala, construtor de temas e formulários."
    },
    "Funcionalidades & Configurações": {
        "id": "theme-config",
        "description": "Configurações gerais do BK, campos personalizados, cupons de desconto e notificações."
    },
    "Operação, Precificação & Negócio": {
        "id": "theme-negocio",
        "description": "Gestão diária, cálculo de preços por hora/quarto, contratos comerciais, seguros e finanças."
    },
    "Suporte, Bugs & Produto BK": {
        "id": "theme-suporte",
        "description": "Bugs no sistema BookingKoala, instabilidade, contato com o suporte e atualizações do produto."
    },
    "Discussões Gerais & Outros": {
        "id": "theme-outros",
        "description": "Discussões gerais sobre negócios de limpeza, conselhos entre fundadores e outros tópicos."
    }
}

def parse_markdown(filepath):
    themes_list = [
        {"id": info["id"], "name": name, "description": info["description"]}
        for name, info in CATEGORIES_MAP.items()
    ]
    
    posts = []
    
    current_category_id = None
    current_post = None
    
    with open(filepath, "r", encoding="utf-8") as f:
        lines = f.readlines()
        
    for line in lines:
        line_str = line.strip()
        
        # 1. Detectar nova Categoria
        if line_str.startswith("## ") and not line_str.startswith("## 📊") and not line_str.startswith("## 📖") and not line_str.startswith("## 🗂️"):
            category_name = line_str.replace("## ", "").strip()
            if category_name in CATEGORIES_MAP:
                current_category_id = CATEGORIES_MAP[category_name]["id"]
            continue
            
        if current_category_id is None:
            continue
            
        # 2. Detectar novo Post (### 1. Titulo...)
        if line_str.startswith("### "):
            # Se havia um post anterior sendo construído, salva
            if current_post:
                posts.append(current_post)
                
            post_title_raw = re.sub(r'^### \d+\.\s*', '', line_str)
            # Limpa reticências do título inicial do markdown
            post_title_raw = post_title_raw.strip().rstrip("…").rstrip("...")
            
            current_post = {
                "post_id": f"post_md_{len(posts) + 1}",
                "author": "Desconhecido",
                "group_link": None,
                "title": post_title_raw,
                "content": "",
                "theme_id": current_category_id,
                "comments": []
            }
            continue
            
        if current_post is None:
            continue
            
        # 3. Detectar Autor e Link do Post
        # Ex: **👤 TJ Sanderlin**  ·  [🔗 post original](https://www.facebook.com...)
        if line_str.startswith("**👤"):
            author_match = re.search(r'\*\*👤\s*(.*?)\*\*', line_str)
            if author_match:
                current_post["author"] = author_match.group(1).strip()
            
            link_match = re.search(r'\[🔗 post original\]\((.*?)\)', line_str)
            if link_match:
                current_post["group_link"] = link_match.group(1).strip()
                # Tentar extrair o ID do post do link
                post_id_match = re.search(r'/posts/(\d+)', current_post["group_link"])
                if post_id_match:
                    current_post["post_id"] = post_id_match.group(1)
            continue
            
        # 4. Detectar Conteúdo do Post
        if line_str.startswith("> "):
            content_line = line_str.replace("> ", "", 1).strip()
            # Remove a formatação de info box do Obsidian se for o caso
            if not content_line.startswith("[!"):
                if current_post["content"]:
                    current_post["content"] += "\n" + content_line
                else:
                    current_post["content"] = content_line
            continue
            
        # 5. Detectar Comentários
        # Ex: - **Roger F. Schulze** · 👍3: feel free to reach out!...
        # Ex: - ↳ **Del Cid Verónica:** I really needed to hear this today.
        if line_str.startswith("- **") or line_str.startswith("- ↳ **"):
            is_subcomment = "↳" in line_str
            
            # Limpar marcador
            clean_line = re.sub(r'^-\s*(↳\s*)?\*\*', '', line_str)
            
            # Pegar autor do comentário
            parts = clean_line.split("**", 1)
            if len(parts) < 2:
                continue
                
            c_author = parts[0].strip()
            rest = parts[1].strip()
            
            # Pegar texto do comentário (depois dos dois pontos `:`)
            # Pode conter curtidas como `· 👍3:` ou `⭐Supercolaborador · 👍3:`
            text_parts = rest.split(":", 1)
            if len(text_parts) < 2:
                continue
                
            c_text = text_parts[1].strip()
            
            # Identifica respostas e subcomentários vazios ou inúteis
            if c_text:
                c_text_trimmed = c_text.strip()
                if c_text_trimmed != "" and not re.match(r'^\.+$', c_text_trimmed):
                    if is_subcomment:
                        c_author = f"{c_author} (resposta)"
                    
                current_post["comments"].append({
                    "comment_id": f"comment_gen_{len(current_post['comments']) + 1}",
                    "author": c_author,
                    "text": c_text
                })
            continue

    # Adiciona o último post
    if current_post:
        posts.append(current_post)
        
    # Refinar e limpar o campo de título de cada post se estiver vazio ou com reticências
    for post in posts:
        # Se o conteúdo do post estiver completo, vamos tentar gerar um título mais inteligível
        # caso o título extraído do header esteja truncado com reticências
        if post["content"]:
            # Se o título extraído tem reticências ou é o início idêntico do post
            if len(post["title"]) < 10 or post["title"].endswith("...") or post["title"].endswith("…"):
                post["title"] = generate_clean_title(post["content"])
        else:
            post["content"] = post["title"]
            
    # Filtrar posts vazios
    valid_posts = [p for p in posts if p["content"].strip()]
            
    kb_data = {
        "themes": themes_list,
        "posts": valid_posts
    }
    
    return kb_data

def generate_clean_title(content):
    # Limpa saudações
    cleaned = re.sub(
        r'^(grand rising|hi guys|hello|hey guys|quick question|hi everyone|hey all|anyone else|does anyone know|has anyone|good morning|good afternoon|good evening|hey)\b,?\s*',
        '',
        content,
        flags=re.IGNORECASE
    )
    cleaned = cleaned.strip()
    if not cleaned:
        cleaned = content.strip()
        
    cleaned = cleaned[0].upper() + cleaned[1:] if cleaned else ""
    
    # Primeira frase
    sentences = re.split(r'[.!?\n]', cleaned)
    first_sentence = sentences[0].strip() if sentences else cleaned
    
    if len(first_sentence) < 15 and len(cleaned) > 15:
        first_sentence = cleaned[:60].strip()
        
    if len(first_sentence) > 50:
        words = first_sentence.split(' ')
        title_words = []
        char_count = 0
        for word in words:
            if char_count + len(word) + 1 > 48:
                break
            title_words.append(word)
            char_count += len(word) + 1
        first_sentence = ' '.join(title_words) + '...'
        
    return first_sentence if first_sentence else "Discussão"

if __name__ == "__main__":
    filepath = "BookingKoala-Base-de-Conhecimento.md"
    print(f"Iniciando parse do arquivo {filepath}...")
    kb = parse_markdown(filepath)
    
    with open("knowledge_base.json", "w", encoding="utf-8") as f:
        json.dump(kb, f, indent=2, ensure_ascii=False)
        
    print("Processamento concluído!")
    print(f"Total de Categorias: {len(kb['themes'])}")
    print(f"Total de Publicações: {len(kb['posts'])}")
