var CCHttp = require('cloud/libs/CCHttp'),
		CCObject = require('cloud/libs/CCObject'),
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
      validator = function(obj) {
        return obj && obj.responseData && obj.responseData.feed && obj.responseData.feed.entries ? true : false;
      },
  		url = 'https://ajax.googleapis.com/ajax/services/feed/load?v=1.0&q=' + encodeURIComponent(rssUrl);
  //obj.responseData.feed.[entries|feedUrl|title|link|author|description|type]
  //entry[title|link|author|publishedDate|contentSnippet|categories|mediaGroups]
  return CCHttp.httpCachedRequest({
  	url: url,
  	key: rssUrl,
  	cacheName: 'Rss',
  	cacheValidation: validator,
  }).then(function(res) {
    if (!res || !validator(res.obj)) {
      return [];
    }
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
    return Content.factory(contentMap, options);
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
		maxAge: 1000 * 60 * 60 * 24, // 1 day cache timeout, Google News is not likely to swap out feeds often.
	  cacheValidation: function(obj) {
			return obj && obj.responseData && obj.responseData.entries ? true : false;
	  }
  }).then(function(res) { 
    var promises = [],
        created = [];
    for (var e in res.obj.responseData.entries) {
      var entry = res.obj.responseData.entries[e];//url, title, contentSnippet, link
      promises.push(exports.ingestRssUrl(entry.url, options.source, options).then(function(items){
        created = CCObject.arrayUnion(created, items);
        return created;// Last item in ingestion returns all the created items.
      }));
    }
    return Parse.Promise.when(promises);
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
		return exports.ingestRssUrl(settings.url, options.source, options);
  }
  else if(settings.query && settings.query.length) {
  	return exports.ingestRssQuery(settings.query, options);
  }
  else {
  	throw new Error({'error': 'Unknown RSS ingestion settiongs'});
  }
}