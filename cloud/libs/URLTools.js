  
var CCHttp = require('cloud/libs/CCHttp');

//
// Facebook share count
//
exports.bitly = function(url, response) {
  var q = 'https://api-ssl.bitly.com/v3/shorten?access_token=aa9e7bc8d011bbacf98afe6fc7cf0dd473037fdd&longUrl=' + encodeURIComponent(url);
  return CCHttp.httpCachedRequest({
    url: q,
    key: url,
    cacheName: 'Bitly',
    maxAge: -1, // never expire, always goood.
		cacheValidation: function(obj) {
			return obj && obj.data ? true : false;
		}
  });
}

/**
 * Add additional params to a URL
 * Respects query strings, #s, etc.
 * Replace will cause it to replace existing query vars
 */
exports.addParams = function(url, map, replace) {
  var hash = url.split('#') || [url],
      suffix = hash.length > 1 ? ('#' + hash[1]) : '',
      parts = hash[0].split('?'),
      query = parts.length > 1 ? parts[1] : false,
      keys = Object.keys(map),
      kvp = query ? query.split('&') : [],
      qs = [];

  for (var i in kvp) {
    x = kvp[i].split('=');
    if (x.length < 2) continue;
    if (!replace && keys.indexOf(x[0]) >= 0) continue;
    map[x[0]] = x[1];
  }

  for (var k in map) {
    qs.push(k + '=' + map[k]);
  }
  return parts[0] + '?' + qs.join('&') + suffix;
}