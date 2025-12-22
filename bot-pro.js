require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const crypto = require('crypto');
const { Pool } = require('pg');
const fs = require('fs');
const { scrapeWebsiteFull, createExcelFile } = require('./enhanced-parser-v2');
const { searchAllEngines } = require('./search-engines-v2');

const BOT_TOKEN = process.env.BOT_TOKEN;
const YOOKASSA_SHOP_ID = process.env.YOOKASSA_SHOP_ID;
const YOOKASSA_SECRET = process.env.YOOKASSA_SECRET;
const ADMIN_ID = parseInt(process.env.ADMIN_ID || '799677717');
const WEBHOOK_URL = process.env.WEBHOOK_URL;

const PRICES = {
  pack_50: { sites: 50, price: 300, label: '50 сайтов - 300 руб' },
  pack_200: { sites: 200, price: 900, label: '200 сайтов - 900 руб' },
  pack_500: { sites: 500, price: 1900, label: '500 сайтов - 1900 руб' },
  unlimited: { sites: 999999, price: 4900, label: 'Безлимит 30 дней - 4900 руб' }
};

const pool = new Pool();

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lead_users (
      id SERIAL PRIMARY KEY,
      telegram_id BIGINT UNIQUE NOT NULL,
      username VARCHAR(255),
      balance INT DEFAULT 0,
      unlimited_until TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS lead_payments (
      id SERIAL PRIMARY KEY,
      telegram_id BIGINT NOT NULL,
      payment_id VARCHAR(255),
      amount INT NOT NULL,
      sites_added INT,
      status VARCHAR(50) DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS lead_usage (
      id SERIAL PRIMARY KEY,
      telegram_id BIGINT NOT NULL,
      sites_count INT NOT NULL,
      emails_found INT DEFAULT 0,
      search_query VARCHAR(500),
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('DB ready');
}

async function getUser(tgId) {
  const res = await pool.query('SELECT * FROM lead_users WHERE telegram_id = $1', [tgId]);
  return res.rows[0];
}

async function createUser(tgId, username) {
  await pool.query(
    'INSERT INTO lead_users (telegram_id, username, balance) VALUES ($1, $2, 5) ON CONFLICT (telegram_id) DO NOTHING',
    [tgId, username]
  );
  return getUser(tgId);
}

async function updateBalance(tgId, delta) {
  await pool.query('UPDATE lead_users SET balance = balance + $1 WHERE telegram_id = $2', [delta, tgId]);
}

async function scrapeMultiple(urls, onProgress) {
  const results = [];
  for (let i = 0; i < urls.length; i++) {
    const r = await scrapeWebsiteFull(urls[i]);
    results.push(r);
    if (onProgress && (i + 1) % 5 === 0) await onProgress(i + 1, urls.length, r);
  }
  return results;
}

const bot = new Telegraf(BOT_TOKEN);

bot.start(async (ctx) => {
  const user = await createUser(ctx.from.id, ctx.from.username);
  await ctx.reply(
    '🔍 *Lead Scraper PRO* - профессиональный сборщик контактов\n\n' +
    '📦 Баланс: ' + user.balance + ' сайтов\n\n' +
    '*Два режима:*\n' +
    '1️⃣ *Поиск* - введите запрос:\n' +
    '`мебельные компании москва`\n' +
    '`натяжные потолки спб`\n\n' +
    '2️⃣ *URL* - отправьте список:\n' +
    '`site1.ru`\n`site2.ru`\n\n' +
    '💡 5 сайтов бесплатно!\n' +
    '📊 Excel с названиями, адресами, телефонами, email\n\n' +
    '🌐 lanaaihelper.ru',
    { parse_mode: 'Markdown', ...Markup.keyboard([['🔍 Поиск', '📋 URL'], ['💰 Купить', '📊 Баланс'], ['❓ Помощь']]).resize() }
  );
});

const userMode = new Map();

bot.hears('🔍 Поиск', async (ctx) => {
  userMode.set(ctx.from.id, 'search');
  await ctx.reply(
    '🔍 *Режим поиска*\n\n' +
    'Напишите запрос, например:\n' +
    '`натяжные потолки спб`\n' +
    '`мебельные компании москва`\n\n' +
    '✨ Бот найдет компании и соберет все контакты!',
    { parse_mode: 'Markdown' }
  );
});

bot.hears('📋 URL', async (ctx) => {
  userMode.set(ctx.from.id, 'url');
  await ctx.reply('📋 *Режим URL*\n\nОтправьте список сайтов:\n`site1.ru`\n`site2.ru`', { parse_mode: 'Markdown' });
});

bot.hears('📊 Баланс', async (ctx) => {
  const user = await getUser(ctx.from.id);
  if (!user) return ctx.reply('/start');
  const unl = user.unlimited_until && new Date(user.unlimited_until) > new Date();
  await ctx.reply(unl ? '♾ Безлимит активен' : '📦 Баланс: *' + user.balance + '* сайтов', { parse_mode: 'Markdown' });
});

bot.hears('💰 Купить', async (ctx) => {
  await ctx.reply('💰 *Выберите пакет:*', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback(PRICES.pack_50.label, 'buy_pack_50')],
      [Markup.button.callback(PRICES.pack_200.label, 'buy_pack_200')],
      [Markup.button.callback(PRICES.pack_500.label, 'buy_pack_500')],
      [Markup.button.callback(PRICES.unlimited.label, 'buy_unlimited')]
    ])
  });
});

