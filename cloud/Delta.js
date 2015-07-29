var CCObject = require('cloud/libs/CCObject'),
    Content = require('cloud/Content').Content,
    Source = require('cloud/Source').Source,
    StreamItem = require('cloud/StreamItem').StreamItem;

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
      return Parse.Promise.as([]);
    }
    this.stream = stream;
    query.containedIn('objectId',sourceIds);
    query.lessThanOrEqualTo('nextFetch', new Date());
    return query.find().then(function(sources) {
      // Content sources (rss, prismatic, etc.) are bundled up and sent to fetchDynamic
      // Static sources (recycling, etc.) are bundled up and sent to fetchStatic
      var dynamicSources = [],
          staticSources = [];
      for (var s in sources) {
        var source = sources[s];
        if(Source.TYPE_STATIC === source.get('type')) {
          staticSources.push(source);
        }
        else {
          dynamicSources.push(source);
        }
      }
      var promises = [Parse.Promise.as([]), Parse.Promise.as([])];
      if (dynamicSources.length > 0) {
        promises[0] = self.fetchDynamic(dynamicSources, stream, options);
      }
      if (staticSources.length > 0) {
        promises[1] = self.fetchStatic(staticSources, stream, options);
      }
      return Parse.Promise.when(promises).then(function(dynamics, statics) {
        CCObject.log('[Delta '+self.id+'] got '+dynamics.length+':'+statics.length + ' from '+
                        dynamicSources.length+':'+staticSources.length,3);
        var items = CCObject.arrayUnion(dynamics || [], statics || []);
        return self.gateStreamItems(stream, items);
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
    CCObject.log('[Delta '+this.id+'] gating '+items.length,3);
    if (items.length <= 0) {
      return items;
    }

    // Score the items based upon delta modifications
    var self = this,
        deltaWeight = this.get('weight') || 1,
        limit = this.get('limit') || items.length,
        hostWeights = this.get('hostWeights') || {};
    for (var i in items) {
      var item = items[i],
          source = item.get('source'),
          isStatic = source && source.get('type') === Source.TYPE_STATIC,
          staticWeight = isStatic ? 2 : 1, // TODO: increment static weight over time??
          baseScore = item.get('contentScore') || item.get('score'),
          matchCount = item.get('matchCount') || 1,
          host = item.get('host') || '',
          hostWeight = parseFloat(hostWeights[host] || 1),
          score = baseScore * matchCount * matchCount * deltaWeight * hostWeight * staticWeight;
      item.set('score', score);
    }

    // Sort the items and apply the gated flag based upon limit
    CCObject.log('[Delta] gating down to '+limit, 3);
    items = items.sort(function(a, b){
      return (b.get('score') || 0) - (a.get('score') || 0);
    });
    var sourcesToSave = [];
    for (var i=0; i<limit && i<items.length; i++) {
      var item = items[i],
          source = item.get('source'),
          isStatic = source && source.get('type') === Source.TYPE_STATIC;
      item.set('status', StreamItem.STATUS_GATED);
      if(isStatic) {
        var sourceRate = source.has('rate') ? source.get('rate') : (1000 * 60 * 60 * 24);// 24hr default static rate
        var rand = source.has('rateVariation') ? source.get('rateVariation') : (1000 * 60 * 60 * 6);
        sourceRate += Math.floor(Math.random() * rand ) - ( rand / 2 );
        source.set('nextFetch', new Date((new Date()).getTime() + sourceRate));
        sourcesToSave.push(source);
      }
    }
    var toSave = CCObject.arrayUnion(items, sourcesToSave);
    if (this.has('rate') > 0) {
      self.set('nextFetch', new Date((new Date()).getTime() + this.get('rate')));
      toSave.push(self);
    }

    return Parse.Object.saveAll(toSave);
  },
  /**
   * Fetches posts for the stream from the Content table
   * Moves them into the StreamItem table
   *
   * @return An array of StreamItem objects
   */
  fetchDynamic: function(sources, stream, options) {
    var self = this,
        query = new Parse.Query(Content),
        offset = options.offset || 0,
        limit = options.limit || 100,
        order = options.order || 'score',
        direction = options.direction || 'descending',
        minImages = this.has('minImages') ? this.get('minImages') : 0,
        maxContentAge = parseInt(this.get('maxContentAge')),
        publishedDate = maxContentAge ? new Date(new Date().getTime() - maxContentAge) : false,
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
      log.push('sources: ' + sourceIds.join(','));
    }
    // Specific content types
    if (contentTypes && contentTypes.length) {
      query.containedIn('type',contentTypes);
      log.push('type [] ' + contentTypes.join(','));
    }
    // Do not include content without images, or NSFW
    if (minImages > 0) {
      query.greaterThanOrEqualTo('imageCount',minImages);
      log.push('imageCount >= '+minImages);
    }

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
    log.push('offset='+offset+' ,limit='+limit+', order='+order+', dir='+direction)
    if (direction === 'ascending') {
      query.ascending(order);
    }
    else {
      query.descending(order);
    }
    // Main search string filters
    return query.find().then(function(contents) {
      CCObject.log('[Delta '+self.id+'] Found '+contents.length+': '+log.join(' | '),2);
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
        query = new Parse.Query(Content);
    query.containedIn("source",sources);
    query.descending("score");
    return query.count().then(function(cnt) {
      // Random ordering simulation: count the results, then randomly skip
      if (cnt <= 0) {
        return Parse.Promise.as([]);
      }
      else {
        query.skip( Math.floor(Math.random() * cnt ) );
        query.limit(1);
        query.include('source');
        return query.find();
      }
    }).then(function(contents) {
      CCObject.log('[Delta '+self.id+'] found statics: '+contents.length,3);
      var ret = [];
      for (var c in contents) {
        ret.push(StreamItem.build(stream, self, contents[c], options));
      }
      return ret;
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