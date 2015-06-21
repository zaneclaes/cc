var isLocal = typeof __dirname !== 'undefined',
    root = isLocal ? './' : 'cloud/',    
    Ingestion = require('cloud/Ingestion'),
    OpQueue = require('cloud/libs/CCOpQueue').OpQueue,
    CCObject = require('cloud/libs/CCObject'),
    Analyzer = require('cloud/libs/Analyzer'),
    StreamItem = require('cloud/StreamItem').StreamItem,
    Content = require('cloud/Content').Content,
    Stream = require('cloud/Stream').Stream;

/*************************************************************************************
* Public API [Endpoints]
 ************************************************************************************/
var express = require('express'),
    app = express(),
    apiRegex = '/api/v[0-9\.]{1,3}/',
    objectIdRegex = '[a-zA-Z0-9]{8,12}'; // I think this is always 10, but left some fudge

app.use(function(req, res, next) {
	var vparts = req.url.match(apiRegex),
			vstr = vparts.length > 0 ? vparts[0] : '/v0.1/';
	req.apiVersion = parseFloat(vstr.substring(2));
	next();
});

// GET /stream/:id
app.get(apiRegex + 'stream/' + objectIdRegex, function(request, response) {
	var parts = request.url.split('/');
	request.params.streamId = parts[4];
	Stream.stream(request.params, {
		success: function(items) {
			response.json(items);
		},
		error: response.error
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
  Ingestion.ingest({	
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