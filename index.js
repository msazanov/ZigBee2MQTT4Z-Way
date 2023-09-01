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
		case WBMQTTImport.LoggingLevel.DEBUG:
			if (!self.config.debug) {
				return;
			}
		case WBMQTTImport.LoggingLevel.INFO:
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

	// Contain vDevs to generate
	if (!self.config.mqttDevices) {
		self.config.mqttDevices = {};
	}

	// Array of all known devices
	if (!self.config.allKnownDevicesArray) {
		self.config.allKnownDevicesArray = [];
	}

	// If enabledMQTTDevicesArray doesn't contain an vDevId, then remove it from the mqttDevices
	Object.keys(self.config.mqttDevices).forEach(function(vDevId) {
		if (self.config.enabledMQTTDevicesArray.indexOf(vDevId) === -1) {
			delete self.config.mqttDevices[vDevId];
		}
		// Create vDevs at start
		else {
			self.createVDev(self.config.mqttDevices[vDevId]);
		}
	});
	self.saveConfig();
	
	// Array of all mqtt devices placed in namespaces to show in web ui
	self.devicesList = [];

	self.topicTree = {
		devices: {}
	};

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
	this.state = WBMQTTImport.ModuleState.DISCONNECTING;
	this.client.disconnect();
	this.removeReconnectionAttempt();

	// Remove all vDevs
	this.config.enabledMQTTDevicesArray.forEach(function(vDevId) {
		self.controller.devices.remove(vDevId);
	});

	WBMQTTImport.super_.prototype.stop.call(this);
};

// ----------------------------------------------------------------------------
// --- Module methods
// ----------------------------------------------------------------------------
WBMQTTImport.prototype.connectionAttempt = function () {
	var self = this;

	try {
		self.state = WBMQTTImport.ModuleState.CONNECTING;
		self.client.connect();
	} catch (exception) {
		self.log("MQTT connection error to " + self.config.host + " as " + self.config.clientId, WBMQTTImport.LoggingLevel.INFO);
		self.reconnectionAttempt();
	}
}

