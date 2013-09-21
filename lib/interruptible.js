var util = require("util");

/**
 * Retrieve usefull types
 */

var dummyGenerator = function*() { yield null };
var GeneratorFunction = dummyGenerator.constructor;
var GeneratedObject = dummyGenerator().next().constructor;

/**
 * Currified version of process.nextTick which accepts arguments
 */
var nextTick = function(callback) {
  return function() {
    var args = arguments;
    process.nextTick(function() {
      callback.apply(null, args)
    })
  }
};

/**
 * Controller for sync-like interruptible code.
 * States :
 *  - idle
 *  - running
 *  - paused
 *  - finished
 */
var Controller = function(fun) {
  this.state = 'idle';
  this.fun = fun;
  this.loops = 0;
};

/**
 * Number of loops before using setImmediate
 */
var maxLoops = 2000;

/**
 * Create a safe callback for controller
 */
var endCallback = function(controller, callback) {
  if (typeof callback !== 'function') {
    callback = function() {}
  }

  controller.callback = function(err, res) {
    delete controller.gen;
    controller.err = err;
    controller.res = res;
    callback(err, res)
  }
};

/**
 * Moves the controller to newState and then calls callback.
 * Like nextTick, this is currified to be able to pass arguments easily.
 */
var nextState = function(controller, newState, callback) {
  return function() {
    nextTick(function() {
      controller.state = newState;
      callback.apply(null, arguments)
    }).apply(null, arguments)
  }
};

/**
 * Runs the generator inside controller.
 */
var runGeneratorWrapped = function(controller) {
  var old = controller.yielded;
  delete controller.yielded;
  var yielded;

  try {
    yielded = controller.gen.next(old);
    if (yielded.done) {
      nextState(controller, 'finished', controller.callback)(null, yielded.value)
    } else {
      if (controller.state === 'paused') {
        controller.waiting = yielded;
        nextTick(controller.pauseCb)(controller);
        delete controller.pauseCb;
        return
      }
      nextLoop(controller, yielded)
    }
  } catch (err) {
    nextState(controller, 'finished', controller.callback)(err)
  }
};

/**
 * Runs the generator inside controller.
 */
var runGenerator = function(controller) {
  if (controller.loops++ < maxLoops) {
    runGeneratorWrapped(controller)
  } else {
    controller.loops = 0;
    setImmediate(function() {
      runGeneratorWrapped(controller)
    })
  }
};

/**
 * If yielded is a future, then it will be executed and the result will
 * be passed back to the generator in controller.
 * If not, the value is simply passed back.
 */
var nextLoop = function(controller, yielded) {
  if (typeof yielded.value === 'function') {
    yielded.value(function(err, res) {
      if (err) {
        nextState(controller, 'finished', controller.callback)(err)
      } else {
        controller.yielded = res;
        nextTick(runGenerator)(controller)
      }
    })
  } else {
    controller.yielded = yielded.value;
    nextTick(runGenerator)(controller)
  }
};

/**
 * Starts the computation, once finished, result is passed to callback.
 */
Controller.prototype.start = function(callback) {
  if (this.state !== 'idle') {
    return this
  }

  endCallback(this, callback);

  if (typeof this.fun !== 'function') {
    nextState(this, 'finished', controller.callback)(new TypeError('fun is not a function'));
    return this
  }

  nextState(this, 'running', function(controller) {
    if (controller.fun instanceof GeneratorFunction) {
      controller.gen = controller.fun();
      runGenerator(controller)
    } else {
      try {
        var res = controller.fun();
        nextState(controller, 'finished', controller.callback)(null, res)
      } catch (err) {
        nextState(controller, 'finished', controller.callback)(err)
      }
    }
  })(this);

  return this
};

/**
 * At next `yield` statement, the computation is paused.
 * callback is called with the controller as an argument when the computation suspends.
 */
Controller.prototype.pause = function(callback) {
  if (this.state === 'running') {
    this.state = 'paused';

    if (typeof callback !== 'function') {
      callback = function() {}
    }

    this.pauseCb = callback
  }

  return this
};

/**
 * Resume paused computation.
 */
Controller.prototype.resume = function() {
  if (this.state === 'paused') {
    this.state = 'running';
    if (this.waiting === undefined) {
      delete this.pauseCb;
      return this
    }
    nextLoop(this, this.waiting)
    delete this.waiting;
  }

  return this
};

/**
 * Reset finished or paused computation.
 */
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

/**
 * Kills the computation. Equivalent to pause, then reset.
 */
Controller.prototype.kill = function(callback) {
  if (typeof callback !== 'function') {
      callback = function() {}
    }

  this.pause(function(controller) {
    controller.reset();
    callback(controller)
  });

  return this
};

/**
 * Example of future that can be used in a `yield` statement.
 */
var sleep = function(miliseconds) {
  return function(callback) {
    setTimeout(function() {
      callback(null, miliseconds)
    }, miliseconds)
  }
};

exports.Controller = Controller;
exports.createFuture = function(fun) {
  var future = function(callback) {
    future.start(callback);
  };
  future.state = 'idle';
  future.fun = fun;

  future.__proto__ = Controller.prototype;

  return future
};
exports.sleep = sleep;
