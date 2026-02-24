# Lead Scraper Bot

Telegram bot for automated lead generation. Searches for companies by keyword using Yandex Search API, then scrapes their websites for contact information: emails, phone numbers, and Telegram accounts. Results are exported to Excel.

## Features

- Company search via Yandex Search API
- Email, phone, and Telegram contact extraction from websites
- 30-second timeout per site with automatic skip on failure
- Success/failure stats per scraping session
- Excel export of collected leads
- Subscription-based access with payment processing
- Admin notifications on errors
- Persistent bottom menu in Telegram

## Tech stack

- **Node.js 18+** with Telegraf
- **PostgreSQL** for data storage
- **Yandex Search API** for company discovery
- **YooKassa** for payments

## Project structure

```
├── bot.js                  # Bot entry point
├── enhanced-parser-v2.js   # Website scraper
├── search-engines-v2.js    # Search engine integration
└── yandex-search.js        # Yandex Search API client
```

## Setup

```bash
npm install
cp .env.example .env
# Fill in your credentials (see below)
npm start
```

## Environment variables

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

## License

MIT
