var isLocal = typeof __dirname !== 'undefined',
    root = isLocal ? './' : 'cloud/',
    fs = require('fs'),
    jade = require('jade'),
    Analyzer = require('cloud/libs/Analyzer'),
    CCObject = require('cloud/libs/CCObject'),
    Content = require('cloud/Content').Content,
    Delta = require('cloud/Delta').Delta,
    Fork = require('cloud/Fork').Fork,
    Source = require('cloud/Source').Source,
    Stream = require('cloud/Stream').Stream,
    StreamItem = require('cloud/StreamItem').StreamItem,
    express = require('express'),
    Image = require('parse-image'),
    parseExpressHttpsRedirect = require('parse-express-https-redirect'),
  	parseExpressCookieSession = require('parse-express-cookie-session'),
    apiRegex = '^/api/v[0-9]{1}/',
    queryParamRegex = '',//'(.*)',//'([\\?\\&]\\w*=\\w*)*',
    usernameRegex = '[a-zA-Z\.\-]{3,16}',
    canonicalNameRegex = '[a-zA-Z0-9#\-]{1,37}' // 32 canonicalName.maxLength + # + 4 characters for uniqueness 
    objectIdRegex = '[a-zA-Z0-9]{8,12}'; // I think this is always 10, but left some fudge

var app = null;

exports.onError = function(req, res) {
  return function(error) {
    CCObject.log('[ERROR]['+req.url+']',10);
    CCObject.log(error, 10);
    if (typeof res.json === 'function') {
      res.json({'error' : error});
    }
    else {
      res.error(error ? JSON.stringify(error) : '?');
    }
  };
}

/***************************************************************************************
 * API
 ***************************************************************************************/

function deltasMiddleware(req, res, next) {
	var vparts = req.url.match(apiRegex),
			vstr = vparts && vparts.length > 0 ? vparts[0] : '/v1/';
	req.apiVersion = parseInt(vstr.substring(2));
  req.vars = req.vars || getJadeVariables(req);
	next();	
}

