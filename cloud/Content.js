var Analyzer = require('cloud/libs/Analyzer'),
    CCHttp = require('cloud/libs/CCHttp'),
    CCObject = require('cloud/libs/CCObject'),
    OpQueue = require('cloud/libs/CCOpQueue').OpQueue;

// globally applied to clicks to compute score as compared to shares
// i.e., how many shares is a single click thru the CC system worth?
var CLICK_WEIGHT = 100;

// same, except for headlines
var HEADLINE_WEIGHT = 2;

var Content = Parse.Object.extend("Content", {
  // @Instance

  /**
   * Actually create and return a StreamItem
   * Used by the StreamItem._factory
   * (where more data is added)
   */
  exportToStreamItem: function(stream) {
    var StreamItem = Parse.Object.extend("StreamItem"), // IMPORTANT : can't require due to include recursion
        item = new StreamItem(),
        keys = { // What goes to StreamItem? localKey => remoteKey
          'images' : 'images',
          'publisher' : 'publisher',
          'score' : 'score',
          'tags' : 'tags',
          'text' : 'text',
          'title' : 'title',
          'url' : 'url',
          'host' : 'host',
        },
        matchRegex = new RegExp(stream.getSearchRegexStr(), 'gi');
    for (var k in keys) {
      item.set(keys[k], this.get(k));
    }
    item.set('shortcode',(new Date()).toISOString().slice(0,10)+'-'+CCObject.canonicalTag(this.get('name')));

    var matches = CCObject.arrayUnion([matchRegex],this.get('canonicalSearchString').match(matchRegex));
    item.set('matches', matches);
    return item;
  },

  // Validates against _keys
  assign: function(map) {
    for(var k in map) {
      if (Content._keys.indexOf(k) >= 0) {
        this.set(k, map[k]);
      }
    }
  },

  /*
   * Based on everything we know, compute a score for a Content object
   * We do this by normalizing the score on "shares" (i.e., how much is
   * each thing we know worth, in terms of shares?) and then multiplying
   * that by a per-content weight (which comes from the source) implying
   * how confident we are that this is a good item (i.e., representational
   * of source health/quality or other quantitative quality metrics)
   *
   * TODO: this should be stream-specific; i.e., clicks should feed from a stream
   * maybe we take the stream in as a param here, and use it when feeding a stream into
   * a carousel?
   */
  calculateScore: function() {
    var weight = parseInt(this.get('weight') || 0) || 1,
        shares = parseInt(this.get('fbShares') || 0),
        clicks = parseInt(this.get('clicks') || 0),
        headline = parseInt(this.get('headlineScore') || 0) || 1,
        score = (clicks * CLICK_WEIGHT) + (headline * HEADLINE_WEIGHT) + shares;
    return weight * score;
  },

  // Load everything we want for the content, incl. headline score, fb, tags, etc.
  // Skips fields that should only be done once, like headline score, if possible.
  analyze: function(options) {
    var self = this,
        title = self.get('title'),
        headlineOpId = -1, fbGraphOpId = -1, pOpId = -1, metaTagsOpId = -1,
        log = 'fetching for "'+title+'": ',
        lastAnalysis = self.get('lastAnalysis'),
        // Success block does data sanitization, called before any return
        successBlock = function() {
          // Validate timestamp
          var ts = self.get('timestamp'),
              now = new Date().getTime(),
              age = now - ts,
              images = self.get('images');
          if (age < 0) {
            ts = now;
            self.set('timestamp',ts);
          }
          self.set('imageCount',images ? images.length : 0);
          self.set('publishedDate',new Date(ts));
          self.set('score',self.calculateScore());
          if(options && options.success) options.success();
        },
        hasBeenAnalyzed = lastAnalysis ? true : false; // If it hasn't been analyzed, let's just get it into the DB
        
    var analyzerQueue = new OpQueue();
    analyzerQueue.displayName = 'Analyzer';
    analyzerQueue.maxConcurrentOps = 3;

    // Get Headline score
    if (parseInt(this.get('headlineScore') || 0) <= 0) {
      log += 'headline, ';
      headlineOpId = analyzerQueue.queueOp({
        run: function(op, options) {
          Analyzer.headlineScore(title, options);
        }
      });
    }

    // Get Facebook shares
    if (parseInt(this.get('fbShares') || 0) <= 0) {
      log += 'fbGraph, ';
      fbGraphOpId = analyzerQueue.queueOp({
        run: function(op, options) {
          Analyzer.fbGraph(self.get('url'), options);
        }
      });
    }

    // Get Meta tags
    /* not necessary, not using OG tags; might cause $/. Parse error in key names.
    if (!this.get('metaTags')) {
      log += 'metaTags, ';
      metaTagsOpId = analyzerQueue.queueOp({
        run: function(op, options) {
          Analyzer.metaTags(self.get('url'), options);
        }
      });
    }*/

    // Get Prismatic URL analysis
    if (!this.get('type')) {
      log += 'prismatic, ';
      pOpId = analyzerQueue.queueOp({
        run: function(op, options) {
          Analyzer.prismaticAnnotations(self.get('url'), options);
        }
      });
    }

    if (analyzerQueue.queue.length <= 0) {
      successBlock();
      return;
    }

    // Run all the operations.
    analyzerQueue.run(function(q) {
      var headline = headlineOpId>=0 ? (q.results[headlineOpId] || {}) : null,
          fbGraph = fbGraphOpId>=0 ? (q.results[fbGraphOpId] || {}) : null,
          metaTags = metaTagsOpId>=0 ? (q.results[metaTagsOpId] || {}) : null,
          pAnnotations = pOpId>=0 ? (q.results[pOpId] || {}) : null;
      // Stash headline data
      if (headline) {
        //CCObject.log('headline score: '+headline.score.total+' ['+headline.score.summary+']');
        var sentiments = {"positive": 1, "negative": -1},
            score = parseInt(headline.score ? headline.score.total : 0),
            summary = headline.score ? headline.score.summary : '';
        self.set('headlineScore',score < 1 ? 1 : score);
        self.set('headlineSentiment',sentiments[summary] || 0);
      }
      // Stash FB Graph data
      if (fbGraph) {
        var shares = parseInt(fbGraph.shares || 0),
            age = new Date().getTime() - (self.get('timestamp') || 0),
            ageMinutes = age / (60 * 1000),
            velocity = shares / (ageMinutes > 0 ? ageMinutes : 1);
        //CCObject.log('fbShares:'+shares);
        self.set('fbShares',shares);
        if (ageMinutes < (60 * 24 * 7)) {
          // Only update the velocity if it was posted in the last week.
          self.set('fbShareVelocity',velocity);
        }
        self.set('fbGraph',fbGraph);
        self.set('fbGraphUpdatedAt',new Date());
      }
      // Stash FB Tags data
      if (metaTags) {
        CCObject.log('got tags');
        CCObject.log(metaTags);
        self.set('metaTags',metaTags);
      }
      // Stash Prismatic data
      if (pAnnotations) {
        CCObject.log('prismatic data');
        CCObject.log(pAnnotations);
        var aspects = pAnnotations.aspects || {},
            nsfw = aspects['flag_nsfw'] ? aspects['flag_nsfw']['value'] : false,
            type = aspects['type'] ? aspects['type']['value'] : null,
            ts = pAnnotations.topics || [],
            topics = [];
        for (var t in ts) {
          topics.push(ts[t]['topic']);
        }
        self.set('nsfw',nsfw === 'false' || !nsfw ? false : true);
        self.set('type',type); 
        self.set('topics',topics);
      }
      self.set('lastAnalysis',new Date());
      if(q.errors) {
        CCObject.log('Save errors: '+Object.keys(q.errors).length);
      }
      successBlock();
    });
  },

}, {
  // @Class

  // Known keys...
  _keys: ['url','title','tags','images','publisher','text','payload','timestamp','sourceType','sourceId','weight'],

  // 
  // Takes a map of URLs => what we know about them
  //
  factory: function(map, options) {
    var urls = Object.keys(map),
        query = new Parse.Query(Content);

    query.containedIn("url", urls);
    query.find({
      success: function(contents) {
        //CCObject.log('found content matches: '+contents.length);
        var built = {},
            toSave = [];

        for (var k in contents) {
          var obj = contents[k],
              url = obj.get('url');
          if(url) {
            urls = CCObject.arrayRemove(urls, url);
            built[url] = obj;
          }
          else {
            built[url] = Content._factory(url, map[url]); 
            toSave.push(built[url]);
          }
        }
        for (var k in urls) {
          var url = urls[k];
          built[url] = Content._factory(url, map[url]); 
          toSave.push(built[url]);
        }
        if (urls.length > 0) {
          CCObject.log('Content factory builds to save: ',2);
          CCObject.log(urls,2);
        }
        Parse.Object.saveAll(toSave, {
          success: function(saved) {
            options.success(built);
          },
          error: options.error,
        });
      },
      error: options.error,
    });
  },
  //
  // Build a Content object, generically
  // URL is always required
  // obj is any pre-existing data
  //
  _factory: function(url, obj) {
    var content = new Content(),
        canonicalTags = CCObject.canonicalArray(obj.tags),
        canonicalTitle = CCObject.canonicalTag(obj.title),
        domains = url.match(/^(?:https?:\/\/)?(?:www\.)?([^\/]+)/i), // 
        parts = domains.length >= 1 ? domains[0].split('.') : [''],
        host = parts.slice(1).join('.');

    canonicalTags.push(canonicalTitle);

    content.assign(obj);
    content.set('host', host);
    content.set('name', canonicalTitle.replace(/\s/g,'-').toLowerCase());
    content.set('canonicalSearchString', ','+canonicalTags.join(',')+',');
    content.set('url', url);
    return content;
  },
  //
  // Finds Content objects that need analysis, and does it.
  //
  analyze: function(options) {
    var query = new Parse.Query(Content),
        t = new Date().getTime(),
        maxAge = (15 * 60 * 1000),
        oldest = new Date(t - maxAge);
    query.lessThanOrEqualTo('lastAnalysis', oldest);
    query.descending('createdAt');
    query.limit(100);
    query.find({
      success: function(contents) {
        CCObject.log('analyzer found '+contents.length+' items for analysis');
        for (var i = 0; i < contents.length; i++) {
          contents[i].set('lastAnalysis',new Date());
          contents[i].save(); // Triggers a background pre-save analysis.
        }
        options.success();
      },
      error: options.error,
    })
  }
});

exports.Content = Content;