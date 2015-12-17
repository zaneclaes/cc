var CCObject = require('cloud/libs/CCObject'),
    Content = require('cloud/Content').Content,
    Delta = require('cloud/Delta').Delta,
    StreamItem = require('cloud/StreamItem').StreamItem,
    fs = require('fs'),
    jade = require('jade'),
    XMLWriter = require('cloud/libs/XMLWriter');

/**
 * Max age for content, if maxContentAge not specified by the stream
 */
var DEFAULT_MAX_CONTENT_AGE = 1000 * 60 * 60 * 24 * 7;

var Stream = Parse.Object.extend("Stream", {
  // @Instance

  onBeforeSave: function() {
    var self = this,
        popDate = this.get('populatedAt');
    if (!popDate) {
      this.set('populatedAt', new Date((new Date()).getTime() - 1000 * 60 * 60 * 24));
    }
    if (!this.get('presentedAt')) {
      this.set('presentedAt', new Date());
    }
    return this._generateCanonicalName(CCObject.canonicalName(this.get('name'))).then(function(cn) {
      self.set('canonicalName',cn);
      return true; //self.populate();
    });
  },

  // Ensure uniqueness beforesave...
  _generateCanonicalName: function(cn) {
    if (this.get('canonicalName')) {
      return Parse.Promise.as(this.get('canonicalName'));
    }
    var self = this,
        q = new Parse.Query(Stream);
    q.equalTo('canonicalName',cn);
    q.notEqualTo('objectId',self.id);
    return q.count().then(function(c) {
      if (c > 0) {
        // Generate new name
        cn = cn.split('#')[0] + '#' + CCObject.idStr(4);
        return self._generateCanonicalName(cn);
      }
      else {
        return cn;
      }
    });
  },
  /**
   * First, calls out to Populate in order to fill up StreamItems
   * Then queries stream items in order to return them to the client
   */
  present: function(options) {
    var self = this,
        minPres = (new Date()).getTime() - (Stream.ACTIVE_STREAM_AGE * 3/4),
        updatePres = !this.has('presentedAt') || this.get('presentedAt').getTime() < minPres;
    options = options || {};
    //options = JSON.parse(JSON.stringify(options || {}));
    options.limit = parseInt(options.limit) || 20;
    options.offset = options.offset || 0;
    options.format = options.format || 'json';
    options.order = options.order || 'scheduledAt';
    options.direction = (options.direction || 'desc').toLowerCase().indexOf('asc') === 0 ? 'ascending' : 'descending';
    options.age = parseInt(options.age || 0);

    var promises = [this._present(options)];
    if (updatePres) {
      this.set('presentedAt', new Date());
      promises.push(this.save());
    }

    return Parse.Promise.when(promises);
  },
  // Internal: called by present once population is complete.
  _present: function(options) {
    var self = this,
        statuses = options.statuses || StreamItem.STREAM_STATUSES,
        query = new Parse.Query(StreamItem),
        now = (new Date()).getTime(),
        scrub = ['populationIndex','populatedAt','presentedAt','user'],
        template = options.template || this.get('template'),
        out = null;
    if (options.format === 'html') {
      // This will become a jade render promise chain, later.
    }
    else if (options.format === 'rss') {
      out = new XMLWriter();
      out.startDocument();
    }
    else {
      out = CCObject.scrubJSON(this, scrub);
    }
    query.equalTo('stream',this);
    query.lessThan('scheduledAt',new Date());
    if (options.age) {
      query.greaterThan('scheduledAt', new Date(now - options.age));
    }

    query.containedIn('status',statuses);
    query.limit(options.limit);
    query.skip(options.offset);
    query[options.direction](options.order);
    query.include('content');
    return query.find().then(Stream.dedupe).then(function(items) {
      if (options.format === 'html') {
        var itemVars = []
            fnJade = 'cloud/views/templates/'+(template || 'default')+'.jade',
            exists = fs.existsSync(fnJade),
            contents = exists ? fs.readFileSync(fnJade) : false,
            jadeVars = options.jadeVars || {};

        jadeVars.items = [];
        jadeVars.stream = JSON.parse( JSON.stringify( self ) );

        if (!contents) {
          throw new Error('Template not found');
        }

        for (var i in items) {
          var item = items[i],
              variableMap = CCObject.extend(item.present(options), item.get('params') || {});
          variableMap.clicks = item.get('clicks');
          jadeVars.items.push(variableMap);
        }
        // Running Jade Version 0.27.6 , no compileFile()
        // 2nd param is options, if necessary.
        return jade.compile(contents, {
          filename: 'cloud/views/main.jade'
        })(jadeVars);
      }
      else if (options.format === 'rss') {
        var firstItem = items.length > 0 ? items[0] : false,
            desc = firstItem ? firstItem.get('title') : self.get('description');

        out.startElement('rss').writeAttribute('version','2.0').
                                writeAttribute('xmlns:atom','http://www.w3.org/2005/Atom');
        out.startElement('channel');
        out.startElement('title').text(self.get('name')).endElement();
        out.startElement('link').text(options.link).endElement();
        out.startElement('atom:link').writeAttribute('rel','self').
                                      writeAttribute('href',options.link).
                                      endElement();
        out.startElement('description').text(desc || self.get('name')).endElement();
        out.startElement('language').text('en-us').endElement();

        if (options.order == 'scheduledAt') {
          items.sort(function(a,b){
            return a.present(options).pubDate - b.present(options).pubDate;
          });
        }

        for (var i in items) {
          var item = items[i],
              map = item.present(options),
              desc = map.text,
              images = item.get('images');
          out.startElement('item');
          out.startElement('title').text(map.title).endElement();
          out.startElement('link').text(map.url).endElement();
          //out.startElement('author').text(item.get('host')).endElement();
          out.startElement('guid').writeAttribute('isPermaLink','false').text(map.id).endElement();
          out.startElement('pubDate').text(map.scheduledAt).endElement();

          // TODO: Remove this hack
          var match = desc.match(/(<div.*)?<img src="([^"]+)" [^>]*>(.*<\/div>)?/)
          if (match) {
            desc = desc.replace(match[0],"")
          }

          if (options.thumbnail) {
            var width = Math.max(parseInt(options.thumbnail), 240);
            if (images && images.length > 0) {
              // Embed a resized thumbnail at the end of the feed
              var imgUrl = 'http://www.deltas.io/api/v1/stream_items/' + map.id + '/image?width='+width;
              out.startElement('enclosure').writeAttribute('type','image/jpeg').
                                            writeAttribute('url',imgUrl).
                                              endElement();
              desc = '<center><a href="' + map.url + '" ><img src="' + imgUrl + '" /></a></center><br />'+desc;

            }
            else if (match) {
              // Fall back on the image we extracted...
              desc = '<center><a href="' + map.url + '" ><img src="' + match[2] + '" width="'+width+'" /></a></center><br />'+desc;
            }
          }
          out.startElement('description').text(desc).endElement();
          out.endElement();
        }
        out.endDocument();
        out = out.toString();
      }
      else {
        var json = [];
        for (var i in items) {
          json.push(items[i].present());
        }
        out.items = JSON.parse(JSON.stringify( json ));
      }
      return out;
    });
  },
  /**
   * Loops through stream_items and pegs them to the scheduling rules
   */
  schedule: function(items, force) {
    if (!items) {
      var self = this,
          query = new Parse.Query(StreamItem);
      query.equalTo('stream',self);
      query.greaterThan('scheduledAt',new Date());
      query.ascending('scheduledAt');
      return query.find().then(function(items) {
        return self._schedule(items);
      });
    }
    else if (items && items.length <= 0) {
      return Parse.Promise.as([]);
    }
    else {
      return this._schedule(items, force);
    }
  },
  _schedule: function(items, force) {
    // Sort the items in ascending scheduled order
    items = items.sort(function(a, b){
      aT = a.has('scheduledAt') ? a.get('scheduledAt').getTime() : 0;
      bT = b.has('scheduledAt') ? b.get('scheduledAt').getTime() : 0;
      return aT - bT;
    });
    var spacing = this.getSpacing(),
        randomization = spacing / 4,
        changed = false;
    for (var i=1; i<items.length; i++) {
      var lastItem = items[i-1],
          item = items[i],
          lastTime = lastItem.has('scheduledAt') ? lastItem.get('scheduledAt').getTime() : 0,
          rand = Math.floor(Math.random() * randomization) - randomization / 2,
          nextTime = lastTime + spacing + rand,
          minTime = lastTime + spacing - randomization / 2,
          maxTime = lastTime + spacing + randomization / 2,
          curTime = item && item.has('scheduledAt') ? item.get('scheduledAt').getTime() : 0;

      if (item && (curTime < minTime || curTime > maxTime)) {
        // Was not in the acceptable zone for scheduling
        item.set('scheduledAt',new Date(nextTime));
        changed = true;
      }
    }
    return changed || force ? Parse.Object.saveAll(items) : Parse.Promise.as(items);
  },
  /**
   * Fills up the stream with new StreamItem objects by calling fetchDeltas
   */
  populate: function(options) {
    options = options || {};
    var self = this,
        allItems = [];

    // First, get the most recent existing StreamItem object so we can query on the date
    var query = new Parse.Query(StreamItem);
    query.equalTo('streamId',this.id);
    query.limit(1);
    query.descending('createdAt');
    return query.first().then(function(item) {
      allItems.push(item);
      if (item && item.createdAt) {
        options.startDate = item.createdAt;
      }
      CCObject.log('[Stream '+self.id+'] Populating '+(item ? '' : 'new deltas'),2);
      return self.fetchDeltas(options);
    }).then(function(items) {
      allItems = CCObject.arrayUnion(allItems, items);
      return self.schedule(allItems);
    });
  },
  /**
   * Find deltas which feed this stream and fetch (populate) them
   * This does the actual content fetching
   */
  fetchDeltas: function(options) {
    options = options || {};
    var self = this,
        query = new Parse.Query(Delta);
    query.equalTo('streamId',this.id);
    query.lessThanOrEqualTo('nextFetch', new Date());
    return query.find().then(function(deltas) {
      CCObject.log('[Stream '+self.id+'] Populating '+deltas.length+' Deltas...',2);
      var promises = [];
      for (var d in deltas) {
        promises.push(deltas[d].fetch(self, options));
      }
      return Parse.Promise.when(promises);
    }).then(function() {
      var items = [];
      for (var i in arguments) {
        for (var j in arguments[i]) {
          if (arguments[i][j]) {
            items.push(arguments[i][j]);
          }
        }
      }
      return items;
    });
  },
  /**
   * For items in the stream, update the click counts
   */
  updateClicks: function() {
    var query = new Parse.Query(StreamItem),
        now = (new Date()).getTime(),
        upDate = new Date(now - StreamItem.CLICK_UPDATE_INTERVAL),
        promises = [];
    query.lessThan('clicksUpdatedAt',upDate);
    query.containedIn('status',StreamItem.STREAM_STATUSES);
    query.equalTo('stream',this);
    query.limit(100);
    return query.find().then(function(items) {
      //CCObject.log('Stream updateClicks on '+items.length,3);
      for (var i in items) {
        promises.push(items[i].getClicks());
      }
      return Parse.Promise.when(promises);
    }).then(function() {
      var items = [];
      for (var i in arguments) {
        for (var j in arguments[i]) {
          if (arguments[i][j]) {
            items.push(arguments[i][j]);
          }
        }
      }
      return items.length ? Parse.Object.saveAll(items) : Parse.Promise.as(true);
    }).then(function() {
      return promises.length;
    });
  },

  /**
   * Accessor methods, assigning defaults
   */
  getSpacing: function() {
    return this.get('spacing') || (1000 * 60 * 60 * 4);
  },
}, {
  // @Class
  ACTIVE_STREAM_AGE: 1000 * 60 * 60 * 24, // Any stream displayed in the last day is "active"
  /**
   * Find the streamId, populate, and return
   */
  find: function(params) {
    var sId = params.id || params.streamId,
        cn = params.canonicalName,
        keys = ['limit','offset','velocity','shares'],
        query = new Parse.Query(Stream);
    if (sId) {
  		query.equalTo("objectId",sId);
		}
    if (cn) {
      query.equalTo('canonicalName',cn);
    }
    return query.first();
	},
  // Internal: after present, dupes are an array of StreamItems that should be deleted.
  dedupe: function(items) {
    if (!items) {
      return Parse.Promise.as([]);
    }
    var seen = {},
        dupes = [],
        out = [];
    for (var i in items) {
      var r = items[i].get('relationship'),
          url = items[i].get('url'),
          title = items[i].get('title'),
          sourceId = items[i].get('source').id;
      seen[sourceId] = seen[sourceId] || [];
      if (seen[sourceId].indexOf(r) >= 0 ||
          seen[sourceId].indexOf(url) >= 0 ||
          seen[sourceId].indexOf(title) >= 0) {
        dupes.push(items[i]);
        continue;
      }
      out.push(items[i]);
      seen[sourceId].push(r);
      seen[sourceId].push(url);
      seen[sourceId].push(title);
    }

    if (dupes.length <= 0) {
      return Parse.Promise.as(out);
    }
    CCObject.log('[Stream] de-duping x'+dupes.length,3);
    CCObject.log(seen);
    return Parse.Object.destroyAll(dupes).then(function(){
      return out;
    });
  },
  /**
   * First, update the click count on all items in the stream
   * Then, reschedule their times
   */
  schedule: function(items, force) {
    if (!items || items.length <= 0) {
      return Parse.Promise.as([]);
    }

    var mapped = {},
        streams = {},
        promises = [];
    for (var i in items) {
      var stream = items[i].get('stream');
      mapped[stream.id] = mapped[stream.id] || [];
      mapped[stream.id].push(items[i]);
      streams[stream.id] = stream;
    }
    for (var streamId in mapped) {
      promises.push(streams[streamId].schedule(mapped[streamId], force));
    }
    return Parse.Promise.when(promises);
  },
});

exports.Stream = Stream;