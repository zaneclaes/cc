var CCHttp = require('cloud/libs/CCHttp'),
		CCObject = require('cloud/libs/CCObject'),
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
		return Prismatic.ingest(options);
	}
	else if (type === 'rss') {
		return Rss.ingest(options);
	}
	else if (type === 'static') {
		// NOP : static sources generate during the Delta
		return [];
	}
	else {
		return [];
	}
	return [];
};

//
// Ingest all sources
//
exports.ingest = function(options) {
	options = options || {};
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
	return query.find().then(function(sources) {
		CCObject.log('sources query found '+sources.length);
		var promises = [];
		for (var i=0; i<sources.length; i++) {
			promises.push(exports.ingestSource(sources[i], options));
		}
		return Parse.Promise.when(promises).then(function() {
			CCObject.log('[Ingestion] queue completed: '+promises.length);
			return true;
		});
	});

}

exports.Source = Source;