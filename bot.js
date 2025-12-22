require("dotenv").config();
const { Telegraf, Markup } = require('telegraf');
const { Pool } = require('pg');
const axios = require('axios');
const ExcelJS = require('exceljs');
const { searchAllEngines } = require('./search-engines-v2');
const { scrapeWebsiteFull, createExcelFile } = require('./enhanced-parser-v2');

const BOT_TOKEN = process.env.BOT_TOKEN;
const YOOKASSA_SHOP_ID = process.env.YOOKASSA_SHOP_ID;
const YOOKASSA_SECRET = process.env.YOOKASSA_SECRET;
const ADMIN_ID = parseInt(process.env.ADMIN_ID);
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const PORT = process.env.PORT || 3002;

const bot = new Telegraf(BOT_TOKEN, { handlerTimeout: 7200000 }); // 2 часа (для больших запросов)

// Timeout wrapper для предотвращения зависаний
function withTimeout(promise, timeoutMs = 30000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Operation timeout')), timeoutMs)
    )
  ]);
}

// PostgreSQL
const pool = new Pool({
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE
});

// Инициализация БД
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lead_users (
      telegram_id BIGINT PRIMARY KEY,
      username TEXT,
      balance INT DEFAULT 5,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lead_payments (
      id SERIAL PRIMARY KEY,
      telegram_id BIGINT,
      amount INT,
      sites_count INT,
      payment_id TEXT,
      status TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lead_usage (
      id SERIAL PRIMARY KEY,
      telegram_id BIGINT,
      sites_count INT,
      emails_found INT,
      phones_found INT,
      telegram_found INT,
      search_query TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  
  console.log('DB ready');
}

initDB();

// Пакеты
const PACKAGES = {
  pack_50: { sites: 50, price: 100 },
  pack_200: { sites: 200, price: 300 },
  pack_500: { sites: 500, price: 1000 },
  pack_1000: { sites: 1000, price: 2000 }
};

// User state
const userStates = {};

// Главное меню
function mainMenu() {
  return Markup.keyboard([
    ['🔍 Найти компании'],
    ['💰 Купить доступ', '📊 Мой баланс']
  ]).resize();
}

bot.start(async (ctx) => {
  const userId = ctx.from.id;
  
  await pool.query(
    `INSERT INTO lead_users (telegram_id, username, balance) VALUES ($1, $2, 0) ON CONFLICT DO NOTHING`,
    [userId, ctx.from.username]
  );
  
  await ctx.reply(
    `🤖 <b>Автоматический сбор контактов компаний</b>\n\n` +
    `Я помогу тебе быстро найти потенциальных клиентов для твоего бизнеса.\n\n` +
    `<b>Как это работает:</b>\n` +
    `1️⃣ Введи поисковый запрос (например: "натяжные потолки москва")\n` +
    `2️⃣ Я найду сотни компаний через Yandex\n` +
    `3️⃣ Соберу с их сайтов:\n` +
    `   • Email адреса\n` +
    `   • Телефоны\n` +
    `   • Telegram аккаунты\n` +
    `   • Названия и адреса компаний\n` +
    `4️⃣ Отправлю тебе готовый Excel файл\n\n` +
    `<b>Кому подойдёт:</b>\n` +
    `✅ B2B продажи и холодные звонки\n` +
    `✅ Email и SMS рассылки\n` +
    `✅ Поиск партнёров и поставщиков\n` +
    `✅ Анализ конкурентов\n\n` +
    `💰 <b>Тарифы:</b>\n` +
    `🟢 Мини: 50 сайтов - 100₽\n` +
    `🔵 Стандарт: 200 сайтов - 300₽\n` +
    `🟡 Бизнес: 500 сайтов - 1000₽\n` +
    `🔴 Про: 1000 сайтов - 2000₽\n\n` +
    `Нажми "💰 Купить доступ" для начала работы`,
    { parse_mode: 'HTML', ...mainMenu() }
  );
});

bot.hears('🔍 Найти компании', (ctx) => {
  const state = userStates[ctx.from.id];

  // Проверка: идёт ли обработка запроса
  if (state?.processing) {
    return ctx.reply(
      '⏳ <b>Запрос обрабатывается</b>\n\nПожалуйста, дождись завершения текущего запроса.',
      { parse_mode: 'HTML', ...mainMenu() }
    );
  }

  userStates[ctx.from.id] = { mode: 'search' };
  ctx.reply(
    `🔍 <b>Поиск компаний</b>\n\n` +
    `Введи запрос и я найду контакты компаний.\n\n` +
    `<b>Примеры запросов:</b>\n` +
    `• натяжные потолки москва\n` +
    `• мебельные компании спб\n` +
    `• стоматология казань\n` +
    `• ремонт квартир екатеринбург\n` +
    `• доставка продуктов новосибирск\n\n` +
    `💡 <i>Чем точнее запрос - тем лучше результат</i>`,
    { parse_mode: 'HTML', ...mainMenu() }
  );
});

// 💰 Купить доступ
bot.hears('💰 Купить доступ', (ctx) => {
  ctx.reply(
    `💰 <b>Пополнение баланса</b>\n\n` +
    `Выбери пакет для продолжения работы:`,
    {
      parse_mode: 'HTML',
      ...mainMenu(),
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🟢 Мини: 50 сайтов - 100₽', 'buy_pack_50')],
        [Markup.button.callback('🔵 Стандарт: 200 сайтов - 300₽', 'buy_pack_200')],
        [Markup.button.callback('🟡 Бизнес: 500 сайтов - 1000₽', 'buy_pack_500')],
        [Markup.button.callback('🔴 Про: 1000 сайтов - 2000₽', 'buy_pack_1000')]
      ])
    }
  );
});