bot.hears('❓ Помощь', (ctx) => ctx.reply(
  '*Как пользоваться:*\n\n' +
  '🔍 *Поиск* - бот соберет:\n' +
  '• Название компании\n' +
  '• Все телефоны\n' +
  '• Все email\n' +
  '• Telegram\n' +
  '• Адрес\n\n' +
  '📋 *URL* - свой список сайтов\n\n' +
  '📊 *Баланс* - проверить остаток\n\n' +
  '💰 *Купить* - пополнить\n\n' +
  '📑 Результат в Excel!\n\n' +
  '🌐 lanaaihelper.ru',
  { parse_mode: 'Markdown' }
));

bot.action(/^buy_(.+)$/, async (ctx) => {
  const packId = ctx.match[1];
  const pack = PRICES[packId];
  if (!pack) return ctx.answerCbQuery('Пакет не найден');
  await ctx.answerCbQuery();

  try {
    const resp = await axios.post('https://api.yookassa.ru/v3/payments', {
      amount: { value: pack.price.toFixed(2), currency: 'RUB' },
      capture: true,
      confirmation: { type: 'redirect', return_url: 'https://t.me/LanaAIParser_bot' },
      description: 'Lead Scraper: ' + pack.label,
      metadata: { telegram_id: String(ctx.from.id), pack_id: packId }
    }, {
      auth: { username: YOOKASSA_SHOP_ID, password: YOOKASSA_SECRET },
      headers: { 'Idempotence-Key': crypto.randomUUID() }
    });

    await pool.query(
      'INSERT INTO lead_payments (telegram_id, payment_id, amount, sites_added, status) VALUES ($1, $2, $3, $4, $5)',
      [ctx.from.id, resp.data.id, pack.price, pack.sites, 'pending']
    );

    await ctx.reply('💳 *' + pack.label + '*', {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.url('💳 Оплатить', resp.data.confirmation.confirmation_url)]])
    });
  } catch (e) {
    console.error('Payment error:', e.response ? e.response.data : e.message);
    await ctx.reply('❌ Ошибка оплаты');
  }
});

async function processRequest(ctx, urls, searchQuery = null) {
  const user = await getUser(ctx.from.id);
  if (!user) return ctx.reply('/start');

  const isUnl = user.unlimited_until && new Date(user.unlimited_until) > new Date();
  const isAdm = ctx.from.id === ADMIN_ID;

  if (!isUnl && !isAdm && user.balance < urls.length) {
    return ctx.reply('❌ Нужно: ' + urls.length + ', баланс: ' + user.balance,
      Markup.inlineKeyboard([[Markup.button.callback('💰 Купить', 'buy_pack_50')]]));
  }

  const msg = await ctx.reply('⏳ Обработка ' + urls.length + ' сайтов...');

  try {
    const results = await scrapeMultiple(urls, async (cur, total) => {
      if (cur % 5 === 0) {
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, 
          '⏳ Обработано ' + cur + ' из ' + total + '...').catch(() => {});
      }
    });

    if (!isUnl && !isAdm) await updateBalance(ctx.from.id, -urls.length);

    const contactsFound = results.filter(r => r.phones.length > 0 || r.emails.length > 0).length;
    await pool.query('INSERT INTO lead_usage (telegram_id, sites_count, emails_found, search_query) VALUES ($1, $2, $3, $4)',
      [ctx.from.id, urls.length, contactsFound, searchQuery]);

    const filename = 'contacts_' + Date.now() + '.xlsx';
    const filepath = await createExcelFile(results, filename);

    await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id).catch(() => {});
    const newUser = await getUser(ctx.from.id);

    await ctx.replyWithDocument({ source: filepath, filename: filename }, {
      caption: '✅ Готово!' + 
        (searchQuery ? '\n🔍 ' + searchQuery : '') +
        '\n📊 Сайтов: ' + results.length + 
        '\n📞 С контактами: ' + contactsFound +
        '\n📦 Остаток: ' + (isAdm ? '∞' : isUnl ? '♾' : newUser.balance)
    });

    fs.unlinkSync(filepath);
  } catch (e) {
    console.error('Processing error:', e);
    await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id).catch(() => {});
    await ctx.reply('❌ Ошибка: ' + e.message);
  }
}

bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();
  if (text.startsWith('/')) return;
  
  const buttonTexts = ['💰 Купить', '📊 Баланс', '❓ Помощь', '🔍 Поиск', '📋 URL'];
  if (buttonTexts.some(btn => text.includes(btn))) return;

  const user = await getUser(ctx.from.id);
  if (!user) return ctx.reply('/start');

  const lines = text.split('\n');
  const urlLines = lines.filter(l => l.trim().includes('.') && l.trim().split(' ').length === 1);
  const hasUrls = urlLines.length > 0;
  
  const mode = userMode.get(ctx.from.id) || (hasUrls ? 'url' : 'search');

  if (mode === 'search' || (!hasUrls && text.length > 3)) {
    const msg = await ctx.reply('🔍 Ищу по запросу: *' + text + '*...', { parse_mode: 'Markdown' });

    try {
      const searchResult = await searchAllEngines(text, 50);
      const urls = searchResult.urls;

      if (urls.length === 0) {
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
          '❌ Ничего не найдено. Попробуйте другой запрос.');
        return;
      }

      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
        '✅ Найдено ' + urls.length + ' компаний. Собираю контакты...');

      await processRequest(ctx, urls, text);
    } catch (e) {
      console.error('Search error:', e);
      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
        '❌ Ошибка поиска: ' + e.message);
    }
  } else {
    const urls = lines
      .map(l => l.trim())
      .filter(l => l && l.includes('.'))
      .map(l => l.startsWith('http') ? l : 'https://' + l);
      
    if (!urls.length) {
      return ctx.reply('Отправьте список URL или поисковый запрос');
    }
    await processRequest(ctx, urls);
  }
});

bot.command('stats', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  const users = await pool.query('SELECT COUNT(*) FROM lead_users');
  const usage = await pool.query('SELECT SUM(sites_count) as sites, SUM(emails_found) as emails FROM lead_usage');
  const pay = await pool.query("SELECT SUM(amount) as total FROM lead_payments WHERE status = 'succeeded'");
  const searches = await pool.query("SELECT COUNT(*) FROM lead_usage WHERE search_query IS NOT NULL");
  await ctx.reply(
    '📊 *Статистика:*\n\n' +
    '👥 Пользователей: ' + users.rows[0].count + '\n' +
    '🔍 Поисков: ' + searches.rows[0].count + '\n' +
    '📊 Сайтов: ' + (usage.rows[0].sites || 0) + '\n' +
    '📧 Контактов: ' + (usage.rows[0].emails || 0) + '\n' +
    '💰 Доход: ' + (pay.rows[0].total || 0) + ' руб',
    { parse_mode: 'Markdown' }
  );
});

const app = express();
app.use(express.json());

app.post('/leadscraper-webhook', async (req, res) => {
  const { event, object } = req.body;
  if (event === 'payment.succeeded') {
    const { id, metadata } = object;
    const tgId = parseInt(metadata.telegram_id);
    const packId = metadata.pack_id;
    const pack = PRICES[packId];

    await pool.query('UPDATE lead_payments SET status = $1 WHERE payment_id = $2', ['succeeded', id]);

    if (packId === 'unlimited') {
      const until = new Date();
      until.setDate(until.getDate() + 30);
      await pool.query('UPDATE lead_users SET unlimited_until = $1 WHERE telegram_id = $2', [until, tgId]);
    } else {
      await updateBalance(tgId, pack.sites);
    }

    await bot.telegram.sendMessage(tgId, '✅ Оплата получена! ' + 
      (packId === 'unlimited' ? '♾ Безлимит 30 дней' : '📦 +' + pack.sites + ' сайтов'));
    await bot.telegram.sendMessage(ADMIN_ID, '💰 +' + pack.price + ' руб от ID' + tgId);
  }
  res.json({ status: 'ok' });
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3002;

async function start() {
  await initDB();
  if (process.env.NODE_ENV === 'production') {
    app.use(bot.webhookCallback('/leadscraper-bot'));
    await bot.telegram.setWebhook(WEBHOOK_URL + '/leadscraper-bot');
    console.log('✅ Webhook:', WEBHOOK_URL + '/leadscraper-bot');
  } else {
    bot.launch();
    console.log('🔄 Polling');
  }
  app.listen(PORT, () => console.log('🚀 Lead Scraper PRO port', PORT));
}

start().catch(console.error);
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
