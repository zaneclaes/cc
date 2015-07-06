var CCObject = require('cloud/libs/CCObject'),
    Content = require('cloud/Content').Content,
    Source = require('cloud/Source').Source,
    StreamItem = require('cloud/StreamItem').StreamItem;

/**
 * Max age for content, if maxContentAge not specified by the stream
 */
var DEFAULT_MAX_CONTENT_AGE = 1000 * 60 * 60 * 24 * 7;

/**
 * Streams have a 1:N relationship with Deltas
 * Doing a fetch on a Delta populates the Stream with StreamItems
 */
var Delta = Parse.Object.extend("Delta", {
  // @Instance

  /**
   * Main operation to query the Source and create StreamItems
   */
  fetch: function(stream, options) {
    var self = this,
        query = new Parse.Query(Source),
        sourceIds = self.get('sourceIds');
    if (!sourceIds || sourceIds.length <= 0) {
      // With no sources attached, just query from all contentSources.
      return self.fetchContent([], stream, options);
    }
    this.stream = stream;
    query.containedIn('objectId',sourceIds);
    return query.find().then(function(sources) {
      // Content sources (rss, prismatic, etc.) are bundled up and sent to fetchContent
      // Static sources (recycling, etc.) are bundled up and sent to fetchStatic
      var contentSources = [],
          staticSources = [];
      for (var s in sources) {
        var source = sources[s];
        if(Source.TYPE_STATIC === source.get('type')) {
          staticSources.push(source);
        }
        else {
          contentSources.push(source);
        }
      }
      var promises = [],
          allItems = [],
          handler = function(items) {
            allItems = CCObject.arrayUnion(allItems, items || []);
          };

      if (contentSources.length > 0 || (contentSources.length == 0 && staticSources.length == 0)) {
        promises.push(self.fetchContent(contentSources, stream, options).then(handler));
      }
      if (staticSources.length > 0) {
        promises.push(self.fetchStatic(staticSources, stream, options).then(handler));
      }
      return Parse.Promise.when(promises).then(function() {
        return self.gateStreamItems(stream, allItems);
      });
    });
  },
  /**
   * The array of content has been created, but not saved.
   * Now we need to go through and determine what content
   * should be allowed into the stream. We *SAVE* all of it,
   * but first we choose statuses based upon
   */
  gateStreamItems: function(stream, items) {
    CCObject.log('[Delta] gating '+items.length,3);
    if (items.length <= 0) {
      return items;
    }

    // Score the items based upon delta modifications
    var self = this,
        deltaWeight = this.get('weight') || 1,
        limit = this.get('limit') || items.length,
        rate = this.get('rate') || 0,
        hostWeights = this.get('hostWeights') || {};
    for (var i in items) {
      var item = items[i],
          baseScore = item.get('contentScore') || item.get('score'),
          matchCount = item.get('matchCount') || 1,
          host = item.get('host') || '',
          hostWeight = parseFloat(hostWeights[host] || 1),
          score = baseScore * matchCount * matchCount * deltaWeight * hostWeight;
      item.set('score', score);
    }

    // Sort the items and apply the gated flag based upon limit
    CCObject.log('[Delta] gating down to '+limit, 3);
    items = items.sort(function(a, b){
      return (b.get('score') || 0) - (a.get('score') || 0);
    });
    for (var i=0; i<limit && i<items.length; i++) {
      items[i].set('status', StreamItem.STATUS_GATED);
    }
    self.set('nextFetch', new Date((new Date()).getTime() + rate));
    return Parse.Object.saveAll(items);
  },
  /**
   * Fetches posts for the stream from the Content table
   * Moves them into the StreamItem table
   *
   * @return An array of StreamItem objects
   */
  fetchContent: function(sources, stream, options) {
    var self = this,
        query = new Parse.Query(Content),
        offset = options.offset || 0,
        limit = options.limit || 100,
        minImages = this.has('minImages') ? this.get('minImages') : 1,
        maxContentAge = parseInt(this.get('maxContentAge')) || DEFAULT_MAX_CONTENT_AGE,
        publishedDate = new Date(new Date().getTime() - maxContentAge),
        velocity = options.velocity || 0,
        shares = options.shares || 0,
        blacklist = this.get('blacklist'),
        contentTypes = this.get('contentTypes'),
        searchRegex = this.getSearchRegexStr(),
        log = [];

    // Date range for CREATION (this preventns de-dupe)
    if (options.startDate) {
      query.greaterThan('createdAt',options.startDate);
      log.push('createdAt > ' + options.startDate.getTime());
    }
    if (options.endDate) {
      query.lessThan('createdAt',options.endDate);
      log.push('createdAt < ' + options.startDate.getTime());
    }
    // Date range for PUBLICATION (how recent we want our news)
    if (publishedDate) {
      query.greaterThan('publishedDate', publishedDate);
      log.push('publishedDate > ' + publishedDate.getTime());
    }
    // Constrain to a specific feed id/type
    if (sources && sources.length) {
      var sourceIds = [];
      for(var s in sources) {
        sourceIds.push(sources[s].id);
      }
      query.containedIn('source',sources);
      log.push('sources [] ' + sourceIds.length);
    }
    // Specific content types
    if (contentTypes && contentTypes.length) {
      query.containedIn('type',contentTypes);
      log.push('type [] ' + contentTypes.join(','));
    }
    // Do not include content without images, or NSFW
    query.greaterThanOrEqualTo('imageCount',minImages);
    log.push('imageCount >= '+minImages);

    // Never include NSFW, for now, though allow unverified (undefined) to get thru
    query.notEqualTo('nsfw',true);

    // Social velocity filters
    if (velocity || shares) {
      query.greaterThanOrEqualTo('fbShareVelocity',velocity);
      log.push('fbShareVelocity >= ' + velocity);
      query.greaterThanOrEqualTo('fbShares',shares);
      log.push('fbShares >= ' + shares);
    }
    if (searchRegex) {
      log.push('canonicalSearchString :: ' + searchRegex);
      query.matches('canonicalSearchString', searchRegex, 'i');
    }
    if (blacklist && blacklist.length) {
      // Filter certain domains
      query.notContainedIn('host',blacklist);
      log.push('source !![] ' + blacklist.join(','));
    }
    // Order, offset, etc.
    query.limit(limit);
    query.skip(offset);
    query.descending('score'); // createdAt??
    // Main search string filters
    CCObject.log('[Delta] search: '+log.join(' | '),2);
    return query.find().then(function(contents) {
      CCObject.log('[Delta] found content: '+contents.length,2);
      return StreamItem.factory(stream, self, contents, options);
    });
  },
  /**
   * Given an array of static sources, choose a random collection of them to pass
   * the delta... by the time this is called, the content has already completed.
   *
   * This means we can use static content as a fallback on our rate limiting, i.e.,
   * inject static content if dynamic did not meet the delta goals/limits.
   */
  fetchStatic: function(sources, stream, options) {
    var self = this,
        query = new Parse.Query(Content),
        limit = 1;
    query.containedIn("source",sources);
    //query.equalTo("static",true);
    query.descending("score");
    query.limit(limit);
    return query.find().then(function(contents) {
      CCObject.log('[Delta] found statics: '+contents.length,3);
      options = JSON.parse( JSON.stringify( options ) );
      options.isStatic = true;
      return StreamItem.factory(stream, self, contents, options);
    });
  },
  /**
   * Return a regex string for the stream
   */
  getSearchRegexStr: function() {
    var exclusions = CCObject.canonicalArray(this.get('exclusions')),
        inclRegex = this.getSearchInclusionsRegexStr(),
        exclRegex = exclusions.length > 0 ? '((?!' + exclusions.join('|') + ').)*' : '';

    if (inclRegex.length) {
      return '^' + exclRegex + inclRegex + exclRegex + '$';
    }
    else if (exclRegex.length) {
      return '^' + exclRegex + '$';
    }
    else {
      return false;
    }
  },

  getSearchInclusionsRegexStr: function() {
    var inclusions = CCObject.canonicalArray(this.get('interests'));
    return inclusions.length > 0 ? '(' + inclusions.join('|') + ')' : '';
  },

}, {
	// @Class
});

exports.Delta = Delta;