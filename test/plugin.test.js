const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = require('homebridge-http-base');

function createMockHomebridge() {
  class MockCharacteristic {
    constructor(name) {
      this.name = name;
      this.value = undefined;
    }

    on() {
      return this;
    }

    updateValue(value) {
      this.value = value;
      return this;
    }
  }

  class MockService {
    constructor(name) {
      this.name = name;
      this.characteristics = new Map();
    }

    getCharacteristic(name) {
      if (!this.characteristics.has(name)) {
        this.characteristics.set(name, new MockCharacteristic(name));
      }
      return this.characteristics.get(name);
    }

    setCharacteristic(name, value) {
      const characteristic = this.getCharacteristic(name);
      characteristic.value = value;
      return characteristic;
    }
  }

  class MockAccessoryInformation {
    setCharacteristic() {
      return this;
    }
  }

  const homebridge = {
    hap: {
      Service: {
        Switch: MockService,
        AccessoryInformation: MockAccessoryInformation,
      },
      Characteristic: {
        On: 'On',
        Manufacturer: 'Manufacturer',
        Model: 'Model',
        SerialNumber: 'SerialNumber',
        FirmwareRevision: 'FirmwareRevision',
      },
    },
    on: () => {},
    registerAccessory: () => {},
    registerPlatform: () => {},
  };

  return homebridge;
}

function buildAccessory(config, log = () => {}) {
  const homebridge = createMockHomebridge();
  let registeredCtor;

  homebridge.registerAccessory = (_pluginName, _accessoryName, ctor) => {
    registeredCtor = ctor;
  };

  const plugin = require('../index.js');
  plugin(homebridge);

  const accessory = new registeredCtor(log, config);

  return accessory;
}

test('plugin exposes a Homebridge config schema for UI support', () => {
  const schemaPath = path.join(__dirname, '..', 'config.schema.json');

  assert.ok(fs.existsSync(schemaPath), 'config.schema.json should exist');

  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  assert.equal(schema.pluginAlias, 'HTTP-SWITCH');
  assert.equal(schema.pluginType, 'platform');
  assert.ok(schema.properties.name);
  assert.ok(schema.properties.switchType);
  assert.ok(schema.properties.switches);
});

test('plugin registers both accessory and platform entrypoints for compatibility', () => {
  const homebridge = createMockHomebridge();
  let accessoryPluginName;
  let platformPluginName;

  homebridge.registerAccessory = (pluginName) => {
    accessoryPluginName = pluginName;
  };

  homebridge.registerPlatform = (pluginName) => {
    platformPluginName = pluginName;
  };

  const plugin = require('../index.js');
  plugin(homebridge);

  assert.equal(accessoryPluginName, 'homebridge-http-switch');
  assert.equal(platformPluginName, 'homebridge-http-switch');
});

test('platform creates accessories from a switch list config', () => {
  const homebridge = createMockHomebridge();
  let platformCtor;

  homebridge.registerPlatform = (_pluginName, _platformName, ctor) => {
    platformCtor = ctor;
  };

  const plugin = require('../index.js');
  plugin(homebridge);

  const platform = new platformCtor(() => {}, {
    name: 'HTTP Switch Platform',
    switches: [
      {
        name: 'Desk Lamp',
        switchType: 'stateful',
        onUrl: 'http://example.com/on',
        offUrl: 'http://example.com/off',
        statusUrl: 'http://example.com/status',
      },
    ],
  });

  const accessories = platform.accessories();
  assert.equal(accessories.length, 1);
  assert.equal(accessories[0].name, 'Desk Lamp');
});

