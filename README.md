# Lead Scraper Bot (@LanaAIParser_bot)

Telegram бот для автоматического сбора контактов компаний с веб-сайтов.

## Возможности

- 🔍 Поиск компаний через Yandex Search API
- 📧 Сбор email адресов
- 📞 Извлечение телефонов
- ✈️ Поиск Telegram аккаунтов
- 💰 Система оплаты через YooKassa
- 📊 Экспорт результатов в Excel

## Технологии

- Node.js 18+
- Telegraf (Telegram Bot Framework)
- PostgreSQL (база данных)
- Yandex Search API
- YooKassa (платежи)

## Установка

1. Клонировать репозиторий:
```bash
git clone https://github.com/n0v1chek/pars_bot.git
cd pars_bot
```

2. Установить зависимости:
```bash
npm install
```

3. Создать файл `.env`:
```env
BOT_TOKEN=your_telegram_bot_token
YOOKASSA_SHOP_ID=your_shop_id
YOOKASSA_SECRET=your_secret_key
ADMIN_ID=your_telegram_id
WEBHOOK_URL=https://your-domain.com
PORT=3002

# PostgreSQL
PGHOST=localhost
PGPORT=5432
PGUSER=your_db_user
PGPASSWORD=your_db_password
PGDATABASE=your_db_name

# Yandex Search API
YANDEX_API_KEY=your_yandex_api_key
YANDEX_FOLDER_ID=your_yandex_folder_id
```

4. Запустить:
```bash
npm start
# или с PM2
pm2 start bot.js --name lead-scraper-bot
```

## Структура проекта

- `bot.js` - основной файл бота
- `enhanced-parser-v2.js` - парсер веб-сайтов
- `search-engines-v2.js` - интеграция с поисковыми системами
- `yandex-search.js` - Yandex Search API

## Функционал

### Защита от зависаний
- Таймаут 30 секунд на каждый сайт
- Автоматический пропуск проблемных сайтов

### Подсчёт ошибок
- Статистика успешных/неудачных запросов
- Уведомления админу при множественных ошибках

### Постоянное меню
- Всегда доступно внизу экрана
- Защита от двойных запросов

## Лицензия

MIT
