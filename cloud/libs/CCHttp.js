
exports.defaultTimeout = 1000 * 60 * 15; // 15 Minutes...

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
  		fetch = function() {
			  Parse.Cloud.httpRequest({
			  	url: options.url,
			  	body: options.body || null,
			  	method: method,
			  	headers: options.headers || {},
			  	success: function(httpResponse) {
			  		// Actually got the HTTP request.
			  		//console.log(httpResponse.text);
			  		var obj = httpResponse.text;
			  		if (!options.html) {
			  			obj = JSON.parse(obj);
			  		}

			  		if (validateForCaching(obj)) {
				  		// Either create or update the content
				  		if (!row) {
				  			row = new ContentClass();
				  			row.set('key', key);
				  			row.set('url', options.url);
				  		}
			  			row.set('obj', obj);
			  			row.save({
			  				success: function() {
			  					options.success(obj);
			  				},
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
  			options.success(row.get('obj'));
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