WBMQTTImport.prototype.reconnectionAttempt = function () {
	var self = this;

	self.reconnect_timer = setTimeout(function () {
		self.log("Trying to reconnect (" + self.reconnectCount + ")", WBMQTTImport.LoggingLevel.INFO);
		self.reconnectCount++;
		self.connectionAttempt();

		// After 3 attempts make all devices broken
		if (self.reconnectCount === 2) {
			self.config.enabledMQTTDevicesArray.forEach(function(vDevId) {
				var vDev = self.controller.devices.get(vDevId);
				if (vDev) {
					vDev.set("metrics:isFailed", true);
				}
			});
		}

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
	self.log("Connected to " + self.config.host + " as " + self.config.clientId, WBMQTTImport.LoggingLevel.INFO);

	self.state = WBMQTTImport.ModuleState.CONNECTED
	self.reconnectCount = 0;

	// Make all vDevs alive
	self.config.enabledMQTTDevicesArray.forEach(function(vDevId) {
		var vDev = self.controller.devices.get(vDevId);
		if (vDev) {
			vDev.set("metrics:isFailed", false);
		}
	});

	self.client.subscribe("#");
}

WBMQTTImport.prototype.onDisconnect = function () {
	var self = this;

	if (self.state == WBMQTTImport.ModuleState.DISCONNECTING) {
		self.log("Disconnected due to module stop, not reconnecting", WBMQTTImport.LoggingLevel.INFO);
		return;
	}

	self.state == WBMQTTImport.ModuleState.DISCONNECTED
	self.error("Disconnected, will retry to connect...");
	self.reconnectionAttempt();
};

WBMQTTImport.prototype.onMessage = function (topic, payload) {
	var self = this;
	var payload = byteArrayToString(payload);
	self.log("New message topic" + topic + " payload " + payload, WBMQTTImport.LoggingLevel.DEBUG);

	var path = topic.split("/");
	path.shift(); // Remove first empty element

	var deviceId = (this.getName() + "_" + this.id + "_" + path[1] + "_" + path[2] + "_" + path[3]).replace(/__/g, "_").replace(/ /g, "_");
	
	var pathObject = self.topicTree;
	
	// skip topics other than:
	// - /devices/.../controls/...
	// - /devices/.../controls/.../meta
	if (!(path[0] === "devices" && path[2] == "controls" && (path.length === 4 || (path.length === 5 && path[4] == "meta")))) return;
	
	// Save in the tree
	if (!self.topicTree["devices"][path[1]]) {
		self.topicTree["devices"][path[1]] = {
			controls: {}
		}
	}
	
	if (path.length === 4) {
		// topic with value, update vDev
		self.topicTree["devices"][path[1]]["controls"][path[3]] = {
			value: payload
		};
		self.updateVDev(deviceId, payload);
	} else {
		// topic with meta, create vDev
		if (path[1].substr(0, 4) != "zway") { // skip devices from WBMQTTNative
			// Add subsystem section
			var subSystemID = (this.getName() + "_" + this.id + "_" + path[1]).replace(/__/g, "_") + "__";
			if (!(self.containsDevice(subSystemID, self.devicesList))) {
				self.devicesList.push({deviceId: subSystemID, deviceName: path[1]})
			}

			if (!self.topicTree["devices"][path[1]]["controls"][path[3]]) {
				self.topicTree["devices"][path[1]]["controls"][path[3]] = {
					value: null
				};
			}

			var meta = JSON.parse(payload);
			var maxLevel = meta.max ? meta.max : undefined;

			deviceId = deviceId.replace("_meta", "");
			topic = topic.replace("/meta", ""); // remove meta from topic path

			// Add {ID:NAME} to array of all mqtt devices
			if (!(self.containsDevice(deviceId, self.devicesList))) {
			
				self.devicesList.push({deviceId: deviceId, deviceName: path[3]});

				self.updateNamespace();

				// If new device, add to allKnownDevicesArray and enabledMQTTDevicesArray
				if (self.config.allKnownDevicesArray.indexOf(deviceId) === -1) {
					self.config.allKnownDevicesArray.push(deviceId);
					
					// Add device to list in config
					self.config.mqttDevices[deviceId] = {
						deviceId: deviceId,
						name: path[1] + "/" + path[3],
						type: meta.type,
						readonly: meta.readonly,
						level: self.topicTree["devices"][path[1]]["controls"][path[3]].value,
						maxLevel: maxLevel,
						topic: topic,
					};
					
					if (self.createVDev(self.config.mqttDevices[deviceId])) {
						// set the checkbox only if the device was created (meas it is supported)
						self.config.enabledMQTTDevicesArray.push(deviceId);
					}
					
					self.saveConfig();
				} else {
					// Generate vDev if device in enabledMQTTDevicesArray
					if (self.config.enabledMQTTDevicesArray.indexOf(deviceId) !== -1) {
						self.createVDev(self.config.mqttDevices[deviceId]);
					}
				}
			}
		}
	}
};

WBMQTTImport.prototype.publish = function (topic, value, retained) {
	var self = this;

	if (self.client && self.state == WBMQTTImport.ModuleState.CONNECTED) {
		self.client.publish(topic, value.toString().trim(), retained);
	}
};

WBMQTTImport.prototype.createVDev = function (dev) {
	if (this.controller.devices.get(dev.deviceId)) return;

	var self = this,
		deviceType = "",
		scaleTitle = "",
		probeType = "",
		icon = "";

	switch(dev.type) {
		case "rel_humidity":
			deviceType = "sensorMultilevel";
			probeType = "humidity";
			scaleTitle = "°%";
			icon = "humidity";
			level = parseFloat(dev.level)
			break;
		case "temperature":
			deviceType = "sensorMultilevel";
			probeType = "temperature";
			scaleTitle = "°C";
			icon = "temperature";
			level = parseFloat(dev.level)
			break;
		case "voltage":
			deviceType = "sensorMultilevel";
			probeType = "energy";
			scaleTitle = "V";
			icon = "energy";
			level = parseFloat(dev.level)
			break;
		case "power":
			deviceType = "sensorMultilevel";
			probeType = "energy";
			scaleTitle = "W";
			icon = "energy";
			level = parseFloat(dev.level)
			break;
		case "power_consumption":
			deviceType = "sensorMultilevel";
			probeType = "meter";
			scaleTitle = "kWh";
			icon = "energy";
			level = parseFloat(dev.level)
			break;
		case "switch":
			deviceType = dev.readonly ? "sensorBinary" : "switchBinary";
			probeType = dev.readonly ? "general_purpose" : "switch";
			icon = "switch";
			level = dev.level == "1" ? "on" : "off"
			break;
		case "range":
			deviceType = "switchMultilevel";
			icon = "multilevel";
			level = parseInt((dev.level * 99) / dev.maxLevel);
			break;
		case "text":
		case "pushbutton":
			return; // skip text topics
		default:
			deviceType = "sensorMultilevel";
			icon = "meter"
			level = parseFloat(dev.level)
			break;
	}

	var defaults = {
		metrics: {
			title: dev.name
		}
	};

	var overlay = {
		deviceType: deviceType,
		probeType: probeType,
		metrics: {
			icon: icon,
			level: level,
			isFailed: false,
			mqttTopic: dev.topic,
		}	  
	};

	if (deviceType == "switchMultilevel") {
		overlay.metrics.maxLevel = dev.maxLevel;
	}

	var vDev = self.controller.devices.create({
		deviceId: dev.deviceId,
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
				self.publish(this.get("metrics:mqttTopic") + "/on", parseInt((dev.maxLevel * level) / 99));
			}
		},
		moduleId: this.id
	});
	
	return true;
}

