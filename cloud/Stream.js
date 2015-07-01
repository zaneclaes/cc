var CCObject = require('cloud/libs/CCObject'),
    Content = require('cloud/Content').Content,
    Delta = require('cloud/Delta').Delta,
    OpQueue = require('cloud/libs/CCOpQueue').OpQueue,
    StreamItem = require('cloud/StreamItem').StreamItem;

/**
 * Max age for content, if maxContentAge not specified by the stream
 */
var DEFAULT_MAX_CONTENT_AGE = 1000 * 60 * 60 * 24 * 7;
var DEFAULT_POPULATION_THROTTLE = 60000;

var Stream = Parse.Object.extend("Stream", {
  // @Instance

  /**
   * First, calls out to Populate in order to fill up StreamItems
   * Then queries stream items in order to return them to the client
   */
  present: function(options) {
    var self = this,
        presentedTime = this.has('presentedAt') ? this.get('presentedAt').getTime() : 0,
        now = (new Date()).getTime(),
        age = now - presentedTime;
    options.limit = options.limit || this.inferFetchLimit();
    options.offset = options.offset || 0;

    // Rate limiting: don't populate, we've presented recently.
    if (age < DEFAULT_POPULATION_THROTTLE) {
      return self._present(options);
    }

    // Will trigger a populate command...
    this.set('presentedAt', new Date());
    return this.save().then(function() {
      return self._present(options);
    });
  },
  // Internal: called by present once population is complete.
  _present: function(options) {
    var self = this,
        statuses = options.statuses || StreamItem.STREAM_STATUSES,
        query = new Parse.Query(StreamItem),
        scrub = ['populationIndex','lastPopulation','presentedAt'],
        out = {
          'json' : CCObject.scrubJSON(this, scrub),
          'stream': this
        };
    query.equalTo('stream',this);
    query.lessThan('scheduledAt',new Date());
    query.containedIn('status',statuses);
    query.limit(options.limit);
    query.skip(options.offset);
    query.descending('createdAt');
    return query.find().then(Stream.dedupe).then(function(items) {
      out.json.items = items;
      return out;
    });
  },
  /**
   * Fills up the stream with new StreamItem objects by calling fetchDeltas
   * Happens as a beforeSave
   */
  populate: function(options) {
    var self = this,
        cb = options.success,
        finalCallback = function(createdItems){
          cb();
        },
        expectedPopulationIndex = parseInt(this.get('populationIndex') || 0);

    // Rate limit population
    this.increment('populationIndex');
    CCObject.log('[Stream '+this.id+'] Populating ['+expectedPopulationIndex+']...',3);

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

        // Before we do the fetchDeltas, let's make sure that we're not in a race
        // condition on the populationIndex
        query = new Parse.Query(Stream);
        query.equalTo('objectId',self.id);
        query.first({
          success: function(stream) {
            if (!stream || parseInt(stream.get('populationIndex') || 0) !== expectedPopulationIndex) {
              CCObject.log('[Stream '+self.id+'] skipping population because index was '+stream.get('populationIndex')+
                           ' instead of '+expectedPopulationIndex+'',3);
              CCObject.log(stream, 3);
              finalCallback([]);
            }
            else {
              self.fetchDeltas(options);
            }
          },
          error: options.error,
        });
      },
      error: options.error,
    });
  },
  /**
   * Find deltas which feed this stream and fetch (populate) them
   * This does the actual content fetching
   */
  fetchDeltas: function(options) {
    var self = this,
        query = new Parse.Query(Delta);
    query.equalTo('streamId',this.id);
    query.lessThanOrEqualTo('nextFetch', new Date());
    query.find({
      success: function(deltas) {
        var ops = new OpQueue();
        ops.displayName = 'fetchDeltas';
        for (var d in deltas) {
          ops.queueOp({
            delta: deltas[d],
            run: function(op, options) {
              op.delta.fetch(self, options);
            }
          });
        }//for
        ops.run(options.success);
      },// success
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
    var sId = params.id || params.streamId,
        keys = ['limit','offset','velocity','shares'];
    options = options || {};
    for(var k in keys) {
      options[k] = params[k];
    }
		var query = new Parse.Query(Stream);
		query.equalTo("objectId",sId);
		return query.first().then(function(stream) {
      if (!stream) {
        throw new Error('stream not found');
      }
      return stream.present(options);
    });
	},
  // Internal: after present, dupes are an array of StreamItems that should be deleted.
  dedupe: function(items) {
    if (!items) {
      return [];
    }
    var seen = [],
        dupes = []
        out = [];
    for (var i in items) {
      var r = items[i].get('relationship');
      if (seen.indexOf(r) >= 0) {
        dupes.push(items[i]);
        continue;
      }
      out.push(items[i].present());
      seen.push(r);
    }

    if (dupes.length <= 0) {
      return out;
    }
    CCObject.log('[Stream] de-duping x'+dupes.length,3);
    return Parse.Object.destroyAll(dupes).then(function(){
      return out;
    });
  },
});

exports.Stream = Stream;