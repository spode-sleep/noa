# 🎮 БЫСТРЫЙ СТАРТ - Установка игр Steam

## 📦 Что у вас есть:

1. **install_games.sh** - главный установщик (ИСПОЛЬЗУЙТЕ ЕГО!)
2. **extract_appids.py** - извлечение AppID из существующих игр
3. **view_games.sh** - просмотр установленных игр
4. **kill_stuck.sh** - убийство зависших процессов

---

## 🚀 УСТАНОВКА ИГР (3 шага):

### Шаг 1: Создайте список игр

**Вариант А - вручную:**
```bash
nano my_games.txt
```
Введите AppID (по одному на строку):
```
730
440
570
```

**Вариант Б - извлечь из существующих:**
```bash
python3 extract_appids.py ~/.steam/steam/steamapps
# Создаст файл extracted_appids.txt
```

### Шаг 2: Запустите установку

```bash
./install_games.sh my_games.txt
```

### Шаг 3: Введите данные Steam

```
Логин: ваш_логин
Пароль: ваш_пароль
Steam Guard код: (если попросит)
```

**ВСЁ!** Скрипт установит все игры автоматически.

---

## ⚙️ КАК ЭТО РАБОТАЕТ:

```
У вас есть: 99 игр

Скрипт делает:
├─ Делит на батчи по 3 игры
├─ Батч 1: логин → игры 1-3 → пауза 30с
├─ Батч 2: игры 4-6 → пауза 30с
├─ Батч 3: игры 7-9 → пауза 30с
└─ ...

Результат:
✓ Только ОДИН Steam Guard запрос!
✓ Игры в: /media/repeater/ARCHIVE1/steam/game_XXXXX
✓ Список установленных: installed_TIMESTAMP.txt
```

---

## 📊 ПРОСМОТР РЕЗУЛЬТАТОВ:

```bash
# Посмотреть что установлено
./view_games.sh

# Проверить директорию
ls /media/repeater/ARCHIVE1/steam/

# Проверить размер
du -sh /media/repeater/ARCHIVE1/steam/game_*
```

---

## 🆘 ПРОБЛЕМЫ:

### Segmentation Fault

Если видите `Segmentation fault (core dumped)`:

```bash
# 1. Обновите SteamCMD
cd ~/steamcmd
./steamcmd.sh +quit

# 2. Установите 32-bit библиотеки
sudo dpkg --add-architecture i386
sudo apt update
sudo apt install lib32gcc-s1 lib32stdc++6

# 3. Перезапустите установку
./install_games.sh my_games.txt
```

**Примечание:** Скрипт уже НЕ использует `validate` чтобы избежать крашей.

### Процесс завис

```bash
# Убить зависшие процессы
./kill_stuck.sh

# Удалить частично установленные игры (скрипт предложит)

# Запустить установку заново
./install_games.sh my_games.txt
```

### Нет папок с играми

**Причины:**
1. **Segmentation fault** - SteamCMD крашится до завершения загрузки
2. **Частичная загрузка** - файлы скачиваются, но процесс прерывается

**Решение:**
```bash
# Проверьте что действительно есть файлы
ls -lah /media/repeater/ARCHIVE1/steam/game_*/

# Проверьте размеры (должны быть сотни MB - десятки GB)
du -sh /media/repeater/ARCHIVE1/steam/game_*

# Если папки пустые или очень маленькие - удалите их
rm -rf /media/repeater/ARCHIVE1/steam/game_*

# Обновите SteamCMD и перезапустите
cd ~/steamcmd
./steamcmd.sh +quit
cd ~/steam-installer
./install_games.sh my_games.txt
```

### Игры показываются как установленные, но их нет

```bash
# Проверьте лог
cat install_*.log | tail -50

# Проверьте ошибки авторизации
grep -i "logged in\|error\|fail" install_*.log

# Проверьте где на самом деле установились игры
find /media -name "game_*" -type d 2>/dev/null
```

### Steam Guard не работает

```bash
# Сначала авторизуйтесь вручную
~/steamcmd/steamcmd.sh

# В консоли SteamCMD:
Steam> login ваш_логин
Password: (пароль)
Steam Guard: (код)
# Дождитесь "Logged in OK"
Steam> quit

# Теперь запускайте установку
./install_games.sh my_games.txt
```

---

## ⚙️ НАСТРОЙКИ:

Откройте `install_games.sh` в начале файла:

```bash
BATCH_SIZE=3                      # Игр в батче (1-10)
PAUSE_BETWEEN_BATCHES=30          # Пауза между батчами (секунды)
GAME_LANGUAGE="russian"           # Язык (english, german, и т.д.)
INSTALL_DIR="/media/repeater/ARCHIVE1/steam"  # Куда ставить
```

---

## 📝 ПРИМЕРЫ:

### Установить 5 бесплатных игр для теста

```bash
# Создать список
cat > test.txt << EOF
730
440
570
4000
413150
EOF

# Установить
./install_games.sh test.txt
```

### Скопировать игры с другого диска

```bash
# Извлечь AppID
python3 extract_appids.py /media/old_disk/steamapps -o old_games.txt

# Установить на новый диск
./install_games.sh old_games.txt
```

### Установить одну игру

```bash
echo "730" > one_game.txt
./install_games.sh one_game.txt
```

---

## ✅ ЧЕКЛИСТ ПЕРЕД ЗАПУСКОМ:

- [ ] SteamCMD установлен и обновлен (`cd ~/steamcmd && ./steamcmd.sh +quit`)
- [ ] 32-bit библиотеки установлены (`sudo apt install lib32gcc-s1 lib32stdc++6`)
- [ ] Диск подключен (`/media/repeater/ARCHIVE1` доступен)
- [ ] Есть список игр (файл .txt с AppID)
- [ ] Скрипты исполняемые (`chmod +x *.sh`)
- [ ] Интернет работает
- [ ] Знаете логин и пароль Steam
- [ ] Можете подтвердить вход в мобильном приложении

---

## ⚙️ ЧТО ИСПРАВЛЕНО В ПОСЛЕДНЕЙ ВЕРСИИ:

✅ **force_install_dir ДО login** - правильный порядок команд
✅ **Убран validate** - предотвращает segmentation fault на внешних дисках
✅ **Одна сессия SteamCMD** - без повторных Steam Guard запросов
✅ **Проверка реальных файлов** - не только папок, но и содержимого

---

## 🎯 ОДНА КОМАНДА ДЛЯ ВСЕГО:

```bash
./install_games.sh my_games.txt
```

**Готово!** 🚀
