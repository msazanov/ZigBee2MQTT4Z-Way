/*** Wirenboard MQTT Import HA module ****************************************************

Version: 1.0.0
-----------------------------------------------------------------------------
Author: Yurkin Vitaliy <aivs@z-wave.me>
Description:
   Get wirenboard devices and control it via MQTT
 *****************************************************************************/


// ----------------------------------------------------------------------------
// --- Class definition, inheritance and setup
// ----------------------------------------------------------------------------

function WBMQTTImport(id, controller) {
	WBMQTTImport.super_.call(this, id, controller);
}

inherits(WBMQTTImport, AutomationModule);

_module = WBMQTTImport;

WBMQTTImport.prototype.log = function (message, level) {
	var self = this;

	if (undefined === message) return;
	switch (level) {
		case LoggingLevel.DEBUG:
			if (!self.config.debug) {
				return;
			}
		case LoggingLevel.INFO:
			console.log('[' + this.constructor.name + '-' + this.id + '] ' + message);
			break;
		default:
			break;
	}
};

WBMQTTImport.prototype.error = function (message) {
	if (undefined === message) message = 'An unknown error occured';
	var error = new Error(message);
	console.error('[' + this.constructor.name + '_' + this.id + '] ' + error.stack);
};

// ----------------------------------------------------------------------------
// --- Module instance initialized
// ----------------------------------------------------------------------------

WBMQTTImport.prototype.init = function (config) {
	// Call superclass' init (this will process config argument and so on)
	WBMQTTImport.super_.prototype.init.call(this, config);

	var self = this;

	self.devicesList = [];
	self.topicTree = {};
	self.generated = [];

	// Defaults
	self.reconnectCount = 0;

	// Init MQTT client
	if (self.config.user != "none" && self.config.password != "none") {
		self.client = new mqtt(self.config.host, parseInt(self.config.port), self.config.user, self.config.password, self.config.clientId);
	}
	else {
		self.client = new mqtt(self.config.host, parseInt(self.config.port), self.config.clientId);
	}

	self.client.ondisconnect = function () { self.onDisconnect(); };
	self.client.onconnect = function () { self.onConnect(); };
	self.client.onmessage = function (topic, payload) { self.onMessage(topic, payload); };

	self.connectionAttempt();
};

WBMQTTImport.prototype.stop = function () {
	var self = this;

	// Cleanup
	this.state = ModuleState.DISCONNECTING;
	this.client.disconnect();
	this.removeReconnectionAttempt();

	// remove devices
	if (this.generated) {
		this.generated.forEach(function(name) {
			self.controller.devices.remove(name);
		});
		this.generated = [];
	}

	WBMQTTImport.super_.prototype.stop.call(this);
};

// ----------------------------------------------------------------------------
// --- Module methods
// ----------------------------------------------------------------------------
WBMQTTImport.prototype.connectionAttempt = function () {
	var self = this;

	try {
		self.state = ModuleState.CONNECTING;
		self.client.connect();
	} catch (exception) {
		self.log("MQTT connection error to " + self.config.host + " as " + self.config.clientId, LoggingLevel.INFO);
		self.reconnectionAttempt();
	}
}

WBMQTTImport.prototype.reconnectionAttempt = function () {
	var self = this;

	self.reconnect_timer = setTimeout(function () {
		self.log("Trying to reconnect (" + self.reconnectCount + ")", LoggingLevel.INFO);
		self.reconnectCount++;
		self.connectionAttempt();
	}, Math.min(self.reconnectCount * 1000, 60000));
}

WBMQTTImport.prototype.removeReconnectionAttempt = function () {
	// Clear any active reconnect timers
	var self = this;

	if (self.reconnect_timer) {
		clearTimeout(self.reconnect_timer);
		self.reconnect_timer = null;
	}
}

WBMQTTImport.prototype.onConnect = function () {
	var self = this;
	self.log("Connected to " + self.config.host + " as " + self.config.clientId, LoggingLevel.INFO);

	self.state = ModuleState.CONNECTED
	self.reconnectCount = 0;

	self.client.subscribe("#");
}

WBMQTTImport.prototype.onDisconnect = function () {
	var self = this;

	if (self.state == ModuleState.DISCONNECTING) {
		self.log("Disconnected due to module stop, not reconnecting", LoggingLevel.INFO);
		return;
	}

	self.state == ModuleState.DISCONNECTED
	self.error("Disconnected, will retry to connect...");
	self.reconnectionAttempt();
};

