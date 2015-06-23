
exports.defaultTimeout = 1000 * 60 * 15; // 15 Minutes...

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
			timeout = parseInt(options.timeout || exports.defaultTimeout),
  		query = new Parse.Query(parseClassName),
  		validateForCaching = options.cacheValidator || function(obj) { return true; },
  		row = null,
  		callback = function(row) {
				options.success({
  				obj: row.get('obj'),
  				text: row.get('text'),
  				cookies: row.get('cookies'),
  				headers: normalizeKeys(row.get('headers')),
  				status: row.get('status'),
  			});
  		},
  		fetch = function() {
			  Parse.Cloud.httpRequest({
			  	url: options.url,
			  	body: options.body || null,
			  	method: method,
			  	headers: options.headers || {},
			  	success: function(httpResponse) {
			  		// Actually got the HTTP request.
			  		//console.log(httpResponse.text);
			  		if (validateForCaching(httpResponse.data)) {
				  		// Either create or update the content
				  		if (!row) {
				  			row = new ContentClass();
				  			row.set('key', key);
				  			row.set('url', options.url);
				  		}
			  			row.set('obj', httpResponse.data);
			  			row.set('text', httpResponse.text);
			  			row.set('cookies', httpResponse.cookies);
			  			row.set('headers', httpResponse.headers);
			  			row.set('status', httpResponse.status);
			  			row.save({
			  				success: callback,
			  				error: options.error,
			  			});
			  		}
			  		else {
			  			// Cache validation failed. Raise an error.
			  			console.log('[HTTP]cache validation failed');
			  			options.error(new Parse.ParseException(500, "Could not validate for cache"));
			  		}
			  	},
			  	error: options.error,
			  });
  		};

  query.equalTo('key', key);
  return query.first({
  	success: function(found) {
  		row = found;
  		var updatedAt = row ? row.updatedAt.getTime() : 0,
  				age = new Date().getTime() - updatedAt;
  		if (row && (timeout < 0 || age < timeout)) {
	  		//console.log('cache hit: '+ key);
  			callback(row);
  		}
  		else {
  			//console.log('cache miss (age)');
  			fetch();
  		}
  	},
  	error: function() {
			//console.log('cache miss (new)');
  		fetch();
  	},
  });
};