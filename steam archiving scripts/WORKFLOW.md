# 🪟 Рабочий процесс: архивация Steam с Windows

Полный цикл «скачать игры → пометить в games.json → синхронизировать репозиторий».
Скачивание и правка `games.json` делаются **на Windows**, проверки дисков — на Linux.

- Установка инструментов и описание флагов: [windows/QUICKSTART.md](windows/QUICKSTART.md)
- Linux-вариант скачивания (не используется, оставлен как запасной): [QUICKSTART.md](QUICKSTART.md)

---

## 📌 Базовые правила

1. **Скачивание — только на Windows.** Linux зависает при копировании больших
   объёмов на USB HDD (dirty page cache), Windows + robocopy — нет. Подробности
   в конце [windows/QUICKSTART.md](windows/QUICKSTART.md).
2. **Приоритет платформы контента — `linux`**, даже когда скачивание идёт с Windows:
   архив рассчитан на воспроизведение с Linux-машины. `install_games.py` использует
   `--platform linux` по умолчанию, порядок фоллбэка:
   `russian/linux → english/linux → russian/windows → english/windows → все платформы`.
   Обратный порядок — `--platform windows`, интерактивный вопрос — `--ask-platform`.
3. **Репозиторий склонирован и на Linux, и на Windows.** Скрипты переносятся через
   `git`, а не через `steam archiving scripts.zip` — зип быстро устаревает.
4. **Путь в `games.json` всегда Linux-вида:** `/mnt/ARCHIVEn/steam/{appId}`.
   `mark_archived.py` собирает эту строку сам, поэтому запускать его с Windows
   безопасно — буквы дисков в JSON не попадают.

---

## 💽 Диски

| Диск | Метка | Точка монтирования (Linux) | Буква (Windows) | Назначение |
|------|-------|---------------------------|-----------------|------------|
| ARCHIVE1 | ARCHIVE1 | `/mnt/ARCHIVE1` | своя | заполнен |
| ARCHIVE2 | ARCHIVE2 | `/mnt/ARCHIVE2` | своя | заполнен |
| ARCHIVE3 | ARCHIVE3 | `/mnt/ARCHIVE3` | своя | заполнен |
| ARCHIVE4 | ARCHIVE4 | `/mnt/ARCHIVE4` | своя | **целевой для новых прогонов** |

Буквы дисков в Windows не фиксированы — смотрите в Проводнике по метке тома
(`ARCHIVE4`) перед каждым прогоном. Все диски NTFS, все прописаны в `/etc/fstab`
на Linux с `nofail`.

Структура на диске: `<диск>/steam/{appId}/…` (rawg-игры — в `<диск>/rawg/`).

---

## 🚀 Прогон

### 1. Подготовить список AppID

Батчи лежат в [batches/](batches/), формат — комментарий с названием + AppID:

```
#Yakuza 0 - too big
638970
```

Собрать список ещё не заархивированных игр (на Linux, где лежат актуальные данные):

```bash
python3 data/games/unarchived_games.py          # → batches/unarchived.txt
python3 data/games/unarchived_games.py --stdout # просто посмотреть
```

Скрипт пропускает всё, что перечислено в [batches/excluded.txt](batches/excluded.txt).

### 2. Подключить HDD и узнать букву

Буфер (`--buffer`, по умолчанию `D:\steam_downloads`) и HDD **обязаны быть на разных
дисках** — иначе скрипт откажется стартовать. На буфере нужно место под самую
большую игру батча.

### 3. Запустить скачивание

```
cd "<репозиторий>\steam archiving scripts\windows"
python install_games.py ..\batches\new_batch.txt E:\steam
```

`E:\steam` замените на букву ARCHIVE4. Полезные флаги:

```
--buffer D:\steam_downloads   папка-буфер (по умолчанию D:\steam_downloads)
--platform windows            приоритет windows-сборок вместо linux
--ask-platform                спросить приоритет интерактивно
--dd C:\tools\DepotDownloader.exe   если DepotDownloader не в %USERPROFILE%\depotdownloader\
```

Скрипт спросит логин Steam и один раз попросит подтвердить вход в мобильном
приложении (дальше пароль запоминается через `-remember-password`).

Для каждой игры: скачать в буфер → robocopy на HDD → сверить размеры → удалить
локальную копию.

### 4. Разобрать результаты

Результаты пишутся в `results\ГГГГММДД_ЧЧММСС\` **относительно текущей папки**
(то есть внутри `windows\`, если запускали оттуда):

| Файл | Что внутри |
|------|-----------|
| `install.log` | полный лог |
| `installed.txt` | AppID успешных — вход для `mark_archived.py` |
| `failed.txt` | AppID неудачных — вход для повторного прогона |
| `warnings.txt` | подозрительно маленькие игры (< 1 МБ) — проверить руками |

Повтор неудачных:

```
python install_games.py results\20260820_120000\failed.txt E:\steam
```

Если процесс завис — `python kill_stuck.py` и перезапуск с `failed.txt`.

### 5. Пометить игры в games.json

```
cd "<репозиторий>\steam archiving scripts"
python mark_archived.py windows\results\20260820_120000\installed.txt --hdd ARCHIVE4
```

Проставляет `isArchived: true` и `archivePath: /mnt/ARCHIVE4/steam/{appId}` в
[../data/games/games.json](../data/games/games.json). Не найденные AppID выводятся
списком в конце — их надо разобрать руками (обычно это rawg/gog/epic-игры,
для них отдельный скрипт `rawg archiving scripts/mark_archived.py`).

### 6. Прибраться в списках

- Скачанные игры удалить из [batches/excluded.txt](batches/excluded.txt), если они
  там были (например, все 11 игр из `new_batch.txt` числятся там как «too big»).
  Иначе `unarchived_games.py` продолжит считать их исключёнными.
- Перегенерировать `batches/unarchived.txt`.

### 7. Синхронизировать репозиторий

```
git add data/games/games.json "steam archiving scripts/batches"
git commit -m "archived <батч> on ARCHIVE4"
git push
```

На Linux — `git pull`. Папки `results/` и `depots/` в репозиторий не коммитим.

---

## 🔍 Проверки (на Linux, со всеми подключёнными дисками)

```bash
cd data/games
python3 check_archive_paths.py    # все archivePath существуют? чинит переехавшие
python3 find_duplicates.py        # одна игра на нескольких дисках
python3 filter.py <батч>          # выкинуть из батча то, что уже на дисках
python3 find_paths.py <батч>      # показать, где лежит каждая игра батча
```

`check_archive_paths.py` **отказывается стартовать, если не все архивные диски
примонтированы** — иначе он посчитал бы игры отключённого диска потерянными и
переписал бы верные пути. Флаг `--force` — только когда диск выведен из
эксплуатации осознанно.

Эти четыре скрипта по умолчанию ходят в `/mnt/ARCHIVE1..4`. На Windows задайте
корни дисков через переменную окружения:

```
set ARCHIVE_MOUNTS=E:\;F:\
```

`check_archive_paths.py` при этом всё равно бесполезен на Windows: он сверяет
Linux-пути из `games.json`.

---

## ✅ Чеклист перед прогоном

- [ ] `git pull` на Windows — скрипты и `games.json` свежие
- [ ] HDD подключён, буква известна, места хватает
- [ ] Буфер на **другом** диске, места хватает под самую большую игру батча
- [ ] `%USERPROFILE%\depotdownloader\DepotDownloader.exe` на месте
- [ ] Батч-файл подготовлен, дубли отфильтрованы
- [ ] Мобильное приложение Steam под рукой для подтверждения входа
