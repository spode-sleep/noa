# RAWG Library Archiver — Windows Setup

Архивация игр из GOG, Epic Games Store и Amazon Games.

## 1. Установка Python 3.10+

Python нужен для запуска скриптов и установки CLI-инструментов через `pip`.

**Вариант А — через winget (если есть):**
```
winget install Python.Python.3.12
```

**Вариант Б — скачать с python.org:**
1. Откройте https://www.python.org/downloads/
2. Скачайте последнюю версию Python 3.12+
3. При установке **обязательно** поставьте галочку **«Add python.exe to PATH»**

После установки **перезапустите терминал** (cmd / PowerShell) и проверьте:
```
python --version
pip --version
```

> **Если `pip` не найден** — попробуйте `py -m pip --version`.
> Если и это не работает — Python не добавлен в PATH. Переустановите
> с галочкой «Add to PATH» или добавьте вручную в системные переменные.

## 2. Установка CLI-инструментов

Скрипт пробует все три сервиса для каждой игры. Установите хотя бы один:

### legendary (Epic Games Store)
```
pip install legendary-gl
legendary auth
```

### lgogdownloader (GOG.com) — только Linux / WSL

> **Важно:** lgogdownloader — **Linux-утилита**. Официальных Windows-бинарников нет,
> и в Scoop / winget пакет отсутствует. На чистой Windows этот сервис можно пропустить —
> скрипт автоматически перейдёт к следующему (legendary / nile).

**Если хотите использовать GOG — установите через WSL (Windows Subsystem for Linux):**

1. Включите WSL (если ещё не включён):
   ```powershell
   wsl --install
   ```
2. Перезагрузите компьютер, откройте Ubuntu из меню «Пуск» и выполните:
   ```bash
   sudo apt update && sudo apt install lgogdownloader -y
   lgogdownloader --login
   ```

После этого `lgogdownloader` будет доступен **только внутри WSL**.
Скрипт `install_games.py` сможет его найти, если запущен из WSL.

### nile (Amazon Games)
```
pip install nile
nile auth --login
```

> **Если `pip install` не работает** — используйте `py -m pip install` вместо `pip install`.

Проверка:
```
legendary --version
lgogdownloader --version
nile --version
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
