var Content = require('cloud/Content'),
		CCHttp = require('cloud/libs/CCHttp'),
		CCObject = require('cloud/libs/CCObject'),
		CCOpQueue = require('cloud/libs/CCOpQueue').OpQueue,
		Prismatic = require('cloud/FeedPrismatic'),
		Rss = require('cloud/FeedRSS');

//
// Ingest a single feed (i.e., rss or prismatic)
//
exports.ingestFeed = function(feedObj, options) {
	type = feedObj.get('type');
	options.feed = feedObj;
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
// Ingest all feeds
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
			onFeedComplete = {
				success: function() {
					results.ingested++;
					onIngested();
				},
				error: function(e) {
					results.errors.push(e || '?');
					onIngested();
				}
			},
			query = new Parse.Query("Feeds");
	if (options.feedNames && options.feedNames.length) {
		query.containedIn("type",options.feedNames);
	}
	query.find({
		success: function(feeds) {
			CCObject.log('feed query found '+feeds.length);
			var queue = new CCOpQueue();
			queue.displayName = 'Ingestion';
			queue.maxConcurrentOps = 1; // Serial progression with ingestion, so we don't collide on content.
			for (var i=0; i<feeds.length; i++) {
				queue.queueOp({
					feed: feeds[i],
					run: function(op, options) {
						exports.ingestFeed(op.feed, options);
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