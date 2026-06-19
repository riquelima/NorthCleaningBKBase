import pandas as pd
import re
import json

df = pd.read_excel("facebook.xlsx")

parsed_items = []
for idx, row in df.iterrows():
    row_dict = {k: v for k, v in row.items() if pd.notnull(v)}
    parsed_items.append((idx, row_dict))

posts_list = []
active_post = None

def extract_post_id(url):
    if not isinstance(url, str):
        return None
    m1 = re.search(r'/posts/(\d+)', url)
    if m1:
        return m1.group(1)
    m2 = re.search(r'gm\.(\d+)', url)
    if m2:
        return m2.group(1)
    return None

def extract_comment_id(url):
    if not isinstance(url, str):
        return None
    m = re.search(r'comment_id=(\d+)', url)
    if m:
        return m.group(1)
    return None

# Mapeamento de temas por palavras-chave (case-insensitive)
THEME_KEYWORDS = {
    "theme-billing": {
        "name": "Faturamento & Pagamentos (Billing & Stripe)",
        "description": "Discussões sobre Stripe, migração do Launch27Pay, processamento de cartões e faturamento de clientes.",
        "keywords": ["billing", "bill", "stripe", "credit card", "charge", "launch27pay", "payment", "card", "price", "pricing", "fees", "refund"]
    },
    "theme-marketing": {
        "name": "Marketing & Aquisição (Marketing & SEO)",
        "description": "Estratégias de Google LSA, anúncios do Facebook, SEO, geração de leads e atração de clientes.",
        "keywords": ["marketing", "ads", "lsa", "google", "lead", "seo", "facebook ads", "advertise", "traffic", "organic", "views", "clicks"]
    },
    "theme-operations": {
        "name": "Operações & Software (BK Setup & Operations)",
        "description": "Configuração de formulários do Booking Koala, checklists, integrações de email, Slack e fluxos de trabalho.",
        "keywords": ["setup", "settings", "theme", "checklist", "slack", "email", "support", "domain", "dns", "cloudflare", "website", "integration", "software", "api"]
    },
    "theme-hiring": {
        "name": "Contratação & Provedores (Hiring & VAs)",
        "description": "Recrutamento de faxineiros (cleaners), contratação de assistentes virtuais (VAs), freelancers e gestão de prestadores.",
        "keywords": ["hiring", "hired", "cleaner", "cleaners", "va", "virtual assistant", "contractor", "contractors", "employee", "interview", "crew", "teams"]
    },
    "theme-reviews": {
        "name": "Avaliações & Suporte (Reviews & Trust)",
        "description": "Geração de avaliações, feedbacks de clientes, reputação online no Google/Yelp e suporte pós-venda.",
        "keywords": ["reviews", "review", "feedback", "rating", "trust", "reputation", "complaint", "yelp", "star", "customer support"]
    },
    "theme-strategy": {
        "name": "Estratégia & Lançamento (Business Strategy)",
        "description": "Planejamento de negócios, limpeza pós-obra ou de temporada (Airbnb/STR) e dicas gerais para fundadores.",
        "keywords": ["airbnb", "str", "short term", "resort", "construction", "launching", "strategy", "startup", "insurance", "business", "company", "canadian", "canada", "partner"]
    }
}

def classify_content(text):
    if not isinstance(text, str):
        return "theme-strategy"
    text_lower = text.lower()
    
    scores = {}
    for tid, info in THEME_KEYWORDS.items():
        score = sum(1 for keyword in info["keywords"] if keyword in text_lower)
        if score > 0:
            scores[tid] = score
            
    if not scores:
        return "theme-strategy"
    
    return max(scores, key=scores.get)

def generate_title(content):
    if not content or not isinstance(content, str):
        return "Discussão sem título"
    
    # 1. Limpar saudações de posts de redes sociais
    cleaned = re.sub(
        r'^(grand rising|hi guys|hello|hey guys|quick question|hi everyone|hey all|anyone else|does anyone know|has anyone|good morning|good afternoon|good evening|hey)\b,?\s*',
        '',
        content,
        flags=re.IGNORECASE
    )
    cleaned = cleaned.strip()
    
    # Se limpou tudo, volta para o original
    if not cleaned:
        cleaned = content.strip()
        
    # Capitalizar a primeira letra
    cleaned = cleaned[0].upper() + cleaned[1:] if cleaned else ""
    
    # 2. Pegar a primeira frase (limite em pontos ou quebras de linha)
    sentences = re.split(r'[.!?\n]', cleaned)
    first_sentence = sentences[0].strip() if sentences else cleaned
    
    # Se a frase ficou curta demais, tenta usar o início do texto
    if len(first_sentence) < 15 and len(cleaned) > 15:
        first_sentence = cleaned[:60].strip()
        
    # 3. Limitar o tamanho do título para caber no grafo
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
        
    return first_sentence if first_sentence else "Discussão sem título"

