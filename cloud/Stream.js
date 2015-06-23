var CCObject = require('cloud/libs/CCObject'),
    Content = require('cloud/Content').Content,
    Delta = require('cloud/Delta').Delta,
    OpQueue = require('cloud/libs/CCOpQueue').OpQueue,
    StreamItem = require('cloud/StreamItem').StreamItem;

/**
 * Max age for content, if maxContentAge not specified by the stream
 */
var DEFAULT_MAX_CONTENT_AGE = 1000 * 60 * 60 * 24 * 7;

var Stream = Parse.Object.extend("Stream", {
  // @Instance

  /**
   * First, calls out to Populate in order to fill up StreamItems
   * Then queries stream items in order to return them to the client
   */
  present: function(options) {
    var self = this;
    options.limit = options.limit || this.inferFetchLimit();
    options.offset = options.offset || 0;

    this.populate({
      success: function() {
        var query = new Parse.Query(StreamItem);
        query.equalTo('streamId',self.id);
        query.lessThan('holdDate',new Date());
        query.containedIn('status',[StreamItem.STREAM_STATUSES]);
        query.limit(options.limit);
        query.skip(options.offset);
        query.descending('createdAt');
        query.find({
          success: function(items) {
            var res = [];
            for (var i in items) {
              res.push(items[i].present());
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
   * Fills up the stream with new StreamItem objects by calling fetchDeltas
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
        self.fetchDeltas(options);
      },
      error: options.error,
    });
  },

  /**
   * Find deltas which feed this stream and fetch (populate) them
   */
  fetchDeltas: function(options) {
    var self = this,
        query = new Parse.Query(Delta);
    query.equalTo('streamId',this.id);
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
  				stream.present(options);
        }
			},
			error: options.error,
		});
	},
});

exports.Stream = Stream;