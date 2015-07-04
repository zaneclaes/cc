var isLocal = typeof __dirname !== 'undefined',
    root = isLocal ? './' : 'cloud/',
    Analyzer = require('cloud/libs/Analyzer'),
    CCObject = require('cloud/libs/CCObject'),
    Content = require('cloud/Content').Content,
    Delta = require('cloud/Delta').Delta,
    Source = require('cloud/Source'),
    Stream = require('cloud/Stream').Stream,
    StreamItem = require('cloud/StreamItem').StreamItem,
    express = require('express'),
    parseExpressHttpsRedirect = require('parse-express-https-redirect'),
  	parseExpressCookieSession = require('parse-express-cookie-session'),
    apiRegex = '^/api/v[0-9]{1}/',
    queryParamRegex = '',//'(.*)',//'([\\?\\&]\\w*=\\w*)*',
    usernameRegex = '[a-zA-Z\.\-]{3,16}',
    canonicalNameRegex = '[a-zA-Z0-9#\-]{1,37}' // 32 canonicalName.maxLength + # + 4 characters for uniqueness 
    objectIdRegex = '[a-zA-Z0-9]{8,12}'; // I think this is always 10, but left some fudge

var app = null;

function onWebError(req, res) {
  return function(error) {
    CCObject.log('[ERROR]['+req.url+']',10);
    CCObject.log(error, 10);
    res.error({'error' : error});
  };
}

/***************************************************************************************
 * API
 ***************************************************************************************/

function apiMiddleware(req, res, next) {
	var vparts = req.url.match(apiRegex),
			vstr = vparts && vparts.length > 0 ? vparts[0] : '/v1/';
	req.apiVersion = parseInt(vstr.substring(2));
	next();	
}

function registerAPI() {
	app.use(apiMiddleware);

	// GET /streams/:id
  var getStreamsId = apiRegex+'streams/'+canonicalNameRegex+'\.(rss|html|json)'+queryParamRegex+'$';
	app.get(getStreamsId, function(req, res) {
		var parts = req.url.split('/'),
        end = parts[4].split('.'),
        format = end[1].split('?')[0],
        root = getJadeVariables(req)['root'],
        json = {};
		req.params.canonicalName = end[0];
		Stream.find(req.params).then(function(s) {
      var params = JSON.parse( JSON.stringify( req.query ) );
      params.format = format;
      params.url = req.url;
      params.link = root + req.url;
      console.log(params);
      return s.present(params);
    }).then(function(obj) {
      if (format === 'json') {
        res.json(obj);
      }
      else if (format === 'html') {
        res.type('html');
        res.end(obj);
      }
      else if(format === 'rss') {
        //res.header('Content-Type:','application/rss+xml; charset=UTF-8');
        res.end(obj);
      }
      else {
        res.json({'error' : format})
      }
		}, onWebError(req, res));
	});
/*
	// GET /sources/:id
	app.get(apiRegex + 'sources/' + objectIdRegex, function(request, response) {
		var parts = request.url.split('/'),
				sourceId = parts[4],
				query = new Parse.Query(Source);
		query.equalTo('objectId',sourceId);
		query.first({
			success: function(source) {
				query = new Parse.Query(Content);
				query.equalTo('source',source);
				query.descending('createdAt');
				query.find({
					success: function(contents) {
						var json = CCObject.scrubJSON(source, []);
						json.contents = contents;
						response.json(json);
					},
					error: response.error,
				});
			},
			error: response.error,
		});
	});

	// Content lookup.
	app.get('/' + objectIdRegex + '/[0-9]{4}[/\-][0-9]{2}[/\-][0-9]{2}[/\-][a-zA-Z0-9\-]*', function(request, response) {
		var parts = request.url.split('/');
		parts.shift();
		var streamId = parts.shift(),
				query = new Parse.Query(StreamItem);
		query.equalTo('shortcode', parts.join('/'));
		query.equalTo('stream.objectId',streamId);
		query.first({
			success: function(item) {
				response.json(item);
			},
			error: response.error,
		});
	});*/
}
/***************************************************************************************
 * WEB HELPERS
 ***************************************************************************************/
function getJadeVariables(req) {
  // req: headers, url, signedCookies, method, ip, ips, subdomains, path, host, protocol
  return {
    root: req ? req.protocol+'://'+req.host : 'https://www.deltas.io',
    title: "Surface What's Good",
    user: null,
    pathToAssets: '',
    pendingCount: 0,
    streamDeltas: false,
  };
}
function renderLoginError(error, res) {
  res.redirect('/login');
}
function renderWebpage(page, req, res) {
  req.vars = req.vars || getJadeVariables(req);
  req.vars.page = page;
  var render = function() {
    if (req.streams) {
      req.vars.streams = JSON.parse(JSON.stringify(req.streams));
    }
    res.render(page+'.jade', req.vars, function(err, html) {
      if (err && !html) {
        html = '<br><br><br><br><div class="container">';
        html += '<p>There was an error compiling "'+page+'.jade"</p>';
        html += '<code>' + JSON.stringify(err) + '</code>';
        html += '</div>';
      }
      req.vars.pageContents = html;
      res.render('main.jade', req.vars);
    });
  }

  if (Parse.User.current()) {
    populateUser(req, res, render);
  }
  else {
    render();
  }
}
/***************************************************************************************
 * WEB MIDDLEWARE
 ***************************************************************************************/
