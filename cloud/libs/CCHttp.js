var CCObject = require('cloud/libs/CCObject');

exports.defaultMaxAge = 1000 * 60 * 15; // 15 Minutes...

exports.normalizeKeys = function(obj) {
	var ret = {};
	for (var k in obj) {
		ret[k.toLowerCase()] = obj[k];
	}
	return ret;
}

// options must have:
// url, cacheName, success, error
exports.httpCachedRequest = function(options) {
	var parseClassName = 'Http'+options.cacheName,
			method = options.method || 'GET',
			key = options.key || (method + options.url),
			ContentClass = Parse.Object.extend(parseClassName),
			maxAge = parseInt(options.maxAge || exports.defaultMaxAge),
  		query = new Parse.Query(parseClassName),
  		validateForCaching = options.cacheValidation || function(obj) {
        return options.html || obj ? true : false;
      },
      parser = options.parser || function(httpResponse) {
        return httpResponse && httpResponse.text && !options.html ? JSON.parse(httpResponse.text) : null;
      },
      performCaching = function(httpResponse, obj) {
        // Either create or update the content
        if (!row) {
          row = new ContentClass();
          row.set('key', key);
          row.set('url', options.url);
        }
        if (obj) {
          row.set('obj', CCObject.sanitizeKeysForParseSave( obj ) );
        }
        if (typeof httpResponse === 'string') {
          row.set('error', CCObject.sanitizeKeysForParseSave( httpResponse ) );
          row.increment('errorCount');
        }
        else if (httpResponse) {
          row.set('errorCount', 0);
          // Causes save failures... doesn't seem to properly scrub nested keys (?)

          //row.set('cookies', CCObject.sanitizeKeysForParseSave( httpResponse.cookies ) );
          //row.set('headers', CCObject.sanitizeKeysForParseSave( httpResponse.headers ) );
          //row.set('status', CCObject.sanitizeKeysForParseSave( httpResponse.status ) );
        }
        return row.save().then(function(){ 
          return true;
        }, function(e) {
          console.log('http caching error');
          console.log(obj);
          console.log(httpResponse);
          console.log(e);
          console.log('byte size http' + CCObject.byteSize(httpResponse));
          console.log('byte size obj' + CCObject.byteSize( JSON.stringify( obj ) ));
        }).then(function() {
          return true;
        });
      },
  		row = null;

  query.equalTo('key', key);
  return query.first().then(function(r) {
    row = r;// Upscope it, intentionally.
    var updatedAt = row ? row.updatedAt.getTime() : 0,
        age = new Date().getTime() - updatedAt,
        err = parseInt(row ? row.get('errorCount') : 0),
        fresh = (maxAge < 0 || age < maxAge),
        validated = row && validateForCaching(row.get('obj'));
    if (err >= 3 || (validated && fresh)) {
      return false;
    }
    return Parse.Cloud.httpRequest({
      url: options.url,
      body: options.body || null,
      method: method,
      headers: options.headers || {}
    });
  }).then(function(httpResponse) {
    // Actually got the HTTP request.
    var obj = parser(httpResponse);
    if (!httpResponse) {
      // We had a cached response; no need to perform caching
      return true;
    }
    else if (validateForCaching(obj)) {
      // Cache validation succeded. Put it in.
      return performCaching(httpResponse, obj);
    }
    else {
      // Cache validation failed. Don't raise an error, we don't want to break promise chains.
      return performCaching('validation failed');
    }
  }).then(function() {
    return true;
  }, function(e) {
    // Swallow the error, so we don't break the whole endpoint.
    CCObject.log('[HTTP] recovering from http error: '+options.url,10);
    CCObject.log(e,10);
    return performCaching(JSON.stringify(e));
  }).then(function() {
    return row ? {
      obj: row.get('obj') || {},
      // cookies: row.get('cookies') || {},
      // headers: exports.normalizeKeys(row.get('headers') || {}),
      // status: row.get('status') || 0,
    } : false;
  });
};