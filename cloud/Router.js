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
function assignJadeVariables(req, res, next) {
  // req: headers, url, signedCookies, method, ip, ips, subdomains, path, host, protocol
  req.vars = {
    root: req.protocol+'://'+req.host+'/',
    user: null,
    pathToAssets: '',
  };
  next();
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
			return query.find();
		}).then(function(streams){
			req.streams = streams;
			render();
		});
	}
	else {
		render();
	}
}

function renderLoginError(error, res) {
	res.redirect('/login');
}

function requireLogin(req, res, next) {
	if (!Parse.User.current()) {
		renderLoginError("You must be logged in to do that.", res);
	}
	else {
		next();
	}
}

function loadStream(req, res, next) {
  var query = new Parse.Query(Stream),
      streamId = req.url.split('/')[2];
  query.equalTo('user',Parse.User.current());
  query.equalTo('objectId',streamId);
  query.first().then(function(stream) {
    if (stream) {
      req.stream = stream;
      req.vars.stream = JSON.parse(JSON.stringify(req.stream));
      req.vars.title = req.stream.get('name');

      var query = new Parse.Query(Delta);
      query.equalTo('streamId',streamId);
      return query.find();
    }
    else {
      renderWebpage('404', req, res);
    }
  }).then(function(deltas) {
    req.deltas = deltas;
    req.vars.deltas = JSON.parse(JSON.stringify(deltas));  
    req.vars.deltasStr = JSON.stringify(deltas);  
    next();
  });
}

function registerWeb() {
	var titleMap = {
		  	index: "Surface What's Good",
		  	about: "About Deltas.io",
		  	contact: "Contact",
		  	login: "Login to your Account",
		  	account: "Account Settings",
		  },
		  requiresLogin = ['account'];

  app.use(assignJadeVariables);

	// Login
  app.post('/login', function(req, res) {
  	Parse.User.logIn(req.body.username, req.body.password, {
  		success: function(user) {
	  		res.redirect('/account');
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
  app.get('/streams/'+objectIdRegex, requireLogin, assignJadeVariables, loadStream, function(req, res) {
    renderWebpage('stream', req, res);
  });
  app.get('/streams/'+objectIdRegex+'/deltas', requireLogin, assignJadeVariables, loadStream, function(req, res) {
    type = req.url.split('/')[3];
    res.render(type+'.jade', req.vars);
  });

  // Generic Page Renderer
	app.use(function(req, res) {
		page = req.url.split('/')[1];
		page = page && page.length > 0 ? page : 'index';
		if (!titleMap[page]) {
			page = '404';
		}
		if (requiresLogin.indexOf(page) >= 0 && !Parse.User.current()) {
			page = 'login';
		}
    req.vars.title = titleMap[page];
		renderWebpage(page, req, res);
	});
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
  app.use(parseExpressCookieSession({ cookie: { maxAge: 3600000 } }));

	registerAPI();
	registerWeb();
	app.listen();
};