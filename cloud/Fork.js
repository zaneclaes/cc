var CCObject = require('cloud/libs/CCObject'),
    CCHttp = require('cloud/libs/CCHttp'),
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
        name = (this.get('name') || '').toLowerCase(),
        settings = this.get('settings') || {};

    CCObject.log('[Fork] forking '+type+'::'+name);
    if (name === Fork.BITLY) {
      return CCHttp.httpCachedRequest({
        url: 'https://api-ssl.bitly.com/v3/shorten?' +
             'access_token=' + settings.access_token +
             '&longUrl=' + encodeURIComponent(streamItem.get('url')),
        key: streamItem.get('url'),
        cacheName: 'Bitly',
        maxAge: -1, // never expire, always goood.
        cacheValidation: function(obj) {
          return obj && obj.data ? true : false;
        }
      });
    }
    else {
      return true;
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

  TYPE_SHORTENER: 'shortener',

  /**
   * For shorteners, get the # of clicks
   */
  clicks: function(forkResults) {
    if (forkResults.name !== Fork.BITLY || !forkResults.settings) {
      return Parse.Promise.as(-1);
    }
    return Parse.Cloud.httpRequest({
      url: 'https://api-ssl.bitly.com/v3/link/clicks' +
           '?access_token=' + forkResults.settings.access_token +
           '&link=' + encodeURIComponent(forkResults.input.obj.data.url),
    }).then(function(httpRequest) {
      var json = JSON.parse( httpRequest.text );
      return parseInt( json.data.link_clicks );
    });
  },
	/**
	 * The Delta has passed an array of forks to the streamItem
	 * Operate on each of them. We use a serial chain of promises.
	 */
	forkStreamItem: function(streamItem, forks, options) {
    if (forks.length <= 0) {
      return {};
    }
    var chain = null,
        forkResults = streamItem.get('forkResults') || {};
    for (var f in forks) {
      var p = forks[f].fork(streamItem).then(function(response) {
        forkResults[forks[f].id] = {
          'input' : response,
          'output': forks[f].merge(response, streamItem),
          'type' : forks[f].get('type'),
          'name' : forks[f].get('name'),
          'settings' : forks[f].get('settings') || {},
        };
        return true;
      });
      chain = chain ? chain.then(p) : p;
    }
    return chain.then(function(q) {
      streamItem.set('pendingForkIds',[]);
      streamItem.set('forkResults',forkResults);
      return true;
    });
	},
});

exports.Fork = Fork;