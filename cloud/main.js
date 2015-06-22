var isLocal = typeof __dirname !== 'undefined',
    root = isLocal ? './' : 'cloud/',    
    Analyzer = require('cloud/libs/Analyzer'),
    CCObject = require('cloud/libs/CCObject'),
    Content = require('cloud/Content').Content,
    Delta = require('cloud/Delta').Delta,
    Source = require('cloud/Source'),
    OpQueue = require('cloud/libs/CCOpQueue').OpQueue,
    Stream = require('cloud/Stream').Stream,
    StreamItem = require('cloud/StreamItem').StreamItem;

/*************************************************************************************
* Public API [Endpoints]
 ************************************************************************************/
var express = require('express'),
    app = express(),
    apiRegex = '/api/v[0-9]{1}/',
    objectIdRegex = '[a-zA-Z0-9]{8,12}'; // I think this is always 10, but left some fudge

app.use(function(req, res, next) {
	var vparts = req.url.match(apiRegex),
			vstr = vparts && vparts.length > 0 ? vparts[0] : '/v1/';
	req.apiVersion = parseInt(vstr.substring(2));
	next();
});

// GET /stream/:id
app.get(apiRegex + objectIdRegex, function(request, response) {
	var parts = request.url.split('/');
	request.params.streamId = parts[3];
	Stream.stream(request.params, {
		success: function(items) {
			response.json(items);
		},
		error: response.error
	});
});

// Content lookup.
app.get('/' + objectIdRegex + '/[0-9]{4}[/\-][0-9]{2}[/\-][0-9]{2}[/\-][a-zA-Z0-9\-]*', function(request, response) {
	var parts = request.url.split('/');
	parts.shift();
	var streamId = parts.shift();
	console.log(parts);
	var query = new Parse.Query(StreamItem);
	query.equalTo('shortcode', parts.join('/'));
	query.first({
		success: function(item) {
			response.json(item);
		},
		error: response.error,
	});
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

app.listen();
/*************************************************************************************
* Internal API [Cloud Functions]
 ************************************************************************************/

// Get a stream by a given stream ID
Parse.Cloud.define("stream", function(request, response) {
	Stream.stream(request.params, response);
});

// Tag a URL?
Parse.Cloud.define("tag", function(request, response) {
	Analyzer.metaTags(request.params.url, response);
});

// Get a content by a given objectId or name
Parse.Cloud.define("item", function(request, response) {
	var query = new Parse.Query(StreamItem);
	
	if (request.params.id && request.params.id.length) {
		query.equalTo('objectId', request.params.id);
	}
	else if (request.params.shortcode && request.params.shortcode.length) {
		query.equalTo('shortcode', request.params.shortcode);
	}
	query.first(response);
});

/*************************************************************************************
* Ingestion [Cloud Jobs]
 ************************************************************************************/

Parse.Cloud.job("ingest", function(request, status) {
	var startTime = new Date().getTime();
	status.message('ingesting...');
	Parse.Cloud.useMasterKey();
  Source.ingest({	
    success: function(res) {
    	status.success('ingested in '+(((new Date).getTime() - startTime)/1000) + 'sec');
    },
    error: function(e) {
      status.error("Error: " + e.toString() );
    }
  });
});

Parse.Cloud.job("analyze", function(request, status) {
	var startTime = new Date().getTime();
	status.message('analyzing...');
	Parse.Cloud.useMasterKey();
  Content.analyze({
    success: function(res) {
    	status.success('ingested in '+(((new Date).getTime() - startTime)/1000) + 'sec');
    },
    error: function(e) {
      status.error("Error: " + e.toString() );
    }
  });
});

Parse.Cloud.beforeSave("Content", function(request, response) {
	request.object.analyze(response);
});

Parse.Cloud.beforeSave("StreamItem", function(request, response) {
	request.object.finalize(response);
});