# Processando as linhas sequencialmente
for idx, item in parsed_items:
    is_post_header = False
    group_link = None
    post_id = None
    
    for col, val in item.items():
        if isinstance(val, str) and 'bookingkoala' in val and 'comment_id' not in val:
            if 'posts/' in val or 'groups/bookingkoala' in val:
                is_post_header = True
                group_link = val
                post_id = extract_post_id(val)
                break
                
    if is_post_header:
        author = item.get('html-span') or item.get('x1i10hfl')
        if not author or author == 'Seguir':
            author = item.get('html-span 2') or item.get('x1i10hfl 2')
        
        active_post = {
            "post_id": post_id,
            "author": str(author) if author else "Desconhecido",
            "group_link": group_link,
            "title": "",
            "content": "",
            "theme_id": "theme-strategy",
            "comments": []
        }
        posts_list.append(active_post)
        continue
        
    if active_post is not None:
        has_comment_links = any(isinstance(val, str) and 'comment_id' in val for val in item.values())
        
        # Conteúdo do post
        if not active_post["content"] and not has_comment_links:
            content_candidates = []
            for col in ['xdj266r', 'x193iq5w', 'xdj266r 2', 'x193iq5w 2']:
                if col in item:
                    content_candidates.append(str(item[col]))
            if content_candidates:
                active_post["content"] = "\n".join(content_candidates)
                if not active_post["post_id"]:
                    for col, val in item.items():
                        pid = extract_post_id(val)
                        if pid:
                            active_post["post_id"] = pid
                            break
                # Classifica o post e gera o título curto
                active_post["theme_id"] = classify_content(active_post["content"])
                active_post["title"] = generate_title(active_post["content"])
                continue
                
        # Comentários
        if 'x1i10hfl href 3' in item:
            c1_id = extract_comment_id(item['x1i10hfl href 3'])
            c1_author = item.get('x193iq5w 2') or item.get('x193iq5w')
            c1_text = item.get('xdj266r')
            if not active_post["post_id"]:
                pid = extract_post_id(item['x1i10hfl href 3'])
                if pid:
                    active_post["post_id"] = pid
            
            if c1_id and c1_text:
                active_post["comments"].append({
                    "comment_id": c1_id,
                    "author": str(c1_author) if c1_author else "Desconhecido",
                    "text": str(c1_text)
                })
                
        if 'x1i10hfl href 6' in item:
            c2_id = extract_comment_id(item['x1i10hfl href 6'])
            c2_author = item.get('x193iq5w 4') or item.get('x193iq5w 2')
            c2_text = item.get('xdj266r 2')
            if not active_post["post_id"]:
                pid = extract_post_id(item['x1i10hfl href 6'])
                if pid:
                    active_post["post_id"] = pid
                    
            if c2_id and c2_text:
                active_post["comments"].append({
                    "comment_id": c2_id,
                    "author": str(c2_author) if c2_author else "Desconhecido",
                    "text": str(c2_text)
                })

# Refina os IDs de post que continuaram null:
# Se o post ainda tiver ID null, podemos atribuir um ID baseado na linha
for i, p in enumerate(posts_list):
    if not p["post_id"]:
        p["post_id"] = f"post_gen_{i}"

# Filtra posts que têm conteúdo
valid_posts = [p for p in posts_list if p["content"].strip()]

# Monta o JSON consolidado
knowledge_base = {
    "themes": [
        {"id": tid, "name": info["name"], "description": info["description"]}
        for tid, info in THEME_KEYWORDS.items()
    ],
    "posts": valid_posts
}

# Salva o arquivo final
with open("knowledge_base.json", "w", encoding="utf-8") as f:
    json.dump(knowledge_base, f, indent=2, ensure_ascii=False)

print(f"Base de conhecimento salva com sucesso!")
print(f"Total de posts processados e válidos: {len(valid_posts)}")