// 📊 Мой баланс
bot.hears('📊 Мой баланс', async (ctx) => {
  const { rows } = await pool.query(
    `SELECT balance FROM lead_users WHERE telegram_id = $1`,
    [ctx.from.id]
  );

  const balance = rows[0]?.balance || 0;

  ctx.reply(
    `📊 <b>Твой баланс</b>\n\n` +
    `Доступно сайтов: <b>${balance}</b>\n\n` +
    `Для пополнения нажми 💰 Купить доступ`,
    { parse_mode: 'HTML', ...mainMenu() }
  );
});

// ◀️ Назад
bot.hears('◀️ Назад', (ctx) => {
  delete userStates[ctx.from.id];
  ctx.reply('Главное меню:', mainMenu());
});

// Покупка пакета
bot.action(/buy_(.+)/, async (ctx) => {
  const pack = ctx.match[1];
  const pkg = PACKAGES[pack];
  
  if (!pkg) return ctx.answerCbQuery('Ошибка');
  
  try {
    // Создаём платёж YooKassa
    const payment = await axios.post(
      'https://api.yookassa.ru/v3/payments',
      {
        amount: { value: pkg.price.toFixed(2), currency: 'RUB' },
        confirmation: { type: 'redirect', return_url: `https://t.me/${ctx.botInfo.username}` },
        capture: true,
        description: `Пакет: ${pkg.sites} сайтов`,
        metadata: { telegram_id: ctx.from.id, package: pack }
      },
      {
        auth: { username: YOOKASSA_SHOP_ID, password: YOOKASSA_SECRET },
        headers: { 'Idempotence-Key': `${ctx.from.id}_${Date.now()}` }
      }
    );
    
    // Сохраняем в БД
    await pool.query(
      `INSERT INTO lead_payments (telegram_id, amount, sites_count, payment_id, status) VALUES ($1, $2, $3, $4, 'pending')`,
      [ctx.from.id, pkg.price, pkg.sites, payment.data.id]
    );
    
    await ctx.editMessageText(
      `💳 <b>Оплата</b>\n\n` +
      `Пакет: <b>${pkg.sites} сайтов</b>\n` +
      `Сумма: <b>${pkg.price}₽</b>\n\n` +
      `Нажми кнопку для оплаты:`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.url('💳 Оплатить', payment.data.confirmation.confirmation_url)]
        ])
      }
    );
    
    ctx.answerCbQuery();
  } catch (error) {
    console.error('Payment error:', error.response?.data || error.message);
    ctx.answerCbQuery('Ошибка создания платежа');
  }
});

