var isLocal = typeof __dirname !== 'undefined',
    root = isLocal ? './' : 'cloud/',
    Analyzer = require('cloud/libs/Analyzer'),
    CCObject = require('cloud/libs/CCObject'),
    Content = require('cloud/Content').Content,
    Delta = require('cloud/Delta').Delta,
    Source = require('cloud/Source').Source,
    Stream = require('cloud/Stream').Stream,
    StreamItem = require('cloud/StreamItem').StreamItem,
    Router = require('cloud/Router');

/*
http://www.colourlovers.com/palette/27905/threadless
http://getbootstrap.com/2.3.2/components.html
*/

/*************************************************************************************
* Public API [Endpoints]
 ************************************************************************************/

Router.listen();

/*************************************************************************************
* Internal API [Cloud Functions]
 ************************************************************************************/

// Get a stream by a given stream ID
Parse.Cloud.define("stream", function(request, response) {
	Stream.find(request.params).then(function(s) {
    return s.present();
  }).then(function(json) {
    response.success(json.items);
  }, Router.onError(request, response));
});

// Tag a URL?
Parse.Cloud.define("tag", function(request, response) {
	Analyzer.metaTags(request.params.url).then(
    response.success, 
    Router.onError(request, response)
  );
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
	query.first().then(
    response.success, 
    Router.onError(request, response)
  );
});

/*************************************************************************************
* Ingestion [Cloud Jobs]
 ************************************************************************************/

Parse.Cloud.job("ingest", function(request, status) {
	var startTime = new Date().getTime();
	status.message('ingesting...');
	Parse.Cloud.useMasterKey();
  Source.ingest().then(function(res) {
  	status.success('ingested in '+(((new Date).getTime() - startTime)/1000) + 'sec');
  }, Router.onError(request, status));
});

Parse.Cloud.job("analyze", function(request, status) {
	var startTime = new Date().getTime();
	status.message('analyzing...');
	Parse.Cloud.useMasterKey();
  Content.analyze().then(function(res) {
  	status.success('ingested in '+(((new Date).getTime() - startTime)/1000) + 'sec');
  }, Router.onError(request, status));
});

Parse.Cloud.job("populate", function(request, status) {
  var query = new Parse.Query(Stream),
      now = (new Date()).getTime(),
      presDate = new Date(now - 1000 * 60 * 60), // anything we tried to present recently
      popDate = new Date(now - 1000 * 60),
      cnt = 0;
  query.greaterThan('presentedAt',presDate);
  query.lessThan('populatedAt',popDate);
  query.find().then(function(streams) {
    cnt = streams ? streams.length : -1;
    streams = streams || [];
    var promises = [];
    for (var s in streams) {
      promises.push(streams[s].populate());
    }
    return Parse.Promise.when(promises);
  }).then(function(){
    status.success('Populated '+cnt);
  }, Router.onError(request, status));
});

// Update clicks on items in streams that were presented recently
Parse.Cloud.job("updateClicks", function(req, status) {
  var query = new Parse.Query(Stream),
      now = (new Date()).getTime(),
      presDate = new Date(now - 1000 * 60 * 60), // anything we tried to present recently
      promises = [];
  query.greaterThan('presentedAt',presDate);
  query.find().then(function(streams) {
    for (var s in streams) {
      promises.push(streams[s].updateClicks());
    }
    return Parse.Promise.when(promises);    
  }).then(function(){
    status.success('Updated Clicks on Streams: '+promises.length);
  }, Router.onError(req, status));
});

function onBeforeSaveSuccess(res) {
  // Throw out obj, beforeSave can't handle it.
  return function(obj) {
    res.success();
  }
}

Parse.Cloud.beforeSave("Content", function(request, response) {
	request.object.analyze().then(
    onBeforeSaveSuccess(response), 
    Router.onError(request, response)
  );
});

Parse.Cloud.beforeSave("StreamItem", function(request, response) {
	request.object.fork().then(
    onBeforeSaveSuccess(response), 
    Router.onError(request, response)
  );
});

Parse.Cloud.beforeSave("Delta", function(request, response) {
  if (!request.object.has('nextFetch')) {
    request.object.set('nextFetch', new Date());
  }
  response.success();
});

Parse.Cloud.beforeSave(Source, function(request, response) {
  if (!request.object.has('nextFetch')) {
    request.object.set('nextFetch', new Date());
  }
  response.success();
});

Parse.Cloud.beforeSave(Stream, function(request, response) {
  request.object.onBeforeSave().then(
    onBeforeSaveSuccess(response), 
    Router.onError(request, response)
  );
});