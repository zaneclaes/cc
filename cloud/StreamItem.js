var Content = require('cloud/Content').Content,
		URLShortener = require('cloud/libs/URLShortener'),
    OpQueue = require('cloud/libs/CCOpQueue').OpQueue,
		CCObject = require('cloud/libs/CCObject');

var StreamItem = Parse.Object.extend("StreamItem", {
	// @Instance

	/**
	 * Before Save
	 * Shortens the URL, etc.
	 */
	finalize: function(options) {
		var self = this,
				opMap = {},
				ops = self.get('operations');

		if(!ops || !Object.keys(ops).length) {
      if(options && options.success) options.success();
      return;
		}

		var finalizerQueue = new OpQueue();
		finalizerQueue.displayName = 'Finalizer';
		finalizerQueue.maxConcurrentOps = 3;

		// Do each of the queued operations...
		for (var o in ops) {
			opMap[o] = finalizerQueue.queueOp({
				run: function(op, options) {
					URLShortener.bitly(self.get('url'), options);
				}
			});
		}

		// Finish up...
		finalizerQueue.run(function(q){
			if (Object.keys(ops).indexOf('shorten')>=0) {
				var shortened = q.results[opMap['shorten']];
				if (shortened) {
					self.set('shortened',shortened.data.url);
				}
			}
			self.set('operations',{});
      if(options && options.success) options.success();
		});
	},

}, {
	// @Class

  // 
  // Takes an object (Either Content or...?)
  // 
  //
  factory: function(stream, objects, options) {
    var map = {},
        query = new Parse.Query(StreamItem);
    for (var o in objects) {
    	var obj = objects[o];
    	var relationship = obj.className+'_'+obj.id;
    	map[relationship] = obj;
    }
    var relationships = Object.keys(map);

    query.containedIn("relationship", relationships);
    query.equalTo('streamId',stream.id);
    query.find({
      success: function(items) {
        CCObject.log('[ItemFactory] found item matches: '+items.length);
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
            built[relationship] = StreamItem._factory(stream, map[relationship]); 
            if (built[relationship]) {
            	toSave.push(built[relationship]);
            }
          }
        }
        for (var r in relationships) {
          var relationship = relationships[r];
          built[relationship] = StreamItem._factory(stream, map[relationship]); 
          if (built[relationship]) {
	          toSave.push(built[relationship]);
	        }
        }
        CCObject.log('[ItemFactory] builds to save: '+toSave.length);
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
  // Takes an object (Either Content or...?)
  // 
  //
  _factory: function(stream, o) {
  	var item = o.exportToStreamItem(stream),
        holdHours = parseInt(stream.get('holdHours') || 0),
        holdTime = (holdHours > 0 ? holdHours : 0) * 60 * 60 * 1000,
        timestamp = new Date().getTime() + holdTime,
        holdDate = new Date(timestamp);
  	item.set('relationship', o.className+'_'+o.id);
    item.set('holdDate',holdDate);
  	item.set('streamId', stream.id);
  	item.set('operations', {
  		'shorten' : stream.get('shortener')
  	});
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