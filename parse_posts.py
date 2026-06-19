import pandas as pd
import re
import json

df = pd.read_excel("facebook.xlsx")

posts = {}
current_post = None

def extract_post_id(url):
    if not isinstance(url, str):
        return None
    # Padrões comuns:
    # .../bookingkoala/posts/2173771616510745/...
    # .../set=gm.2167713293783244...
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

# Vamos percorrer as linhas
# Estrutura observada:
# - Linhas de "Cabeçalho de Post": têm link do grupo em x1i10hfl href 4 (ou similar) e nome do autor em html-span ou x1i10hfl.
# - Linha de "Texto de Post": geralmente a linha seguinte, tem o texto principal do post.
# - Linha de "Comentários": tem links com comment_id nas colunas x1i10hfl href 3, x1i10hfl href 6, etc.

# Vamos fazer um parse baseado nos blocos de posts.
# Podemos identificar uma linha de "início de post" se ela tem um autor e link do grupo ou link do perfil, e NÃO tem comment_id.
# Vamos ver se há uma maneira de reconstruir isso.

parsed_items = []

for idx, row in df.iterrows():
    row_dict = {k: v for k, v in row.items() if pd.notnull(v)}
    parsed_items.append((idx, row_dict))

# Vamos salvar o JSON de posts estruturados.
# Como o scraping do Excel é sequencial, vamos identificar o post atual.
# Se a linha contém um link com 'groups/bookingkoala?__cft__' ou similar, é o início de um post.
# Vamos tentar mapear sequencialmente.

posts_list = []
active_post = None

for idx, item in parsed_items:
    # Verifica se é um cabeçalho de post
    # Um cabeçalho de post normalmente tem:
    # 'x1i10hfl href 4' contendo 'groups/bookingkoala' ou 'bookingkoala' e NENHUM comentário ainda.
    # E o autor costuma estar em 'html-span' ou 'x1i10hfl' (se não houver html-span).
    
    is_post_header = False
    author = None
    group_link = None
    post_id = None
    
    # Vamos ver se tem link de post/grupo
    for col, val in item.items():
        if isinstance(val, str) and 'bookingkoala' in val and 'comment_id' not in val:
            if 'posts/' in val or 'groups/bookingkoala' in val:
                is_post_header = True
                group_link = val
                post_id = extract_post_id(val)
                break
                
    if is_post_header:
        # Tenta pegar o autor
        author = item.get('html-span') or item.get('x1i10hfl')
        if not author or author == 'Seguir':
            author = item.get('html-span 2') or item.get('x1i10hfl 2')
        
        active_post = {
            "post_line": idx,
            "post_id": post_id,
            "author": author,
            "group_link": group_link,
            "content": "",
            "comments": []
        }
        posts_list.append(active_post)
        continue
        
    if active_post is not None:
        # Se active_post existe, vamos ver o que é esta linha
        # Se tiver texto em xdj266r ou x193iq5w e active_post["content"] estiver vazio, e NÃO tiver links de comentários, é o texto do post
        has_comment_links = any(isinstance(val, str) and 'comment_id' in val for val in item.values())
        
        # Texto do post
        if not active_post["content"] and not has_comment_links:
            # Pode estar em xdj266r ou x193iq5w ou html-span
            content_candidates = []
            for col in ['xdj266r', 'x193iq5w', 'xdj266r 2', 'x193iq5w 2']:
                if col in item:
                    content_candidates.append(str(item[col]))
            if content_candidates:
                active_post["content"] = "\n".join(content_candidates)
                # Tenta extrair post_id se ainda não tem
                if not active_post["post_id"]:
                    for col, val in item.items():
                        pid = extract_post_id(val)
                        if pid:
                            active_post["post_id"] = pid
                            break
                continue
                
        # Comentários
        # Uma linha pode ter múltiplos comentários. Por exemplo, na Linha 3 temos comment_id em x1i10hfl href 3 e x1i10hfl href 6.
        # Vamos varrer as colunas e ver quantos comentários conseguimos extrair desta linha.
        # Cada comentário tem um link com comment_id. Vamos mapear os pares:
        # Link 1: x1i10hfl href 3 -> Autor: x193iq5w 2 (ou similar), Conteúdo: xdj266r (ou similar)
        # Link 2: x1i10hfl href 6 -> Autor: x193iq5w 4 (ou similar), Conteúdo: xdj266r 2 (ou similar)
        
        # Vamos fazer um parsing genérico de comentários nesta linha.
        # Procuramos todas as chaves que contêm links com comment_id
        comment_cols = [k for k, v in item.items() if isinstance(v, str) and 'comment_id' in v]
        if comment_cols:
            # Vamos extrair os comentários dessa linha
            # Vamos ver a estrutura de colunas associadas
            # Por exemplo, se temos x1i10hfl href 3, o autor pode estar em x193iq5w 2, e o texto em xdj266r.
            # Se temos x1i10hfl href 6, o autor pode estar em x193iq5w 4, e o texto em xdj266r 2.
            # Vamos criar um mapeamento flexível baseado nas posições ou nomes de colunas.
            # Mas também podemos apenas pegar todos os textos de comentários na linha e associar aos nomes.
            # Vamos inspecionar as colunas da linha e extrair.
            
            # Comentário 1:
            # Se x1i10hfl href 3 existe:
            #   url: x1i10hfl href 3
            #   autor: x193iq5w 2 ou x193iq5w 4
            #   texto: xdj266r
            # Comentário 2:
            # Se x1i10hfl href 6 existe:
            #   url: x1i10hfl href 6
            #   autor: x193iq5w 4 ou x193iq5w 2
            #   texto: xdj266r 2
            
            # Vamos fazer de forma genérica:
            # Encontrar autores: todos os valores que parecem nomes (não são links, não são botões como 'Curtir', 'Responder', 'Ver mais')
            # Encontrar textos: colunas xdj266r, xdj266r 2, etc.
            # Vamos mapear por "grupos".
            
            # Vamos fazer um processamento mais direcionado:
            # Grupo A (Comentário principal):
            #   Link: x1i10hfl href 3
            #   Autor: x193iq5w 2 (ou x193iq5w se for o primeiro)
            #   Texto: xdj266r
            #   ID: extract_comment_id(item.get('x1i10hfl href 3'))
            # Grupo B (Comentário secundário/aninhado):
            #   Link: x1i10hfl href 6
            #   Autor: x193iq5w 4
            #   Texto: xdj266r 2
            #   ID: extract_comment_id(item.get('x1i10hfl href 6'))
            
            if 'x1i10hfl href 3' in item:
                c1_id = extract_comment_id(item['x1i10hfl href 3'])
                c1_author = item.get('x193iq5w 2') or item.get('x193iq5w')
                c1_text = item.get('xdj266r')
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
                if c2_id and c2_text:
                    active_post["comments"].append({
                        "comment_id": c2_id,
                        "author": str(c2_author) if c2_author else "Desconhecido",
                        "text": str(c2_text)
                    })

print(f"Posts detectados inicialmente: {len(posts_list)}")
valid_posts = [p for p in posts_list if p["content"]]
print(f"Posts com conteúdo: {len(valid_posts)}")

# Vamos salvar uma amostra dos posts parseados para analisar se deu certo
with open("posts_sample.json", "w", encoding="utf-8") as f:
    json.dump(valid_posts[:5], f, indent=2, ensure_ascii=False)
