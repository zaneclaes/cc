
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
    maxAge: -1, // Cache forever, headlines do not change in score
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
    cacheName: 'MetaTags',
    maxAge: -1, // never expire, always goood.
    parser: function(httpRequest) { // It's not JSON, we custom parse the httpRequest
      var text = (httpRequest ? httpRequest.text : false) || '',
          tags = text.match(new RegExp("<meta\\s*(?:(?:\\b(\\w|-)+\\b\\s*(?:=\\s*(?:[\"\"[^\"\"]*\"\"|'[^']*'|[^\"\"'<> ]|[''[^'']*''|\"[^\"]*\"|[^''\"<> ]]]+)\\s*)?)*)/?\\s*>",'gi')),
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
      return {
        tags : res,
        headers : httpRequest.headers,
      };
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
    maxAge: -1, // never expire, always goood.
    method: 'POST',
    header:{
      'Content-Type': 'application/json',
    },
  });
}