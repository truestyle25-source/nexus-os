#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import re

# Mapa de substituições de encoding quebrado e erros ortográficos
replacements = {
    # Encoding UTF-8 quebrado - caracteres específicos
    'Ã…\xa0ltimas Movimentaçõ': 'Últimas Movimentações',
    'ÃƒÂ£': 'ã',
    'ÃƒÂ§': 'ç',
    'ÃƒÂ­': 'í',
    'ÃƒÂ©': 'é',
    'ÃƒÂ¡': 'á',
    'Ã¢â‚¬Â¢': '•',
    'Ã¢Å"â€¢': '×',
    'Ã¢â‚¬': '–',
    'Ã¢â‚¬Â': '–',
    'ÃƒÂµ': 'õ',
    'ÃƒÂ³': 'ó',
    'ÃƒÂ²': 'ò',
    'Ã…\xa1': 'ú',
    'ÃƒÅ¡': 'ú',
    'Ã¢â‚¬â€': '—',
    'Ã¢â‚¬Â¢': '•',
    'Ã‚Â©': '©',
    'ÃƒÂ ': 'à',
    'Ã„Â±': 'ñ',
    
    # Palavras específicas com problemas
    'Nao foi possivel': 'Não foi possível',
    'Nao foi possÃ': 'Não foi possív',
    'composicao': 'composição',
    'Composicao': 'Composição',
    'numero': 'número',
    'Producao': 'Produção',
    'producao': 'produção',
    'Produzir ?': 'Produzir –',
    'Composi??o ?': 'Composição –',
}

# Ler o arquivo
with open('frontend/app/(dashboard)/produtos/page.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Aplicar as substituições
for old, new in replacements.items():
    content = content.replace(old, new)

# Mais substituições complexas usando regex
substitutions_regex = [
    (r'PreÃƒÂ§o de venda', 'Preço de venda'),
    (r'Sem permissÃ.*?ã', 'Sem permissão'),
    (r'Filtros AvanÃƒÂ§ados', 'Filtros Avançados'),
    (r'Margem mÃƒÂ­n', 'Margem mín'),
    (r'Margem mÃƒÂ¡x', 'Margem máx'),
    (r'PreÃƒÂ§o mÃƒÂ­n', 'Preço mín'),
    (r'PreÃƒÂ§o mÃƒÂ¡x', 'Preço máx'),
    (r'CatÃƒÂ¡logo', 'Catálogo'),
    (r'Margem mÃ©dia', 'Margem média'),
    (r'indisponÃ.*?veis', 'indisponíveis'),
    (r'CÃƒÂ³digo', 'Código'),
    (r'DescriÃ§Ã£o', 'Descrição'),
    (r'InÃ­cio', 'Início'),
    (r'dÃ­gito', 'dígito'),
    (r'PreÃ§o', 'Preço'),
    (r'Informe um cÃ³digo', 'Informe um código'),
    (r'Informe PreÃ§o', 'Informe Preço'),
]

for pattern, replacement in substitutions_regex:
    content = re.sub(pattern, replacement, content)

# Salvar o arquivo corrigido
with open('frontend/app/(dashboard)/produtos/page.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("✓ Arquivo corrigido com sucesso!")