/**
 * Middleware
 * Knows that /stream_items/123 => Query("StreamItem").id == 123
 * Assigns the object to req.StreamItem
 */
function restfulObjectLookup(querySetupFunc, postFindFunc) {
  return function(req, res, next) {
    var parts = req.url.split('/'),
        objectType = parts.length > 1 ? parts[1] : null,
        objectId = parts.length > 2 ? parts[2] : null;
    if (!objectType || !objectId || objectType.length <= 0 || objectId.length <= 0) {
      res.error('Object ID lookup failed');
      return;
    }
    var objectTypeParts = objectType.split('_'),
        KlassName = '';
    for (o in objectTypeParts) {
      var string = objectTypeParts[o].toLowerCase();
      KlassName += string.charAt(0).toUpperCase() + string.slice(1);
    }
    KlassName = KlassName.slice(0,KlassName.length-1);
    var query = new Parse.Query(KlassName);
    query.equalTo('objectId',objectId);
    if (querySetupFunc) {
      querySetupFunc(query);
    }
    query.first({
      success: function(model) {
        if (!model) {
          res.error('No object existed for '+KlassName+'::'+objectId);
        } else {
          var objectTypeSing = objectType.slice(0, objectType.length-1);
          req[objectTypeSing] = model;
          req.vars[objectTypeSing] = JSON.parse( JSON.stringify( model ) );
          if (postFindFunc) {
            postFindFunc(req[objectTypeSing], next);
          }
          else {
            next();
          }
        }
      },
      error: res.error,
    });
  }
}

function requireBodyParams(params) {
  return function(req, res, next) {
    var missing = [],
        keys = Object.keys(req.body);
    for (var p in params) {
      if (keys.indexOf(params[p]) < 0) {
        missing.push(params[p]);
      }
    }
    if (missing.length > 0) {
      throw new Error('Missing params: '+missing.join(', '));
    }
    else {
      next();
    }
  }
}

function populateUser(req, res, next) {
  return Parse.User.current().fetch().then(function(user) {
    req.user = user;
    req.vars.user = user ? JSON.parse(JSON.stringify(user)) : null;
    if (req.streams) {
      return req.streams; // passed into next
    }
    else {
      var query = new Parse.Query(Stream);
      query.equalTo('user',user);
      return query.find();
    }
  }).then(function(streams) {
    req.streams = streams;
    next();
  }, onWebError(req, res));
}
/**
 * Errors if the user is not logged in
 * Also assigns streams, pending, deltas, stream, streamDeltas
 */
function requireLogin(req, res, next) {
  req.vars = getJadeVariables(req);
  if (!Parse.User.current()) {
    renderLoginError("You must be logged in to do that.", res);
    return;
  }

  var query = new Parse.Query(Stream),
      urlParts = req.url.split('/'),
      streamId = urlParts.length >= 3 && urlParts[1] === 'streams' ? urlParts[2] : null,
      streamIds = [];

  // Start by loading all the user's streams
  query.equalTo('user',Parse.User.current());
  query.find().then(function(streams) {
    req.streams = streams;
    var stream = null,
        promises = [];    
    for (var s in streams) {
      if (streamId && streams[s].id === streamId) {
        stream = streams[s];
      }
      streamIds.push(streams[s].id);
      promises.push(streams[s].populate());
    }
    if (streamId) {
      // If we're at a /streams/:id endpoint, either assign the stream or error if it's not found
      if (stream) {
        req.stream = stream;
        req.vars.stream = JSON.parse(JSON.stringify(req.stream));
        req.vars.title = req.stream.get('name');
      }
      else {
        renderWebpage('404', req, res);
        return null;
      }
    }
    return Parse.Promise.when(promises);
  }).then(function() {
    // Find all deltas
    var query = new Parse.Query(Delta);
    query.containedIn('streamId',streamIds);
    return query.find();
  }).then(function(deltas) {
    if (streamId) {
      req.streamDeltas = []; // Deltas for active steram
      for (var d in deltas) {
        if (deltas[d].get('streamId') === streamId) {
          req.streamDeltas.push(deltas[d]);
        }
      }
      req.vars.streamDeltas = JSON.parse(JSON.stringify( req.streamDeltas ));
    }
    req.deltaMap = {};
    for (var d in deltas) {
      req.deltaMap[deltas[d].id] = deltas[d];
    }
    req.deltas = deltas;
    req.vars.deltas = JSON.parse(JSON.stringify(deltas));  

    // Find all the pending stream items that are forked or accepted
    var query = new Parse.Query(StreamItem);
    query.containedIn('stream',req.streams);
    query.greaterThan('scheduledAt', new Date());
    query.containedIn('status',[StreamItem.STATUS_FORKED,StreamItem.STATUS_ACCEPTED]);
    return query.find();
  }).then(Stream.dedupe).then(function(items) {
    var itms = JSON.parse(JSON.stringify(items));
    for (var i in itms) {
      var date = new Date(itms[i].scheduledAt.iso);
      itms[i].scheduledAt = date.toString();
      itms[i].untilScheduled = CCObject.timeUntil(date);
      itms[i].matches = itms[i].matches.join(', ');
    }
    req.pending = items;
    req.vars.pendingCount = items.length;
    req.vars.pending = itms;
    next();
  }, onWebError(req, res));
}

