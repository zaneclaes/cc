
/**
 * An "op" is just a standard success/error options map
 * With an additional function, "run", which receives the 
 * op back into its input, as well as its own unique success/error block to call.
 */


var CCObject = require('cloud/libs/CCObject'),
  OpQueue = Parse.Object.extend("OpQueue", {
	displayName: '',
	maxConcurrentOps: 1,
  numRunning: 0,
	queue: [],
	opId: 0,
	completed: [],
	errors: {},
	results: {},

	// Todo: sort the results based upon the op ID  
	getSortedResults: function() {
		// Object.keys(this.results).sort()
	},

	// Queue an op. Does not invoke run.
	queueOp: function(op) {
		if (typeof op === 'function') {
			op = {
				run: op
			};
		}

		op.opId = this.opId;
		this.opId++;
		this.queue.push(op);
		return op.opId;
	},

	getName: function() {
		return '['+this.displayName+']';
	},

	// Actually runs, if possible; just a simple callback.
	run: function(callback) {
		if (this.queue.length <= 0 || this.numRunning >= this.maxConcurrentOps) {
			return false;
		}
		var self = this,
				op = self.queue.shift(),
				opId = op.opId,
				onDone = (function() {
					self.numRunning--;
					CCObject.log(self.getName()+' Finished op: '+opId+'/'+self.queue.length+'/'+self.numRunning);
					self.completed.push(op);
					if (self.queue.length <= 0 && self.numRunning <= 0) {
						// TODO: sort this.completed by opId (??)
						CCObject.log(self.getName() + 'opQueue complete; '+Object.keys(self.results).length+' results and '+Object.keys(self.errors).length + 'errors');
						callback(self);
					}
					else {
						self.run(callback);
					}
				});
		CCObject.log(this.getName()+' starting op: '+opId+'/'+self.queue.length+'/'+self.numRunning);
		self.numRunning++;
		op.run(op, ({
			success: (function(v) {
				self.results[opId] = v;
				onDone();
			}),
			error: (function(e) {
				CCObject.log(self.getName()+' #'+opId+' errored: ');
				CCObject.log(e.class);
				CCObject.log(e);
				self.errors[opId] = e;
				onDone();
			})
		}));

		// Try running again immediatley, which fills up the queue.
		this.run(callback);
	}

}, {
});

exports.OpQueue = OpQueue;