WBMQTTImport.prototype.updateVDev = function (deviceId, level) {
	var self = this;
	var vDev = this.controller.devices.get(deviceId);
	if (vDev) {
		switch(vDev.get("deviceType")) {
		case "switchBinary":
		case "sensorBinary":
			vDev.set("metrics:level", level == "1" ? "on" : "off");
			break;
		case "switchMultilevel":
			vDev.set("metrics:level", parseInt((level * 99) / vDev.get("metrics:maxLevel")));
			break;
		default:
			vDev.set("metrics:level", level);
			break;
		}
	}
}

WBMQTTImport.prototype.updateNamespace = function() {
	// Sort devicesList by alphabet to show in UI
	this.devicesList.sort(function(a, b){
		var nameA = a.deviceId.toLowerCase(), nameB = b.deviceId.toLowerCase();
		if (nameA < nameB) return -1;
		if (nameA > nameB) return 1;
		return 0;
	});

	this.controller.setNamespace("wbmqttimport", this.controller.namespaces, this.devicesList);
}

// ----------------------------------------------------------------------------
// --- Utility methods
// ----------------------------------------------------------------------------
WBMQTTImport.prototype.containsDevice = function (deviceId, array) {
	for (var i = 0; i < array.length; i++) {
		if (deviceId === array[i].deviceId) return true;
	}

	return false;
};

// ----------------------------------------------------------------------------
// --- Device types enum
// ----------------------------------------------------------------------------

WBMQTTImport.LoggingLevel = Object.freeze({
	INFO: "INFO",
	DEBUG: "DEBUG"
});

WBMQTTImport.ModuleState = Object.freeze({
	CONNECTING: "CONNECTING",
	CONNECTED: "CONNECTED",
	DISCONNECTING: "DISCONNECTING",
	DISCONNECTED: "DISCONNECTED"
});