/***************************************************************************************
 * WEB ROUTES
 ***************************************************************************************/

function registerWeb() {
	// Login
  app.post('/login', function(req, res) {
  	Parse.User.logIn(req.body.username, req.body.password, {
  		success: function(user) {
	  		res.redirect('/streams');
  		},
  		error: function(user, error) {
  			res.redirect('/login');
  		}
  	});
  });

 	// Logout
  app.get('/logout', function(req, res) {
		Parse.User.logOut();
    res.redirect('/');
  });

  // Stream Main Page
  app.get('/streams', requireLogin, function(req, res) {
    req.vars.title = "Streams";
    renderWebpage('streams', req, res);
  });
  app.post('/streams', requireLogin, function(req, res) {
    var stream = new Stream();
    stream.set('presentedAt', new Date(new Date().getTime() - 60000 * 60 * 24 * 30));
    stream.set('lastPopulation', new Date(new Date().getTime() - 60000 * 60 * 24 * 30));
    stream.set('name', req.body.name);
    stream.set('user', Parse.User.current());
    stream.save().then(function(s){
      res.redirect('/streams/'+s.id);
    }, onWebError(req, res));
  });
  // Individual stream page
  app.get('/streams/'+objectIdRegex, requireLogin, function(req, res) {
    renderWebpage('stream', req, res);
  });
  app.get('/streams/'+objectIdRegex+'/deltas', requireLogin, function(req, res) {
    res.render('deltas.jade', req.vars);
  });
  app.get('/scheduled', requireLogin, function(req, res) {
    renderWebpage('scheduled', req, res);
  });
  // Sources
  app.post('/sources', requireLogin, requireBodyParams(['deltaId','streamId','type','settings']), function(req, res) {
    var delta = req.deltaMap[req.body.deltaId],
        source = null;
    if (!delta) {
      renderWebpage('404', req, res);
    } else {
      var types = req.body.type.split('-');
      Source.factory({
        name : req.body.settings,
        settings : { query : req.body.settings },
        type : types[0],
        subtype : types.length > 1 ? types[1] : null,
      }).then(function(s) {
        source = s;
        delta.add('sourceIds', s.id);
        return delta.save();
      }).then(function(d) {
        res.redirect('/streams/'+req.body.streamId+'#source-'+source.id);
      });
    }

  });

  // Modify a stream item
  app.post('/stream_items/'+objectIdRegex, requireLogin, restfulObjectLookup(function(query) {
    query.include('stream');
  }), function(req, res) {
    var params = Object.keys(req.body),
        stream = req.stream_item ? req.stream_item.get('stream') : false,
        accepted = params.indexOf('accept') >= 0,
        rejected = params.indexOf('reject') >= 0;

    if (!stream || stream.get('user').id !== Parse.User.current().id) {
      renderWebpage('404', req, res);
    } else if (accepted || rejected) {
      var status = accepted ? StreamItem.STATUS_ACCEPTED : StreamItem.STATUS_REJECTED;
      req.stream_item.set('status',status);
      req.stream_item.save().then(function(obj) {
        res.redirect('/scheduled');
      }, onWebError(req, res));
    } else {
      // NOP
      res.redirect('/scheduled');
    }
  });

  // Generic Page Renderer
  var titleMap = {
        index: "Surface What's Good",
        login: "Login to your Account",
        account: "Account Preferences",
      },
      allowedPages = Object.keys(titleMap);
  var genericRenderer = function(req, res) {
    req.vars = getJadeVariables(req);
    page = req.url.split('/')[1];
    page = page && page.length > 0 ? page : 'index';
    if (!titleMap[page]) {
      page = '404';
    }
    req.vars.title = titleMap[page];
    renderWebpage(page, req, res);
  };
  for (var k in allowedPages) {
    app.get('/'+allowedPages[k], genericRenderer);
  }
  app.get('/',genericRenderer);
  app.use(function(req, res) {
    renderWebpage('404', req, res);
  });
}

/***************************************************************************************
 * FINAL MAIN SETUP :: LISTEN
 ***************************************************************************************/
exports.listen = function() {
	app = express();
  registerAPI();

  app.engine('jade', require('jade').__express);
  app.engine('ejs', require('ejs').__express);
  app.set('views', 'cloud/views');
  app.set('view engine','jade');
  app.use(parseExpressHttpsRedirect());  // Require user to be on HTTPS.
  app.use(express.bodyParser());
  app.use(express.cookieParser('298oeuhd91hrajoe89g1234h9k09812'));
  app.use(parseExpressCookieSession({ cookie: { maxAge: 14400000 } }));

	registerWeb();
	app.listen();
};