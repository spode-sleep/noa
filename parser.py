#!/usr/bin/env python3
"""
Скрипт для обогащения games.json данными из PCGamingWiki и BeforeIPlay
Добавляет поля: 
  - PCGamingWiki: essential_improvements, issues_fixed, issues_unresolved,
                  modifications, game_data, other_information
  - BeforeIPlay: gameplay_tips

ИСПОЛЬЗОВАНИЕ:
    python parser.py

На входе: games.json (или другой файл, который вы укажете)
На выходе: games_pcgaming.json
"""

import requests
from bs4 import BeautifulSoup
import json
import time
from pathlib import Path


def clean_game_name(game_name):
    """Очищает название игры от ® и ™ перед запросом"""
    if not game_name:
        return ""
    
    # Убираем символы товарных знаков
    game_name = game_name.replace('®', '').replace('™', '')
    # Убираем лишние пробелы, которые могли остаться
    game_name = ' '.join(game_name.split())
    
    return game_name


def resolve_redirect(page_title):
    """Определяет финальный URL страницы с учетом редиректов"""
    url = "https://pcgamingwiki.com/w/api.php"
    params = {
        "action": "query",
        "titles": page_title,
        "redirects": "1",
        "format": "json"
    }
    
    try:
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        if "query" in data:
            if "redirects" in data["query"]:
                final_title = data["query"]["redirects"][-1]["to"]
                return final_title
            return page_title
    except Exception as e:
        print(f"    ⚠ Ошибка при проверке редиректа: {e}")
        return page_title


def search_game(query):
    """Поиск игры по названию"""
    url = "https://pcgamingwiki.com/w/api.php"
    params = {
        "action": "opensearch",
        "search": query,
        "format": "json",
        "limit": 1  # Берём только первый результат
    }
    
    try:
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        if data[1] and len(data[1]) > 0:
            return {
                "title": data[1][0],
                "url": data[3][0]
            }
    except Exception as e:
        print(f"    ⚠ Ошибка при поиске: {e}")
    
    return None


def get_game_page_html(page_title):
    """Получение HTML содержимого страницы игры"""
    resolved_title = resolve_redirect(page_title)
    
    url = "https://pcgamingwiki.com/w/api.php"
    params = {
        "action": "parse",
        "page": resolved_title,
        "format": "json",
        "prop": "text"
    }
    
    try:
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        if "parse" in data and "text" in data["parse"]:
            return data["parse"]["text"]["*"]
    except Exception as e:
        print(f"    ⚠ Ошибка при получении страницы: {e}")
    
    return None


def clean_text_for_web(text):
    """Очистка текста для веб-фронтенда (убирает все переносы строк)"""
    if not text:
        return ""
    
    # Убираем лишние пробелы и переносы
    text = text.strip()
    # Заменяем множественные пробелы на одинарные
    text = " ".join(text.split())
    
    return text


def clean_text_preserve_newlines(text):
    """Очистка текста с сохранением переносов строк, включая двойные переносы (пустые строки)"""
    if not text:
        return ""
    
    # Разбиваем на строки
    lines = text.split('\n')
    # Очищаем каждую строку от лишних пробелов
    cleaned_lines = []
    for line in lines:
        line = line.strip()
        # Убираем множественные пробелы внутри строки
        line = " ".join(line.split())
        # Добавляем все строки, включая пустые (для сохранения двойных переносов)
        cleaned_lines.append(line)
    
    # Объединяем строки обратно, сохраняя пустые строки
    result = '\n'.join(cleaned_lines)
    
    # Убираем ТОЛЬКО тройные и более переносы, заменяя их на двойные
    import re
    result = re.sub(r'\n{3,}', '\n\n', result)
    
    # Убираем переносы вокруг эмодзи (если эмодзи окружены \n с обеих сторон)
    # Убираем лишние переносы вокруг одиночных эмодзи
    result = re.sub(r'\n+([\U0001F300-\U0001F9FF])\n+', r' \1 ', result)
    
    # Убираем пустые строки в начале и конце
    result = result.strip()
    
    return result


def replace_css_icons_with_emoji(element):
    """Заменяет элементы с CSS ::before иконками на эмодзи"""
    if not element:
        return
    
    from bs4 import NavigableString
    
    # Маппинг CSS классов на эмодзи
    css_class_emoji_map = {
        'file-span-directory': '📁',
        'thumbs-down': '👎',
        'info-icon': 'ℹ️',
        'fixbox-icon': '🔧',
        'file-span': '📄',
        'thumbs-up': '👍',
        'file-span-registry': '🟦'
    }
    
    # Ищем все div и span элементы
    for tag in element.find_all(['div', 'span']):
        tag_classes = tag.get('class', [])
        
        # Сначала проверяем, есть ли совпадение с нашими классами
        replaced = False
        for css_class, emoji in css_class_emoji_map.items():
            if css_class in tag_classes:
                # Получаем текст внутри элемента (если есть)
                inner_text = tag.get_text(separator=' ', strip=True)
                
                if inner_text:
                    # Если внутри тега есть текст: эмодзи + пробел + текст
                    replacement_text = f"{emoji} {inner_text}"
                else:
                    # Если текста нет, просто эмодзи
                    replacement_text = emoji
                
                # Заменяем на NavigableString вместо элемента
                # Это предотвращает добавление переносов строк
                tag.replace_with(NavigableString(replacement_text))
                replaced = True
                break
        
        # Если не нашли соответствие в маппинге, проверяем svg-icon
        if not replaced and 'svg-icon' in tag_classes:
            # Получаем title атрибут
            title_text = tag.get('title', '').strip()
            if title_text:
                # Заменяем на текст из title
                tag.replace_with(NavigableString(title_text))


