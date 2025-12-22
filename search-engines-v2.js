const { searchYandex } = require('./yandex-search');

// Поиск только через Yandex
async function searchAllEngines(query, maxResults = 100) {
  console.log(`\n🔎 Yandex Search: ${query}`);
  
  const results = await searchYandex(query, maxResults);
  
  console.log(`\n📊 Total URLs: ${results.length}`);
  
  return results;
}

module.exports = {
  searchAllEngines
};
