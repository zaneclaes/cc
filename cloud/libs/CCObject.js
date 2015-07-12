
exports.LOG_PRIORITY_MIN = 3;

exports.log = function(str, priority) {
  priority = priority || 1;
  if (priority >= exports.LOG_PRIORITY_MIN) {
    console.log(str);
  }
}

exports.idStr = function(len) {
  len = parseInt(len || 10);
  var text = "";
  var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for( var i=0; i < len; i++ )
      text += possible.charAt(Math.floor(Math.random() * possible.length));
  return text;
}

exports.makeTemplateHtml = function(html) {
  return html.match(/<(script|object|applet|embbed|frameset|iframe|form|textarea|input|button)(\s+.*?)?\/?>/);
}

exports.escapeHtml = function(text) {
  var map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };

  return text.replace(/[&<>"']/g, function(m) { return map[m]; });
}

// Given "k1=v1&k2=v2" returns {k1: v1, k2: v2}
exports.mapParams = function(str, map) {
  var items = str.split('&');
  map = map || {};
  for (var i in items) {
    var kv = items[i].split('=');
    map[kv[0]] = kv.length > 1 ? kv[1] : false;
  }
  return map;
}

exports.timeUntil = function(date) {
  var now = new Date().getTime(),
      sec = (date.getTime() - now) / 1000;
  if (sec < 60) return 'seconds';
  var min = (sec / 60) % 60,
      minStr = Math.round(min) + ' min',
      hrs = (sec / (60 * 60)) % 24,
      hrsStr = hrs >= 1 ? (Math.round(hrs) + ' hrs') : false,
      dys = (sec / (60 * 60 * 24)) % 7,
      dysStr = dys >= 1 ? (Math.round(dys) + ' days') : false,
      wks = (sec / (60 * 60 * 24 * 7)),
      wksStr = wks >= 1 ? (Math.round(wks) + ' weeks') : false,
      ret = [];
  if (wksStr) ret.push(wksStr);
  if (dysStr) ret.push(dysStr);
  if (hrsStr) ret.push(hrsStr);
  ret.push(minStr);
  return ret.join(', ');
}

exports.scrubJSON = function(obj, keysToRemove) {
  var item = JSON.parse(JSON.stringify(obj));
  for (var s in keysToRemove) {
    delete item[keysToRemove[s]];
  }
  return item;
}

exports.arrayRemove = function(arr, what) {
    var a = arguments, L = a.length, ax;
    while (L > 1 && arr.length) {
        what = a[--L];
        while ((ax= arr.indexOf(what)) !== -1) {
            arr.splice(ax, 1);
        }
    }
    return arr;
}

exports.canonicalTag = function(t) {
  // strip everything but numbers letters and spaces
  return t.replace(/[^a-zA-Z\d\s]/g, '').trim();
}

exports.canonicalName = function(n) {
  var ret = [],
      parts = exports.canonicalTag(n).split(' ');
  for (var p in parts) {
    var pt = parts[p].trim();
    if (pt.length) {
      ret.push(pt);
    }
  }
  return ret.join('-').toLowerCase().substring(0,32);
}

exports.canonicalArray = function(arr) {
  var ret = [];
  for (var i in arr) {
    var v = exports.canonicalTag(arr[i]);
    if (v.length > 0 && ret.indexOf(v) < 0) {
      ret.push(v);
    }
  }
  return ret;
}

exports.arrayUnique = function(arr) {
  var ret = [];
  for (var i in arr) {
    var v = arr[i];
    if (ret.indexOf(v) < 0) {
      ret.push(v);
    }
  }
  return ret;
}

exports.extractString = function(str, beginning, end) {
  if (!str) {
    return false;
  }
  var match = str.indexOf(beginning);
  if (match < 0) {
    return false;
  }
  str = str.substring(match + beginning.length);
  match = str.indexOf(end);
  return match >= 0 ? str.substring(0, match) : str;
}

exports.arrayUnion = function() {
  var res = [];
  for (var i=0; i<arguments.length; i++) {
    var arg = arguments[i];
    for (var j in arg) {
      res.push(arg[j]);
    }
  }
  return res;
}

exports.extend = function() {
    var options, name, src, copy, copyIsArray, clone, target = arguments[0] || {},
        i = 1,
        length = arguments.length,
        deep = false,
        toString = Object.prototype.toString,
        hasOwn = Object.prototype.hasOwnProperty,
        push = Array.prototype.push,
        slice = Array.prototype.slice,
        trim = String.prototype.trim,
        indexOf = Array.prototype.indexOf,
        class2type = {
          "[object Boolean]": "boolean",
          "[object Number]": "number",
          "[object String]": "string",
          "[object Function]": "function",
          "[object Array]": "array",
          "[object Date]": "date",
          "[object RegExp]": "regexp",
          "[object Object]": "object"
        },
        jQuery = {
          isFunction: function (obj) {
            return jQuery.type(obj) === "function"
          },
          isArray: Array.isArray ||
          function (obj) {
            return jQuery.type(obj) === "array"
          },
          isWindow: function (obj) {
            return obj != null && obj == obj.window
          },
          isNumeric: function (obj) {
            return !isNaN(parseFloat(obj)) && isFinite(obj)
          },
          type: function (obj) {
            return obj == null ? String(obj) : class2type[toString.call(obj)] || "object"
          },
          isPlainObject: function (obj) {
            if (!obj || jQuery.type(obj) !== "object" || obj.nodeType) {
              return false
            }
            try {
              if (obj.constructor && !hasOwn.call(obj, "constructor") && !hasOwn.call(obj.constructor.prototype, "isPrototypeOf")) {
                return false
              }
            } catch (e) {
              return false
            }
            var key;
            for (key in obj) {}
            return key === undefined || hasOwn.call(obj, key)
          }
        };
      if (typeof target === "boolean") {
        deep = target;
        target = arguments[1] || {};
        i = 2;
      }
      if (typeof target !== "object" && !jQuery.isFunction(target)) {
        target = {}
      }
      if (length === i) {
        target = this;
        --i;
      }
      for (i; i < length; i++) {
        if ((options = arguments[i]) != null) {
          for (name in options) {
            src = target[name];
            copy = options[name];
            if (target === copy) {
              continue
            }
            if (deep && copy && (jQuery.isPlainObject(copy) || (copyIsArray = jQuery.isArray(copy)))) {
              if (copyIsArray) {
                copyIsArray = false;
                clone = src && jQuery.isArray(src) ? src : []
              } else {
                clone = src && jQuery.isPlainObject(src) ? src : {};
              }
              // WARNING: RECURSION
              target[name] = extend(deep, clone, copy);
            } else if (copy !== undefined) {
              target[name] = copy;
            }
          }
        }
      }
      return target;
    }