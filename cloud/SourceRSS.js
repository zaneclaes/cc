var CCHttp = require('cloud/libs/CCHttp'),
		CCObject = require('cloud/libs/CCObject'),
	  OpQueue = require('cloud/libs/CCOpQueue').OpQueue,
		Content = require('cloud/Content').Content;

/**
 * These are automatically built into a http://[subdomain?].X.com regexp
 * No link in a RSS feed matching any of these will ever become content
 */
var globalBlacklist = [
	'reddit', 'kickstarter', 'feedsportal', 'instructables', 'google,'
];

/**
 * Turn Google RSS image styles into the database style we use
 */
function normalizeImages(images) {
	if (!images || !images.length) {
		return [];
	}
	var ret = [];
	for (var i in images) {
		var contents = images[i]['contents'],
				whitelist = ['credits','description','url'];
		for (var c in contents) {
			var image = {
				'credits' : contents[c].credits,
				'description' : contents[c].description,
				'url' : contents[c].url,
			};
			if (contents[c].height && contents[c].width) {
				image.size = {
					'width' : contents[c].width,
					'height' : contents[c].height,
				};
			}
			ret.push(image);
		}
	}
	return ret;
}
/**
 * Fetch a RSS feed from a single URL
 *
 * A single RSS "Feed" can potentially match multiple RSS feeds
 * if it is a query-type object (which searches on topics)
 * Thus this function gets called for each feed.
 */
exports.ingestRssUrl = function(rssUrl, source, options) {
  var settings = source.get('settings'),
  		url = 'https://ajax.googleapis.com/ajax/services/feed/load?v=1.0&q=' + encodeURIComponent(rssUrl);
  //obj.responseData.feed.[entries|feedUrl|title|link|author|description|type]
  //entry[title|link|author|publishedDate|contentSnippet|categories|mediaGroups]
  return CCHttp.httpCachedRequest({
  	url: url,
  	key: rssUrl,
  	cacheName: 'Rss',
  	cacheValidation: function(obj) {
  		return obj.responseData && obj.responseData.feed && obj.responseData.feed.entries ? true : false;
  	},
  	success: function(res) {
			var lastEntry = null,
					contentMap = {};
			for (var e in res.obj.responseData.feed.entries) {
				lastEntry = res.obj.responseData.feed.entries[e];
				var url = lastEntry['link'],
						blacklisted = false;
				// We don't actually want content from reddit itself...
				for (var b in globalBlacklist) {
					var regExp = new RegExp('^https?://([\w\d]+\.)?'+globalBlacklist[b]+'\.com');
					if (!url || url.match(regExp)) {
						blacklisted = true;
						break;
					}
				}
				if (blacklisted) {
					continue;
				}

				contentMap[url] = {
          'source' : source,
					'weight' : source.get('weight') || 1,
					'title' : lastEntry['title'],
					'publisher' : { 'title' : lastEntry['author'] },
					'text' : lastEntry['contentSnippet'],
					'tags' : lastEntry['categories'],
					'images' : normalizeImages(lastEntry['mediaGroups']),
					'timestamp' : new Date(lastEntry['publishedDate']).getTime(),
					'payload' : lastEntry,
				};
			}
			Content.factory(contentMap, options);
  	},// success
  	error: options.error,
  });
}
/**
 * MULTI-Ingestion
 * Will find many feeds from Google Feeds
 */
exports.ingestRssQuery = function(query, options) {
	var url = 'https://ajax.googleapis.com/ajax/services/feed/find?v=1.0&q=' + encodeURIComponent(query);
  return CCHttp.httpCachedRequest({
		url: url,
		key: query,
		cacheName: 'RssQuery',
		timeout: 1000 * 60 * 60 * 24, // 1 day cache timeout, Google News is not likely to swap out feeds often.
	  cacheValidation: function(obj) {
			return obj.responseData && obj.responseData.entries ? true : false;
	  },
		success: function(res) {
		  var q = new OpQueue(),
				  created = [];
			q.displayName = 'RssIngestion';
			for (var e in res.obj.responseData.entries) {
				var entry = res.obj.responseData.entries[e];//url, title, contentSnippet, link
				var op = q.queueOp({
					url: entry.url,
					source: options.source,
					run: function(op, options) {
						exports.ingestRssUrl(op.url, op.source, options);
					}
				});
			}
			q.run(function(q){
				// Pack all the content objects into one big array
				for(var r in q.results) {
					created = CCObject.arrayUnion(created, q.results[r]);
				}
				options.success(created);
			});
		},
		error: options.error,
  });
}
/**
 * Settings for this source:
 * Either a "url" or a "query"
 * A query is expensive and will spawn many URL based ingestions
 */
exports.ingest = function(options) {
	var settings = options.source.get('settings');
  if (settings.url && settings.url.length) {
		exports.ingestRssUrl(settings.url, options.source, options);
  }
  else if(settings.query && settings.query.length) {
  	exports.ingestRssQuery(settings.query, options);
  }
  else {
  	options.error({'error': 'Unknown RSS ingestion settiongs'});
  }
}