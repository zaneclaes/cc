var CCObject = require('cloud/libs/CCObject'),
		OpQueue = require('cloud/libs/CCOpQueue').OpQueue,
    URLShortener = require('cloud/libs/URLShortener');

var Fork = Parse.Object.extend("Fork", {
	// @Instance

	/**
	 * Main Fork Function
	 * Take a streamItem and construct some query
	 * We'll get the results in merge, below.
	 */
	fork: function(streamItem, options) {
    URLShortener.bitly(streamItem.get('url'), options);
	},
	/**
	 * The fork has run, now we have the results.
	 * Mutate the content in whatever way we want;
	 * no need to call save, since this is invoked
	 * beforeSave on the streamItem anyways.
	 * Therefore this function is synchronous.
	 */
	merge: function(forkResults, streamItem) {
		if (forkResults) {
			if (forkResults.obj.data.url) streamItem.set('url',forkResults.obj.data.url);
		}
	},

}, {
	// @Class

	/**
	 * The Delta has passed an array of forks to the streamItem
	 * Operate on each of them.
	 */
	forkStreamItem: function(streamItem, forks, options) {
    CCObject.log('[Fork] '+forks.length+' for streamItem');

    var forkQueue = new OpQueue(),
    		forkOpMap = {};
    forkQueue.displayName = 'Forks';
    forkQueue.maxConcurrentOps = 1; // Forks need to be run serially to preserve possible intentional cross-effects.

    // Enqueue each of the forks...
    for (var f in forks) {
      forkOpMap[f] = forkQueue.queueOp({
      	fork: forks[f],
        run: function(op, options) {
        	op.fork.fork(streamItem, options);
        }
      });
    }

    // Run the queue...
    forkQueue.run(function(q){
    	for (var f in forkOpMap) {
    		forks[f].merge(q.results[forkOpMap[f]], streamItem);
    	}
      streamItem.set('pendingForkIds',[]);
      if(options && options.success) options.success();
    });
	},
});

exports.Fork = Fork;