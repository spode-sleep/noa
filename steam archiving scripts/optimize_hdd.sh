#!/bin/bash

# Скрипт для оптимизации внешнего HDD перед установкой игр
# Помогает предотвратить зависания SteamCMD

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

if [ $# -lt 1 ]; then
    echo "Использование: $0 <путь_к_HDD>"
    echo "Пример: $0 /mnt/hdd"
    exit 1
fi

HDD_PATH="$1"

if [ ! -d "$HDD_PATH" ]; then
    log_error "Директория $HDD_PATH не существует"
    exit 1
fi

echo "======================================"
log_info "Оптимизация HDD для работы со SteamCMD"
log_info "Целевая директория: $HDD_PATH"
echo "======================================"
echo ""

# 1. Проверка свободного места
log_info "Проверка свободного места..."
FREE_SPACE=$(df -BG "$HDD_PATH" | awk 'NR==2 {print $4}' | sed 's/G//')
log_info "Свободно: ${FREE_SPACE}GB"

if [ "$FREE_SPACE" -lt 50 ]; then
    log_warning "Мало свободного места (< 50GB). Некоторые игры могут не установиться."
fi
echo ""

# 2. Определение устройства
DEVICE=$(df "$HDD_PATH" | awk 'NR==2 {print $1}')
BASE_DEVICE=$(echo "$DEVICE" | sed 's/[0-9]*$//')
log_info "Устройство: $DEVICE (базовое: $BASE_DEVICE)"
echo ""

# 3. Проверка опций монтирования
log_info "Текущие опции монтирования:"
mount | grep "$DEVICE"
echo ""

# 4. Рекомендации по ремонтированию
log_warning "РЕКОМЕНДУЕТСЯ: Размонтировать и перемонтировать HDD с оптимальными параметрами"
echo ""
echo "Для оптимальной работы выполните:"
echo ""
echo "sudo umount $HDD_PATH"
echo "sudo mount -o noatime,nodiratime,async $DEVICE $HDD_PATH"
echo ""
log_info "Опции монтирования:"
echo "  noatime     - не обновлять время доступа к файлам (быстрее)"
echo "  nodiratime  - не обновлять время доступа к директориям"
echo "  async       - асинхронная запись (быстрее, но менее безопасно)"
echo ""

# 5. Проверка скорости записи
log_info "Тест скорости записи (может занять 10-20 сек)..."
TEST_FILE="$HDD_PATH/.speed_test_$$"
WRITE_SPEED=$(dd if=/dev/zero of="$TEST_FILE" bs=1M count=100 oflag=direct 2>&1 | grep -oP '\d+\.?\d* MB/s' | tail -1)
rm -f "$TEST_FILE"
log_info "Скорость записи: $WRITE_SPEED"

if [[ "$WRITE_SPEED" =~ ^([0-9]+) ]]; then
    SPEED_NUM="${BASH_REMATCH[1]}"
    if [ "$SPEED_NUM" -lt 20 ]; then
        log_warning "Медленная скорость записи (< 20 MB/s). Установка будет долгой."
        log_warning "Проверьте: USB 3.0 подключение, состояние диска, загрузку системы"
    fi
fi
echo ""

# 6. Настройка параметров ядра для улучшения производительности
log_info "Рекомендуемые настройки sysctl для HDD:"
echo ""
echo "# Временно (до перезагрузки):"
echo "sudo sysctl -w vm.dirty_ratio=10"
echo "sudo sysctl -w vm.dirty_background_ratio=5"
echo "sudo sysctl -w vm.dirty_expire_centisecs=1000"
echo "sudo sysctl -w vm.dirty_writeback_centisecs=500"
echo ""
echo "# Постоянно (добавить в /etc/sysctl.conf):"
echo "vm.dirty_ratio = 10"
echo "vm.dirty_background_ratio = 5"
echo "vm.dirty_expire_centisecs = 1000"
echo "vm.dirty_writeback_centisecs = 500"
echo ""

# 7. Проверка USB устройства (если применимо)
if [[ "$BASE_DEVICE" =~ sd[a-z]$ ]]; then
    log_info "Проверка USB подключения..."
    
    # Проверка через lsusb
    if command -v lsusb &> /dev/null; then
        USB_INFO=$(lsusb -t 2>/dev/null | grep -A 2 "Driver=usb-storage" | head -3)
        if [ -n "$USB_INFO" ]; then
            log_info "USB устройство обнаружено"
            echo "$USB_INFO"
            
            if echo "$USB_INFO" | grep -q "5000M"; then
                log_info "✓ USB 3.0 подключение обнаружено (оптимально)"
            elif echo "$USB_INFO" | grep -q "480M"; then
                log_warning "USB 2.0 подключение (медленно!)"
                log_warning "Переподключите к USB 3.0 порту для лучшей производительности"
            fi
        fi
    fi
fi
echo ""

# 8. Создание тестовой директории
TEST_DIR="$HDD_PATH/.steamcmd_test"
mkdir -p "$TEST_DIR"
if [ $? -eq 0 ]; then
    log_info "✓ Тест записи директорий успешен"
    rmdir "$TEST_DIR"
else
    log_error "✗ Ошибка создания директорий"
fi
echo ""

# 9. Проверка фрагментации (для ext4)
FS_TYPE=$(df -T "$HDD_PATH" | awk 'NR==2 {print $2}')
log_info "Файловая система: $FS_TYPE"

if [ "$FS_TYPE" = "ext4" ]; then
    log_info "Проверка фрагментации ext4..."
    if command -v e4defrag &> /dev/null; then
        sudo e4defrag -c "$DEVICE" 2>/dev/null | head -5
    else
        log_warning "e4defrag не установлен (sudo apt install e2fsprogs)"
    fi
fi
echo ""

# 10. Итоговые рекомендации
echo "======================================"
log_info "РЕКОМЕНДАЦИИ ДЛЯ УСТАНОВКИ:"
echo "======================================"
echo ""
echo "1. Перемонтируйте диск с опциями noatime,async (команды выше)"
echo "2. Закройте тяжелые приложения для снижения нагрузки на систему"
echo "3. Используйте таймаут в скрипте не менее 2-4 часов для больших игр"
echo "4. Устанавливайте игры небольшими пакетами (5-10 игр за раз)"
echo "5. Если есть возможность, подключите HDD к USB 3.0 порту"
echo "6. Периодически проверяйте свободное место: df -h $HDD_PATH"
echo ""

# 11. Автоматическое применение настроек (опционально)
read -p "Применить рекомендуемые настройки sysctl автоматически? (y/n): " APPLY
if [ "$APPLY" = "y" ] || [ "$APPLY" = "Y" ]; then
    log_info "Применение настроек..."
    sudo sysctl -w vm.dirty_ratio=10 2>/dev/null
    sudo sysctl -w vm.dirty_background_ratio=5 2>/dev/null
    sudo sysctl -w vm.dirty_expire_centisecs=1000 2>/dev/null
    sudo sysctl -w vm.dirty_writeback_centisecs=500 2>/dev/null
    log_info "✓ Настройки применены (до перезагрузки)"
    echo ""
    log_warning "Для постоянного применения добавьте их в /etc/sysctl.conf"
fi

echo ""
log_info "Оптимизация завершена!"
