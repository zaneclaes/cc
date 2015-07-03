var Analyzer = require('cloud/libs/Analyzer'),
    CCHttp = require('cloud/libs/CCHttp'),
    CCObject = require('cloud/libs/CCObject');

// globally applied to clicks to compute score as compared to shares
// i.e., how many shares is a single click thru the CC system worth?
var CLICK_WEIGHT = 100;

// same, except for headlines
var HEADLINE_WEIGHT = 2;

var Content = Parse.Object.extend("Content", {
  // @Instance

  /**
   * Find a single meta tag, like "property", "og:image"
   */
  findMetaTag: function(key, value) {
    var metas = this.get('metaTags');
    for (var m in metas) {
      var tag = metas[m];
      if (tag[key] === value) {
        return tag;
      }
    }
    return false;
  },
  /**
   * For example, [{"property":"og:image"}]
   * Preserves order
   */
  findMetaTags: function(kvArray) {
    var ret = [];
    for (var i in kvArray) {
      var keys = Object.keys(kvArray[i]),
          tag = this.findMetaTag(keys[0], kvArray[i][keys[0]]);
      if (tag) {
        ret.push(tag);
      }
    }
    return ret;
  },
  /**
   * Use meta tags to search for an image, i.e., FB OG
   */
  findMetaImage: function() {
    var tags = this.findMetaTags([{"property":"og:image"}]);
    if (!tags || !tags.length) return false;
    for (var t in tags) {
      var tag = tags[t];

      if (tag.property = 'og:image') {
        return tag.content;
      }
      // else if twitter??
    }
    return false;
  },
  inferImages: function() {
    var images = this.get('images') || [];
    var url = this.findMetaImage();
    if (images.length > 0) {
      return;
    }
    if (!url) {
      return;
    }
    this.set('images',[{'url':url}]);
  },
  /**
   * Actually create and return a StreamItem
   * Used by the StreamItem._factory
   * (where more data is added)
   */
  exportToStreamItem: function(delta) {
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
        matchRegex = delta.getSearchInclusionsRegexStr(),
        matches = (this.get('canonicalSearchString') || '').match(new RegExp(matchRegex, 'gi')),
        matchCount =  matches && matches.length > 0 ? matches.length : 1;
    for (var k in keys) {
      if (this.has(k)) {
        item.set(keys[k], this.get(k));
      }
    }
    if (this.has('redirectUrl')) {
      // Bypass the 301 all together... TODO: consider making this an optional Fork?
      item.set('url', this.get('redirectUrl'));
    }
    var date = (new Date()).toISOString().slice(0,10),
        name = CCObject.canonicalTag(this.get('title')).replace(/\s/g,'-').toLowerCase(),
        score = item.get('score') || 0;

    item.set('contentScore', score); // original score preservation; delta will modify
    item.set('shortcode',date+'-'+name);
    item.set('matches', matches);
    item.set('matchCount', matchCount);
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
        promises = [],
        title = self.get('title'),
        headlineOpId = -1, fbGraphOpId = -1, pOpId = -1, metaTagsOpId = -1,
        log = 'fetching for "'+title+'": ',
        lastAnalysis = self.get('lastAnalysis'),
        hasBeenAnalyzed = lastAnalysis ? true : false; // If it hasn't been analyzed, let's just get it into the DB

    // Get Headline score
    if (parseInt(this.get('headlineScore') || 0) <= 0) {
      log += 'headline, ';
      promises.push(Analyzer.headlineScore(title).then(function(headline) {
        headline = headline.obj || {};
        //CCObject.log('headline score: '+headline.score.total+' ['+headline.score.summary+']');
        var sentiments = {"positive": 1, "negative": -1},
            score = parseInt(headline.score ? headline.score.total : 0),
            summary = headline.score ? headline.score.summary : '';
        self.set('headlineScore',score < 1 ? 1 : score);
        self.set('headlineSentiment',sentiments[summary] || 0);
        return true;
      }));
    }

    // Get Facebook shares
    if (parseInt(this.get('fbShares') || 0) <= 0) {
      log += 'fbGraph, ';
      promises.push(Analyzer.fbGraph(self.get('url')).then(function(fbGraph) {
        fbGraph = fbGraph.obj || {};
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
        return true;
      }));
    }

    // Get Meta tags
    if (!this.has('metaTags')) {
      log += 'metaTags, ';
      promises.push(Analyzer.metaTags(self.get('url')).then(function(metaTags) {
        CCObject.log('got tags');
        CCObject.log(metaTags.tags);
        CCObject.log(metaTags.headers);
        self.set('metaTags',metaTags.tags);

        var headers = metaTags.headers || {};
        if (headers.location) {
          self.set('redirectUrl',headers.location);
        }
        return true;
      }));
    }

    // Get Prismatic URL analysis
    if (!this.has('type')) {
      log += 'prismatic, ';
      promises.push(Analyzer.prismaticAnnotations(self.get('url')).then(function(pAnnotations) {
        pAnnotations = pAnnotations.obj || {};
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

        return true;
      }));
    }

    // Do it all, then apply final sanitization
    return Parse.Promise.when(promises).then(function() {
      // Validate timestamp
      var ts = self.get('timestamp'),
          now = new Date().getTime(),
          age = now - ts,
          images = self.get('images'),
          tags = CCObject.arrayUnion(self.get('tags') || [], self.get('topics') || []),
          canonicalTags = CCObject.canonicalArray(tags),
          canonicalTitle = CCObject.canonicalTag(self.get('title')),
          domains = self.get('url').match(/^(?:https?:\/\/)?(?:www\.)?([^\/]+)/i);

      canonicalTags.push(canonicalTitle);
      if (age < 0) {
        ts = now;
        self.set('timestamp',ts);
      }
      self.inferImages();
      self.set('lastAnalysis',new Date());
      self.set('tags', canonicalTags);
      self.set('host', domains.length > 1 ? domains[1] : null);
      self.set('canonicalSearchString', ','+canonicalTags.join(',')+',');
      self.set('imageCount',images ? images.length : 0);
      self.set('publishedDate',new Date(ts));
      self.set('score',self.calculateScore());
      return true;
    });
  },

}, {
  // @Class

  // Known keys...
  _keys: ['url','title','tags','images','publisher','text','timestamp','source','weight'],

  //
  // Takes a map of URLs => what we know about them
  //
  factory: function(map, options) {
    var urls = Object.keys(map),
        query = new Parse.Query(Content);

    query.containedIn("url", urls);
    query.find().then(function(contents) {
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
      else {
        return built;
      }
      return Parse.Object.saveAll(toSave).then(function(saved) {
        return built
      });
    });
  },
  //
  // Build a Content object, generically
  // URL is always required
  // obj is any pre-existing data
  //
  _factory: function(url, obj) {
    var content = new Content();
    content.assign(obj);
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
    query.find().then(function(contents) {
      CCObject.log('analyzer found '+contents.length+' items for analysis');
      for (var i = 0; i < contents.length; i++) {
        contents[i].set('lastAnalysis',new Date());
      }
      // Triggers a background pre-save analysis.
      return Parse.Object.saveAll(contents);
    });
  }
});

exports.Content = Content;