"use strict";

const assert = require("assert");
const registerPlugin = require("../index");

class SwitchService {
    constructor(name) {
        this.name = name;
        this.characteristic = {
            on() { return this; },
            updateValue(value) { this.value = value; },
        };
    }

    getCharacteristic() {
        return this.characteristic;
    }
}

class AccessoryInformation {
    setCharacteristic() { return this; }
}

let Accessory;
registerPlugin({
    hap: {
        Service: { Switch: SwitchService, AccessoryInformation },
        Characteristic: { On: "On" },
    },
    registerAccessory(pluginName, accessoryName, constructor) {
        assert.strictEqual(pluginName, "homebridge-http-switch");
        assert.strictEqual(accessoryName, "HTTP-SWITCH");
        Accessory = constructor;
    },
});

assert.strictEqual(typeof Accessory, "function");
const log = () => {};
log.warn = log.error = log;

const accessory = new Accessory(log, {
    name: "Test Switch",
    onUrl: "http://localhost/on",
    offUrl: "http://localhost/off",
    statusUrl: "http://localhost/status",
});
assert.strictEqual(accessory.getServices().length, 2);
assert.strictEqual(accessory.homebridgeService.name, "Test Switch");

const invalidAccessory = new Accessory(log, { name: "Invalid Switch" });
assert.deepStrictEqual(invalidAccessory.getServices(), []);
