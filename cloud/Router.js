var isLocal = typeof __dirname !== 'undefined',
    root = isLocal ? './' : 'cloud/',
    Analyzer = require('cloud/libs/Analyzer'),
    CCObject = require('cloud/libs/CCObject'),
    Content = require('cloud/Content').Content,
    Delta = require('cloud/Delta').Delta,
    Source = require('cloud/Source'),
    OpQueue = require('cloud/libs/CCOpQueue').OpQueue,
    Stream = require('cloud/Stream').Stream,
    StreamItem = require('cloud/StreamItem').StreamItem,
    express = require('express'),
    parseExpressHttpsRedirect = require('parse-express-https-redirect'),
  	parseExpressCookieSession = require('parse-express-cookie-session'),
    apiRegex = '/api/v[0-9]{1}/',
    usernameRegex = '[a-zA-Z\.\-]{3,16}',
    objectIdRegex = '[a-zA-Z0-9]{8,12}'; // I think this is always 10, but left some fudge

var app = null;

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
	app.get(apiRegex + 'streams/' + objectIdRegex, function(request, response) {
		var parts = request.url.split('/');
		request.params.streamId = parts[4];
		Stream.stream(request.params, {
			success: function(out) {
				response.json(out.json);
			},
			error: function(e) {
	      response.json({'error': e});
	    },
		});
	});

	// GET /sources/:id
	app.get(apiRegex + 'sources/' + objectIdRegex, function(request, response) {
		var parts = request.url.split('/'),
				sourceId = parts[4],
				query = new Parse.Query(Source.Source);
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
	});
}

/***************************************************************************************
 * WEB
 ***************************************************************************************/
function getJadeVariables(req) {
  // req: headers, url, signedCookies, method, ip, ips, subdomains, path, host, protocol
  return {
    root: req ? req.protocol+'://'+req.host+'/' : 'https://www.deltas.io/',
    title: "Surface What's Good",
    user: null,
    pathToAssets: '',
    pendingCount: 0,
    streamDeltas: false,
  };
}
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
function renderWebpage(page, req, res) {
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
		Parse.User.current().fetch().then(function(user) {
			req.user = user;
			req.vars.user = user ? JSON.parse(JSON.stringify(user)) : null;
			if (req.streams) {
        render();
				return;
			}
			var query = new Parse.Query(Stream);
			query.equalTo('user',user);
			query.find({
        success: function(streams) {
          req.streams = streams;
          render();
        },
        error: render,
      });
		});
	}
	else {
		render();
	}
}

function renderLoginError(error, res) {
	res.redirect('/login');
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
      streamId = urlParts.length >= 3 && urlParts[1] === 'streams' ? urlParts[2] : null;

  // Start by loading all the user's streams
  query.equalTo('user',Parse.User.current());
  query.find().then(function(streams) {
    req.streams = streams;
    var stream = null,
        streamIds = [];
    
    for (var s in streams) {
      if (streamId && streams[s].id === streamId) {
        stream = streams[s];
      }
      streamIds.push(streams[s].id);
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

    req.deltas = deltas;
    req.vars.deltas = JSON.parse(JSON.stringify(deltas));  

    var query = new Parse.Query(StreamItem);
    query.containedIn('stream',req.streams);
    query.greaterThan('holdDate', new Date());
    query.equalTo('status',StreamItem.STATUS_FORKED);
    return query.find();
  }).then(function(pendingStreamItems) {    
    req.pending = pendingStreamItems;
    req.vars.pendingCount = pendingStreamItems.length;
    req.vars.pending = JSON.parse(JSON.stringify(pendingStreamItems));
    next();
  });
}

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
  app.get('/streams/'+objectIdRegex, requireLogin, function(req, res) {
    renderWebpage('stream', req, res);
  });
  app.get('/streams/'+objectIdRegex+'/deltas', requireLogin, function(req, res) {
    res.render('deltas.jade', req.vars);
  });
  app.get('/scheduled', requireLogin, function(req, res) {
    renderWebpage('scheduled', req, res);
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
      req.stream_item.save({
        success: function(obj) {
          res.redirect('/scheduled');
        },
        error: function(e) {
          res.error('could not save the obj');
        } 
      });
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
    console.log('generic render '+page);
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
}

/***************************************************************************************
 * LISTEN
 ***************************************************************************************/
exports.listen = function() {
	app = express();
  app.engine('jade', require('jade').__express);
  app.engine('ejs', require('ejs').__express);
  app.set('views', 'cloud/views');
  app.set('view engine','jade');
  app.use(parseExpressHttpsRedirect());  // Require user to be on HTTPS.
  app.use(express.bodyParser());
  app.use(express.cookieParser('298oeuhd91hrajoe89g1234h9k09812'));
  app.use(parseExpressCookieSession({ cookie: { maxAge: 14400000 } }));

	registerAPI();
	registerWeb();
	app.listen();
};