/**
 * Retrieve usefull types
 */

var dummyGenerator = function*() { yield null };
var GeneratorFunction = dummyGenerator.constructor;
var GeneratedObject = dummyGenerator().next().constructor;

var nextTick = function(callback) {
  return function() {
    var args = arguments;
    process.nextTick(function() {
      callback.apply(null, args)
    })
  }
};

/**
 * States :
 *  - idle
 *  - running
 *  - paused
 *  - finished
 */
var Controller = function(fun) {
  this.state = 'idle';
  this.fun = fun;
};

Object.defineProperty(Controller.prototype, 'safeCb', {
  value: function(callback) {
    if (typeof callback !== 'function') {
      callback = function() {}
    }

    var that = this;
    return function(err, res) {
      delete that.gen;
      that.err = err;
      that.res = res;
      callback(err, res)
    };
  },
  writable: true,
  enumerable : true,
  configurable : true
});

Object.defineProperty(Controller.prototype, 'nextState', {
  value: function(newState, callback) {
    var that = this;
    return function() {
      nextTick(function() {
        that.state = newState
        callback.apply(null, arguments)
      }).apply(null, arguments)
    }
  },
  writable: false,
  enumerable : false,
  configurable : false
});

Object.defineProperty(Controller.prototype, 'nextLoop', {
  value: function(res, callback) {
    if (typeof res.value === 'function') {
      var that = this;
      res.value(function(err) {
        if (err) {
          that.nextState('finished', callback)(err)
        } else {
          nextTick(that.runGenerator.bind(that))(callback)
        }
      })
    } else {
      nextTick(this.runGenerator.bind(this))(callback)
    }
  },
  writable: true,
  enumerable : true,
  configurable : true
});

Object.defineProperty(Controller.prototype, 'runGenerator', {
  value: function(callback) {
    var res;

    try {
      res = this.gen.next();
      if (res.done) {
        this.nextState('finished', callback)(null, res.value)
      } else {
        if (this.state === 'paused') {
          this.waiting = res;
          this.callback = callback;
          return
        }

        this.nextLoop(res, callback)
      }
    } catch (err) {
      this.nextState('finished', callback)(err)
    }    
  },
  writable: true,
  enumerable : true,
  configurable : true
});

Controller.prototype.start = function(callback) {
  if (this.state !== 'idle') {
    return this
  }

  callback = this.safeCb(callback);

  if (typeof this.fun !== 'function') {
    this.nextState('finished', callback)(new TypeError('fun is not a function'));
    return this
  }

  this.nextState('running', function(that) {
    if (that.fun instanceof GeneratorFunction) {
      that.gen = that.fun();
      that.runGenerator(callback)
    } else {
      try {
        var res = that.fun();
        that.nextState('finished', callback)(null, res)
      } catch (err) {
        that.nextState('finished', callback)(err)
      }
    }
  })(this);

  return this
};

Controller.prototype.pause = function() {
  if (this.state === 'running') {
    this.state = 'paused'
  }

  return this
};

Controller.prototype.resume = function() {
  if (this.state === 'paused') {
    this.state = 'running';
    this.nextLoop(this.waiting, this.callback)
    delete this.waiting;
    delete this.callback
  }

  return this
};

Controller.prototype.reset = function() {
  if (this.state === 'paused' || this.state === 'finished') {
    this.state = 'idle';
    delete this.waiting;
    delete this.callback;
    delete this.gen;
    delete this.err;
    delete this.res
  }

  return this
};

var sleep = function(miliseconds) {
  return function(callback) {
    setTimeout(function() {
      callback()
    }, miliseconds)
  }
};

exports.Controller = Controller;
exports.create = function(fun) {
  return new Controller(fun)
};
exports.sleep = sleep;
