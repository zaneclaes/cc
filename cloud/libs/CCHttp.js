var CCObject = require('cloud/libs/CCObject');

exports.defaultMaxAge = 1000 * 60 * 15; // 15 Minutes...

function normalizeKeys(obj) {
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
      performCaching = function(obj) {
        // Either create or update the content
        if (!row) {
          row = new ContentClass();
          row.set('key', key);
          row.set('url', options.url);
        }
        if (obj) {
          row.set('obj', obj);
          row.set('cookies', httpResponse.cookies);
          row.set('headers', httpResponse.headers);
          row.set('status', httpResponse.status);
        }
        return row.save();
      },
  		row = null;

  query.equalTo('key', key);
  return query.first().then(function(r) {
    row = r;// Upscope it, intentionally.
    var updatedAt = row ? row.updatedAt.getTime() : 0,
        age = new Date().getTime() - updatedAt;
    if (row && validateForCaching(row.get('obj')) && (maxAge < 0 || age < maxAge)) {
      //console.log('cache hit: '+ key);
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
      // We had a cached response
      return true;
    }
    else if (validateForCaching(obj)) {
      return performCaching(obj);
    }
    else {
      // Cache validation failed. Don't raise an error, we don't want to break promise chains.
      //CCObject.log('[HTTP] cache validation failed ' + (httpResponse.text ? httpResponse.text.length : -1),5);
      /*throw new Error('cache validation failed for '+options.url+':'+
                      (httpResponse.text ? httpResponse.text.length : -1)+':'+
                      (obj ? 'd' : ''));*/
      return performCaching(false);
    }
  }).then(function() {
    return true;
  }, function(e) {
    // Swallow the error, so we don't break the whole endpoint.
    //console.log('recovering from http error');
    return performCaching();
  }).then(function() {
    return row ? {
      obj: row.get('obj') || {},
      cookies: row.get('cookies') || {},
      headers: normalizeKeys(row.get('headers') || {}),
      status: row.get('status') || 0,
    } : false;
  });
};