const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
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
    registerAccessory: () => {},
  };

  return homebridge;
}

function buildAccessory(config) {
  const homebridge = createMockHomebridge();
  let registeredCtor;

  homebridge.registerAccessory = (_pluginName, _accessoryName, ctor) => {
    registeredCtor = ctor;
  };

  const plugin = require('../index.js');
  plugin(homebridge);

  const accessory = new registeredCtor(() => {}, config);

  return accessory;
}

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
        assert.equal(accessory.homebridgeService.getCharacteristic('On').value, true);
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

test('stateful switch uses base v3 for challenged Basic authentication and HTTP errors', async (t) => {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ url: req.url, authorization: req.headers.authorization });
    if (req.headers.authorization !== 'Basic dXNlcjpwYXNz') {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="switch"' });
      res.end();
    } else if (req.url === '/off') {
      res.writeHead(500);
      res.end('failed');
    } else {
      res.end(req.url === '/status' ? '1' : 'ok');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

  const url = `http://127.0.0.1:${server.address().port}`;
  const accessory = buildAccessory({
    name: 'HTTP Switch',
    onUrl: `${url}/on`,
    offUrl: `${url}/off`,
    statusUrl: `${url}/status`,
    auth: { username: 'user', password: 'pass', sendImmediately: false },
  });

  const status = await new Promise((resolve, reject) => {
    accessory.getStatus((error, value) => error ? reject(error) : resolve(value));
  });
  assert.equal(status, true);
  await new Promise((resolve, reject) => {
    accessory.setStatus(true, (error) => error ? reject(error) : resolve());
  });
  await assert.rejects(new Promise((resolve, reject) => {
    accessory.setStatus(false, (error) => error ? reject(error) : resolve());
  }), /Some or every request returned with an error/);
  assert.deepEqual(requests, ['/status', '/on', '/off'].flatMap((path) => [
    { url: path, authorization: undefined },
    { url: path, authorization: 'Basic dXNlcjpwYXNz' },
  ]));
});
