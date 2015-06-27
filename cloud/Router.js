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
    apiRegex = '/api/v[0-9]{1}/',
    objectIdRegex = '[a-zA-Z0-9]{8,12}'; // I think this is always 10, but left some fudge

var app = null;

exports.apiMiddleware = function(req, res, next) {
	var vparts = req.url.match(apiRegex),
			vstr = vparts && vparts.length > 0 ? vparts[0] : '/v1/';
	req.apiVersion = parseInt(vstr.substring(2));
	next();	
}

/**
 * Register all the API endpoints
 */
function registerAPI() {
  // Some API matching middleware
	app.use(exports.apiMiddleware);

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

/**
 *
 * WEB
 *
 */
function registerWeb() {
  app.engine('jade', require('jade').__express);
  app.engine('ejs', require('ejs').__express);
  app.set('views', 'cloud/views');
  app.set('view engine','jade');	

	app.get('/', function(request, response) {
		response.render('index.jade', { pathToAssets: '', pathToSelectedTemplateWithinBootstrap: 'docs/examples/carousel' });
	});

	//
	// POST /ingest { Content }
	// For RSS Ingestion: https://github.com/mapkyca/ifttt-webhook
	//
	/*
	app.post(apiRegex + 'ingest', function(req, res){
		var Post = Parse.Object.extend("Post"),
				post = new Post();
		post.set('url',req.url);
		post.set('params',req.params);
		post.set('query',req.query);
		post.set('body',req.body);
		post.set('headers',req.headers);
		post.save().then(function(){
		  res.json(post);
		});
	});*/
}

exports.listen = function() {
	app = express();
	registerAPI();
	registerWeb();
	app.listen();
};