// Выбор количества сайтов
bot.action(/count_(.+)/, async (ctx) => {
  const userId = ctx.from.id;
  const count = parseInt(ctx.match[1]);
  const state = userStates[userId];
  
  if (!state || !state.query) {
    return ctx.answerCbQuery('Ошибка: запрос не найден');
  }
  
  // Получаем баланс
  const { rows } = await pool.query(
    `SELECT balance FROM lead_users WHERE telegram_id = $1`,
    [userId]
  );
  const balance = rows[0]?.balance || 0;
  
  if (balance < count) {
    await ctx.editMessageText(
      `❌ <b>Недостаточно баланса</b>\n\n` +
      `Для сбора <b>${count} сайтов</b> нужно: ${count} сайтов\n` +
      `Твой баланс: <b>${balance} сайтов</b>\n\n` +
      `Пополни баланс через 💰 Купить доступ`,
      { parse_mode: 'HTML' }
    );
    return ctx.answerCbQuery();
  }
  
  ctx.answerCbQuery();

  // Устанавливаем флаг обработки
  state.processing = true;

  const query = state.query;

  // Удаляем предыдущее сообщение с кнопками выбора
  try {
    await ctx.deleteMessage();
  } catch (e) {
    // Если не удалось удалить - ничего страшного
  }

  // Отправляем новое сообщение для отслеживания прогресса
  const msg = await ctx.reply(
    `🔍 <b>Поиск компаний...</b>\n\n` +
    `Запрос: <i>${query}</i>\n` +
    `Количество: <b>${count} сайтов</b>\n\n` +
    `⏳ Ищу в Yandex...`,
    { parse_mode: 'HTML' }
  );

  console.log(`📝 Создано сообщение для прогресса: chat_id=${ctx.chat.id}, message_id=${msg.message_id}`);
  
  let urls = [];
  
  try {
    // Убрали ограничение Math.min(balance, 100) - теперь ищем столько, сколько запросили
    const results = await searchAllEngines(query, count);
    urls = results.map(r => r.url);
    
    if (urls.length === 0) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        msg.message_id,
        null,
        `❌ <b>Ничего не найдено</b>\n\n` +
        `Попробуй изменить запрос или сделать его более конкретным.`,
        { parse_mode: 'HTML' }
      );
      delete userStates[userId];
      return;
    }
    
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      msg.message_id,
      null,
      `✅ <b>Найдено: ${urls.length} компаний</b>\n\n` +
      `📊 Собираю контакты с сайтов...\n` +
      `⏳ Это займёт 1-2 минуты`,
      { parse_mode: 'HTML' }
    );
  } catch (error) {
    console.error('Search error:', error);
    await ctx.telegram.sendMessage(
      ctx.chat.id,
      `❌ <b>Ошибка поиска</b>\n\n` +
      `Попробуй ещё раз или обратись в поддержку.`,
      { parse_mode: 'HTML', ...mainMenu() }
    );
    delete userStates[userId];
    return;
  }
  
  // Парсим сайты
  const results = [];
  let emailsFound = 0;
  let phonesFound = 0;
  let telegramFound = 0;
  let errorCount = 0;
  let timeoutCount = 0;

  const sitesToProcess = urls.slice(0, Math.min(count, urls.length));
  const totalSites = sitesToProcess.length;

  for (let i = 0; i < sitesToProcess.length; i++) {
    const url = sitesToProcess[i];
    const progress = i + 1;

    try {
      // Жёсткий таймаут 30 секунд на весь процесс парсинга сайта
      const data = await withTimeout(scrapeWebsiteFull(url), 30000);
      results.push(data);

      if (data.emails.length) emailsFound += data.emails.length;
      if (data.phones.length) phonesFound += data.phones.length;
      if (data.telegram.length) telegramFound += data.telegram.length;

      // Определяем частоту обновления в зависимости от количества сайтов
      const updateInterval = totalSites <= 20 ? 1 : 5;

      // Логи прогресса
      if (progress % updateInterval === 0 || progress === totalSites) {
        console.log(`  📊 Обработано: ${progress}/${totalSites} сайтов (📧 ${emailsFound} email, 📞 ${phonesFound} телефонов)`);
      }

      // Обновление сообщения в Telegram (адаптивная частота)
      if (progress % updateInterval === 0 || progress === totalSites) {
        console.log(`  🔄 Попытка обновить сообщение: ${progress}/${totalSites}`);
        console.log(`  📝 Параметры: chat_id=${ctx.chat.id}, message_id=${msg.message_id}`);

        // Прогресс-бар
        const progressPercent = Math.round((progress / totalSites) * 100);
        const filledBlocks = Math.round(progressPercent / 10);
        const emptyBlocks = 10 - filledBlocks;
        const progressBar = '█'.repeat(filledBlocks) + '░'.repeat(emptyBlocks);

        const progressText = `📊 <b>Сбор контактов...</b>\n\n` +
            `${progressBar} <b>${progressPercent}%</b>\n\n` +
            `Обработано: <b>${progress}/${totalSites}</b> сайтов\n` +
            `📧 Email: <b>${emailsFound}</b>\n` +
            `📞 Телефоны: <b>${phonesFound}</b>\n` +
            `✈️ Telegram: <b>${telegramFound}</b>\n\n` +
            `⏳ Осталось: <b>${totalSites - progress}</b>`;

        try {
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            msg.message_id,
            null,
            progressText,
            { parse_mode: 'HTML' }
          );
          console.log(`  ✅ Сообщение успешно обновлено!`);

          // Задержка 500мс чтобы Telegram успел показать обновление
          await new Promise(r => setTimeout(r, 500));
        } catch (editError) {
          console.error(`  ⚠️ Ошибка обновления:`, editError.message);
        }
      }

    } catch (error) {
      console.error(`  ❌ Error scraping ${url}:`, error.message);

      // Подсчёт ошибок
      if (error.message === 'Operation timeout') {
        timeoutCount++;
      } else {
        errorCount++;
      }

      results.push({
        domain: new URL(url).hostname,
        url,
        status: 'error',
        companyName: '',
        address: '',
        emails: [],
        phones: [],
        telegram: []
      });

      // Уведомление админу при большом количестве ошибок
      if ((errorCount + timeoutCount) >= 5 && (errorCount + timeoutCount) % 5 === 0) {
        try {
          await ctx.telegram.sendMessage(
            ADMIN_ID,
            `⚠️ <b>Много ошибок в парсере</b>\n\n` +
            `Пользователь: ${userId}\n` +
            `Запрос: ${query}\n` +
            `Ошибок: ${errorCount + timeoutCount}/${progress}`,
            { parse_mode: 'HTML' }
          );
        } catch (e) {
          // Игнорируем ошибки отправки уведомлений
        }
      }
    }
  }
  
  // Создаём Excel
  const excelPath = `/tmp/contacts_${userId}_${Date.now()}.xlsx`;
  await createExcelFile(results, excelPath);
  
  // Списываем баланс
  await pool.query(
    `UPDATE lead_users SET balance = balance - $1 WHERE telegram_id = $2`,
    [sitesToProcess.length, userId]
  );
  
  // Статистика
  await pool.query(
    `INSERT INTO lead_usage (telegram_id, sites_count, emails_found, phones_found, telegram_found, search_query) VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, sitesToProcess.length, emailsFound, phonesFound, telegramFound, query]
  );
  
  const newBalance = balance - sitesToProcess.length;
  
  // Формируем итоговое сообщение с учётом ошибок
  let finalMessage = `✅ <b>Готово!</b>\n\n` +
    `📊 Обработано: <b>${sitesToProcess.length} сайтов</b>\n` +
    `📧 Email: <b>${emailsFound}</b>\n` +
    `📞 Телефоны: <b>${phonesFound}</b>\n` +
    `✈️ Telegram: <b>${telegramFound}</b>\n`;

  // Добавляем информацию об ошибках, если есть
  if (errorCount > 0 || timeoutCount > 0) {
    finalMessage += `\n⚠️ <b>Проблемы:</b>\n`;
    if (timeoutCount > 0) finalMessage += `  • Таймаут: ${timeoutCount} сайтов\n`;
    if (errorCount > 0) finalMessage += `  • Ошибки загрузки: ${errorCount} сайтов\n`;
  }

  finalMessage += `\n💰 Остаток баланса: <b>${newBalance} сайтов</b>`;

  await ctx.telegram.editMessageText(
    ctx.chat.id,
    msg.message_id,
    null,
    finalMessage,
    { parse_mode: 'HTML' }
  );
  
  await ctx.telegram.sendDocument(
    ctx.chat.id,
    { source: excelPath },
    {
      caption: `📎 <b>Файл с контактами готов!</b>\n\nОткрой в Excel или Google Sheets`,
      parse_mode: 'HTML',
      ...mainMenu()
    }
  );
  
  // Удаляем временный файл
  require('fs').unlinkSync(excelPath);
  
  delete userStates[userId];
});

// Обработка текста (поиск)
bot.on('text', async (ctx) => {
  const state = userStates[ctx.from.id];
  if (!state || state.mode !== 'search') return;
  
  const userId = ctx.from.id;
  const query = ctx.message.text;
  
  // Получаем баланс
  const { rows } = await pool.query(
    `SELECT balance FROM lead_users WHERE telegram_id = $1`,
    [userId]
  );
  const balance = rows[0]?.balance || 0;
  
  if (balance <= 0) {
    return ctx.reply(
      `❌ <b>Недостаточно баланса</b>\n\n` +
      `Пополни баланс через 💰 Купить доступ`,
      { parse_mode: 'HTML', ...mainMenu() }
    );
  }
  
  // Сохраняем запрос в state
  userStates[userId].query = query;
  
  // Предлагаем выбрать количество
  const counts = [10, 50, 100, 200, 500, 1000];
  const buttons = counts
    .filter(c => c <= balance) // Показываем только те, на которые хватает баланса
    .map(c => [Markup.button.callback(`${c} сайтов`, `count_${c}`)]);
  
  // Если баланс больше 1000, добавляем кнопку "Все доступные"
  if (balance > 1000) {
    buttons.push([Markup.button.callback(`Все доступные (${balance})`, `count_${balance}`)]);
  }
  
  if (buttons.length === 0) {
    return ctx.reply(
      `❌ <b>Недостаточно баланса</b>\n\n` +
      `Твой баланс: <b>${balance} сайтов</b>\n` +
      `Минимум для поиска: <b>10 сайтов</b>\n\n` +
      `Пополни баланс через 💰 Купить доступ`,
      { parse_mode: 'HTML', ...mainMenu() }
    );
  }
  
  ctx.reply(
    `🔍 <b>Запрос принят!</b>\n\n` +
    `Поиск: <i>${query}</i>\n` +
    `Твой баланс: <b>${balance} сайтов</b>\n\n` +
    `Выбери, сколько сайтов найти:`,
    {
      parse_mode: 'HTML',
      ...mainMenu(),
      ...Markup.inlineKeyboard(buttons)
    }
  );
});

// Webhook для YooKassa
const express = require('express');
const bodyParser = require('body-parser');
const app = express();

app.use(bodyParser.json());

app.post('/leadscraper-webhook', async (req, res) => {
  const { object } = req.body;
  
  if (object.status === 'succeeded') {
    const telegramId = parseInt(object.metadata.telegram_id);
    const pack = object.metadata.package;
    const pkg = PACKAGES[pack];
    
    if (!pkg) return res.sendStatus(200);
    
    // Пополняем баланс
    await pool.query(
      `UPDATE lead_users SET balance = balance + $1 WHERE telegram_id = $2`,
      [pkg.sites, telegramId]
    );
    
    // Обновляем статус платежа
    await pool.query(
      `UPDATE lead_payments SET status = 'succeeded' WHERE payment_id = $1`,
      [object.id]
    );
    
    // Уведомляем пользователя
    await bot.telegram.sendMessage(
      telegramId,
      `✅ <b>Оплата получена!</b>\n\n` +
      `💰 Пополнено: <b>+${pkg.sites} сайтов</b>\n\n` +
      `Теперь можешь продолжить поиск компаний.`,
      { parse_mode: 'HTML' }
    );
  }
  
  res.sendStatus(200);
});

// Статистика (админ)
bot.command('stats', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  
  const users = await pool.query(`SELECT COUNT(*) FROM lead_users`);
  const totalUsage = await pool.query(`SELECT SUM(sites_count) as total FROM lead_usage`);
  const totalPayments = await pool.query(`SELECT SUM(amount) as total FROM lead_payments WHERE status = 'succeeded'`);
  const emails = await pool.query(`SELECT SUM(emails_found) as total FROM lead_usage`);
  const phones = await pool.query(`SELECT SUM(phones_found) as total FROM lead_usage`);
  
  ctx.reply(
    `📊 <b>Статистика бота</b>\n\n` +
    `👥 Пользователей: <b>${users.rows[0].count}</b>\n` +
    `📊 Обработано сайтов: <b>${totalUsage.rows[0].total || 0}</b>\n` +
    `📧 Найдено email: <b>${emails.rows[0].total || 0}</b>\n` +
    `📞 Найдено телефонов: <b>${phones.rows[0].total || 0}</b>\n` +
    `💰 Доход: <b>${totalPayments.rows[0].total || 0}₽</b>`,
    { parse_mode: 'HTML' }
  );
});

// Webhook
app.post('/leadscraper-bot', (req, res) => {
  bot.handleUpdate(req.body, res);
});

app.get('/leadscraper-bot', (req, res) => {
  res.send('Lead Scraper Bot is running');
});

app.listen(PORT, "127.0.0.1", async () => {
  console.log(`Port ${PORT}`);
  
  // Устанавливаем webhook
  await bot.telegram.setWebhook(`${WEBHOOK_URL}/leadscraper-bot`);
  console.log(`✅ Webhook: ${WEBHOOK_URL}/leadscraper-bot`);
  console.log(`🚀 Lead Scraper PRO port ${PORT}`);
});

// Обработка ошибок бота
bot.catch(async (err, ctx) => {
  console.error('❌ Bot error:', err);
  try {
    await bot.telegram.sendMessage(
      ADMIN_ID,
      `🔴 <b>Ошибка бота</b>\n\n` +
      `User: ${ctx.from?.id || 'unknown'}\n` +
      `Error: ${err.message}\n` +
      `Stack: ${err.stack?.split('\n').slice(0, 3).join('\n')}`,
      { parse_mode: 'HTML' }
    );
  } catch (e) {
    console.error('Failed to send error notification:', e);
  }
});

// Глобальные обработчики ошибок
process.on('uncaughtException', async (err) => {
  console.error('💥 Uncaught Exception:', err);
  try {
    await bot.telegram.sendMessage(
      ADMIN_ID,
      `💥 <b>Критическая ошибка</b>\n\n` +
      `Type: Uncaught Exception\n` +
      `Error: ${err.message}\n` +
      `Stack: ${err.stack?.split('\n').slice(0, 3).join('\n')}`,
      { parse_mode: 'HTML' }
    );
  } catch (e) {
    console.error('Failed to send error notification:', e);
  }
});

process.on('unhandledRejection', async (reason, promise) => {
  console.error('⚠️ Unhandled Rejection:', reason);
  try {
    await bot.telegram.sendMessage(
      ADMIN_ID,
      `⚠️ <b>Необработанный Promise</b>\n\n` +
      `Reason: ${reason}\n` +
      `Promise: ${promise}`,
      { parse_mode: 'HTML' }
    );
  } catch (e) {
    console.error('Failed to send error notification:', e);
  }
});

// Graceful shutdown
process.on('SIGINT', () => bot.stop('SIGINT'));
process.on('SIGTERM', () => bot.stop('SIGTERM'));
