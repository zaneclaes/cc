var CCObject = require('cloud/libs/CCObject'),
    Content = require('cloud/Content').Content,
    OpQueue = require('cloud/libs/CCOpQueue').OpQueue,
    Fork = require('cloud/Fork').Fork;

var StreamItem = Parse.Object.extend("StreamItem", {
	// @Instance

  /**
   * Pass a StreamItem through a JSON parser to get a simple hash
   * Then delete extra data that we don't want to send down
   * (trim the pipe bandwidth)
   */
  present: function() {
    return CCObject.scrubJSON(this, ['holdDate','operations','relationship','matches','status','delta','stream',
                                     'publisher','pendingForkIds','forkResults']);
  },

	/**
	 * Before Save
	 * Shortens the URL, etc.
	 */
	fork: function(options) {
		var self = this,
				forkMap = {},
				forkIds = self.get('pendingForkIds'),
        status = self.get('status'),
        success = options && options.success ? options.success : function(){};

    options.success = function(res) {
      // Any final sanitization? Do it here.
      success();
    }

		if(status !== StreamItem.STATUS_GATED || !forkIds || !forkIds.length) {
      options.success();
      return;
		}

    // Load the forks...
    var query = new Parse.Query(Fork);
    query.containedIn('objectId',forkIds);
    query.find({
      success: function(forks) {
        if(!forks || !forks.length) {
          if(options && options.success) options.success();
          return;
        }
        self.set('status', StreamItem.STATUS_FORKED); // Will only be committed if this all succceds.

        // Sort the forks based on our own forkIds, to preserve order.
        var sortedForks = forks.sort(function(a, b){
          return forkIds.indexOf(a.id) - forkIds.indexOf(b.id);
        });
        Fork.forkStreamItem(self, sortedForks, options);
      },
      error: options.error,
    })

	},

}, {
	// @Class
  STATUS_PENDING: "rejected",    // Stream owner rejected content; do not show in queries.
  STATUS_FORKED: "forked",       // Fork job complete. Ready for display.
  STATUS_GATED: "gated",         // The delta decided this should not be displayed.

  STREAM_STATUSES: ["forked"],   // On a standard Stream query, which statuses are acceptable?

  //
  // Takes an object (Either Content or...?)
  //
  factory: function(stream, delta, objects, options) {
    var map = {},
        query = new Parse.Query(StreamItem);
    for (var o in objects) {
    	var obj = objects[o];
    	var relationship = obj.className+'_'+obj.id;
    	map[relationship] = obj;
    }
    var relationships = Object.keys(map);

    query.containedIn('relationship', relationships);
    query.equalTo('stream',stream);
    query.descending('createdAt');
    query.limit(1000);
    query.find({
      success: function(items) {
        CCObject.log('[ItemFactory] found item matches: '+items.length,3);
        var built = {},
            toSave = [];

        for (var i in items) {
          var item = items[i],
              relationship = item.get('relationship');
          if(relationship) {
            relationships = CCObject.arrayRemove(relationships, relationship);
            built[relationship] = item;
          }
          else {
            built[relationship] = StreamItem._factory(stream, delta, map[relationship]);
            if (built[relationship]) {
            	toSave.push(built[relationship]);
            }
          }
        }
        for (var r in relationships) {
          var relationship = relationships[r];
          built[relationship] = StreamItem._factory(stream, delta, map[relationship]);
          if (built[relationship]) {
	          toSave.push(built[relationship]);
	        }
        }
        CCObject.log('[ItemFactory] builds to save: '+toSave.length, 3);
        options.success(toSave);
      },
      error: options.error,
    });
  },

  //
  // Takes an object (Either Content or...?)
  // The object has exportToStreamItem(stream) called on it
  // Do any setup there
  // This is just for automatic (relationship) stuff
  //
  _factory: function(stream, delta, o) {
  	var item = o.exportToStreamItem(delta),
        holdHours = parseInt(delta.get('holdHours') || 0),
        holdTime = (holdHours > 0 ? holdHours : 0) * 60 * 60 * 1000,
        timestamp = new Date().getTime() + holdTime,
        holdDate = new Date(timestamp);
    item.set('stream',stream);
    item.set('originalUrl',item.get('url'));
  	item.set('relationship', o.className+'_'+o.id);
    item.set('holdDate',holdDate);
    item.set('delta', delta);
    item.set('pendingForkIds',delta.get('forkIds'));
   	return item;
  },

  sorter: function(a,b) {
	  if (a.get('createdAt') < b.get('createdAt'))
	    return -1;
	  if (a.get('createdAt') > b.get('createdAt'))
	    return 1;
	  return 0;
	},

});

exports.StreamItem = StreamItem;