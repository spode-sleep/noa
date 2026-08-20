# Steam Library Archiver — Windows Setup

Быстрая настройка архивации Steam-библиотеки на Windows.

> Полный рабочий процесс (батчи → скачивание → пометка в `games.json` → git)
> описан в [../WORKFLOW.md](../WORKFLOW.md). Здесь — только установка и флаги.

## 1. Установка DepotDownloader

1. Скачайте последнюю версию: https://github.com/SteamRE/DepotDownloader/releases
2. Скачайте `DepotDownloader-windows-x64.zip`
3. Распакуйте в `%USERPROFILE%\depotdownloader\`
4. Проверьте: `%USERPROFILE%\depotdownloader\DepotDownloader.exe` должен существовать

## 2. Установка Python 3.10+ (рекомендуется 3.12)

Если ещё не установлен:
```
winget install Python.Python.3.12
```

Проверка:
```
python --version
```

## 3. Подготовка файла с играми

Формат `my_games.txt` — один AppID на строку:
```
# Мои игры
1010870
1082430
217980
```

AppID можно найти в URL игры на Steam: `store.steampowered.com/app/APPID/`

## 4. Подключение HDD

Подключите внешний HDD (NTFS). Запомните букву диска (например, `D:`, `E:`).

## 5. Запуск

```
cd "steam archiving scripts\windows"
python install_games.py ..\batches\new_batch.txt E:\steam
```

Параметры:
- 1-й аргумент: путь к файлу с AppID
- 2-й аргумент: путь на HDD (по умолчанию `D:\steam`)
- `--buffer`: папка-буфер для скачивания (по умолчанию `D:\steam_downloads`).
  Должна быть на другом диске, чем HDD — иначе скрипт откажется стартовать.
- `--dd`: путь к DepotDownloader если не в стандартном месте
- `--platform`: приоритетная платформа (`linux` или `windows`), см. раздел 6
- `--ask-platform`: спросить приоритет интерактивно

Примеры:
```
python install_games.py ..\batches\new_batch.txt E:\steam
python install_games.py ..\my_games.txt "E:\Archive\steam" --buffer D:\steam_downloads
python install_games.py ..\my_games.txt E:\steam --dd "C:\tools\DepotDownloader.exe"
python install_games.py ..\my_games.txt E:\steam --platform windows
```

## 6. Выбор приоритетной платформы

**По умолчанию — `linux`.** Архив рассчитан на воспроизведение с Linux-машины,
поэтому linux-сборки скачиваются в приоритете, даже когда сам прогон идёт с Windows.
Ничего указывать не нужно.

С флагом `--ask-platform` скрипт спросит интерактивно (Enter = Linux):

```
╔════════════════════════════════════════╗
║     Выбор приоритетной платформы       ║
╚════════════════════════════════════════╝

  [1] Linux   — сначала linux, потом windows  (по умолчанию)
  [2] Windows — сначала windows, потом linux

Ваш выбор [1/2, Enter = 1]:
```

Выбор определяет **порядок перебора** при фоллбэке (сначала обе локали
приоритетной ОС, потом обе локали запасной):

| Выбор | Порядок перебора |
|-------|-----------------|
| `linux` (по умолчанию) | russian/linux → english/linux → russian/windows → english/windows → все платформы |
| `windows` | russian/windows → english/windows → russian/linux → english/linux → все платформы |

Чтобы разово скачать с приоритетом windows-сборок:
```
python install_games.py my_games.txt E:\steam --platform windows
```

## 7. Что происходит

Для каждой игры:
1. **Скачивание** в буфер `D:\steam_downloads\{appId}` (или в `--buffer`)
2. **Копирование** на HDD через robocopy (стабильнее shutil/xcopy для NTFS)
3. **Верификация** — сравнение размеров
4. **Удаление** локальной копии

## 8. Результаты

После завершения в папке `results/YYYYMMDD_HHMMSS/`:
- `install.log` — полный лог
- `installed.txt` — успешно скачанные AppID
- `failed.txt` — не скачанные AppID (можно использовать как вход для повторной попытки)
- `warnings.txt` — подозрительно маленькие игры

Повтор неудачных:
```
python install_games.py results\20260218_120000\failed.txt E:\steam
```

> `results/` создаётся **относительно текущей папки**, то есть внутри `windows\`,
> если запускали оттуда.

## 8.1 Пометка в games.json

После прогона (из папки `steam archiving scripts`):
```
python mark_archived.py windows\results\20260218_120000\installed.txt --hdd ARCHIVE4
```
Записывает `archivePath: /mnt/ARCHIVE4/steam/{appId}` — путь Linux-вида,
буквы дисков Windows в `games.json` не попадают.

## 9. Если зависло

```
python kill_stuck.py
```

Или через диспетчер задач: убейте процесс `DepotDownloader.exe`.

## Почему Windows?

Linux имеет проблемы с копированием на USB HDD: ядро накапливает данные
в dirty page cache (до 10% RAM = 6.4GB при 64GB), а потом пытается
сбросить всё разом — USB контроллер не справляется и зависает.

Windows обрабатывает USB HDD (NTFS) стабильнее благодаря другой модели
буферизации I/O и robocopy с многопоточным копированием.
