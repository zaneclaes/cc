var CCObject = require('cloud/libs/CCObject'),
    Content = require('cloud/Content').Content,
    Source = require('cloud/Source'),
    OpQueue = require('cloud/libs/CCOpQueue').OpQueue,
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
   * If the Delta has undefined sourceIds, it will match all content source types
   * (see: Source.CONTENT_SOURCE_TYPES)
   */
  fetch: function(stream, options) {
    var self = this,
        query = new Parse.Query(Source.Source),
        sourceIds = self.get('sourceIds');
    if (!sourceIds || sourceIds.length <= 0) {
      // With no sources attached, just query from all contentSources.
      self.fetchContent([], stream, options);
      return;
    }
    query.containedIn('objectId',sourceIds);
    query.find({
      success: function(sources) {   
        // Content sources (rss, prismatic, etc.) are bundled up and sent to fetchContent
        // Static sources (recycling, etc.) are bundled up and sent to fetchStatic
        var contentSources = [],
            staticSources = [];
        for (var s in sources) {
          var source = sources[s];
          if(Source.CONTENT_SOURCE_TYPES.indexOf(source.get('type')) >= 0) {
            contentSources.push(source);
          }
          else {
            staticSources.push(source);
          }
        }
        var ops = new OpQueue();
        ops.displayName = 'deltaDiffs';
        ops.maxConcurrentOps = 1; // IMPORTANT: we want static sources to be analyzed second.
        if (contentSources.length > 0 || (contentSources.length == 0 && staticSources.length == 0)) {
          ops.queueOp({
            sources: contentSources,
            run: function(op, options) {
              self.fetchContent(op.sources, stream, options);
            }
          });
        }
        if (staticSources.length > 0) {
          ops.queueOp({
            sources: staticSources,
            run: function(op, options) {
              self.fetchStatic(op.sources, stream, options);
            }
          });
        }
        ops.run(function(ops){
          var res = [];
          for(var r in ops.results) {
            res = CCObject.arrayUnion(res, ops.results[r]);
          }
          options.success(res);
        });
      },
      error: options.error,
    });
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
      log.push('publishedDate < ' + publishedDate.getTime());
    }
    // Constrain to a specific feed id/type
    if (sources && sources.length) {
      var sourceIds = [];
      for(var s in sources) {
        sourceIds.push(sources[s].id);
      }
      query.containedIn('sourceIds',sourceIds);
      log.push('sources [] ' + sources.length);
    }
    // Specific content types
    if (contentTypes && contentTypes.length) {
      query.containedIn('type',contentTypes);
      log.push('type [] ' + contentTypes.join(','));
    }
    // Do not include content without images, or NSFW
    query.greaterThanOrEqualTo('imageCount',minImages);
    query.exists('images');
    query.exists('name');
    query.equalTo('nsfw',false);
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
    query.find({
      success: function(contents) {
        CCObject.log('[Delta] found content: '+contents.length);
        StreamItem.factory(self, contents, options);
      },
      error: options.error
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
    CCObject.log("[Delta] WARNING: fetchStatic is not implemented...",10);
    options.success([]);
  },
  /**
   * Return a regex string for the stream
   */
  getSearchRegexStr: function() {
    var
        inclusions = CCObject.canonicalArray(this.get('interests')),
        exclusions = CCObject.canonicalArray(this.get('exclusions')),
        inclRegex = inclusions.length > 0 ? '(' + inclusions.join('|') + ')' : '',
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

}, {
	// @Class
});

exports.Delta = Delta;