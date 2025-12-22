const ExcelJS = require('exceljs');
const { parse } = require('node-html-parser');
const axios = require('axios');

function extractCompanyName(html, url) {
  const root = parse(html);
  
  const ogSiteName = root.querySelector('meta[property="og:site_name"]');
  if (ogSiteName) {
    const name = ogSiteName.getAttribute('content');
    if (name && name.length > 2) return cleanText(name);
  }
  
  const title = root.querySelector('title');
  if (title) {
    let name = title.text.split(/[-|]/)[0].trim();
    if (name.length > 2) return cleanText(name);
  }
  
  const h1 = root.querySelector('h1');
  if (h1) {
    const name = h1.text.trim();
    if (name.length > 2 && name.length < 100) {
      return cleanText(name);
    }
  }
  
  try {
    return new URL(url).hostname.replace('www.', '').split('.')[0];
  } catch {
    return 'Unknown';
  }
}

function extractAddress(html) {
  const text = parse(html).text;
  
  const patterns = [
    /(?:г\.?\s*)([А-ЯЁа-яё][А-ЯЁа-яё\s-]+),\s*(?:ул\.?\s*)([А-ЯЁа-яё][А-ЯЁа-яё\s-]+),\s*(?:д\.?\s*)(\d+)/gi,
    /(Москва|Санкт-Петербург|СПб),\s*([А-ЯЁа-яё][А-ЯЁа-яё\s-]+),\s*(\d+)/gi
  ];
  
  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches && matches.length > 0) {
      const addr = matches[0].replace(/\s+/g, ' ').trim();
      if (addr.length > 10 && addr.length < 200) {
        return cleanText(addr);
      }
    }
  }
  
  return null;
}

function extractPhones(html) {
  // Ищем по ВСЕЙ странице
  const text = html.replace(/<[^>]*>/g, ' ');

  const patterns = [
    /\+7\s*\(?\d{3}\)?\s*\d{3}[-\s]?\d{2}[-\s]?\d{2}/g,
    /8\s*\(?\d{3}\)?\s*\d{3}[-\s]?\d{2}[-\s]?\d{2}/g,
    /8\d{10}/g,
    /\+7\d{10}/g
  ];

  const phones = new Set();
  for (const pattern of patterns) {
    const matches = text.match(pattern) || [];
    matches.forEach(phone => {
      let cleaned = phone.replace(/[^\d+]/g, '');
      if (cleaned.startsWith('8')) cleaned = '+7' + cleaned.substring(1);

      // Фильтрация мусора:
      // 1. Длина должна быть 11-12 символов
      if (cleaned.length < 11 || cleaned.length > 12) return;

      // 2. Не должно быть слишком много одинаковых цифр (например 88888888888)
      const digits = cleaned.replace('+', '');
      const uniqueDigits = new Set(digits).size;
      if (uniqueDigits < 4) return;  // Минимум 4 разных цифры

      // 3. Не должно быть подозрительных паттернов (1234567890, 0000000000)
      if (digits.includes('1234567890') || /(.)\1{6,}/.test(digits)) return;

      phones.add(cleaned);
    });
  }

  // Возвращаем максимум 5 телефонов (чтобы не собирать сотни с агрегаторов)
  return Array.from(phones).slice(0, 5);
}

