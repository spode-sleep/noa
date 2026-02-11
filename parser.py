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
    """Очистка текста с сохранением переносов строк"""
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
        if line:  # Добавляем только непустые строки
            cleaned_lines.append(line)
    
    # Объединяем строки обратно
    return '\n'.join(cleaned_lines)


def replace_css_icons_with_emoji(element):
    """Заменяет элементы с CSS ::before иконками на эмодзи"""
    if not element:
        return
    
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
        
        # Проверяем, есть ли совпадение с нашими классами
        for css_class, emoji in css_class_emoji_map.items():
            if css_class in tag_classes:
                # Заменяем элемент на эмодзи + текст внутри элемента (если есть)
                inner_text = tag.get_text(strip=True)
                if inner_text:
                    tag.replace_with(f"{emoji} {inner_text}")
                else:
                    tag.replace_with(emoji)
                break


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
        
        # Если есть текстовое описание, заменяем тег на текст
        if text_replacement:
            img.replace_with(f"[{text_replacement}]")
        else:
            # Если нет описания, просто удаляем изображение
            img.decompose()


def preserve_structure_tags(element):
    """Заменяем <br> на символ переноса строки и оборачиваем <code> в обратные кавычки"""
    if not element:
        return
    
    # Заменяем <br> на \n
    for br in element.find_all('br'):
        br.replace_with('\n')
    
    # Оборачиваем <code> в обратные кавычки
    for code in element.find_all('code'):
        code_text = code.get_text()
        code.replace_with(f'`{code_text}`')


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
    
    # Заменяем CSS иконки и изображения на текст
    replace_css_icons_with_emoji(element)
    preserve_structure_tags(element)  # Сохраняем br и code
    replace_images_with_text(element)
    
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
        text = clean_text_for_web(element.get_text(strip=True))
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
    
    # Заменяем CSS иконки на эмоджи, затем изображения на текст
    replace_css_icons_with_emoji(table_elem)
    preserve_structure_tags(table_elem)  # Сохраняем br и code
    replace_images_with_text(table_elem)
    
    # Обрабатываем fixbox таблицы отдельно - они содержат просто текст
    if 'fixbox' in table_elem.get('class', []):
        fix_title_elem = table_elem.find('th', class_='fixbox-title')
        fix_body_elem = table_elem.find('td', class_='fixbox-body')
        
        if fix_title_elem or fix_body_elem:
            fixbox_rows = []
            if fix_title_elem:
                title_text = clean_text_preserve_newlines(fix_title_elem.get_text(separator='\n'))
                if title_text:
                    fixbox_rows.append(title_text)
            if fix_body_elem:
                # get_text с separator='\n' сохраняет структуру
                body_text = fix_body_elem.get_text(separator='\n')
                content_text = clean_text_preserve_newlines(body_text)
                if content_text:
                    fixbox_rows.append(content_text)
            
            return {
                "type": "fixbox",
                "rows": fixbox_rows
            }
        return None
    
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
                table_data["headers"].append(clean_text_for_web(th.get_text(strip=True)))
    
    # Если заголовков нет в thead, ищем в первой строке tbody
    if not table_data["headers"]:
        first_row = table_elem.find('tr')
        if first_row:
            headers = first_row.find_all('th')
            if headers:
                for th in headers:
                    table_data["headers"].append(clean_text_for_web(th.get_text(strip=True)))
    
    # Извлекаем строки данных
    tbody = table_elem.find('tbody') or table_elem
    rows = tbody.find_all('tr')
    
    # Если первая строка была заголовком, пропускаем её
    start_index = 1 if (not thead and rows and rows[0].find('th')) else 0
    
    for row in rows[start_index:]:
        cells = row.find_all(['td', 'th'])
        row_data = []
        for cell in cells:
            row_data.append(clean_text_for_web(cell.get_text(strip=True)))
        
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
                        title = clean_text_for_web(improvement_title_span.get_text(strip=True))
                        
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
                        title = clean_text_for_web(issue_title_span.get_text(strip=True))
                        
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
                        title = clean_text_for_web(issue_title_span.get_text(strip=True))
                        
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
    modifications_header = soup.find('span', id='Modifications')
    if modifications_header:
        h_tag = modifications_header.find_parent(['h2', 'h3'])
        if h_tag:
            current = h_tag.find_next_sibling()
            
            while current:
                if current.name == 'h2':
                    break
                
                if current.name == 'h3':
                    mod_title_span = current.find('span', class_='mw-headline')
                    if mod_title_span:
                        title = clean_text_for_web(mod_title_span.get_text(strip=True))
                        
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
                        title = clean_text_for_web(data_title_span.get_text(strip=True))
                        
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
                        title = clean_text_for_web(info_title_span.get_text(strip=True))
                        
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


def extract_beforeiplay_tips(html):
    """Извлекает gameplay tips из HTML страницы beforeiplay.com"""
    if not html:
        return []
    
    soup = BeautifulSoup(html, 'html.parser')
    tips = []
    
    # Ищем div с классом mw-parser-output
    output_div = soup.find('div', class_='mw-parser-output')
    if not output_div:
        return tips
    
    # Заменяем CSS иконки и изображения
    replace_css_icons_with_emoji(output_div)
    preserve_structure_tags(output_div)
    replace_images_with_text(output_div)
    
    # Ищем все h2 заголовки
    h2_tags = output_div.find_all('h2')
    
    # Если есть h2 заголовки, обрабатываем секции
    if h2_tags:
        for h2 in h2_tags:
            # Пропускаем служебные секции
            headline = h2.find('span', class_='mw-headline')
            if not headline:
                continue
            
            title_text = headline.get_text(strip=True)
            
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
                        tip_text = clean_text_for_web(li.get_text(strip=True))
                        if tip_text:
                            section_tips.append(tip_text)
                current = current.find_next_sibling()
            
            if section_tips:
                tips.append({
                    "title": title,
                    "tips": section_tips
                })
    
    else:
        # Нет h2 заголовков - собираем все li из всех ul
        all_ul = output_div.find_all('ul')
        section_tips = []
        for ul in all_ul:
            for li in ul.find_all('li', recursive=False):
                tip_text = clean_text_for_web(li.get_text(strip=True))
                if tip_text:
                    section_tips.append(tip_text)
        
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
    
    # В тестовом режиме обрабатываем только игру с ключом "220"
    games_to_process = list(games_data.items())
    if test_mode:
        # Ищем игру с app_id = "220"
        test_game = None
        for app_id, game_info in games_data.items():
            if app_id == "220":
                test_game = (app_id, game_info)
                break
        
        if test_game:
            games_to_process = [test_game]
        else:
            print("⚠ Игра с app_id='220' не найдена, используется первая игра")
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
        # Берем игру "220" если есть, иначе первую
        if "220" in games_data:
            test_app_id = "220"
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
    
    # В test mode сохраняем только игру "220"
    if test_mode:
        if "220" in games_data:
            output_data = {"220": games_data["220"]}
        else:
            # Fallback на первую игру если "220" нет
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
