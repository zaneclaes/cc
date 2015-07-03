var isLocal = typeof __dirname !== 'undefined',
    root = isLocal ? './' : 'cloud/',
    Analyzer = require('cloud/libs/Analyzer'),
    CCObject = require('cloud/libs/CCObject'),
    Content = require('cloud/Content').Content,
    Delta = require('cloud/Delta').Delta,
    Source = require('cloud/Source'),
    Stream = require('cloud/Stream').Stream,
    StreamItem = require('cloud/StreamItem').StreamItem,
    Router = require('cloud/Router');

/*************************************************************************************
* Public API [Endpoints]
 ************************************************************************************/

Router.listen();

/*************************************************************************************
* Internal API [Cloud Functions]
 ************************************************************************************/

function onApiError(req, res) {
  return function(error) {
    CCObject.log('[ERROR][API]',10);
    CCObject.log(error,10);
    res.error({'error' : error});
  };
}

// Get a stream by a given stream ID
Parse.Cloud.define("stream", function(request, response) {
	Stream.stream(request.params).then(function(out) {
    response.success(out.json.items);
  }, onApiError(request, response));
});

// Tag a URL?
Parse.Cloud.define("tag", function(request, response) {
	Analyzer.metaTags(request.params.url).then(response.success, onApiError(request, response));
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
	query.first().then(response.success, onApiError(request, response));
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
  }, onApiError(request, status));
});

Parse.Cloud.job("analyze", function(request, status) {
	var startTime = new Date().getTime();
	status.message('analyzing...');
	Parse.Cloud.useMasterKey();
  Content.analyze().then(function(res) {
  	status.success('ingested in '+(((new Date).getTime() - startTime)/1000) + 'sec');
  }, onApiError(request, status));
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
    onApiError(request, response)
  );
});

Parse.Cloud.beforeSave("StreamItem", function(request, response) {
	request.object.fork().then(
    onBeforeSaveSuccess(response), 
    onApiError(request, response)
  );
});

Parse.Cloud.beforeSave("Delta", function(request, response) {
  if (!request.object.has('nextFetch')) {
    request.object.set('nextFetch', new Date());
  }
  response.success();
});

Parse.Cloud.beforeSave(Stream, function(request, response) {
	request.object.populate().then(
    onBeforeSaveSuccess(response), 
    onApiError(request, response)
  );
});