def replace_images_with_text(element):
    """Заменяет изображения на их текстовое описание (title, alt или имя файла)"""
    if not element:
        return
    
    img_tags = element.find_all('img')
    
    for img in img_tags:
        # Пропускаем иконки и служебные изображения
        src = img.get('src', '')
        if any(skip in src.lower() for skip in ['/icon/', '/icons/', 'ui-icon', 'blank.gif']):
            img.decompose()
            continue
        
        # Получаем alt и title
        alt = img.get('alt', '').strip()
        title = img.get('title', '').strip()
        
        # Выбираем title если есть, иначе alt
        text_replacement = title if title else alt
        
        # Если нет ни title, ни alt, пробуем извлечь имя файла из src
        if not text_replacement and src:
            # Извлекаем имя файла из пути
            filename = src.split('/')[-1].split('?')[0]  # Убираем параметры URL
            # Убираем расширение и декодируем URL-кодирование
            import urllib.parse
            filename = urllib.parse.unquote(filename)
            filename = filename.rsplit('.', 1)[0]  # Убираем расширение
            if filename and filename not in ['blank', 'spacer', 'transparent']:
                text_replacement = filename.replace('_', ' ').replace('-', ' ')
        
        # Если есть текстовое описание, заменяем тег на текст (БЕЗ квадратных скобок)
        if text_replacement:
            img.replace_with(text_replacement)
        else:
            # Если нет описания, просто удаляем изображение
            img.decompose()


def replace_abbr_tags(element):
    """Заменяет теги abbr на их текстовое содержимое, заменяя < и > на %, без добавления пробелов"""
    if not element:
        return
    
    abbr_tags = element.find_all('abbr')
    
    for abbr in abbr_tags:
        # Получаем текст внутри abbr
        abbr_text = abbr.get_text()
        # Заменяем < и > на %
        abbr_text = abbr_text.replace('<', '%').replace('>', '%')
        # Заменяем содержимое и разворачиваем тег
        abbr.string = abbr_text
        abbr.unwrap()


def unwrap_inline_elements(element):
    """Разворачивает inline элементы (a, span), чтобы убрать лишние пробелы при get_text()"""
    if not element:
        return
    
    # Разворачиваем все <a> и <span> теги
    for tag in element.find_all(['a', 'span']):
        tag.unwrap()


def replace_code_tags_with_quotes(element):
    """Заменяет <code>, <tt>, <kbd>, <samp>, <pre> теги на §символ параграфа§ """
    if not element:
        return
    
    # Ищем все code-подобные теги
    code_tags = element.find_all(['code', 'tt', 'kbd', 'samp', 'pre'])
    
    for code in code_tags:
        # Получаем текст внутри
        code_text = code.get_text()
        # Заменяем на символ параграфа
        code.replace_with(f'§{code_text}§')


def add_spaces_between_words(element):
    """Добавляет пробелы между словами, которые могут склеиться при get_text(separator='')"""
    if not element:
        return
    
    from bs4 import NavigableString
    
    # Добавляем пробел после определенных inline элементов
    # которые обычно отделяются пробелами в тексте
    inline_with_space = ['span', 'em', 'strong', 'b', 'i', 'u']
    
    for tag in element.find_all(inline_with_space):
        # Добавляем пробел после тега если следующий sibling не пробел
        next_sib = tag.next_sibling
        if next_sib and isinstance(next_sib, NavigableString):
            text = str(next_sib)
            if text and not text[0].isspace():
                tag.insert_after(NavigableString(' '))
        elif next_sib and not isinstance(next_sib, NavigableString):
            tag.insert_after(NavigableString(' '))


def extract_list_with_newlines(list_element):
    """Извлекает текст из <dl>, <ul> или <ol> элемента, сохраняя каждый элемент на отдельной строке"""
    if not list_element:
        return ""
    
    lines = []
    
    # Для dl обрабатываем dd элементы
    if list_element.name == 'dl':
        for dd in list_element.find_all('dd', recursive=False):
            dd_text = dd.get_text(separator='', strip=True)
            if dd_text:
                lines.append(dd_text)
    
    # Для ul/ol обрабатываем li элементы
    elif list_element.name in ['ul', 'ol']:
        for li in list_element.find_all('li', recursive=False):
            li_text = li.get_text(separator='', strip=True)
            if li_text:
                lines.append(li_text)
    
    return '\n'.join(lines)