function extractEmails(html) {
  const emails = new Set();
  const root = parse(html);

  // 1. Поиск в специальных местах (приоритетные источники)
  // Footer
  const footer = root.querySelector('footer');
  if (footer) {
    const footerEmails = footer.text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9а-яА-Я.-]+\.[a-zA-Zа-яА-Я]{2,}/g) || [];
    footerEmails.forEach(e => emails.add(e.toLowerCase()));
  }

  // Header
  const header = root.querySelector('header');
  if (header) {
    const headerEmails = header.text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9а-яА-Я.-]+\.[a-zA-Zа-яА-Я]{2,}/g) || [];
    headerEmails.forEach(e => emails.add(e.toLowerCase()));
  }

  // Meta tags
  const metaTags = root.querySelectorAll('meta[content]');
  metaTags.forEach(meta => {
    const content = meta.getAttribute('content') || '';
    const metaEmails = content.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9а-яА-Я.-]+\.[a-zA-Zа-яА-Я]{2,}/g) || [];
    metaEmails.forEach(e => emails.add(e.toLowerCase()));
  });

  // Schema.org / JSON-LD
  const scripts = root.querySelectorAll('script[type="application/ld+json"]');
  scripts.forEach(script => {
    try {
      const data = JSON.parse(script.text);
      const jsonStr = JSON.stringify(data);
      const jsonEmails = jsonStr.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9а-яА-Я.-]+\.[a-zA-Zа-яА-Я]{2,}/g) || [];
      jsonEmails.forEach(e => emails.add(e.toLowerCase()));
    } catch {}
  });

  // 2. Декодируем HTML entities
  const text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&commat;/gi, '@')
    .replace(/&period;/gi, '.')
    .replace(/&#64;/g, '@')
    .replace(/&#46;/g, '.')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');

  // 3. Стандартное регулярное выражение
  const standardPattern = /[a-zA-Z0-9][a-zA-Z0-9._%+-]*@[a-zA-Z0-9а-яА-Я][a-zA-Z0-9а-яА-Я.-]*\.[a-zA-Zа-яА-Я]{2,}/g;
  const matches = text.match(standardPattern) || [];
  matches.forEach(email => emails.add(email.toLowerCase().trim()));

  // 4. Поиск в mailto: ссылках
  const mailtoPattern = /mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9а-яА-Я.-]+\.[a-zA-Zа-яА-Я]{2,})/gi;
  const mailtoMatches = html.match(mailtoPattern) || [];
  mailtoMatches.forEach(match => {
    const email = match.replace(/mailto:/i, '').toLowerCase().trim();
    emails.add(email);
  });

  // 5. Закодированные email: info[at]example[dot]com
  const encodedPattern1 = /([a-zA-Z0-9._%+-]+)\s*\[at\]\s*([a-zA-Z0-9а-яА-Я.-]+)\s*\[dot\]\s*([a-zA-Zа-яА-Я]{2,})/gi;
  const encoded1 = text.match(encodedPattern1) || [];
  encoded1.forEach(match => {
    const email = match.replace(/\s*\[at\]\s*/gi, '@').replace(/\s*\[dot\]\s*/gi, '.').toLowerCase();
    emails.add(email);
  });

  // 6. Закодированные email: info(at)example.com
  const encodedPattern2 = /([a-zA-Z0-9._%+-]+)\s*[\(\[]?\s*at\s*[\)\]]?\s*([a-zA-Z0-9а-яА-Я.-]+\.[a-zA-Zа-яА-Я]{2,})/gi;
  const encoded2 = text.match(encodedPattern2) || [];
  encoded2.forEach(match => {
    const email = match.replace(/\s*[\(\[]?\s*at\s*[\)\]]?\s*/gi, '@').toLowerCase();
    if (email.includes('@') && email.includes('.')) emails.add(email);
  });

  // 7. Email с пробелами: info @ example . com
  const spacedPattern = /([a-zA-Z0-9._%+-]+)\s+@\s+([a-zA-Z0-9а-яА-Я.-]+)\s+\.\s+([a-zA-Zа-яА-Я]{2,})/gi;
  const spaced = text.match(spacedPattern) || [];
  spaced.forEach(match => {
    const email = match.replace(/\s+/g, '').toLowerCase();
    emails.add(email);
  });

  // 8. Извлечение из JavaScript кода
  const scriptTags = root.querySelectorAll('script:not([src])');
  scriptTags.forEach(script => {
    const jsCode = script.text;

    // Ищем email в строковых литералах: "email@site.ru" или 'email@site.ru'
    const jsEmailPattern = /["']([a-zA-Z0-9][a-zA-Z0-9._%+-]*@[a-zA-Z0-9а-яА-Я][a-zA-Z0-9а-яА-Я.-]*\.[a-zA-Zа-яА-Я]{2,})["']/g;
    const jsMatches = jsCode.match(jsEmailPattern) || [];
    jsMatches.forEach(match => {
      const email = match.replace(/['"]/g, '').toLowerCase().trim();
      // Проверяем что это не техническая переменная
      if (!email.match(/^(m@h\.|d@alayer|w@dow|navig@or|loc@ion)/)) {
        emails.add(email);
      }
    });

    // Ищем переменные с email: email = "...", contact = "..."
    const varPattern = /(email|contact|mail|e-?mail)\s*[:=]\s*["']([a-zA-Z0-9._%+-]+@[a-zA-Z0-9а-яА-Я.-]+\.[a-zA-Zа-яА-Я]{2,})["']/gi;
    const varMatches = jsCode.matchAll(varPattern);
    for (const match of varMatches) {
      const email = match[2].toLowerCase().trim();
      emails.add(email);
    }
  });

  // Фильтруем невалидные email
  const fakeDomains = [
    '@example.com', '@example.ru', '@test.com', '@test.ru',
    '@domain.com', '@localhost',
    '@yoursite.', '@yourdomain.', '@yourcompany.',
    '@yourbusiness.', '@yourwebsite.', '@yoursite.com',
    '@demo.com', '@demo.ru',
    'noreply@', 'no-reply@', 'donotreply@',
    '@tribute', 'changeloc@', 'remove@', '.has@', '.add@',  // JS защита от спама
    '@placeholder', '@tempmail.', '@temp-mail.', '@fake.'
  ];

  // JavaScript ключевые слова и паттерны (не email!)
  const jsPatterns = [
    'math.', 'document.', 'window.', 'navigator.', 'location.',
    'console.', 'string.', 'array.', 'object.', 'function.',
    '.round', '.floor', '.ceil', '.js', '.protocol', '.href',
    '.indexof', '.foreach', '.map', '.filter', '.slice',
    'useragent', 'loc@ion', 'navig@or', 'w@ch', 'doc@ment',
    'm@h.', 'd@alayer', 'w@dow.', 'arr@y.', 'obj@ct.',
    '.random', '.push', '.pop', '.shift', '.unshift', '.split'
  ];

  const validEmails = Array.from(emails).filter(email => {
    const lowerEmail = email.toLowerCase();

    // Базовая валидация
    if (!email.includes('@') || !email.includes('.')) return false;
    if (email.length < 5 || email.length > 100) return false;

    // Не должен быть JavaScript кодом
    if (jsPatterns.some(pattern => lowerEmail.includes(pattern))) return false;

    // Не должен быть файлом
    if (email.match(/\.(jpg|png|gif|pdf|doc|zip|rar|exe|js|css|json)$/i)) return false;

    // Не должен быть фейковым доменом
    if (fakeDomains.some(fake => email.includes(fake))) return false;

    // Не должен содержать подозрительных символов
    if (email.includes('..') || email.startsWith('.') || email.endsWith('.')) return false;

    // Домен должен выглядеть настоящим (не .round, .floor и т.д.)
    const domain = email.split('@')[1];
    if (domain && domain.match(/\.(round|floor|ceil|abs|max|min|log|pow)$/i)) return false;

    return true;
  });

  // Возвращаем максимум 3 email на сайт
  return validEmails.slice(0, 3);
}

function extractTelegram(html) {
  const root = parse(html);

  // Удаляем script и style теги (там нет telegram, только код)
  root.querySelectorAll('script, style').forEach(el => el.remove());

  // Получаем только текст страницы
  const text = root.text;

  // Список запрещённых слов (CSS, JSON-LD, технические термины)
  const blacklist = [
    'media', 'keyframes', 'supports', 'import', 'font', 'charset', 'namespace',  // CSS
    'context', 'graph', 'type', 'id', 'value', 'name',  // JSON-LD
    'share', 'joinchat', 'intent', 'addstickers', 'setlanguage',  // Telegram служебные
    'include', 'extend', 'mixin', 'function', 'return', 'class', 'public', 'private',  // Код
    'width', 'height', 'color', 'size', 'style', 'webkit', 'moz', 'ms', 'o'  // CSS свойства
  ];

  const telegrams = new Set();

  // 1. Поиск t.me/username
  const tmePattern = /t\.me\/([a-zA-Z][a-zA-Z0-9_]{4,31})/gi;
  const tmeMatches = html.match(tmePattern) || [];
  tmeMatches.forEach(match => {
    const username = match.replace(/t\.me\//i, '');
    if (!blacklist.includes(username.toLowerCase())) {
      telegrams.add('@' + username);
    }
  });

  // 2. Поиск @username в тексте (НЕ в коде)
  const atPattern = /@([a-zA-Z][a-zA-Z0-9_]{4,31})\b/g;
  const atMatches = text.match(atPattern) || [];
  atMatches.forEach(match => {
    const username = match.replace('@', '');
    // Проверяем что это не техническое слово
    if (!blacklist.includes(username.toLowerCase()) &&
        /^[a-zA-Z][a-zA-Z0-9_]*$/.test(username)) {  // Только латиница, цифры, _
      telegrams.add('@' + username);
    }
  });

  // Ограничиваем до 2 аккаунтов
  return Array.from(telegrams).slice(0, 2);
}

function cleanText(text) {
  return text.replace(/\s+/g, ' ').trim().substring(0, 200);
}

async function createExcelFile(results, filename) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Contacts');
  
  worksheet.columns = [
    { header: 'No', key: 'num', width: 5 },
    { header: 'Company', key: 'company', width: 30 },
    { header: 'Website', key: 'url', width: 40 },
    { header: 'Phones', key: 'phones', width: 25 },
    { header: 'Emails', key: 'emails', width: 30 },
    { header: 'Telegram', key: 'telegram', width: 20 },
    { header: 'Address', key: 'address', width: 50 }
  ];
  
  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4472C4' }
  };
  
  results.forEach((result, index) => {
    worksheet.addRow({
      num: index + 1,
      company: result.company || 'Not specified',
      url: result.url,
      phones: result.phones.join(', ') || 'Not found',
      emails: result.emails.join(', ') || 'Not found',
      telegram: result.telegram.join(', ') || 'Not found',
      address: result.address || 'Not found'
    });
  });
  
    const filepath = filename.startsWith("/tmp/") ? filename : "/tmp/" + filename;
  await workbook.xlsx.writeFile(filepath);
  return filepath;
}

// Ищем ссылку на страницу контактов
async function findContactsPage(html, baseUrl) {
  // 1. Сначала пробуем прямые пути к страницам контактов
  const directPaths = [
    '/contacts.html', '/contacts', '/contact.html', '/contact',
    '/kontakty.html', '/kontakty', '/kontakt.html', '/kontakt',
    '/svyaz.html', '/svyaz', '/contacts.php', '/contact.php'
  ];

  for (const path of directPaths) {
    try {
      const testUrl = new URL(path, baseUrl).href;
      const testResponse = await axios.head(testUrl, {
        timeout: 3000,
        maxRedirects: 2
      });

      if (testResponse.status === 200) {
        console.log(`  ✅ Найдена прямая ссылка: ${testUrl}`);
        return testUrl;
      }
    } catch {
      // Страница не существует, продолжаем
      continue;
    }
  }

  // 2. Если прямых путей нет - ищем в ссылках (приоритет: contact > about)
  const root = parse(html);
  const priorityKeywords = ['contact', 'contacts', 'kontakt', 'kontakty', 'связь', 'контакт', 'svyaz'];
  const lowPriorityKeywords = ['about', 'o-nas', 'about-us'];

  // Сначала ищем приоритетные
  const links = root.querySelectorAll('a[href]');
  for (const link of links) {
    const href = link.getAttribute('href');
    if (!href) continue;

    const lowerHref = href.toLowerCase();

    for (const keyword of priorityKeywords) {
      if (lowerHref.includes(keyword)) {
        try {
          const fullUrl = new URL(href, baseUrl).href;
          console.log(`  ✅ Найдена ссылка по ключевому слову "${keyword}": ${fullUrl}`);
          return fullUrl;
        } catch {
          continue;
        }
      }
    }
  }

  // Потом ищем низкоприоритетные (about)
  for (const link of links) {
    const href = link.getAttribute('href');
    if (!href) continue;

    const lowerHref = href.toLowerCase();

    for (const keyword of lowPriorityKeywords) {
      if (lowerHref.includes(keyword)) {
        try {
          const fullUrl = new URL(href, baseUrl).href;
          console.log(`  ✅ Найдена ссылка по ключевому слову "${keyword}": ${fullUrl}`);
          return fullUrl;
        } catch {
          continue;
        }
      }
    }
  }

  return null;
}

async function scrapeWebsiteFull(url) {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 15000,
      maxRedirects: 3
    });

    const html = response.data;

    // Парсим главную страницу
    let phones = extractPhones(html);
    let emails = extractEmails(html);
    let telegram = extractTelegram(html);
    const company = extractCompanyName(html, url);
    const address = extractAddress(html);

    // Ищем страницу контактов
    const contactsUrl = await findContactsPage(html, url);

    // Если нашли страницу контактов - парсим её тоже
    if (contactsUrl && contactsUrl !== url) {
      try {
        const contactResponse = await axios.get(contactsUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          timeout: 10000,
          maxRedirects: 2
        });

        const contactHtml = contactResponse.data;

        // Добавляем данные со страницы контактов
        const contactPhones = extractPhones(contactHtml);
        const contactEmails = extractEmails(contactHtml);
        const contactTelegram = extractTelegram(contactHtml);

        // Объединяем уникальные значения
        phones = [...new Set([...phones, ...contactPhones])];
        emails = [...new Set([...emails, ...contactEmails])];
        telegram = [...new Set([...telegram, ...contactTelegram])];
      } catch (contactError) {
        // Если не удалось загрузить страницу контактов - не страшно
        console.log(`  ⚠️ Не удалось загрузить ${contactsUrl}`);
      }
    }

    return {
      url,
      company,
      address,
      phones,
      emails,
      telegram,
      success: true
    };
  } catch (error) {
    return {
      url,
      company: 'Error loading',
      address: null,
      phones: [],
      emails: [],
      telegram: [],
      success: false
    };
  }
}

module.exports = {
  extractCompanyName,
  extractAddress,
  extractPhones,
  extractEmails,
  extractTelegram,
  createExcelFile,
  scrapeWebsiteFull
};