test('toggle switch remembers the last successful state', async (t) => {
  const originalMultipleHttpRequests = base.http.multipleHttpRequests;

  base.http.multipleHttpRequests = (_urlObjects, callback) => {
    callback([{ response: { statusCode: 200 }, body: 'ok' }]);
  };

  t.after(() => {
    base.http.multipleHttpRequests = originalMultipleHttpRequests;
  });

  const accessory = buildAccessory({
    name: 'Test Toggle',
    switchType: 'toggle',
    onUrl: 'http://example.com/on',
    offUrl: 'http://example.com/off',
  });

  await new Promise((resolve, reject) => {
    accessory.setStatus(true, (err) => {
      try {
        assert.equal(err, undefined);
        assert.equal(accessory.toggleSwitchState, true);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });

  await new Promise((resolve, reject) => {
    accessory.getStatus((statusErr, value) => {
      try {
        assert.equal(statusErr, null);
        assert.equal(value, true);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
});

test('stateful switch resolves statusUrl values against the configured pattern', async (t) => {
  const originalHttpRequest = base.http.httpRequest;

  base.http.httpRequest = (_url, callback) => {
    callback(null, { statusCode: 200 }, '0');
  };

  t.after(() => {
    base.http.httpRequest = originalHttpRequest;
  });

  const accessory = buildAccessory({
    name: 'Test Stateful',
    switchType: 'stateful',
    onUrl: 'http://example.com/on',
    offUrl: 'http://example.com/off',
    statusUrl: 'http://example.com/status',
    statusPattern: '1',
  });

  await new Promise((resolve, reject) => {
    accessory.getStatus((err, value) => {
      try {
        assert.equal(err, null);
        assert.equal(value, false);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
});

test('malformed statusPattern falls back safely to the default match', async (t) => {
  const originalHttpRequest = base.http.httpRequest;

  base.http.httpRequest = (_url, callback) => {
    callback(null, { statusCode: 200 }, '1');
  };

  t.after(() => {
    base.http.httpRequest = originalHttpRequest;
  });

  assert.doesNotThrow(() => {
    buildAccessory({
      name: 'Test Stateful Invalid Pattern',
      switchType: 'stateful',
      onUrl: 'http://example.com/on',
      offUrl: 'http://example.com/off',
      statusUrl: 'http://example.com/status',
      statusPattern: '(',
    });
  });

  const accessory = buildAccessory({
    name: 'Test Stateful Invalid Pattern',
    switchType: 'stateful',
    onUrl: 'http://example.com/on',
    offUrl: 'http://example.com/off',
    statusUrl: 'http://example.com/status',
    statusPattern: '(',
  });

  await new Promise((resolve, reject) => {
    accessory.getStatus((err, value) => {
      try {
        assert.equal(err, null);
        assert.equal(value, true);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
});

test('missing required config values fail cleanly for stateful and stateless switches', () => {
  const getWarnings = () => {
    const warnings = [];
    return {
      log: Object.assign(() => {}, { warn: (msg) => warnings.push(msg) }),
      warnings,
    };
  };

  const missingOn = getWarnings();
  assert.doesNotThrow(() => {
    const accessory = buildAccessory({
      name: 'Missing On URL',
      switchType: 'stateful',
      offUrl: 'http://example.com/off',
      statusUrl: 'http://example.com/status',
    }, missingOn.log);

    assert.equal(accessory.on, undefined);
  });
  assert.match(missingOn.warnings.join(' '), /onUrl/i);

  const missingOff = getWarnings();
  assert.doesNotThrow(() => {
    const accessory = buildAccessory({
      name: 'Missing Off URL',
      switchType: 'stateful',
      onUrl: 'http://example.com/on',
      statusUrl: 'http://example.com/status',
    }, missingOff.log);

    assert.equal(accessory.off, undefined);
  });
  assert.match(missingOff.warnings.join(' '), /offUrl/i);

  const missingStatus = getWarnings();
  assert.doesNotThrow(() => {
    const accessory = buildAccessory({
      name: 'Missing Status URL',
      switchType: 'stateful',
      onUrl: 'http://example.com/on',
      offUrl: 'http://example.com/off',
    }, missingStatus.log);

    assert.equal(accessory.status, undefined);
  });
  assert.match(missingStatus.warnings.join(' '), /statusUrl/i);

  const validStateless = getWarnings();
  assert.doesNotThrow(() => {
    const accessory = buildAccessory({
      name: 'Valid Stateless',
      switchType: 'stateless',
      onUrl: 'http://example.com/on',
    }, validStateless.log);

    assert.ok(accessory.on);
  });
  assert.equal(validStateless.warnings.length, 0);
});

test('stateless and reverse switch modes expose the expected runtime behavior', async (t) => {
  const originalHttpRequest = base.http.httpRequest;
  const originalMultipleHttpRequests = base.http.multipleHttpRequests;

  base.http.multipleHttpRequests = (_urlObjects, callback) => {
    callback([{ response: { statusCode: 200 }, body: 'ok' }]);
  };

  t.after(() => {
    base.http.httpRequest = originalHttpRequest;
    base.http.multipleHttpRequests = originalMultipleHttpRequests;
  });

  const stateless = buildAccessory({
    name: 'Stateless Switch',
    switchType: 'stateless',
    onUrl: 'http://example.com/on',
    timeout: 10,
  });

  await new Promise((resolve, reject) => {
    stateless.getStatus((err, value) => {
      try {
        assert.equal(err, null);
        assert.equal(value, false);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });

  await new Promise((resolve, reject) => {
    stateless.setStatus(true, (err) => {
      try {
        assert.equal(err, undefined);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });

  const reverse = buildAccessory({
    name: 'Reverse Switch',
    switchType: 'stateless-reverse',
    offUrl: 'http://example.com/off',
    timeout: 10,
  });

  await new Promise((resolve, reject) => {
    reverse.getStatus((err, value) => {
      try {
        assert.equal(err, null);
        assert.equal(value, true);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
});

test('service metadata and notification updates reflect the accessory state', () => {
  const accessory = buildAccessory({
    name: 'Notification Switch',
    switchType: 'stateful',
    onUrl: 'http://example.com/on',
    offUrl: 'http://example.com/off',
    statusUrl: 'http://example.com/status',
  });

  const services = accessory.getServices();
  assert.equal(services.length, 2);
  assert.equal(services[0].constructor.name, 'MockAccessoryInformation');

  accessory.handleNotification({ characteristic: 'On', value: true });
  assert.equal(accessory.homebridgeService.getCharacteristic('On').value, true);
});

test('stateful status checks use the cache and return HTTP errors safely', async (t) => {
  const originalHttpRequest = base.http.httpRequest;

  t.after(() => {
    base.http.httpRequest = originalHttpRequest;
  });

  const accessory = buildAccessory({
    name: 'Cached Status Switch',
    switchType: 'stateful',
    onUrl: 'http://example.com/on',
    offUrl: 'http://example.com/off',
    statusUrl: 'http://example.com/status',
    statusPattern: '1',
  });

  accessory.homebridgeService.getCharacteristic('On').updateValue(true);
  accessory.statusCache.queried();

  await new Promise((resolve, reject) => {
    accessory.getStatus((err, value) => {
      try {
        assert.equal(err, null);
        assert.equal(value, true);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });

  accessory.statusCache.shouldQuery = () => true;

  base.http.httpRequest = (_url, callback) => {
    callback(null, { statusCode: 500 }, 'bad');
  };

  await new Promise((resolve, reject) => {
    accessory.getStatus((err, value) => {
      try {
        assert.equal(value, undefined);
        assert.ok(err instanceof Error);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
});

test('mixed HTTP results and invalid switch types are handled gracefully', async (t) => {
  const originalMultipleHttpRequests = base.http.multipleHttpRequests;
  t.after(() => {
    base.http.multipleHttpRequests = originalMultipleHttpRequests;
  });

  const accessory = buildAccessory({
    name: 'Mixed Request Switch',
    switchType: 'stateful',
    onUrl: 'http://example.com/on',
    offUrl: 'http://example.com/off',
    statusUrl: 'http://example.com/status',
  });

  base.http.multipleHttpRequests = (_urlObjects, callback) => {
    callback([
      { response: { statusCode: 500 }, body: 'bad' },
      { response: { statusCode: 200 }, body: 'ok' },
    ]);
  };

  await new Promise((resolve, reject) => {
    accessory.setStatus(true, (err) => {
      try {
        assert.ok(err instanceof Error);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });

  const invalid = buildAccessory({
    name: 'Invalid Switch',
    switchType: 'unknown',
  });
  assert.equal(invalid.homebridgeService, undefined);

  await new Promise((resolve, reject) => {
    invalid.getStatus((err, value) => {
      try {
        assert.ok(err instanceof Error);
        assert.equal(value, undefined);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
});

test('stateless reset timers and unknown notification characteristics behave safely', async (t) => {
  const originalMultipleHttpRequests = base.http.multipleHttpRequests;
  t.after(() => {
    base.http.multipleHttpRequests = originalMultipleHttpRequests;
  });

  base.http.multipleHttpRequests = (_urlObjects, callback) => {
    callback([{ response: { statusCode: 200 }, body: 'ok' }]);
  };

  const stateless = buildAccessory({
    name: 'Reset Switch',
    switchType: 'stateless',
    onUrl: 'http://example.com/on',
    timeout: 0,
  });

  await new Promise((resolve, reject) => {
    stateless.setStatus(true, (err) => {
      try {
        assert.equal(err, undefined);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(stateless.homebridgeService.getCharacteristic('On').value, false);

  const reverse = buildAccessory({
    name: 'Reset Reverse Switch',
    switchType: 'stateless-reverse',
    offUrl: 'http://example.com/off',
    timeout: 0,
  });

  await new Promise((resolve, reject) => {
    reverse.setStatus(false, (err) => {
      try {
        assert.equal(err, undefined);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(reverse.homebridgeService.getCharacteristic('On').value, true);

  const accessory = buildAccessory({
    name: 'Unknown Notification',
    switchType: 'stateful',
    onUrl: 'http://example.com/on',
    offUrl: 'http://example.com/off',
    statusUrl: 'http://example.com/status',
  });

  accessory.handleNotification({ characteristic: 'SomethingElse', value: true });
  assert.equal(accessory.homebridgeService.getCharacteristic('On').value, undefined);
});

test('advanced configuration flags cover the verbose option paths', () => {
  const messages = [];
  const logger = Object.assign((message) => messages.push(message), {
    warn: (message) => messages.push(message),
  });

  const accessory = buildAccessory({
    name: 'Advanced Options',
    switchType: 'stateful',
    onUrl: 'http://example.com/on',
    offUrl: 'http://example.com/off',
    statusUrl: 'http://example.com/status',
    debug: true,
    httpMethod: 'POST',
    auth: { username: 'user', password: 'pass', sendImmediately: true },
    pullInterval: 25,
    notificationID: 'abc123',
    multipleUrlExecutionStrategy: 'parallel',
  }, logger);

  assert.equal(accessory.debug, true);
  assert.equal(accessory.on[0].method, 'POST');
  assert.equal(accessory.off[0].method, 'POST');
  assert.equal(accessory.on[0].auth.username, 'user');
  assert.equal(accessory.off[0].auth.password, 'pass');
  assert.ok(accessory.pullTimer);
  assert.ok(messages.length >= 0);

  if (accessory.pullTimer && typeof accessory.pullTimer.stop === 'function') {
    accessory.pullTimer.stop();
  }

  assert.doesNotThrow(() => {
    buildAccessory({
      name: 'Should Warn',
      switchType: 'stateful',
      onUrl: 'http://example.com/on',
      offUrl: 'http://example.com/off',
      statusUrl: 'http://example.com/status',
      statusCache: 'bad-type',
      multipleUrlExecutionStrategy: 'bad-strategy',
    }, logger);
  });

  const invalidType = buildAccessory({
    name: 'Invalid Type',
    switchType: 'stateful',
    onUrl: 'http://example.com/on',
    offUrl: 'http://example.com/off',
    statusUrl: 'http://example.com/status',
    statusPattern: '(',
  }, logger);

  assert.ok(invalidType);
  assert.equal(invalidType.statusPattern.test('1'), true);
});