function registerAPI() {
	// GET /streams/:id
  var getStreamsId = apiRegex+'streams/'+canonicalNameRegex+'\.(rss|html|json)'+queryParamRegex+'$';
	app.get(getStreamsId, function(req, res) {
		var parts = req.url.split('/'),
        end = parts[4].split('.'),
        format = end[1].split('?')[0],
        root = getJadeVariables(req)['root'],
        json = {};
        
		req.query.canonicalName = end[0];
		Stream.find(req.query).then(function(s) {
      if (!s) {
        throw new Error("Stream not found");
      }
      var params = JSON.parse( JSON.stringify( req.query ) );
      params.format = format;
      params.url = req.url;
      params.link = root + req.url;
      params.jadeVars = getJadeVariables();
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
		}, exports.onError(req, res));
	});

  // GET stream_items/:id
  var getImage = apiRegex+'stream_items/'+objectIdRegex+queryParamRegex+'$';
  app.get(getImage, restfulObjectLookup(), function(req, res) {
    req.stream_item.updateClicks().then(function() {
      res.json(req.stream_item.present());
    }, exports.onError(req, res));
  });

  // GET stream_items/:id/image
  var getImage = apiRegex+'stream_items/'+objectIdRegex+'/image'+queryParamRegex+'$';
  app.get(getImage, restfulObjectLookup(), function(req, res) {
    req.stream_item.thumbnail(req.query).then(function(fileUrl) {
      if (fileUrl) {
        res.redirect(fileUrl);
      }
      else {
        exports.onError(req, res)('No images found');
      }
    }, exports.onError(req, res));
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
  var root = req ? req.protocol+'://'+req.host : 'https://www.deltas.io';
  return {
    root: root,
    title: "Surface What's Good",
    user: null,
    pathToAssets: '',
    pendingCount: 0,
    streamDeltas: false,
    oauthCallback: root + "/oauth/callback",
    templates: ['default','product'],
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

// Ex: we're accessing /about/xyz
// Will try to load views/about/xyz.jade
// if doesn't exist, use views/about/index.jade
// Then render it using views/about.jade
function renderSubPage(req, res) {
  var parts = req.url.split('/'),
      dir = parts[1],
      page = parts[2],
      exists = fs.existsSync('cloud/views/'+dir+'/'+page+'.jade');
  page = exists ? page : 'index';

  res.render(dir+'/'+page+'.jade', req.vars, function(err, html) {
    match = html ? html.match(/<h1>(.*)<\/h1>/i) : [];
    if (match && match.length >= 2) {
      req.vars.title = match[1];
    }
    req.vars[dir] = html;
    renderWebpage('about',req,res);
  });
}
/***************************************************************************************
 * WEB MIDDLEWARE
 ***************************************************************************************/
function allowCrossDomain(req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
  // intercept OPTIONS method
  if ('OPTIONS' == req.method) {
    res.send(200);
  }
  else {
    next();
  }
}
/**
 * Middleware
 * Knows that /stream_items/123 => Query("StreamItem").id == 123
 * Assigns the object to req.StreamItem
 */
function restfulObjectLookup(querySetupFunc, postFindFunc) {
  return function(req, res, next) {
    var parts = req.url.split('/'),
        base = parts.length > 1 && parts[1] === 'api' ? 2 : 0,
        objectType = parts.length > (base+1) ? parts[base+1] : null,
        objectId = parts.length > (base+2) ? parts[base+2] : null,
        onError = exports.onError(req, res);
    if (!objectType || !objectId || objectType.length <= 0 || objectId.length <= 0) {
      onError('Object ID lookup failed');
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
    query.first().then(function(model) {
      if (!model) {
        onError('No object existed for '+KlassName+'::'+objectId+'::'+parts.join('/'));
      } else {
        var objectTypeSing = objectType.slice(0, objectType.length-1);
        req[objectTypeSing] = model;
        req.vars = req.vars || getJadeVariables(req);
        req.vars[objectTypeSing] = JSON.parse( JSON.stringify( model ) );
        if (postFindFunc) {
          postFindFunc(req[objectTypeSing], next);
        }
        else {
          next();
        }
      }
    }, onError);
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
  }, exports.onError(req, res));
}
function mapObjectsOnRequest(req, key, objects) {
  objects = objects || [];
  req[key] = objects;
  req.vars[key] = JSON.parse(JSON.stringify(objects));
  var mapKey = key + 'Map';
  req[mapKey] = {};
  for (var x in objects) {
    var obj = objects[x];
    req[mapKey][obj.id] = obj; 
  }
}
// say we have stream items, like scheduled posts
// we don't want to use an inclusion query to keep down load
// instead, we post-hoc map the full objects back onto each obj
function mapFullObjectsOntoObjects(objects, req) {
  var mappable = {
    stream: req.streamMap,
    source: req.sourcesMap,
    delta: req.deltaMap,
  };
  for (var k in mappable) {
    for (var o in objects) {
      var cmp = objects[o][k],
          full = mappable[k][cmp.objectId];          
      if (full) {
        objects[o][k] = JSON.parse( JSON.stringify( full ) );
      }
    }
  }
}
/**
 * Errors if the user is not logged in
 * Also assigns streams, pending, deltas, stream, streamDeltas
 */
function requireLogin(req, res, next) {
  if (!Parse.User.current()) {
    renderLoginError("You must be logged in to do that.", res);
    return;
  }
  loadCurrentUserData(req, res, next);
}
function loadCurrentUserData(req, res, next) {
  if (!Parse.User.current()) {
    next();
    return;
  }

  var query = new Parse.Query(Stream),
      urlParts = req.url.split('/'),
      streamId = urlParts.length >= 3 && urlParts[1] === 'streams' ? urlParts[2] : null,
      streamIds = [],
      sourceIds = [],
      forkIds = [];

  // Start by loading all the user's streams
  query.equalTo('user',Parse.User.current());
  query.find().then(function(streams) {
    req.streams = streams;
    req.streamMap = {};
    var stream = null;
    for (var s in streams) {
      if (streamId && streams[s].id === streamId) {
        stream = streams[s];
      }
      streamIds.push(streams[s].id);
      req.streamMap[streams[s].id] = streams[s];
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
      sourceIds = CCObject.arrayUnion(sourceIds, deltas[d].get('sourceIds') || []);
      forkIds = CCObject.arrayUnion(forkIds, deltas[d].get('forkIds') || []);
    }
    sourceIds = CCObject.arrayUnique(sourceIds);
    forkIds = CCObject.arrayUnique(forkIds);
    req.deltas = deltas;
    req.vars.deltas = JSON.parse(JSON.stringify(deltas)); 

    // Find related information
    var qs = new Parse.Query(Source);
    qs.containedIn('objectId',sourceIds);
    qs.limit(1000);

    var qf = new Parse.Query(Fork);
    // n.b., returning all forks for now so that we can render them all as possible additions to a delta
    //qf.containedIn('objectId',forkIds);

    return Parse.Promise.when([
      qs.find(),
      qf.find(),
    ]);
  }).then(function(sources, forks) {
    mapObjectsOnRequest(req, 'sources', sources);
    mapObjectsOnRequest(req, 'forks', forks);

    // Find static & dynamic content...
    var qsc = null,
        qdc = null;
    if (req.stream && sources && sources.length) {
      var staticSources = [],
          dynamicSources = [];
      for (var s in sources) {
        if (sources[s].get('type') === Source.TYPE_STATIC) {
          staticSources.push(sources[s]);
        }
        else {
          dynamicSources.push(sources[s]);
        }
      }
      if (staticSources.length > 0) {
        qsc = new Parse.Query(Content);
        qsc.containedIn('source', staticSources);
        qsc.descending('createdAt');
        qsc.limit(1000);
      }
      if (dynamicSources.length > 0) {
        qdc = new Parse.Query(Content);
        qdc.containedIn('source', dynamicSources);
        qdc.descending('createdAt');
        qdc.limit(1000);
      }
    }

    // Find all the pending stream items that are forked or accepted
    var qi = new Parse.Query(StreamItem);
    qi.containedIn('stream',req.streams);
    qi.greaterThan('scheduledAt', new Date());
    qi.containedIn('status',[StreamItem.STATUS_FORKED,StreamItem.STATUS_ACCEPTED]);
    qi.ascending('scheduledAt');

    return Parse.Promise.when([
      qsc ? qsc.find() : Parse.Promise.as([]),
      qdc ? qdc.find() : Parse.Promise.as([]),
      qi.find().then(Stream.dedupe).then(schedule(req)),
    ]);
  }).then(function(static_contents, dynamic_contents, items) {
    mapObjectsOnRequest(req, 'static_contents', static_contents || []);
    mapObjectsOnRequest(req, 'dynamic_contents', dynamic_contents || []);

    var itms = JSON.parse(JSON.stringify(items));
    mapFullObjectsOntoObjects(itms, req);

    for (var i in itms) {
      var date = new Date(itms[i].scheduledAt.iso);
      itms[i].scheduledAt = date.toString();
      itms[i].untilScheduled = CCObject.timeUntil(date);
      itms[i].matches = itms[i].matches ? itms[i].matches.join(', ') : '';
    }
    req.pending = items;
    req.vars.pendingCount = items.length;
    req.vars.pending = itms;
    next();
  }, exports.onError(req, res));
}

// Break this out into a helper function b/c we may want to move the first item
// This happens when we POST to /scheduled, but since this is called as part of the
// login steps we need it up here, not in its own endpoint code.
function schedule(req) {
  return function(items) {
    if (req.url === '/scheduled' && req.method === 'POST' && items.length > 0) {
      // Reschedule the first item(s) before scheduling.
      var map = {};
      for (var i in items) {
        var stream = req.streamMap[items[i].get('stream').id];
        if (stream && !map[stream.id]) {
          var spacing = parseInt( req.body.spacing || stream.getSpacing() );
          var scheduledAt = (new Date()).getTime() + spacing;
          items[i].set('scheduledAt', new Date(scheduledAt));
          map[stream.id] = true;
        }
      }
    }
    return Stream.schedule(items, true);
  }
}

/***************************************************************************************
 * WEB ROUTES
 ***************************************************************************************/

function registerWeb() {
  app.use(parseExpressHttpsRedirect());  // Require user to be on HTTPS.

	// Login
  app.post('/login', function(req, res) {
  	Parse.User.logIn(req.body.username, req.body.password).then(function() {
      res.redirect('/streams');
    }, function() {
  		res.redirect('/login');
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
    stream.set('populatedAt', new Date(new Date().getTime() - 60000 * 60 * 24 * 30));
    stream.set('name', req.body.name);
    stream.set('user', Parse.User.current());
    stream.save().then(function(s){
      res.redirect('/streams/'+s.id);
    }, exports.onError(req, res));
  });
  // Individual stream page
  app.get('/streams/'+objectIdRegex, requireLogin, function(req, res) {
    renderWebpage('stream', req, res);
  });
  app.post('/streams/'+objectIdRegex, requireLogin, function(req, res) {
    if (typeof req.body.populate !== 'undefined') {
      req.stream.populate().then(function() {
        res.redirect(req.url);// Back into the GET endpoint.        
      });
      return;
    }
    var keys = ['name', 'template'];
    for (var k in keys) {
      var val = req.body[keys[k]];
      if (typeof val !== 'undefined') {
        req.stream.set(keys[k], val);
      }
    }
    req.stream.save().then(function() {
      res.redirect('/streams/'+req.stream.id+'#preview');// Back into the GET endpoint.
    }, exports.onError(req, res));
  });
  app.get('/streams/'+objectIdRegex+'/deltas', requireLogin, function(req, res) {
    res.render('deltas.jade', req.vars);
  });
  // Scheduling
  app.get('/scheduled', requireLogin, function(req, res) {
    renderWebpage('scheduled', req, res);
  });
  app.post('/scheduled', requireLogin, function(req, res) {
    renderWebpage('scheduled', req, res);
  });
  // Deltas
  app.post('/deltas', requireLogin, requireBodyParams(['streamId','name']), function(req, res) {
    var stream = req.streamMap[req.body.streamId];
    if (!stream) {
      return renderWebpage('404', req, res);
    }
    var delta = new Delta();
    delta.set('streamId',stream.id);
    delta.set('name',req.body.name);
    delta.save().then(function(d) {
      res.redirect('/streams/'+req.body.streamId+'#delta-'+d.id);
    }, exports.onError(req, res));
  });
  app.post('/deltas/'+objectIdRegex, requireLogin, requireBodyParams(['streamId','name']), restfulObjectLookup(), function(req, res) {
    req.delta.set('name',req.body.name);
    req.delta.save().then(function() {      
      res.redirect('/streams/'+req.body.streamId+'#delta-'+req.delta.id);
    }, exports.onError(req, res));
  });
  // Forks
  app.post('/forks', requireLogin, requireBodyParams(['streamId','deltaId','forkId']), function(req, res) {
    // We could validate the forkId here... but fuck it. Assume it's good.
    var delta = req.deltaMap[req.body.deltaId];
    if (!delta) {
      return renderWebpage('404', req, res);
    }
    var forkIds = delta.get('forkIds') || [],
        onDone = function() {
          res.redirect('/streams/'+req.body.streamId+'#delta-'+delta.id);
        };
    if (forkIds.indexOf(req.body.forkId) >= 0) {
      return onDone();
    }
    forkIds.push(req.body.forkId);
    delta.set('forkIds',forkIds);
    delta.save().then(onDone, exports.onError(req, res));
  });
  // Sources
  var sourceParams = ['deltaId','streamId','type','settings','name'];
  app.post('/sources', requireLogin, requireBodyParams(sourceParams), function(req, res) {
    var delta = req.deltaMap[req.body.deltaId],
        source = null;
    if (!delta) {
      renderWebpage('404', req, res);
      return;
    }
    var types = req.body.type.split('-');
    Source.factory({
      name : req.body.name,
      settings : { query : req.body.settings },
      type : types[0],
      subtype : types.length > 1 ? types[1] : null,
    }).then(function(s) {
      source = s;
      delta.add('sourceIds', s.id);
      return delta.save();
    }).then(function(d) {
      res.redirect('/streams/'+req.body.streamId+'#source-'+source.id);
    }, exports.onError(req, res));
  });
  // Create static content
  var contentsParams = ['streamId','sourceId','title','text','link','image','tags','params'],
      createContentMap = function(req, source) {
        if (!source) {
          renderWebpage('404', req, res);
          return false;
        }
        var img = req.body.image.length ? { url : req.body.image } : null,
            params = req.body.params.indexOf('{') === 0 ? JSON.parse(req.body.params) : {},
            map = {};
        map[req.body.link] = {
          'source' : source,
          'weight' : source.get('weight') || 1,
          'title' : req.body['title'],
          'text' : req.body['text'],
          'tags' : req.body['tags'].split(','),
          'images' : img ? [img] : [],
          'timestamp' : new Date().getTime(),
          'params' : params,
          //'payload' : lastEntry,
        };
        return map;
      };
  app.post('/contents', requireLogin, requireBodyParams(contentsParams), function(req, res) {
    var source = req.sourcesMap[req.body.sourceId],
        map = createContentMap(req, source);
    if (!map) {
      return;
    }
    Content.factory(map, source).then(function() {
      res.redirect('/streams/'+req.body.streamId+'#source-'+source.id);      
    }, exports.onError(req, res));
  });
  app.post('/contents/'+objectIdRegex, requireLogin, requireBodyParams(contentsParams), restfulObjectLookup(), function(req, res) {    
    var source = req.sourcesMap[req.body.sourceId],
        map = createContentMap(req, source);
    if (!map) {
      return;
    }
    var url = Object.keys(map)[0];
    map = map[url];
    map[url] = url;
    for (var k in map) {
      req.content.set(k, map[k]);
    }
    req.content.save().then(function() {
      return req.content.copyUpdatesToStreamItems();
    }).then(function() {
      res.redirect('/streams/'+req.body.streamId+'#source-'+source.id);  
    });
  });
  // Modify a stream item
  app.post('/stream_items/'+objectIdRegex, requireLogin, restfulObjectLookup(function(query) {
    query.include('stream');
  }), function(req, res) {
    var params = Object.keys(req.body),
        stream = req.stream_item ? req.stream_item.get('stream') : false,
        accepted = params.indexOf('accept') >= 0,
        rejected = params.indexOf('reject') >= 0,
        deleted = params.indexOf('delete') >= 0;

    if (!stream || stream.get('user').id !== Parse.User.current().id) {
      renderWebpage('404', req, res);
    } else if (accepted || rejected) {
      var status = accepted ? StreamItem.STATUS_ACCEPTED : StreamItem.STATUS_REJECTED;
      req.stream_item.set('status',status);
      req.stream_item.save().then(function(obj) {
        res.redirect('/scheduled');
      }, exports.onError(req, res));
    } else if (deleted) {   
      var streamId = req.stream_item.get('stream').id;   
      req.stream_item.destroy().then(function(obj) {
        res.redirect('/streams/'+streamId+'#preview');
      }, exports.onError(req, res));
    } else {
      // NOP
      res.redirect('/scheduled');
    }
  });

  // Complete OAuth: GET /oauth/callback
  app.get('/oauth/callback' + queryParamRegex + '$', function(req, res) {
    var q = new Parse.Query(Fork),
        fork = null,
        settings = {};
    q.equalTo('objectId',req.query.state);
    q.first().then(function(f) {
      fork = f;
      settings = fork.get('settings');
      return Parse.Cloud.httpRequest({
        url: 'https://api-ssl.bitly.com/oauth/access_token',
        body: {
          client_id: settings.client_id,
          client_secret: settings.client_secret,
          redirect_uri: req.vars.oauthCallback,
          code: req.query.code,
        },
        method: 'POST',
        header:{
          'Content-Type': 'application/json',
        },
      });
    }).then(function(httpResponse) {
      settings = CCObject.mapParams(httpResponse.text, settings);
      fork.set('settings',settings);
      return fork.save();
    }).then(function(f) {
      res.json({ state : req.query.state });
    }, exports.onError(req, res));
  });

  // Start OAuth: GET /oauth
  app.get('/oauth', function(req, res) {
    var q = new Parse.Query(Fork),
        fork = null,
        settings = {};
    q.equalTo('name','bitly');
    q.first().then(function(fork) {
      settings = fork.get('settings');
      res.redirect("https://bitly.com/oauth/authorize?" +
                   "client_id=" + settings.client_id +
                   "&state=" + fork.id +
                   "&redirect_uri=" + req.vars.oauthCallback);
    }, exports.onError(req, res));
  });

  app.get('/preview/' + canonicalNameRegex, function(req, res) {
    var parts = req.url.split('/'),
        stream_name = parts[2];
    req.vars.stream_name = stream_name;
    req.vars.title = "Preview";
    renderWebpage('preview', req, res);
  });

  // About renderer
  app.get('/about/[a-zA-Z0-9\-]+', renderSubPage);

  // Generic Page Renderer
  var titleMap = {
        index: "Surface What's Good",
        login: "Login to your Account",
        account: "Account Preferences",
      },
      allowedPages = Object.keys(titleMap);
  var genericRenderer = function(req, res) {
    page = req.url.split('/')[1];
    page = page && page.length > 0 ? page : 'index';
    if (!titleMap[page]) {
      page = '404';
    }
    req.vars.title = titleMap[page];
    renderWebpage(page, req, res);
  };
  for (var k in allowedPages) {
    app.get('/'+allowedPages[k], loadCurrentUserData, genericRenderer);
  }
  app.get('/',loadCurrentUserData,genericRenderer);
  app.use(function(req, res) {
    renderWebpage('404', req, res);
  });
}

/***************************************************************************************
 * FINAL MAIN SETUP :: LISTEN
 ***************************************************************************************/
exports.listen = function() {
	app = express();
  app.engine('jade', jade.__express);
  app.engine('ejs', require('ejs').__express);
  app.set('views', 'cloud/views');
  app.set('view engine','jade');
  app.use(express.bodyParser());
  app.use(express.cookieParser('298oeuhd91hrajoe89g1234h9k09812'));
  app.use(parseExpressCookieSession({ cookie: { maxAge: 14400000 } }));
  app.use(allowCrossDomain);
  app.use(deltasMiddleware); // Assign Jade vars, API vars, etc.

  registerAPI();
	registerWeb();
	app.listen();
};