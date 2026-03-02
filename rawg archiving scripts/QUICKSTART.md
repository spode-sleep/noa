# RAWG Library Archiver — Windows Setup

Архивация игр из GOG, Epic Games Store и Amazon Games.

## 1. Установка CLI-инструментов

Скрипт пробует все три сервиса для каждой игры. Установите хотя бы один:

### legendary (Epic Games Store)
```
pip install legendary-gl
legendary auth
```

### lgogdownloader (GOG.com)
```
# Windows: скачайте с https://github.com/Sude-/lgogdownloader/releases
# Или через scoop: scoop install lgogdownloader
lgogdownloader --login
```

### nile (Amazon Games)
```
pip install nile
nile auth --login
```

Проверка:
```
legendary --version
lgogdownloader --version
nile --version
```

## 2. Установка Python 3.10+

```
winget install Python.Python.3.12
```

## 3. Подключение HDD

Подключите внешний HDD (NTFS). Запомните букву диска (например, `D:`, `E:`).

## 4. Запуск

```
cd "rawg archiving scripts"
python install_games.py batches/batch_01.txt D:\rawg
```

Параметры:
- 1-й аргумент: файл с именами игр (батч)
- 2-й аргумент: путь на HDD (по умолчанию `D:\rawg`)

Примеры:
```
python install_games.py batches/batch_01.txt
python install_games.py batches/batch_01.txt "E:\Archive\rawg"
```

## 5. Что происходит

При запуске:
1. **Проверка авторизации** во всех доступных сервисах (legendary, lgogdownloader, nile)
2. Если не авторизован — запускает интерактивный логин

Для каждой игры:
1. **Поиск** ключа в `games.json` по имени (для имени папки)
2. **Поиск** в библиотеках legendary → lgogdownloader → nile
3. **Скачивание** в `D:\rawg_downloads\{key}`
4. **Копирование** на HDD в `{install_dir}\{key}`
5. **Верификация** — сравнение размеров
6. **Удаление** локальной копии

### Именование папок

Папки на HDD именуются по **ключу из games.json** (только буквы, цифры, `_`):
- Батч-файлы содержат **имена игр** (например `Into the Breach`)
- Скрипт находит ключ в games.json (например `Into_the_Breach`)
- Папка на HDD: `D:\rawg\Into_the_Breach`

Это аналогично тому, как Steam-архиватор использует AppID для папок.

## 6. Батчи (порядок приоритета)

| Батч | Категория | Кол-во | Приоритет |
|------|-----------|--------|-----------|
| batch_01 | Креативные / рогалики | 27 | ⬆ Высокий |
| batch_02 | Стратегии / менеджмент | 30 | ⬆ Высокий |
| batch_03 | Головоломки / арт | 29 | ➡ Средний |
| batch_04 | RPG / выборы | 26 | ➡ Средний |
| batch_05 | Экшен / платформеры | 29 | ➡ Средний |
| batch_06 | Нарратив / хоррор | 36 | ⬇ Обычный |
| batch_07 | Крупные AAA | 9 | ⬇ Низкий |

Критерии приоритизации:
- **Реиграбельность**: рогалики, песочницы, стратегии выше
- **Креативные инструменты**: строители, симуляторы выше
- **Размер**: маленькие игры выше (быстрее скачать)

## 7. Пометка как заархивированных

После успешной загрузки батча:
```
python mark_archived.py results/YYYYMMDD_HHMMSS/installed.txt --hdd ARCHIVE1
```

Скрипт ищет игры **по имени** (не по ключу) и помечает только rawg-игры.
`installed.txt` содержит ID папки для каждой игры — `archivePath` в games.json
указывает на папку по ID сервиса (не по имени).

## 8. Результаты

После завершения в папке `results/YYYYMMDD_HHMMSS/`:
- `install.log` — полный лог
- `installed.txt` — успешно скачанные (формат: `name<TAB>service<TAB>folder_id`)
- `failed.txt` — не скачанные (можно перезапустить)
- `warnings.txt` — подозрительно маленькие

Повтор неудачных:
```
python install_games.py results\20260301_120000\failed.txt D:\rawg
```

## 9. Важно

- Скрипт проверяет авторизацию во всех сервисах **при запуске** и запускает
  логин, если нужно. Можно также авторизоваться заранее вручную.
- Имена игр в батчах взяты из `games.json` и могут не точно совпадать
  с названиями в магазинах. Скрипт ищет по имени в библиотеке каждого сервиса.
- Нельзя заранее знать, из какого сервиса какая игра — поэтому пробуются все три.
