var CCObject = require('cloud/libs/CCObject'),
    Content = require('cloud/Content').Content,
    Source = require('cloud/Source').Source,
    Image = require('parse-image'),
    Fork = require('cloud/Fork').Fork;

var StreamItem = Parse.Object.extend("StreamItem", {
	// @Instance

  /**
   * Pass a StreamItem through a JSON parser to get a simple hash
   * Then delete extra data that we don't want to send down
   * (trim the pipe bandwidth)
   */
  present: function() {
    return CCObject.scrubJSON(this, ['holdDate','operations','relationship','status','delta','stream',
                                     'publisher','pendingForkIds','forkResults','contentScore']);
  },
	/**
	 * Before Save
	 * Shortens the URL, etc.
	 */
	fork: function(options) {
		var self = this,
				forkMap = {},
				forkIds = self.get('pendingForkIds'),
        status = self.get('status');

		if(status !== StreamItem.STATUS_GATED || !forkIds || !forkIds.length) {
      if (status === StreamItem.STATUS_GATED) {
        this.set('status', StreamItem.STATUS_FORKED);
      }
      return Parse.Promise.as(true);
		}

    // Load the forks...
    var query = new Parse.Query(Fork);
    query.containedIn('objectId',forkIds);
    return query.find().then(function(forks) {
      if(!forks || !forks.length) {
        return true;
      }
      self.set('status', StreamItem.STATUS_FORKED); // Will only be committed if this all succceds.

      // Sort the forks based on our own forkIds, to preserve order.
      var sortedForks = forks.sort(function(a, b){
        return forkIds.indexOf(a.id) - forkIds.indexOf(b.id);
      });
      return Fork.forkStreamItem(self, sortedForks, options);
    });
	},
  /**
   * Get a resized version of the cover image
   * Can take width/height as params
   */
  thumbnail: function(options) {
    if (!this.has('images') || this.get('images').length <= 0) {
      return Parse.Promise.as(false);
    }
    var self = this,
        images = this.get('images'),
        thumbnails = this.get('thumbnails') || {},
        width = parseInt(options.width || 0),
        height = parseInt(options.height || 0),
        key = width + '_' + height,
        url = (images[0].url.indexOf('//') === 0 ? 'http:' : '') + images[0].url,
        base64 = null;
    if (thumbnails[key]) {
      return Parse.Promise.as(thumbnails[key]);
    }
    return Parse.Cloud.httpRequest({ url: url }).then(function(response) {
      // Create an Image from the data.
      return (new Image()).setData(response.buffer);
    }).then(function(image) {
      var opts = {};
      if (width && height) {
        opts.width = width;
        opts.height = height;
      }
      else if (width) {
        opts.ratio = width / image.width();
      }
      else if (height) {
        opts.ratio = height / image.height();
      }
      else {
        throw Error("No width/height");
      }
      // Scale the image to a certain size.
      return image.scale(opts);
    }).then(function(image) {
      return image.setFormat("JPEG");
    }).then(function(image) {
      // Get the bytes of the new image.
      return image.data();
    }).then(function(data) {
      base64 = data.toString("base64");
      var file = new Parse.File("image.jpg", { base64: data.toString("base64") });
      return file.save();
    }).then(function(file) {
      thumbnails[key] = file.url();
      self.set('thumbnails',thumbnails);
      return self.save();
    }).then(function() {
      return thumbnails[key];
    });
  },

}, {
	// @Class
  STATUS_ACCEPTED: "accepted",   // Accepted by user; don't show in schedule
  STATUS_REJECTED: "rejected",   // Stream owner rejected content; do not show in queries.
  STATUS_FORKED: "forked",       // Fork job complete. Ready for display.
  STATUS_GATED: "gated",         // The delta decided this should not be displayed.

  STREAM_STATUSES: ["forked","accepted"],   // On a standard Stream query, for rendering, which statuses are acceptable?

  //
  // Takes a Content object
  // For dynamic sources, only returns new (saved) items
  // For statics, returns the StreamItem representation in all cases
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
    return query.find().then(function(items) {
      CCObject.log('[ItemFactory] found item matches: '+items.length,3);
      var built = {},
          ret = [];

      for (var i in items) {
        var item = items[i],
            relationship = item.get('relationship');
        if(relationship) {
          // Already had a representation
          relationships = CCObject.arrayRemove(relationships, relationship);
          built[relationship] = item;
        }
        /* WUT? no relationship? We queried on it, it must exist...
        else {
          // Build a new streamitem 
          built[relationship] = StreamItem.build(stream, delta, map[relationship], options);
          if (built[relationship]) {
          	ret.push(built[relationship]);
          }
        }*/
      }
      for (var r in relationships) {
        var relationship = relationships[r];
        built[relationship] = StreamItem.build(stream, delta, map[relationship], options);
        if (built[relationship]) {
          ret.push(built[relationship]);
        }
      }
      CCObject.log('[ItemFactory] returning: '+ret.length, 3);
      return ret;
    });
  },

  //
  // Takes an object (Either Content or...?)
  // The object has exportToStreamItem(stream) called on it
  // Do any setup there
  // This is just for automatic (relationship) stuff
  //
  build: function(stream, delta, o, options) {
  	var item = o.exportToStreamItem(delta),
        source = o.get('source'),
        isStatic = source && source.get('type') === Source.TYPE_STATIC,
        holdHours = isStatic ? 0 : parseInt(delta.get('holdHours') || 0),
        holdTime = (holdHours > 0 ? holdHours : 0) * 60 * 60 * 1000,
        timestamp = new Date().getTime() + holdTime,
        scheduledAt = new Date(timestamp);
    item.set('stream',stream);
    item.set('delta', delta);
    item.set('originalUrl',item.get('url'));
  	item.set('relationship', o.className+'_'+o.id);
    item.set('scheduledAt',scheduledAt);
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