var CCObject = require('cloud/libs/CCObject'),
    Content = require('cloud/Content').Content,
    Delta = require('cloud/Delta').Delta,
    StreamItem = require('cloud/StreamItem').StreamItem,
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
    return this._generateCanonicalName(CCObject.canonicalName(this.get('name'))).then(function(cn) {
      self.set('canonicalName',cn);
      return true; //self.populate();
    });
  },

  // Ensure uniqueness beforesave...
  _generateCanonicalName: function(cn) {
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
    var self = this;
    options = JSON.parse(JSON.stringify(options || {}));
    options.limit = options.limit || this.inferFetchLimit();
    options.offset = options.offset || 0;
    options.format = options.format || 'json';
    options.order = options.order || 'scheduledAt';
    options.direction = (options.direction || 'desc').toLowerCase().indexOf('asc') === 0 ? 'ascending' : 'descending';
    options.age = parseInt(options.age || 0);

    // Will trigger a populate command...
    this.set('presentedAt', new Date());
    return this.save().then(function(){
      return self._present(options);
    });
  },
  // Internal: called by present once population is complete.
  _present: function(options) {
    var self = this,
        statuses = options.statuses || StreamItem.STREAM_STATUSES,
        query = new Parse.Query(StreamItem),
        now = (new Date()).getTime(),
        scrub = ['populationIndex','populatedAt','presentedAt','user'],
        template = this.get('template') || {
          before : '<div class="deltas"><ul class="deltas-items">',
          item : '<li class="deltas-item"><img src="#{imageUrl}" /><h3><a href="#{url}" target="_blank">#{title}</a></h3><p>#{text}</p></li>',
          after : '</ul></div>',
        },
        out = null;
    if (options.format === 'html') {
      out = '<div class="deltas"><ul>';
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

    return query.find().then(Stream.dedupe).then(function(items) {
      return options.order === 'scheduledAt' ? self.schedule(items) : Parse.Promise.as(items);
    }).then(function(items) {
      if (options.format === 'html') {
        for (var i in items) {
          var item = items[i],
              images = item.get('images'),
              html = JSON.parse( JSON.stringify( template.item ) ),
              map = {
                title : item.get('title'),
                text : item.get('text'),
                url : item.get('url'),
                host : item.get('host'),
                id : item.id,
                scheduledAt : (item.get('scheduledAt') || new Date()).toUTCString(),
                imageUrl : images && images.length > 0 ? images[0].url : '',
              };
          for (var k in map) {
            html = html.replace('#{' + k + '}', map[k]);
          }
          out += html;
        }
        out += template.after;
      }
      else if (options.format === 'rss') {
        var item = items.length > 0 ? items[0] : false,
            desc = item ? item.get('title') : self.get('description');

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

        for (var i in items) {
          var item = items[i],
              desc = item.get('text'),
              images = item.get('images');
          out.startElement('item');
          out.startElement('title').text(item.get('title')).endElement();
          out.startElement('link').text(item.get('url')).endElement();
          //out.startElement('author').text(item.get('host')).endElement();
          out.startElement('guid').writeAttribute('isPermaLink','false').text(item.id).endElement();
          out.startElement('pubDate').text((item.get('scheduledAt') || new Date()).toUTCString()).endElement();
          if (images && images.length > 0) {
           // var imgUrl = (images[0].url.indexOf('//') === 0 ? 'http:' : '') + images[0].url;
            var imgUrl = 'http://www.deltas.io/api/v1/stream_items/' + item.id + '/image?width=240';
            out.startElement('enclosure').writeAttribute('type','image/jpeg').
                                          writeAttribute('url',imgUrl).
                                          endElement();
            desc = '<center><a href="' + item.get('url') + '" ><img src="' + imgUrl + '" /></a></center><br />'+desc;
          }

          if (options.paragraphs) {
            desc = desc.split('</p>').slice(0, parseInt(options.paragraphs)).join('</p>');
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
        out.items = JSON.parse(JSON.stringify( items ));
      }
      return out;
    });
  },
  /**
   * Loops through stream_items and pegs them to the scheduling rules
   */
  schedule: function(items) {
    if (!items || items.length <= 0) {
      return Parse.Promise.as([]);
    }
    // Sort the items in ascending scheduled order
    items = items.sort(function(a, b){
      return a.get('scheduledAt').getTime() - b.get('scheduledAt').getTime();
    });
    var spacing = this.get('spacing') || (1000 * 60 * 60 * 4),
        randomization = this.get('randomization') || (1000 * 60 * 60),
        changed = false;
    for (var i=1; i<items.length; i++) {
      var lastItem = items[i-1],
          item = items[i],
          lastTime = lastItem.get('scheduledAt').getTime(),
          rand = Math.floor(Math.random() * randomization) - randomization / 2,
          nextTime = lastTime + spacing + rand,
          minTime = lastTime + spacing - randomization / 2,
          maxTime = lastTime + spacing + randomization / 2,
          curTime = item.get('scheduledAt').getTime();

      if (curTime < minTime || curTime > maxTime) {
        // Was not in the acceptable zone for scheduling
        item.set('scheduledAt',new Date(nextTime));
        changed = true;
      }
    }
    return changed ? Parse.Object.saveAll(items) : Parse.Promise.as(items);
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
      return self.fetchDeltas(options);
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
    });
  },
  /**
   * Max number of items to fetch at a time
   * For now, this is just hardcoded, but it could be used for query timeout fixes
   */
  inferFetchLimit: function() {
    return 20;
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
    query.limit(100);
    return query.find().then(function(items) {
      for (var i in items) {
        promises.push(items[i].updateClicks());
      }
      return Parse.Promise.when(promises);
    });
  },

}, {
  // @Class

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
      return [];
    }
    var seen = [],
        dupes = [],
        out = [];
    for (var i in items) {
      var r = items[i].get('relationship'),
          url = items[i].get('url'),
          title = items[i].get('title');
      if (seen.indexOf(r) >= 0 || seen.indexOf(url) >= 0 || seen.indexOf(title) >= 0) {
        dupes.push(items[i]);
        continue;
      }
      out.push(items[i]);
      seen.push(r);
      seen.push(url);
      seen.push(title);
    }

    if (dupes.length <= 0) {
      return out;
    }
    CCObject.log('[Stream] de-duping x'+dupes.length,3);
    return Parse.Object.destroyAll(dupes).then(function(){
      return out;
    });
  },
  /**
   * First, update the click count on all items in the stream
   * Then, reschedule their times
   */
  schedule: function(items) {
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
      promises.push(streams[streamId].schedule(mapped[streamId]));
    }
    return Parse.Promise.when(promises);
  },
});

exports.Stream = Stream;