WBMQTTImport.prototype.onMessage = function (topic, payload) {
	var self = this;
	var payload = byteArrayToString(payload);
	self.log("New message topic" + topic + " payload " + payload, LoggingLevel.DEBUG);

	var path = topic.split("/");
	path.shift(); // Remove first empty element

	if (!self.topicTree[path[0]]) {
		self.topicTree[path[0]] = {}
	}

	var deviceId = "WB" + topic.replace(/\//g, "_") + "_" + this.id;
	var pathObject = self.topicTree[path[0]] // Хранит текущее место
	for (var i = 1; i < path.length; i++) {
		// Last element add payload
		if (i == path.length - 1) {
			// Update payload
			pathObject[path[i]] = {value: payload};
			self.updateVDev(deviceId, payload)
			// If meta data of device, create vDev without meta
			if (path[0] == "devices" && path[2] == "controls" && path[i] == "meta") {
				if (path[1] == "knx" || path[1] == "buzzer" || path[1] == "power_status" || path[1] == "wb-adc" || path[1] == "wb-gpio" ||  path[1] == "wb-w1") {
					var meta = JSON.parse(payload);

					// Remove meta from path
					deviceId = deviceId.replace("_meta", "");
					topic = topic.replace("/meta", "");
					self.generated.push(deviceId);
					self.createVDev(deviceId, path[1] + "/" + path[3], meta.type, meta.readonly, self.topicTree[path[0]][path[1]][path[2]][path[3]].value, topic);
				}
			}
		}
		else {
			// Create next object in path
			if (!pathObject[path[i]]) {
				pathObject[path[i]] = {}
			}
			pathObject = pathObject[path[i]]
		}
	}
};

WBMQTTImport.prototype.publish = function (topic, value, retained) {
	var self = this;

	if (self.client && self.state == ModuleState.CONNECTED) {
		self.client.publish(topic, value.toString().trim(), retained);
	}
};

WBMQTTImport.prototype.createVDev = function (deviceId, name, type, readonly, level, topic) {
	var self = this,
		deviceType = "",
		scaleTitle = "",
		probeType = "",
		icon = "";

	switch(type) {
		case "voltage":
			deviceType = "sensorMultilevel";
			probeType = "energy";
			scaleTitle = "V";
			icon = "energy";
			break;
		case "switch":
			deviceType = readonly ? "sensorBinary" : "switchBinary";
			probeType = readonly ? "general_purpose" : "switch";
			icon = "switch";
			level = level == "1" ? "on" : "off"
			break;
	}

	var defaults = {
		metrics: {
			title: name
		}
	};

	var overlay = {
			deviceType: deviceType,
			probeType: probeType,
			metrics: {
				icon: icon,
				level: level,
				mqttTopic: topic,
			}	  
	};

	var vDev = self.controller.devices.create({
		deviceId: deviceId,
		defaults: defaults,
		overlay: overlay,
		handler: function (command, args) {
			var vDevType = deviceType;

			if (command === "on" && vDevType === "switchBinary") {
				self.publish(this.get("metrics:mqttTopic") + "/on", "1");
			}

			if (command === "off" && vDevType === "switchBinary") {
				self.publish(this.get("metrics:mqttTopic") + "/on", "0");
			}

			if ((command === "off" || command === "on" || command === "exact") && vDevType === "switchMultilevel") {
				var level = command === "exact" ? parseInt(args.level, 10) : (command === "on" ? 99 : 0);
				self.publish(this.get("metrics:mqttTopic") + "/on", level);
			}
		},
		moduleId: this.id
	});
}

WBMQTTImport.prototype.updateVDev = function (deviceId, level) {
	var vDev = this.controller.devices.get(deviceId);
	if (vDev) {
		switch(vDev.get("deviceType")) {
		case "switchBinary":
		case "sensorBinary":
			vDev.set("metrics:level", level == "1" ? "on" : "off");
			break;
		default:
			vDev.set("metrics:level", level);
			break;
		}
	}
}

// ----------------------------------------------------------------------------
// --- Device types enum
// ----------------------------------------------------------------------------

const LoggingLevel = Object.freeze({
	INFO: "INFO",
	DEBUG: "DEBUG"
});

const ModuleState = Object.freeze({
	CONNECTING: "CONNECTING",
	CONNECTED: "CONNECTED",
	DISCONNECTING: "DISCONNECTING",
	DISCONNECTED: "DISCONNECTED"
});