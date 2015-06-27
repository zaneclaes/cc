var CCObject = require('cloud/libs/CCObject'),
		OpQueue = require('cloud/libs/CCOpQueue').OpQueue,
    URLTools = require('cloud/libs/URLTools');

var Fork = Parse.Object.extend("Fork", {
	// @Instance

	/**
	 * Main Fork Function
	 * Take a streamItem and construct some query
	 * We'll get the results in merge, below.
	 */
	fork: function(streamItem, options) {
    var type = (this.get('type') || '').toLowerCase(),
        name = (this.get('name') || '').toLowerCase();

    CCObject.log('[Fork] forking '+type+'::'+name);
    if (name === Fork.BITLY) {
      URLTools.bitly(streamItem.get('url'), options);
    }
    else {
      options.success(true);
    }
	},
	/**
	 * The fork has run, now we have the results.
	 * Mutate the content in whatever way we want;
	 * no need to call save, since this is invoked
	 * beforeSave on the streamItem anyways.
	 * Therefore this function is synchronous.
	 */
	merge: function(forkResults, streamItem) {
		if (!forkResults) {
      return;
    }
    var type = (this.get('type') || '').toLowerCase(),
        name = (this.get('name') || '').toLowerCase(),
        settings = this.getSettings();

    CCObject.log('[Fork] merging '+type+'::'+name);
    if (name === Fork.BITLY && forkResults.obj.data.url) {
  		streamItem.set('url',forkResults.obj.data.url);
    }
    else if (name === Fork.GAN) {
      streamItem.set('url',URLTools.addParams(streamItem.get('url'), settings));
    }
    else {
      CCObject.log('[Fork] unknown: '+this.id+'::'+type+'::'+name,10);
    }
	},
  /**
   * Get the settings for this service, merging in defaults
   */
  getSettings: function() {
    var type = (this.get('type') || '').toLowerCase(),
        name = (this.get('name') || '').toLowerCase(),
        settings = this.get('settings') || {},
        keys = Object.keys(settings),
        defaults = {};
    if (name === Fork.GAN) {
      defaults = {
        'utm_source' : 'deltas',
        'utm_medium' : 'stream',
        'utm_campaign' : 'deltas', // context?
      };
    }
    for (var k in defaults) {
      if (keys.indexOf(k) < 0) {
        settings[k] = defaults[k];
      }
    }
    return settings;
  },
}, {
	// @Class
  BITLY: 'bitly',
  GAN: 'google analytics',

	/**
	 * The Delta has passed an array of forks to the streamItem
	 * Operate on each of them.
	 */
	forkStreamItem: function(streamItem, forks, options) {
    var forkQueue = new OpQueue(),
    		forkOpMap = {},
        forkResults = streamItem.get('forkResults') || {};
    forkQueue.displayName = 'Forks';
    forkQueue.maxConcurrentOps = 1; // Forks need to be run serially to preserve possible intentional cross-effects.

    // Enqueue each of the forks...
    for (var f in forks) {
      forkOpMap[f] = forkQueue.queueOp({
      	fork: forks[f],
        run: function(op, options) {
        	op.fork.fork(streamItem, {
            success: function(response) {
              forkResults[op.fork.id] = {
                'input' : response,
                'output': op.fork.merge(response, streamItem),
              };
              options.success(response);
            },
            error: options.error,
          });
        }
      });
    }
    CCObject.log('[Fork] '+forks.length+' for streamItem');

    // Run the queue...
    forkQueue.run(function(q){
      streamItem.set('pendingForkIds',[]);
      streamItem.set('forkResults',forkResults);
      if(options && options.success) options.success();
    });
	},
});

exports.Fork = Fork;