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
/*******************************************************************************************
 *
 * MAIN SOURCE CLASS
 * 
 ******************************************************************************************/
var Source = Parse.Object.extend("Source", {
	// @instance

	facebook: function(options) {
		var source = options.source,
				settings = source.get('settings'),
				fbid = settings.query,
				token = 'CAACEdEose0cBAEbTSu0CaQ0mPh2T61LxiuuzEmOovWC3Am7M0gcthmC5QxD6S06NZA0As2CCkHUS2AA2FePOqLva7jVxLUGgiHkTxK9NxcYka35Qy9UBuVB0nHToXxrfqBioTCbOEXei2T7V8uU8bVAEd2SzGU2fIrlcpDeH4NZC04ZBkZCOpn7FLMXwnc3D5ajPEnEuJsaUtwBgNYPC',
				url = 'https://graph.facebook.com/' + fbid + '/posts?oauth_token=' + token;

		return CCHttp.httpCachedRequest({
			url: url,
			key: fbid,
			cacheName: 'FacebookPosts',
			cacheValidation: function(obj) {
				return obj.data ? true : false;
			}
		}).then(function(res) {
			var items = res.obj.data,
					lastItem = null,
					contentMap = {};
			for (var x in items) {
				lastItem = items[x];
				if (!lastItem['link'] || lastItem['link'].indexOf('https://www.facebook.com') === 0) {
					continue;
				}
				from = lastItem['from'];
				from['title'] = from['name'];
				delete from['name'];
				contentMap[lastItem['link']] = {
					'source' : options.source,
					'weight' : options.source.get('weight') || 1,
					'title' : lastItem['name'],
					'publisher' : from,
					'text' : lastItem['description'],
					'tags' : [],
					'images' : lastItem['picture'] && lastItem['picture'].length ? [{ url : lastItem['picture'] }] : [],
					'timestamp' : new Date(lastItem['created_time']).getTime(),
					//'payload' : lastItem,
				};
			}
			return Content.factory(contentMap, options);
		});
	},
	twitter: function(options) {
		// https://twitter.com/i/search/timeline?f=realtime&q=Babylon%205&src=typd
		var source = options.source,
				settings = source.get('settings'),
				count = parseInt(settings.count || 10),
				sn = settings.query.toLowerCase(),
				headers = {
					'Authorization': 'OAuth oauth_consumer_key="3HX1legGnk6mNz56POJdw", oauth_nonce="b79c71e7daa55dd080c307c456c4124e", oauth_signature="Epx%2FROaE%2BdMSgxinGBVenR0WOZk%3D", oauth_signature_method="HMAC-SHA1", oauth_timestamp="1435956547", oauth_token="14954006-T71pWLFKp0pP3J9f40ACka4DArXDmXN0hlPK0ikzA", oauth_version="1.0"'
				},
				url = 'https://api.twitter.com/1.1/statuses/user_timeline.json';
		return CCHttp.httpCachedRequest({
			url: url,
			headers: headers,
			key: sn,
			body: 'screen_name='+sn+'&count='+count,
			cacheName: 'Twitter',
			parser: function(res) {
				console.log('tw');
				console.log(res.text);
				var obj = JSON.parse(httpResponse.text);
				console.log(obj);
				return obj;
			}
		}).then(function(res) {
			console.log('Twitter ');
			console.log(res);
			return []; /*
			var items = res.obj.docs.items,
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
			return Content.factory(contentMap, options);*/
		});
	},
	/**
	 * Call out to Prismatic
	 */
	prismatic: function(options) {
		var source = options.source,
				settings = source.get('settings'),
				sourceId = source.id,
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
		return CCHttp.httpCachedRequest({
			url: urlBase + token,
			headers: headers,
			key: sourceId,
			cacheName: 'Prismatic',
			cacheValidation: function(obj) {
				return obj.docs ? true : false;
			}
		}).then(function(res) {
			var items = res.obj.docs.items,
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
			return Content.factory(contentMap, options);
		});
	},
	/**
	 * Fetch a RSS feed from a single URL
	 *
	 * A single RSS "Feed" can potentially match multiple RSS feeds
	 * if it is a query-type object (which searches on topics)
	 * Thus this function gets called for each feed.
	 */
	rss: function(options) {
	  var source = options.source,
	  		settings = source.get('settings');
		return source._rss(settings.query, source, options);
	},
	_rss: function(rssUrl, source, options) {
	  var validator = function(obj) {
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
	},
	/**
	 * MULTI-Ingestion
	 * Will find many feeds from Google Feeds
	 */
	topic: function(options) {
		var source = options.source,
				settings = source.get('settings'),
				query = settings.query,
				url = 'https://ajax.googleapis.com/ajax/services/feed/find?v=1.0&q=' + encodeURIComponent(query);
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
	      promises.push(source._rss(entry.url, options.source, options).then(function(items){
	        created = CCObject.arrayUnion(created, items);
	        return created;// Last item in ingestion returns all the created items.
	      }));
	    }
	    return Parse.Promise.when(promises);
	  });
	},
	//
	// Ingest a single source (i.e., rss or prismatic)
	//
	ingest: function(options) {
		options = JSON.parse(JSON.stringify(options || {}));
		type = this.get('type');
		options.source = this;
		var func = this[type];
		if (typeof func === 'function') {
			return func(options);
		}
		else if (type === Source.TYPE_STATIC) {
			// NOP : static sources generate during the Delta
			return [];
		}
		else {
			throw new Error("Unknown Source Type: "+type);
		}
	},

}, {
	TYPE_STATIC: 'static',

	/**
	 * Create a source, unless it's a duplicate
	 */
	factory: function(map) {
		var source = new Source();
		return source.save(map);
	},

	//
	// Ingest all sources
	//
	ingest: function(options) {
		options = JSON.parse(JSON.stringify(options || {}));
		var query = new Parse.Query(Source);
		if (options.sourceTypes && options.sourceTypes.length) {
			query.containedIn("type",options.sourceTypes);
		}
		if (options.sourceId && options.sourceId.length) {
			query.equalTo("objectId",options.sourceId);
		}
		return query.find().then(function(sources) {
			CCObject.log('sources query found '+sources.length);
			var promises = [];
			for (var i=0; i<sources.length; i++) {
				promises.push(sources[i].ingest(options));
			}
			return Parse.Promise.when(promises).then(function() {
				CCObject.log('[Ingestion] queue completed: '+promises.length);
				return true;
			});
		});
	},

});

exports.Source = Source;