var Content = require('cloud/Content').Content,
    StreamItem = require('cloud/StreamItem').StreamItem,
		CCObject = require('cloud/libs/CCObject'),
    OpQueue = require('cloud/libs/CCOpQueue').OpQueue;

var Stream = Parse.Object.extend("Stream", {
  // @Instance

  /**
   * First, calls out to Populate in order to fill up StreamItems
   * Then queries stream items in order to return them to the client
   */
  render: function(options) {
    var self = this;
    options.limit = options.limit || this.inferFetchLimit();
    options.offset = options.offset || 0;

    this.populate({
      success: function() {
        var query = new Parse.Query(StreamItem);
        query.equalTo('streamId',self.id);
        query.lessThan('holdDate',new Date());
        query.limit(options.limit);
        query.skip(options.offset);
        query.descending('createdAt');
        query.find({
          success: function(items) {
            var res = [];
            for (var i in items) {
              res.push(self.renderItem(items[i]));
            }
            options.success(res);
          },
          error: options.error,
        });
      },
      error: options.error,
    });
  },

  /**
   * Pass a StreamItem through a JSON parser to get a simple hash
   * Then delete extra data that we don't want to send down
   * (trim the pipe bandwidth)
   */
  renderItem: function(item) {
    var item = JSON.parse(JSON.stringify(item));
    delete item.holdDate;
    delete item.operations;
    delete item.relationship;
    return item;
  },

  /**
   * Fills up the stream with new StreamItem objects
   *
   * @return an array of StreamItem objects
   */
  populate: function(options) {
    var self = this;
    var finalCallback = options.success;

    // First, get the most recent existing StreamItem object so we can query on the date    
    var query = new Parse.Query(StreamItem);
    query.equalTo('streamId',this.id);
    query.limit(1);
    query.descending('createdAt');
    query.first({
      success: function(item) {
        if (item && item.createdAt) {
          options.startDate = item.createdAt;
        }
        options.success = function(built) {
          var allItems = [item];
          for (var relationship in built) {
            allItems.push(built[relationship]);
          }
          finalCallback(allItems);
        };
        self.fetch(options);
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
  fetch: function(options) {
    var self = this,
        query = new Parse.Query(Content),
        offset = options.offset || 0,
        limit = options.limit || this.inferFetchLimit(),
        oneDay = 1000 * 60 * 60 * 24,
        publishedDate = options.publishedDate || new Date(new Date().getTime() - (oneDay * 2)),
        velocity = options.velocity || 0,
        shares = options.shares || 0,
        inclusions = CCObject.canonicalArray(this.get('interests')),
        exclusions = CCObject.canonicalArray(this.get('exclusions')),
        blacklist = this.get('blacklist'),
        feedIds = this.get('feedIds'),
        feedTypes = this.get('feedTypes'),
        contentTypes = this.get('contentTypes'),
        inclRegex = inclusions.length > 0 ? '(' + inclusions.join('|') + ')' : '',
        exclRegex = exclusions.length > 0 ? '((?!' + exclusions.join('|') + ').)*' : '',
        blackRegex = blacklist.length > 0 ? '((?!' + blacklist.join('|') + ').)*' : '',
        searchRegex = '^' + exclRegex + inclRegex + exclRegex + '$',
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
    if (feedIds && feedIds.length) {
      query.containedIn('feedId',feedIds);
      log.push('feedId [] ' + feedIds.join(','));
    }
    if (feedTypes && feedTypes.length) {
      query.containedIn('feedType',feedTypes);
      log.push('feedType [] ' + feedTypes.join(','));
    }
    // Specific content types
    if (contentTypes && contentTypes.length) {
      query.containedIn('type',contentTypes);
      log.push('type [] ' + contentTypes.join(','));
    }
    // Do not include content without images, or NSFW
    query.notEqualTo('images',[]);
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
    if (searchRegex.length > 2) {
      log.push('canonicalSearchString :: ' + searchRegex);
      query.matches('canonicalSearchString', searchRegex, 'i');
    }
    if (blacklist && blacklist.length) {
      // Filter certain domains
      query.notContainedIn('source',blacklist);
      log.push('source !![] ' + blacklist.join(','));
    }
    // Order, offset, etc.
    query.limit(limit);
    query.skip(offset);
    query.descending('score'); // createdAt??
    // Main search string filters
    CCObject.log('[Stream] search: '+log.join(' | '),2);
    query.find({
      success: function(contents) {
        CCObject.log('[Stream] found content: '+contents.length);
        StreamItem.factory(self, contents, options);
      },
      error: options.error
    });
  },

  /**
   * Max number of items to fetch at a time
   * For now, this is just hardcoded, but it could be used for query timeout fixes
   */
  inferFetchLimit: function() {
    return 20;
  },

}, {
  // @Class

  /**
   * Find the streamId, populate, and return
   */
  stream: function(params, options) {
    var keys = ['limit','offset','velocity','shares'];
    for(var k in keys) {
      options[k] = params[k];
    }
		var query = new Parse.Query(Stream);
		query.equalTo("objectId",params.id || params.streamId);
		query.first({
			success: function(stream) {
        if (!stream) {
          options.error({'error':'stream not found'});
        }
        else {
  				stream.render(options);
        }
			},
			error: options.error,
		});
	},
});

exports.Stream = Stream;