
exports.LOG_PRIORITY_MIN = 3;

exports.log = function(str, priority) {
  priority = priority || 1;
  if (priority >= exports.LOG_PRIORITY_MIN) {
    console.log(str);
  }
}

exports.arrayRemove = function(arr) {
    var what, a = arguments, L = a.length, ax;
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
    for (var j=0; j<arg.length; j++) {
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