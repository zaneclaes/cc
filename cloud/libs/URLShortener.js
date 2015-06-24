
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
    timeout: -1, // never expire, always goood.
		cacheValidation: function(obj) {
			return obj && obj.data ? true : false;
		},
    success: response.success,
    error: response.error,
  });
}