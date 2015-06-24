var CCHttp = require('cloud/libs/CCHttp'),
		CCObject = require('cloud/libs/CCObject'),
		CCOpQueue = require('cloud/libs/CCOpQueue').OpQueue,
		Content = require('cloud/Content'),
		Prismatic = require('cloud/SourcePrismatic'),
		Rss = require('cloud/SourceRSS');

// The types of sources which result in content
exports.CONTENT_SOURCE_TYPES = ['rss','prismatic'];

var Source = Parse.Object.extend("Source", {

}, {

});

//
// Ingest a single source (i.e., rss or prismatic)
//
exports.ingestSource = function(source, options) {
	type = source.get('type');
	options.source = source;
	if (type === 'prismatic') {
		Prismatic.ingest(options);
	}
	else if (type === 'rss') {
		Rss.ingest(options);
	}
	else {
		return false;
	}
	return true;
};

//
// Ingest all sources
//
exports.ingest = function(options) {
	var ingesting = 1,
			results = {
				ingested: 0,
				errors: [],
			},
			errors = [],
			onIngested = function() {
				ingesting--;
				CCObject.log('ingesting at '+ingesting);
				if (ingesting == 0) {
					options.success(results);
				}
			},
			onSourceComplete = {
				success: function() {
					results.ingested++;
					onIngested();
				},
				error: function(e) {
					results.errors.push(e || '?');
					onIngested();
				}
			},
			query = new Parse.Query(Source);
	if (options.sourceNames && options.sourceNames.length) {
		query.containedIn("type",options.sourceNames);
	}
	query.find({
		success: function(sources) {
			CCObject.log('sources query found '+sources.length);
			var queue = new CCOpQueue();
			queue.displayName = 'Ingestion';
			queue.maxConcurrentOps = 5;
			for (var i=0; i<sources.length; i++) {
				queue.queueOp({
					source: sources[i],
					run: function(op, options) {
						exports.ingestSource(op.source, options);
					}
				});
			}
			queue.run(function(queue) {
				CCObject.log('[Ingestion] queue completed: '+queue.completed.length);
				options.success(queue.results);
			});
		},
		error: options.error,
	})

}

exports.Source = Source;