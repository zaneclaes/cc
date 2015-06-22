var CCHttp = require('cloud/libs/CCHttp'),
		CCObject = require('cloud/libs/CCObject'),
		Content = require('cloud/Content').Content;

//
// Helper: get tags from an item by inspecting metadata
// Prismatic has all these crazy card things n stuff
// Tries to normalize them into a simple flat array of strings
//
function extractTags(item, options) {
	var tags = [],
			canonicalTags = [],
			include = (options.include || '').split(','),
			riCards = item['related-interest-cards']['items'],
			appendTag = function(t) {
				canonical = CCObject.canonicalTag(t);
				if (canonicalTags.indexOf(canonical) < 0) {
					canonicalTags.push(canonical);
					tags.push(t);
				}
			};
	for(var i in include) {
		var t = include[i].trim();
		if (t.length <= 0) continue;
		if (item['title'].toLowerCase().indexOf(t.toLowerCase()) >= 0) {
			appendTag(t);
		}
	}
	for (var x in item['tags']) {
		appendTag(item['tags'][x]);
	}
	for (var i in riCards) {
		appendTag(riCards[i]['interest']['title']);
	}
	for (var i in item['topics']) {
		appendTag(item['topics'][i]['title']);
	}
	for (var i in item['home-interests']) {
		appendTag(item['home-interests'][i]['title']);
	}
	return tags;
}

//
// Ingest prismatic
//
exports.ingest = function(options) {
	var settings = options.source.get('settings'),
			sourceId = options.source.id,
			maxPages = settings.pages || 1,
			allObjs = options.allObjs || [],
			curPage = options.curPage || 0,
			urlBase = 'http://api.getprismatic.com/2.1/feeds/personal:-default-/linear?inline-comments=4&inline-bookmarks=6',
			token = '&jsonp-token=' + settings.token,
			headers = {
				'Accept-Encoding': 'gzip, deflate',
				'X-Csrf-Token': 'MTQzNDI5MTQ2MzU2OA.a2M4Zm5scnVodGZq.6Bsy9yMAvAEVnvpj_cOb6VNSTh4',
				'Accept-Language': 'en-US,en;q=0.8',
				'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/43.0.2357.124 Safari/537.36',
				'Referer': 'http://api.getprismatic.com/2.1/auth/iframexdr-receiver',
				'Content-Type': 'application/json',
				'Accept': '*/*',
				'Cookie': settings.cookie,
				'Connection': 'keep-alive',
				'X-FirePHP-Version': '0.0.6',
				'Origin': 'http://api.getprismatic.com',
			};
	CCHttp.httpCachedRequest({
		url: urlBase + token,
		headers: headers,
		key: sourceId,
		cacheName: 'Prismatic',
		cacheValidation: function(obj) {
			return obj.docs ? true : false;
		},
		success: function(obj) {
			var items = obj.docs.items,
					lastItem = null,
					contentMap = {};
			for (var x in items) {
				lastItem = items[x];
				contentMap[lastItem['url']] = {
					'source' : options.source,
					'weight' : options.source.get('weight') || 100,
					'title' : lastItem['title'],
					'publisher' : lastItem['publisher'],
					'text' : lastItem['text'],
					'tags' : extractTags(lastItem, options),
					'images' : lastItem['images'],
					'timestamp' : lastItem['date'],
					//'payload' : lastItem,
				};
			}
			CCObject.log('got prismatic content map page '+curPage+' from sourceId '+sourceId);
			CCObject.log(contentMap);
			Content.factory(contentMap, options);
		},
		error: options.error,
	});
}
