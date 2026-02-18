# 🎮 БЫСТРЫЙ СТАРТ - Архивирование игр Steam

## 📦 Что у вас есть:

1. **install_games.sh** - главный установщик (использует DepotDownloader)
2. **extract_appids.py** - извлечение AppID из существующих игр
3. **view_games.sh** - просмотр установленных игр
4. **kill_stuck.sh** - убийство зависших процессов
5. **install_games_steamcmd.sh** - старая версия на SteamCMD (не рекомендуется)

---

## 🔧 ПОЧЕМУ DEPOTDOWNLOADER:

SteamCMD постоянно зависает при пакетном скачивании — подхватывает
чужие обновления из библиотеки, застревает на случайных играх,
крашится с segfault на внешних дисках.

**DepotDownloader** (https://github.com/SteamRE/DepotDownloader):
- ✅ Не зависает — нет проблем с очередью обновлений
- ✅ 64-bit нативный — не нужны 32-bit библиотеки
- ✅ Показывает прогресс скачивания
- ✅ Запоминает авторизацию (`-remember-password`)
- ✅ 3000+ звёзд на GitHub, активно поддерживается
- ✅ Работает на Linux, macOS, Windows

---

## 🔧 УСТАНОВКА DEPOTDOWNLOADER (ОДИН РАЗ):

```bash
# 1. Скачать и распаковать
mkdir -p ~/depotdownloader && cd ~/depotdownloader
curl -sqL https://github.com/SteamRE/DepotDownloader/releases/download/DepotDownloader_3.4.0/DepotDownloader-linux-x64.zip -o dd.zip
unzip dd.zip && chmod +x DepotDownloader && rm dd.zip

# 2. Проверить
./DepotDownloader --version
```

**Готово!** DepotDownloader установлен в `~/depotdownloader/DepotDownloader`.

---

## 🚀 УСТАНОВКА ИГР (3 шага):

### Шаг 0: Настройка постоянного монтирования HDD (ОДИН РАЗ)

```bash
# 1. Узнать UUID вашего внешнего HDD
lsblk -o NAME,UUID,SIZE,MOUNTPOINT | grep sdb1

# 2. Создать точку монтирования
sudo mkdir -p /mnt/ARCHIVE1

# 3. Размонтировать текущее
sudo umount /media/repeater/ARCHIVE11

# 4. Добавить в /etc/fstab (замените YOUR_UUID!)
echo "UUID=YOUR_UUID /mnt/ARCHIVE1 auto defaults,nofail 0 0" | sudo tee -a /etc/fstab

# 5. Смонтировать и дать права
sudo mount -a
sudo chown -R $USER:$USER /mnt/ARCHIVE1
```

### Шаг 1: Создайте список игр

```bash
nano my_games.txt
```
Введите AppID (по одному на строку):
```
730
440
570
```

Или извлеките из существующих:
```bash
python3 extract_appids.py ~/.steam/steam/steamapps
```

### Шаг 2: Запустите установку

```bash
./install_games.sh my_games.txt /mnt/ARCHIVE1/steam
```

Скрипт попросит логин Steam и авторизацию через мобильное приложение (один раз).

**ВСЁ!** Скрипт скачает все игры автоматически.

---

## ⚙️ КАК ЭТО РАБОТАЕТ:

```
Скрипт делает (для каждой игры):
├─ 1. DepotDownloader скачивает в ~/steam_downloads/APPID
├─ 2. rsync копирует на HDD: /mnt/ARCHIVE1/steam/APPID
├─ 3. Верифицирует копирование (сравнивает размеры)
├─ 4. Удаляет локальную копию + чистит кэш .steam
└─ Повторяет для следующей игры

Результаты сохраняются в: results/TIMESTAMP/
├─ install.log       — полный лог
├─ installed.txt     — AppID успешных (формат как my_games.txt)
└─ failed.txt        — AppID неудачных

✓ Авторизация один раз, запоминается
✓ Не зависает (DepotDownloader стабильнее SteamCMD)
✓ Автофоллбэк: linux → windows, russian → english
✓ Чанки скачиваются с автоматическим ретраем
✓ Ctrl+C безопасно прерывает и чистит за собой
```

> **Почему не напрямую на HDD?** Скачивание на основной диск и копирование
> надёжнее чем прямая запись на внешний USB HDD.

---

## 📊 ПРОСМОТР РЕЗУЛЬТАТОВ:

```bash
# Посмотреть результаты последнего запуска
ls results/

# Успешно скачанные AppID (можно использовать как входной файл)
cat results/*/installed.txt

# Не скачанные AppID (можно перезапустить для них)
cat results/*/failed.txt

# Перезапустить для неудачных
./install_games.sh results/20260218_041500/failed.txt /mnt/ARCHIVE1/steam

# Посмотреть что на HDD
./view_games.sh
du -sh /mnt/ARCHIVE1/steam/*
```

---

## 🆘 ПРОБЛЕМЫ:

### DepotDownloader не запускается

```bash
# Проверьте что файл исполняемый
chmod +x ~/depotdownloader/DepotDownloader

# Проверьте версию
~/depotdownloader/DepotDownloader --version
```

### Ошибка авторизации

```bash
# Запустите с ручной авторизацией
~/depotdownloader/DepotDownloader -app 730 -username ВАШ_ЛОГИН -remember-password
# Подтвердите в мобильном приложении Steam
```

### Процесс завис

```bash
./kill_stuck.sh
./install_games.sh my_games.txt /mnt/ARCHIVE1/steam
```

---

## ⚙️ НАСТРОЙКИ:

Откройте `install_games.sh` в начале файла:

```bash
GAME_LANG="russian"                          # Язык контента
GAME_OS="linux"                              # Платформа (linux, windows, macos)
LOCAL_DOWNLOAD_DIR="$HOME/steam_downloads"   # Куда скачивать
```

---

## ✅ ЧЕКЛИСТ ПЕРЕД ЗАПУСКОМ:

- [ ] DepotDownloader установлен (см. раздел установки выше)
- [ ] HDD подключен и смонтирован
- [ ] Достаточно места на основном диске (~15+ ГБ)
- [ ] Есть список игр (файл .txt с AppID)
- [ ] Скрипты исполняемые (`chmod +x *.sh`)
- [ ] Интернет работает
- [ ] Знаете логин Steam
- [ ] Можете подтвердить вход в мобильном приложении

---

## 🎯 ОДНА КОМАНДА:

```bash
./install_games.sh my_games.txt /mnt/ARCHIVE1/steam
```

**Готово!** 🚀