def add_newlines_after_blocks(element):
    """Добавляет переносы строк после block-level элементов для сохранения структуры"""
    if not element:
        return
    
    from bs4 import NavigableString
    
    # Block-level элементы, после которых нужен перенос строки
    block_elements = ['p', 'div', 'dd', 'dt', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr']
    
    for block in element.find_all(block_elements):
        # Добавляем \n после каждого block элемента
        # Проверяем, что после элемента есть что-то ещё
        if block.next_sibling is not None:
            # Если следующий sibling - это текст, и он не начинается с \n, добавляем \n
            if isinstance(block.next_sibling, NavigableString):
                text = str(block.next_sibling)
                if not text.startswith('\n'):
                    block.insert_after(NavigableString('\n'))
            else:
                # Если следующий sibling - элемент, добавляем \n между ними
                block.insert_after(NavigableString('\n'))


def add_newlines_before_section_headers(element):
    """Добавляет переносы строк перед и после заголовков секций типа Notes, Warning и т.д."""
    if not element:
        return
    
    from bs4 import NavigableString
    
    # Ищем все <p> элементы, которые содержат жирные заголовки
    for p in element.find_all('p'):
        # Проверяем, содержит ли <p> тег <b> или <strong>
        bold_tag = p.find(['b', 'strong'])
        if bold_tag:
            # Получаем текст внутри <b>/<strong>
            header_text = bold_tag.get_text(strip=True).lower()
            
            # Список ключевых слов для заголовков секций
            section_keywords = ['notes', 'note', 'warning', 'important', 'tip', 'caution', 
                              'attention', 'info', 'информация', 'примечание', 'внимание']
            
            # Если это заголовок секции
            if any(keyword in header_text for keyword in section_keywords):
                # Добавляем ДВОЙНОЙ перенос строки ПЕРЕД <p> (визуальный отступ)
                # Всегда вставляем \n\n, независимо от того что было до этого
                p.insert_before(NavigableString('\n\n'))
                
                # Добавляем одинарный перенос строки ПОСЛЕ <p>
                if p.next_sibling is not None:
                    # Если следующий sibling - текст, проверяем что он не начинается с \n
                    if isinstance(p.next_sibling, NavigableString):
                        text = str(p.next_sibling)
                        if not text.startswith('\n'):
                            p.insert_after(NavigableString('\n'))
                    else:
                        # Если следующий sibling - элемент, добавляем \n после <p>
                        p.insert_after(NavigableString('\n'))


def add_newlines_in_lists(element):
    """Добавляет переносы строк между элементами списков (li, dd) для fixbox"""
    if not element:
        return
    
    from bs4 import NavigableString
    
    # Обрабатываем все списки: ul, ol, dl
    for list_elem in element.find_all(['ul', 'ol', 'dl']):
        # Для ul/ol обрабатываем li элементы
        if list_elem.name in ['ul', 'ol']:
            list_items = list_elem.find_all('li', recursive=False)
            for li in list_items:
                # Добавляем \n после каждого li (кроме последнего)
                if li.next_sibling is not None:
                    # Проверяем, что следующий sibling не начинается с \n
                    if isinstance(li.next_sibling, NavigableString):
                        text = str(li.next_sibling)
                        if not text.startswith('\n'):
                            li.insert_after(NavigableString('\n'))
                    else:
                        # Если следующий элемент - другой li, добавляем \n
                        li.insert_after(NavigableString('\n'))
        
        # Для dl обрабатываем dd элементы
        elif list_elem.name == 'dl':
            dd_items = list_elem.find_all('dd', recursive=False)
            for dd in dd_items:
                # Добавляем \n после каждого dd (кроме последнего)
                if dd.next_sibling is not None:
                    if isinstance(dd.next_sibling, NavigableString):
                        text = str(dd.next_sibling)
                        if not text.startswith('\n'):
                            dd.insert_after(NavigableString('\n'))
                    else:
                        dd.insert_after(NavigableString('\n'))


def preserve_structure_tags(element):
    """Заменяем <br> на пробел (для обычного текста переносы не нужны), кроме code тегов"""
    if not element:
        return
    
    # Заменяем <br> на пробел, но пропускаем те что внутри code
    for br in element.find_all('br'):
        # Проверяем, находится ли br внутри code тега
        parent = br.parent
        inside_code = False
        while parent:
            if parent.name == 'code':
                inside_code = True
                break
            parent = parent.parent
        
        # Заменяем только если не внутри code
        if not inside_code:
            br.replace_with(' ')


def preserve_structure_tags_with_newlines(element):
    """Заменяем <br> на \n (для fixbox где нужна структура), кроме code тегов"""
    if not element:
        return
    
    # Заменяем <br> на \n, но пропускаем те что внутри code
    for br in element.find_all('br'):
        # Проверяем, находится ли br внутри code тега
        parent = br.parent
        inside_code = False
        while parent:
            if parent.name == 'code':
                inside_code = True
                break
            parent = parent.parent
        
        # Заменяем только если не внутри code
        if not inside_code:
            br.replace_with('\n')


def remove_brackets_from_text(element):
    """Удаляет квадратные скобки [] вместе с их содержимым и [ citation needed ]"""
    if not element:
        return
    
    import re
    from bs4 import NavigableString
    
    # Удаляем ВСЕ <sup> теги (они обычно содержат ссылки и citation needed)
    for sup in element.find_all('sup'):
        sup.decompose()
    
    # Удаляем все <a> теги, которые содержат квадратные скобки (ссылки на сноски)
    for a in element.find_all('a'):
        a_text = a.get_text()
        if '[' in a_text or ']' in a_text:
            a.decompose()
    
    def process_text_nodes(elem):
        """Рекурсивно обрабатываем текстовые узлы"""
        for child in list(elem.children):
            if isinstance(child, NavigableString):
                text = str(child)
                # Удаляем [ citation needed ] (с вариациями пробелов и регистра)
                text = re.sub(r'\[\s*citation\s+needed\s*\]', '', text, flags=re.IGNORECASE)
                # Удаляем все квадратные скобки вместе с содержимым (включая цифры ссылок)
                text = re.sub(r'\[\s*Note\s+\d+\s*\]', '', text, flags=re.IGNORECASE)  # [Note 1], [Note 2], etc.
                text = re.sub(r'\[\s*\d+\s*\]', '', text)  # [1], [2], etc.
                text = re.sub(r'\[.*?\]', '', text)  # Остальные скобки
                # Убираем лишние пробелы, которые могли остаться
                text = re.sub(r'\s+', ' ', text)
                if text != str(child):
                    child.replace_with(text)
            elif hasattr(child, 'children'):
                process_text_nodes(child)
    
    process_text_nodes(element)


def extract_content_from_element(element, include_fixbox=True):
    """
    Универсальная функция для извлечения контента из элемента.
    Возвращает словарь с текстом, таблицами и fixbox'ами.
    Ищет таблицы и fixbox на ЛЮБОМ уровне вложенности внутри элемента.
    """
    if not element:
        return {"text": [], "tables": [], "fixboxes": []}
    
    result = {
        "text": [],
        "tables": [],
        "fixboxes": []
    }
    
    # ВАЖНО: Сначала удаляем brackets и ссылки (пока это ещё HTML)
    remove_brackets_from_text(element)
    # Добавляем переносы строк после block элементов
    add_newlines_after_blocks(element)
    # Добавляем переносы строк перед заголовками секций (Notes, Warning и т.д.)
    add_newlines_before_section_headers(element)
    # Заменяем code теги на кавычки
    replace_code_tags_with_quotes(element)
    # Заменяем CSS иконки и изображения на текст
    replace_css_icons_with_emoji(element)
    preserve_structure_tags(element)  # Сохраняем br
    replace_images_with_text(element)
    replace_abbr_tags(element)  # Заменяем abbr теги
    unwrap_inline_elements(element)  # Разворачиваем inline элементы
    add_spaces_between_words(element)  # Добавляем пробелы между словами
    
    # Если сам элемент является таблицей, обрабатываем его
    if element.name == 'table':
        table_data = extract_table_data(element)
        if table_data:
            # Если это fixbox и нужно включить fixbox'ы - добавляем в оба массива
            if table_data.get("type") == "fixbox" and include_fixbox:
                # Добавляем в fixboxes для Issues fixed (просто массив строк)
                result["fixboxes"].append(table_data.get("rows", []))
                # И ТАКЖЕ добавляем в tables для других секций
                result["tables"].append(table_data)
            # Если это fixbox, но мы не включаем fixbox'ы, добавляем только как таблицу
            elif table_data.get("type") == "fixbox" and not include_fixbox:
                result["tables"].append(table_data)
            # Обычная таблица
            elif table_data.get("type") == "table":
                result["tables"].append(table_data)
        return result  # Таблица не содержит другого текста, возвращаем сразу
    
    # Обрабатываем ВСЕ таблицы, включая вложенные (recursive=True)
    # Это включает таблицы внутри dl, div, p и других элементов
    all_tables = element.find_all('table', recursive=True)
    for table in all_tables:
        table_data = extract_table_data(table)
        if table_data:
            # Если это fixbox и нужно включить fixbox'ы - добавляем в оба массива
            if table_data.get("type") == "fixbox" and include_fixbox:
                # Добавляем в fixboxes для Issues fixed (просто массив строк)
                result["fixboxes"].append(table_data.get("rows", []))
                # И ТАКЖЕ добавляем в tables для других секций
                result["tables"].append(table_data)
            # Если это fixbox, но мы не включаем fixbox'ы, добавляем только как таблицу
            elif table_data.get("type") == "fixbox" and not include_fixbox:
                result["tables"].append(table_data)
            # Обычная таблица
            elif table_data.get("type") == "table":
                result["tables"].append(table_data)
        
        # Удаляем таблицу из элемента, чтобы не дублировать текст
        table.decompose()
    
    # Извлекаем оставшийся текст
    if element.name in ['p', 'dl', 'ul', 'ol', 'div', 'figure']:
        # Для dl/ul/ol используем специальную функцию с переносами строк
        if element.name in ['dl', 'ul', 'ol']:
            text = extract_list_with_newlines(element)
            text = clean_text_preserve_newlines(text)
        else:
            # Для остальных используем separator='' чтобы не было лишних пробелов
            text = clean_text_for_web(element.get_text(separator='', strip=True))
        if text:
            result["text"].append(text)
    
    return result


def extract_all_tables(element):
    """Извлекает все таблицы из элемента, включая вложенные"""
    if not element:
        return []
    
    tables = []
    # Ищем все таблицы в элементе
    all_table_tags = element.find_all('table', recursive=True)
    
    for table_tag in all_table_tags:
        table_data = extract_table_data(table_tag)
        if table_data:
            tables.append(table_data)
    
    return tables


def extract_table_data(table_elem):
    """Извлекает данные из HTML таблицы в структурированный формат"""
    if not table_elem:
        return None
    
    # Обрабатываем fixbox таблицы отдельно - они содержат просто текст
    if 'fixbox' in table_elem.get('class', []):
        # ВАЖНО: Сначала удаляем brackets и ссылки (пока это ещё HTML)
        remove_brackets_from_text(table_elem)
        # Добавляем переносы строк перед заголовками секций
        add_newlines_before_section_headers(table_elem)
        # Добавляем переносы строк между элементами списков
        add_newlines_in_lists(table_elem)
        # Потом остальные преобразования
        replace_code_tags_with_quotes(table_elem)
        # Для fixbox используем preserve с newlines
        replace_css_icons_with_emoji(table_elem)
        preserve_structure_tags_with_newlines(table_elem)  # Сохраняем br как \n
        replace_images_with_text(table_elem)
        replace_abbr_tags(table_elem)  # Заменяем abbr теги
        unwrap_inline_elements(table_elem)  # Разворачиваем inline элементы
        
        fix_title_elem = table_elem.find('th', class_='fixbox-title')
        fix_body_elem = table_elem.find('td', class_='fixbox-body')
        
        if fix_title_elem or fix_body_elem:
            fixbox_rows = []
            if fix_title_elem:
                title_text = clean_text_preserve_newlines(fix_title_elem.get_text(separator=' '))
                if title_text:
                    fixbox_rows.append(title_text)
            if fix_body_elem:
                # get_text с separator=' ' - переносы только от <br>
                body_text = fix_body_elem.get_text(separator=' ')
                content_text = clean_text_preserve_newlines(body_text)
                if content_text:
                    fixbox_rows.append(content_text)
            
            return {
                "type": "fixbox",
                "rows": fixbox_rows
            }
        return None
    
    # ВАЖНО: Сначала удаляем brackets и ссылки (пока это ещё HTML)
    remove_brackets_from_text(table_elem)
    # Заменяем code теги на кавычки для обычных таблиц
    replace_code_tags_with_quotes(table_elem)
    # Для обычных таблиц - заменяем br на пробелы
    replace_css_icons_with_emoji(table_elem)
    preserve_structure_tags(table_elem)  # br -> пробел
    replace_images_with_text(table_elem)
    replace_abbr_tags(table_elem)  # Заменяем abbr теги
    unwrap_inline_elements(table_elem)  # Разворачиваем inline элементы
    add_spaces_between_words(table_elem)  # Добавляем пробелы между словами
    
    # Обычная таблица
    table_data = {
        "type": "table",
        "headers": [],
        "rows": []
    }
    
    # Извлекаем заголовки
    thead = table_elem.find('thead')
    if thead:
        header_row = thead.find('tr')
        if header_row:
            for th in header_row.find_all(['th', 'td']):
                header_text = clean_text_for_web(th.get_text(separator='', strip=True))
                table_data["headers"].append(header_text)
    
    # Если заголовков нет в thead, ищем в первой строке tbody
    if not table_data["headers"]:
        first_row = table_elem.find('tr')
        if first_row:
            headers = first_row.find_all('th')
            if headers:
                for th in headers:
                    header_text = clean_text_for_web(th.get_text(separator='', strip=True))
                    table_data["headers"].append(header_text)
    
    # Извлекаем строки данных
    tbody = table_elem.find('tbody') or table_elem
    rows = tbody.find_all('tr')
    
    # Если первая строка была заголовком, пропускаем её
    start_index = 1 if (not thead and rows and rows[0].find('th')) else 0
    
    for row in rows[start_index:]:
        cells = row.find_all(['td', 'th'])
        row_data = []
        for cell in cells:
            cell_text = clean_text_for_web(cell.get_text(separator='', strip=True))
            row_data.append(cell_text)
        
        if any(row_data):  # Добавляем только непустые строки
            table_data["rows"].append(row_data)
    
    # Возвращаем только если есть данные
    if table_data["headers"] or table_data["rows"]:
        return table_data
    
    return None


def extract_pcgaming_data(html):
    """Извлечение полей Essential improvements, Issues fixed, Issues unresolved, Modifications, Game data, Other information из HTML"""
    if not html:
        return None
    
    soup = BeautifulSoup(html, 'html.parser')
    
    result = {
        "essential_improvements": [],
        "issues_fixed": [],
        "issues_unresolved": [],
        "modifications": [],
        "game_data": [],
        "other_information": []
    }
    
    # ===== ESSENTIAL IMPROVEMENTS =====
    improvements_header = soup.find('span', id='Essential_improvements')
    if improvements_header:
        h_tag = improvements_header.find_parent(['h2', 'h3'])
        if h_tag:
            current = h_tag.find_next_sibling()
            
            while current:
                if current.name == 'h2':
                    break
                
                if current.name == 'h3':
                    improvement_title_span = current.find('span', class_='mw-headline')
                    if improvement_title_span:
                        title = clean_text_for_web(improvement_title_span.get_text(separator=' ', strip=True))
                        
                        all_text = []
                        all_tables = []
                        desc_elem = current.find_next_sibling()
                        
                        while desc_elem and desc_elem.name not in ['h2', 'h3']:
                            content = extract_content_from_element(desc_elem, include_fixbox=True)
                            all_text.extend(content["text"])
                            all_tables.extend(content["tables"])
                            desc_elem = desc_elem.find_next_sibling()
                        
                        improvement_data = {
                            "title": title,
                            "description": " ".join(all_text)
                        }
                        if all_tables:
                            improvement_data["tables"] = all_tables
                        
                        result["essential_improvements"].append(improvement_data)
                
                current = current.find_next_sibling()
    
    # ===== ISSUES FIXED =====
    issues_header = soup.find('span', id='Issues_fixed')
    if issues_header:
        h_tag = issues_header.find_parent(['h2', 'h3'])
        if h_tag:
            current = h_tag.find_next_sibling()
            
            while current:
                if current.name == 'h2':
                    break
                
                if current.name == 'h3':
                    issue_title_span = current.find('span', class_='mw-headline')
                    if issue_title_span:
                        title = clean_text_for_web(issue_title_span.get_text(separator=' ', strip=True))
                        
                        solutions = []
                        all_text = []
                        all_tables = []
                        sol_elem = current.find_next_sibling()
                        
                        while sol_elem and sol_elem.name not in ['h2', 'h3']:
                            content = extract_content_from_element(sol_elem, include_fixbox=True)
                            
                            # Добавляем текст как примечания
                            for text in content["text"]:
                                solutions.append({
                                    "type": "note",
                                    "content": text
                                })
                            
                            # Собираем таблицы (fixbox уже будут в tables)
                            all_tables.extend(content["tables"])
                            
                            sol_elem = sol_elem.find_next_sibling()
                        
                        if solutions or all_tables:
                            issue_data = {
                                "issue": title,
                                "solutions": solutions
                            }
                            if all_tables:
                                issue_data["tables"] = all_tables
                            
                            result["issues_fixed"].append(issue_data)
                
                current = current.find_next_sibling()
    
    # ===== ISSUES UNRESOLVED =====
    unresolved_header = soup.find('span', id='Issues_unresolved')
    if unresolved_header:
        h_tag = unresolved_header.find_parent(['h2', 'h3'])
        if h_tag:
            current = h_tag.find_next_sibling()
            
            while current:
                if current.name == 'h2':
                    break
                
                if current.name == 'h3':
                    issue_title_span = current.find('span', class_='mw-headline')
                    if issue_title_span:
                        title = clean_text_for_web(issue_title_span.get_text(separator=' ', strip=True))
                        
                        all_text = []
                        all_tables = []
                        desc_elem = current.find_next_sibling()
                        
                        while desc_elem and desc_elem.name not in ['h2', 'h3']:
                            content = extract_content_from_element(desc_elem, include_fixbox=True)
                            all_text.extend(content["text"])
                            all_tables.extend(content["tables"])
                            desc_elem = desc_elem.find_next_sibling()
                        
                        unresolved_data = {
                            "issue": title,
                            "description": " ".join(all_text),
                            "notes": ""  # Оставляем для совместимости
                        }
                        if all_tables:
                            unresolved_data["tables"] = all_tables
                        
                        result["issues_unresolved"].append(unresolved_data)
                
                current = current.find_next_sibling()
    
    # ===== MODIFICATIONS =====
    # Only look for Modifications as a TOP-LEVEL h2 section (not as subsection of Other information)
    modifications_header = soup.find('span', id='Modifications')
    if modifications_header:
        h_tag = modifications_header.find_parent(['h2', 'h3'])
        # Only process if it's an h2 (top-level section), not h3 (subsection)
        if h_tag and h_tag.name == 'h2':
            current = h_tag.find_next_sibling()
            
            while current:
                if current.name == 'h2':
                    break
                
                if current.name == 'h3':
                    mod_title_span = current.find('span', class_='mw-headline')
                    if mod_title_span:
                        title = clean_text_for_web(mod_title_span.get_text(separator=' ', strip=True))
                        
                        all_text = []
                        all_tables = []
                        desc_elem = current.find_next_sibling()
                        
                        while desc_elem and desc_elem.name not in ['h2', 'h3']:
                            content = extract_content_from_element(desc_elem, include_fixbox=True)
                            all_text.extend(content["text"])
                            all_tables.extend(content["tables"])
                            desc_elem = desc_elem.find_next_sibling()
                        
                        mod_data = {
                            "title": title,
                            "description": " ".join(all_text)
                        }
                        if all_tables:
                            mod_data["tables"] = all_tables
                        
                        result["modifications"].append(mod_data)
                
                current = current.find_next_sibling()
    
    # ===== GAME DATA =====
    game_data_header = soup.find('span', id='Game_data')
    if game_data_header:
        h_tag = game_data_header.find_parent(['h2', 'h3'])
        if h_tag:
            current = h_tag.find_next_sibling()
            
            while current:
                if current.name == 'h2':
                    break
                
                if current.name == 'h3':
                    data_title_span = current.find('span', class_='mw-headline')
                    if data_title_span:
                        title = clean_text_for_web(data_title_span.get_text(separator=' ', strip=True))
                        
                        # Пропускаем "Save game cloud syncing"
                        if title == "Save game cloud syncing":
                            current = current.find_next_sibling()
                            continue
                        
                        all_text = []
                        all_tables = []
                        desc_elem = current.find_next_sibling()
                        
                        while desc_elem and desc_elem.name not in ['h2', 'h3']:
                            content = extract_content_from_element(desc_elem, include_fixbox=True)
                            all_text.extend(content["text"])
                            all_tables.extend(content["tables"])
                            desc_elem = desc_elem.find_next_sibling()
                        
                        game_data_item = {
                            "title": title,
                            "description": " ".join(all_text)
                        }
                        if all_tables:
                            game_data_item["tables"] = all_tables
                        
                        result["game_data"].append(game_data_item)
                
                current = current.find_next_sibling()
    
    # ===== OTHER INFORMATION =====
    other_info_header = soup.find('span', id='Other_information')
    if other_info_header:
        h_tag = other_info_header.find_parent(['h2', 'h3'])
        if h_tag:
            current = h_tag.find_next_sibling()
            
            while current:
                if current.name == 'h2':
                    break
                
                if current.name == 'h3':
                    info_title_span = current.find('span', class_='mw-headline')
                    if info_title_span:
                        title = clean_text_for_web(info_title_span.get_text(separator=' ', strip=True))
                        
                        # Пропускаем "Middleware"
                        if title == "Middleware":
                            current = current.find_next_sibling()
                            continue
                        
                        # Для подраздела "Modifications" собираем h4 отдельно
                        if title == "Modifications":
                            all_text = []
                            desc_elem = current.find_next_sibling()
                            
                            while desc_elem and desc_elem.name not in ['h2', 'h3']:
                                # Если это h4 - это отдельная модификация
                                if desc_elem.name == 'h4':
                                    h4_title_span = desc_elem.find('span', class_='mw-headline')
                                    if h4_title_span:
                                        h4_title = clean_text_for_web(h4_title_span.get_text(separator=' ', strip=True))
                                        all_text.append(h4_title)
                                else:
                                    # Собираем контент под h4
                                    content = extract_content_from_element(desc_elem, include_fixbox=True)
                                    all_text.extend(content["text"])
                                
                                desc_elem = desc_elem.find_next_sibling()
                            
                            # Объединяем с переносами строк
                            other_info_item = {
                                "title": title,
                                "description": "\n".join(all_text)
                            }
                            result["other_information"].append(other_info_item)
                        else:
                            # Обычная обработка для других подразделов
                            all_text = []
                            all_tables = []
                            desc_elem = current.find_next_sibling()
                            
                            while desc_elem and desc_elem.name not in ['h2', 'h3']:
                                content = extract_content_from_element(desc_elem, include_fixbox=True)
                                all_text.extend(content["text"])
                                all_tables.extend(content["tables"])
                                desc_elem = desc_elem.find_next_sibling()
                            
                            other_info_item = {
                                "title": title,
                                "description": " ".join(all_text)
                            }
                            if all_tables:
                                other_info_item["tables"] = all_tables
                            
                            result["other_information"].append(other_info_item)
                
                current = current.find_next_sibling()
    
    return result


def get_pcgaming_info(game_name):
    """Получает PCGamingWiki данные для игры"""
    # Очищаем название от товарных знаков
    cleaned_name = clean_game_name(game_name)
    
    if not cleaned_name:
        return None
    
    # Шаг 1: Поиск игры
    search_result = search_game(cleaned_name)
    
    if not search_result:
        return None
    
    # Шаг 2: Получение HTML страницы
    html = get_game_page_html(search_result['title'])
    
    if not html:
        return None
    
    # Шаг 3: Извлечение нужных полей
    data = extract_pcgaming_data(html)
    
    # Проверяем, есть ли хоть какие-то данные
    if (not data['essential_improvements'] and 
        not data['issues_fixed'] and 
        not data['issues_unresolved'] and
        not data['modifications'] and
        not data['game_data'] and
        not data['other_information']):
        return None
    
    return data


# ===== BEFOREIPLAY.COM FUNCTIONS =====

def search_game_beforeiplay(query):
    """Поиск игры на beforeiplay.com по названию"""
    url = "https://www.beforeiplay.com/api.php"
    params = {
        "action": "opensearch",
        "search": query,
        "format": "json",
        "limit": 1
    }
    
    try:
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        if data[1] and len(data[1]) > 0:
            return {
                "title": data[1][0],
                "url": data[3][0]
            }
    except Exception as e:
        print(f"    ⚠ Ошибка при поиске на BeforeIPlay: {e}")
    
    return None


def get_beforeiplay_page_html(page_title):
    """Получение HTML содержимого страницы игры с beforeiplay.com"""
    url = "https://www.beforeiplay.com/api.php"
    params = {
        "action": "parse",
        "page": page_title,
        "format": "json",
        "prop": "text"
    }
    
    try:
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        if "parse" in data and "text" in data["parse"]:
            return data["parse"]["text"]["*"]
    except Exception as e:
        print(f"    ⚠ Ошибка при получении страницы BeforeIPlay: {e}")
    
    return None


def extract_list_item_with_children(li_element):
    """Извлекает содержимое <li> элемента с учетом вложенных списков"""
    if not li_element:
        return None
    
    from bs4 import NavigableString
    
    # ВАЖНО: Сначала заменяем <b> и <strong> теги на §text§ для bold
    for bold_tag in li_element.find_all(['b', 'strong']):
        bold_text = bold_tag.get_text()
        bold_tag.replace_with(f'§{bold_text}§')
    
    # Получаем прямой текст элемента (без вложенных ul/ol)
    direct_text_parts = []
    for child in li_element.children:
        if isinstance(child, NavigableString):
            text = str(child).strip()
            if text:
                direct_text_parts.append(text)
        elif child.name not in ['ul', 'ol']:
            # Это другой тег (но уже не b/strong, т.к. они заменены), но не список
            text = child.get_text(separator=' ', strip=True)
            if text:
                direct_text_parts.append(text)
    
    main_text = clean_text_for_web(' '.join(direct_text_parts))
    
    if not main_text:
        return None
    
    # Проверяем, есть ли вложенные списки
    nested_ul = li_element.find('ul', recursive=False)
    nested_ol = li_element.find('ol', recursive=False)
    nested_list = nested_ul or nested_ol
    
    if nested_list:
        # Есть вложенный список - создаем структуру с children
        children = []
        for nested_li in nested_list.find_all('li', recursive=False):
            child_item = extract_list_item_with_children(nested_li)
            if child_item:
                children.append(child_item)
        
        if children:
            return {
                "text": main_text,
                "children": children
            }
        else:
            # Вложенный список пустой, возвращаем просто текст
            return {"text": main_text}
    else:
        # Нет вложенных списков - простой элемент
        return {"text": main_text}


def extract_beforeiplay_tips(html):
    """Извлекает gameplay tips из HTML страницы beforeiplay.com с сохранением иерархии"""
    if not html:
        return []
    
    soup = BeautifulSoup(html, 'html.parser')
    tips = []
    
    # Ищем div с классом mw-parser-output
    output_div = soup.find('div', class_='mw-parser-output')
    if not output_div:
        return tips
    
    # ВАЖНО: Сначала удаляем brackets и ссылки (пока это ещё HTML)
    remove_brackets_from_text(output_div)
    # Заменяем CSS иконки и изображения
    replace_css_icons_with_emoji(output_div)
    preserve_structure_tags(output_div)
    replace_images_with_text(output_div)
    replace_abbr_tags(output_div)  # Заменяем abbr теги
    unwrap_inline_elements(output_div)  # Разворачиваем inline элементы
    
    # Ищем все h2 заголовки
    h2_tags = output_div.find_all('h2')
    
    # Если есть h2 заголовки, обрабатываем секции
    if h2_tags:
        for h2 in h2_tags:
            # Пропускаем служебные секции
            headline = h2.find('span', class_='mw-headline')
            if not headline:
                continue
            
            title_text = headline.get_text(separator=' ', strip=True)
            
            # Пропускаем навигационные секции
            if title_text.lower() in ['contents', 'navigation', 'see also', 'external links']:
                continue
            
            title = clean_text_for_web(title_text)
            
            # Собираем все ul списки до следующего h2
            section_tips = []
            current = h2.find_next_sibling()
            
            while current and current.name != 'h2':
                if current.name == 'ul':
                    for li in current.find_all('li', recursive=False):
                        tip_item = extract_list_item_with_children(li)
                        if tip_item:
                            section_tips.append(tip_item)
                current = current.find_next_sibling()
            
            if section_tips:
                tips.append({
                    "title": title,
                    "tips": section_tips
                })
    
    else:
        # Нет h2 заголовков - собираем все li из всех ul
        all_ul = output_div.find_all('ul', recursive=False)
        section_tips = []
        for ul in all_ul:
            for li in ul.find_all('li', recursive=False):
                tip_item = extract_list_item_with_children(li)
                if tip_item:
                    section_tips.append(tip_item)
        
        if section_tips:
            tips.append({
                "title": "",  # Без заголовка
                "tips": section_tips
            })
    
    return tips


def get_beforeiplay_info(game_name):
    """Получает gameplay tips для игры с beforeiplay.com"""
    cleaned_name = clean_game_name(game_name)
    
    if not cleaned_name:
        return None
    
    # Поиск игры
    search_result = search_game_beforeiplay(cleaned_name)
    
    if not search_result:
        return None
    
    # Получение HTML страницы
    html = get_beforeiplay_page_html(search_result['title'])
    
    if not html:
        return None
    
    # Извлечение tips
    tips = extract_beforeiplay_tips(html)
    
    if not tips:
        return None
    
    return tips


def main():
    print("=" * 80)
    print("PCGamingWiki & BeforeIPlay Enrichment Script")
    print("=" * 80)
    
    # Выбор режима работы
    print("\nРежим работы:")
    print("1. TEST MODE (только первая игра) - по умолчанию")
    print("2. FULL MODE (все игры)")
    mode_input = input("\nВыберите режим (1/2, Enter = 1): ").strip()
    
    test_mode = True  # По умолчанию
    if mode_input == "2":
        test_mode = False
    
    if test_mode:
        print("\n🧪 TEST MODE: Обработка только первой игры")
    else:
        print("\n🚀 FULL MODE: Обработка всех игр")
    
    # Ввод имени входного файла
    input_file = input("\nВведите имя входного файла (по умолчанию: games.json): ").strip()
    if not input_file:
        input_file = "games.json"
    
    # Проверка существования файла
    if not Path(input_file).exists():
        print(f"\n❌ Файл {input_file} не найден!")
        return
    
    # Загрузка games.json
    print(f"\n📂 Загрузка {input_file}...")
    with open(input_file, 'r', encoding='utf-8') as f:
        games_data = json.load(f)
    
    print(f"✓ Загружено {len(games_data)} игр")
    
    # Обработка каждой игры
    print(f"\n🔍 Начинаем обогащение данными из PCGamingWiki и BeforeIPlay...\n")
    
    enriched_count = 0
    failed_count = 0
    skipped_count = 0
    
    # В тестовом режиме обрабатываем только игру с ключом "1510"
    games_to_process = list(games_data.items())
    if test_mode:
        # Ищем игру с app_id = "1510"
        test_game = None
        for app_id, game_info in games_data.items():
            if app_id == "1510":
                test_game = (app_id, game_info)
                break
        
        if test_game:
            games_to_process = [test_game]
        else:
            print("⚠ Игра с app_id='1510' не найдена, используется первая игра")
            games_to_process = games_to_process[:1]
    
    for i, (app_id, game_info) in enumerate(games_to_process, 1):
        game_name = game_info.get('name', '')
        
        if not game_name:
            print(f"[{i}/{len(games_to_process)}] ⏭ Пропуск {app_id} - нет имени игры")
            skipped_count += 1
            continue
        
        print(f"[{i}/{len(games_to_process)}] 🎮 {game_name}")
        
        try:
            # Получаем данные из PCGamingWiki
            pcgaming_data = get_pcgaming_info(game_name)
            
            if pcgaming_data:
                # Добавляем данные к игре
                games_data[app_id]['essential_improvements'] = pcgaming_data['essential_improvements']
                games_data[app_id]['issues_fixed'] = pcgaming_data['issues_fixed']
                games_data[app_id]['issues_unresolved'] = pcgaming_data['issues_unresolved']
                games_data[app_id]['modifications'] = pcgaming_data['modifications']
                games_data[app_id]['game_data'] = pcgaming_data['game_data']
                games_data[app_id]['other_information'] = pcgaming_data['other_information']
                
                improvements_count = len(pcgaming_data['essential_improvements'])
                fixed_count = len(pcgaming_data['issues_fixed'])
                unresolved_count = len(pcgaming_data['issues_unresolved'])
                mods_count = len(pcgaming_data['modifications'])
                game_data_count = len(pcgaming_data['game_data'])
                other_info_count = len(pcgaming_data['other_information'])
                
                print(f"    ✓ PCGamingWiki: {improvements_count} улучшений, {fixed_count} решений, {unresolved_count} нерешённых")
                print(f"      {mods_count} модификаций, {game_data_count} данных, {other_info_count} доп. информации")
                enriched_count += 1
                
                # В test mode показываем детальный результат
                if test_mode:
                    print("\n" + "=" * 80)
                    print("📋 PCGamingWiki РЕЗУЛЬТАТ (TEST MODE)")
                    print("=" * 80)
                    print(json.dumps(pcgaming_data, ensure_ascii=False, indent=2))
                    print("=" * 80)
            else:
                # Добавляем пустые поля
                games_data[app_id]['essential_improvements'] = []
                games_data[app_id]['issues_fixed'] = []
                games_data[app_id]['issues_unresolved'] = []
                games_data[app_id]['modifications'] = []
                games_data[app_id]['game_data'] = []
                games_data[app_id]['other_information'] = []
                
                print(f"    ℹ PCGamingWiki: Данные не найдены")
                failed_count += 1
            
            # Пауза между запросами
            time.sleep(1.5)
            
            # Получаем данные из BeforeIPlay
            beforeiplay_data = get_beforeiplay_info(game_name)
            
            if beforeiplay_data:
                games_data[app_id]['gameplay_tips'] = beforeiplay_data
                tips_count = sum(len(section['tips']) for section in beforeiplay_data)
                print(f"    ✓ BeforeIPlay: {tips_count} советов в {len(beforeiplay_data)} секциях")
                
                # В test mode показываем детальный результат
                if test_mode:
                    print("\n" + "=" * 80)
                    print("📋 BeforeIPlay РЕЗУЛЬТАТ (TEST MODE)")
                    print("=" * 80)
                    print(json.dumps(beforeiplay_data, ensure_ascii=False, indent=2))
                    print("=" * 80)
            else:
                games_data[app_id]['gameplay_tips'] = []
                print(f"    ℹ BeforeIPlay: Данные не найдены")
            
            # Пауза между запросами, чтобы не перегружать API
            time.sleep(1.5)
            
        except Exception as e:
            print(f"    ❌ Ошибка: {e}")
            # Добавляем пустые поля при ошибке
            games_data[app_id]['essential_improvements'] = []
            games_data[app_id]['issues_fixed'] = []
            games_data[app_id]['issues_unresolved'] = []
            games_data[app_id]['modifications'] = []
            games_data[app_id]['game_data'] = []
            games_data[app_id]['other_information'] = []
            games_data[app_id]['gameplay_tips'] = []
            failed_count += 1
    
    # В тестовом режиме показываем результат в JSON
    if test_mode and enriched_count > 0:
        print("\n" + "=" * 80)
        print("📋 ИТОГОВЫЙ РЕЗУЛЬТАТ (JSON)")
        print("=" * 80)
        # Берем игру "1510" если есть, иначе первую
        if "1510" in games_data:
            test_app_id = "1510"
        else:
            test_app_id = list(games_data.keys())[0]
        
        test_game = games_data[test_app_id]
        
        # Выводим все поля
        all_fields = {
            "name": test_game.get('name', ''),
            "essential_improvements": test_game.get('essential_improvements', []),
            "issues_fixed": test_game.get('issues_fixed', []),
            "issues_unresolved": test_game.get('issues_unresolved', []),
            "modifications": test_game.get('modifications', []),
            "game_data": test_game.get('game_data', []),
            "other_information": test_game.get('other_information', []),
            "gameplay_tips": test_game.get('gameplay_tips', [])
        }
        
        print(json.dumps(all_fields, ensure_ascii=False, indent=2))
        print("=" * 80)
    
    # Сохранение результата
    output_file = "games_pcgaming.json"
    print(f"\n💾 Сохранение результата в {output_file}...")
    
    # В test mode сохраняем только игру "1510"
    if test_mode:
        if "1510" in games_data:
            output_data = {"1510": games_data["1510"]}
        else:
            # Fallback на первую игру если "1510" нет
            first_app_id = list(games_data.keys())[0]
            output_data = {first_app_id: games_data[first_app_id]}
    else:
        output_data = games_data
    
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)
    
    print(f"✓ Сохранено!")
    
    # Статистика
    print("\n" + "=" * 80)
    print("📊 СТАТИСТИКА")
    print("=" * 80)
    print(f"Всего игр:           {len(games_data)}")
    print(f"Обогащено данными:   {enriched_count}")
    print(f"Данные не найдены:   {failed_count}")
    print(f"Пропущено:           {skipped_count}")
    print("=" * 80)
    print(f"\n✅ Готово! Результат сохранён в {output_file}")


if __name__ == "__main__":
    main()
