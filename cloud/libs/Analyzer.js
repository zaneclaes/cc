
var CCHttp = require('cloud/libs/CCHttp'),
    CCObject = require('cloud/libs/CCObject'),
    PrismaticAPIToken = 'MTQzNDQ5MzQzOTk4Ng.cHJvZA.WmFuZUBDbGFlcy5iaXo.9YeCgGVYBjysjxrJWtsOO_3fkVk';

//
// Given a headline, what is it's sentiment/share score? 0-100
//
exports.headlineScore = function(headline, options) {
  var url = 'https://cos-headlines.herokuapp.com/?headline=' + encodeURIComponent(headline);
  return CCHttp.httpCachedRequest({
    url: url,
    key: headline,
    cacheName: 'Headline',
    timeout: -1, // Cache forever, headlines do not change in score
    success: options.success,
    error: options.error,
  });
}

//
// Facebook share count
//
exports.fbGraph = function(url, response) {
  var ogQuery = 'https://graph.facebook.com/' + encodeURIComponent(url);
  return CCHttp.httpCachedRequest({
    url: ogQuery,
    key: url,
    cacheName: 'FacebookGraph',
    success: response.success,
    error: response.error,
  });
}

//
// Extract all meta tags
//
exports.metaTags = function(url, response) {
  var getKV = function(match) {
    match = match.split('=');
    var key = match.shift();
    var val = match.join('=');
    if (val && (val.indexOf('"')==0 || val.indexOf('"')==0)) {
      val = val.substr(1,val.length-2);
    }
    return key && val ? {'k': key, 'v': val} : null;
  };
  return CCHttp.httpCachedRequest({
    url: url,
    key: url,
    html: true,
    cacheName: 'MetaTags',
    timeout: -1, // never expire, always goood.
    success: function(result) {
      var tags = result.text.match(new RegExp("<meta\\s*(?:(?:\\b(\\w|-)+\\b\\s*(?:=\\s*(?:[\"\"[^\"\"]*\"\"|'[^']*'|[^\"\"'<> ]|[''[^'']*''|\"[^\"]*\"|[^''\"<> ]]]+)\\s*)?)*)/?\\s*>",'gi')),
          res = [];
      for(var t in tags) {
        var map = {};
        var m = tags[t].match(/((\S+)=["']?((?:.(?!["']?\s+(?:\S+)=|[>"']))+.)["']?)+/gi);
        if (!m) continue;
        for (var i=0; i<m.length; i++) {
          var kv = getKV(m[i]);
          if (kv) {
            map[kv.k] = kv.v;
          }
        }
        res.push(map);
      }
      response.success({
        tags : res,
        headers : result.headers,
      });
    },
    error: function(e) {
      response.error(e);
    },
  });
}

//
// Prismatic
//
exports.prismaticAnnotations = function(url, response) {
  return CCHttp.httpCachedRequest({
    url: 'http://interest-graph.getprismatic.com/url?api-token=' + PrismaticAPIToken,
    body: {
      "url" : url
    },
    key: url,
    cacheName: 'PrismaticAnnotation',
    timeout: -1, // never expire, always goood.
    method: 'POST',
    header:{
      'Content-Type': 'application/json',
    },
    success: response.success,
    error: response.error,
  });
}