const axios = require('axios');

const YANDEX_API_KEY = process.env.YANDEX_API_KEY || 'your-api-key-here';
const FOLDER_ID = process.env.YANDEX_FOLDER_ID || 'your-folder-id-here';
const API_ENDPOINT = 'https://searchapi.api.cloud.yandex.net/v2/web/searchAsync';
const OPERATIONS_ENDPOINT = 'https://operation.api.cloud.yandex.net/operations';

async function searchYandexPage(query, page = 0, perPage = 100) {
  try {
    const response = await axios.post(
      API_ENDPOINT,
      {
        folderId: FOLDER_ID,
        query: {
          searchType: 'SEARCH_TYPE_RU',
          queryText: query,
          familyMode: 'FAMILY_MODE_MODERATE',
          page: String(page)
        },
        sortSpec: {
          sortMode: 'SORT_MODE_BY_RELEVANCE'
        },
        groupSpec: {
          groupMode: 'GROUP_MODE_DEEP',
          groupsOnPage: String(perPage),
          docsInGroup: '1'
        },
        maxPassages: '2',
        responseFormat: 'FORMAT_XML'
      },
      {
        headers: {
          'Authorization': `Api-Key ${YANDEX_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    const operationId = response.data.id;

    // Ждём завершения операции
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000));

      try {
        const statusResponse = await axios.get(
          `${OPERATIONS_ENDPOINT}/${operationId}`,
          {
            headers: {
              'Authorization': `Api-Key ${YANDEX_API_KEY}`
            }
          }
        );

        if (statusResponse.data.done) {
          const rawData = statusResponse.data.response?.rawData;
          if (rawData) {
            const xmlData = Buffer.from(rawData, 'base64').toString('utf-8');

            const urlMatches = xmlData.match(/<url>(.*?)<\/url>/g) || [];
            const titleMatches = xmlData.match(/<title>(.*?)<\/title>/g) || [];

            const results = [];
            for (let i = 0; i < urlMatches.length; i++) {
              const url = urlMatches[i].replace(/<\/?url>/g, '');
              const title = titleMatches[i]
                ? titleMatches[i]
                    .replace(/<\/?title>/g, '')
                    .replace(/<hlword>(.*?)<\/hlword>/g, '$1')
                    .replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1')
                : '';

              results.push({
                title: title.trim(),
                url: url.trim(),
                snippet: ''
              });
            }

            return results;
          }

          return [];
        }
      } catch (pollError) {
        console.error(`  ⚠️ Ошибка проверки статуса:`, pollError.message);
      }
    }

    return [];
  } catch (error) {
    console.error('❌ Yandex API error:', error.response?.data || error.message);
    return [];
  }
}

async function searchYandex(query, maxResults = 100) {
  try {
    console.log(`🔍 Yandex Search: ${query} (нужно: ${maxResults} результатов)`);

    const allResults = [];
    const perPage = 100;
    const pages = Math.ceil(maxResults / perPage);

    console.log(`  📄 Запрашиваю ${pages} страниц по ${perPage} результатов`);

    for (let page = 0; page < pages; page++) {
      console.log(`  ⏳ Страница ${page + 1}/${pages}...`);

      const pageResults = await searchYandexPage(query, page, perPage);

      if (pageResults.length === 0) {
        console.log(`  ℹ️ Страница ${page + 1} пустая, прекращаю поиск`);
        break;
      }

      const aggregators = [
        'avito.ru', '2gis.ru', 'yandex.ru', 'kp.ru', 'zoon.ru',
        'vk.com', 'ok.ru', 'instagram.com', 'facebook.com',
        'profi.ru', 'youdo.com', 'qlaster.ru', 'cataloxy.ru',
        'orgpage.ru', 'spravker.ru', 'yellowpages.ru', 'rusprofile.ru',
        'vc.ru', 'medium.com', 'habr.com', 'dzen.ru', 'teletype.in',
        'spark.ru', 'google.com', 'wikipedia.org', 'youtube.com',
        'otzovik.com', 'irecommend.ru', 'flamp.ru',
        'rerate.ru', 'otzyvru.com', 'otziv.ru', 'otzyv.ru',
        'rumexpert.ru', 'yell.ru', 'biznet.ru', 'list-org.com'
      ];

      const filteredResults = pageResults.filter(result => {
        const url = result.url.toLowerCase();
        if (aggregators.some(agg => url.includes(agg))) return false;
        if (url.includes('.yandex.ru') || url.includes('yandex.ru/')) return false;
        return true;
      });

      allResults.push(...filteredResults);

      console.log(`  ✅ Страница ${page + 1}: найдено ${pageResults.length}, после фильтрации: ${filteredResults.length}`);

      if (allResults.length >= maxResults) {
        break;
      }

      if (page < pages - 1) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    const finalResults = allResults.slice(0, maxResults);
    console.log(`✅ Yandex нашёл ${finalResults.length} результатов`);

    return finalResults;

  } catch (error) {
    console.error('❌ Yandex Search error:', error.message);
    return [];
  }
}

module.exports = { searchYandex };
