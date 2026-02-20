# Steam Library Archiver — Windows Setup

Быстрая настройка архивации Steam-библиотеки на Windows.

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
python install_games.py ..\my_games.txt D:\steam
```

Параметры:
- 1-й аргумент: путь к файлу с AppID
- 2-й аргумент: путь на HDD (по умолчанию `D:\steam`)
- `--dd`: путь к DepotDownloader если не в стандартном месте

Примеры:
```
python install_games.py ..\my_games.txt
python install_games.py ..\my_games.txt "E:\Archive\steam"
python install_games.py ..\my_games.txt D:\steam --dd "C:\tools\DepotDownloader.exe"
```

## 6. Что происходит

Для каждой игры:
1. **Скачивание** в `D:\steam_downloads\{appId}`
2. **Копирование** на HDD через robocopy (стабильнее shutil/xcopy для NTFS)
3. **Верификация** — сравнение размеров
4. **Удаление** локальной копии

### Фоллбэк по платформе/языку

Если игра недоступна для текущей ОС/языка:
1. russian / linux
2. russian / windows
3. english / linux
4. english / windows
5. все платформы / без языкового фильтра

## 7. Результаты

После завершения в папке `results/YYYYMMDD_HHMMSS/`:
- `install.log` — полный лог
- `installed.txt` — успешно скачанные AppID
- `failed.txt` — не скачанные AppID (можно использовать как вход для повторной попытки)
- `warnings.txt` — подозрительно маленькие игры

Повтор неудачных:
```
python install_games.py results\20260218_120000\failed.txt D:\steam
```

## 8. Если зависло

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
