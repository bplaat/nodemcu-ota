const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const { WebSocket, WebSocketServer } = require('ws');

// Config
const SERVER_PORT = process.env.PORT || 8080;
const UPDATE_WRITEBACK_TIMEOUT = 5000;

// Simple local json 'database'
let devices = [], values = [];
if (fs.existsSync('db.json')) {
    const db = JSON.parse(fs.readFileSync('db.json'));
    devices = db.devices;
    values = db.values;
    console.log('[DB] db.json read');
}
let devicesDirty = false, valuesDirty = false;
function saveData() {
    if (devicesDirty || valuesDirty) {
        devicesDirty = false;
        valuesDirty = false;
        fs.writeFile('db.json', JSON.stringify({ devices, values }), (err) => {
            if (err) console.log(err);
            console.log('[DB] db.json written');
            setTimeout(saveData, UPDATE_WRITEBACK_TIMEOUT);
        });
    } else {
        setTimeout(saveData, UPDATE_WRITEBACK_TIMEOUT);
    }
}
setTimeout(saveData, UPDATE_WRITEBACK_TIMEOUT);

// Websocket server
const wss = new WebSocketServer({ noServer: true });
wss.on('connection', ws => {
    function send(type, data) {
        console.log('[WS] SEND', { type, data });
        ws.send(JSON.stringify({ id: Date.now(), type, data }));
    }

    function response(id, type, data) {
        console.log('[WS] RESPONSE', { id, type, data });
        ws.send(JSON.stringify({ id, type, data }));
    }

    function broadcast(type, data, ignoreDeviceConnections) {
        const id = Date.now();
        wss.clients.forEach(function (client) {
            if (ignoreDeviceConnections && 'isDeviceConnection' in client) {
                return;
            }
            if (client != ws && client.readyState == WebSocket.OPEN) {
                console.log('[WS] BROADCAST', { id, type, data });
                client.send(JSON.stringify({ id, type, data }));
            }
        });
    }

    let connectedDevice = null;

    ws.on('message', message => {
        const { id, type, data } = JSON.parse(message);
        console.log('[WS] RECEIVE', { id, type, data });

        // ###########################################################
        // ######################### DEVICES #########################
        // ###########################################################

        // Devices index
        if (type == 'devices.index') {
            // Send all devices back
            response(id, type, {
                devices: devices.map(device => {
                    device.values = values.filter(value => value.device_id == device.id);
                    return device;
                })
            });
        }

        // Devices store
        if (type == 'devices.store') {
            // Validate name
            if (!('name' in data && data.name.length >= 2 && data.name.length <= 48)) {
                response(id, type, { success: false, error: 'name' });
                return;
            }

            // Create device and save
            const newDeviceId = Date.now();
            const device = {
                id: newDeviceId,
                name: data.name,
                key: crypto.createHash('md5').update(`${newDeviceId}@super_secure_salt!`).digest('hex'),
                connected: false
            };
            devices.push(device);
            devicesDirty = true;

            // Send success response
            response(id, type, { success: true, device });
            broadcast(type, { device });
        }

        // Devices update
        if (type == 'devices.update') {
            // Validate device id
            const device = devices.find(device => device.id == data.id);
            if (!('id' in data && device != null)) {
                response(id, type, { success: false, error: 'id' });
                return;
            }

            // Validate new name and update
            if ('name' in data) {
                if (!(data.name.length >= 2 && data.name.length <= 48)) {
                    response(id, type, { success: false, error: 'name' });
                    return;
                }

                device.name = data.name;
                devicesDirty = true;
            }

            // Send success response back
            response(id, type, { success: true, device });
            broadcast(type, { device });
        }

        // Devices delete
        if (type == 'devices.delete') {
            // Validate device id
            const device = devices.find(device => device.id == data.id);
            if (!('id' in data && device != null)) {
                response(id, type, { success: false, error: 'id' });
                return;
            }

            // Remove device from devices and save
            devices = devices.filter(device => device.id != data.id);
            devicesDirty = true;

            // Send success response back
            response(id, type, { success: true, id: device.id });
            broadcast(type, { id: device.id });
        }

        // Devices connect
        if (type == 'devices.connect') {
            // Validate device key
            connectedDevice = devices.find(device => device.key == data.key);
            if (!('key' in data && connectedDevice != null)) {
                response(id, type, { success: false, error: 'key' });
                return;
            }

            // Update device state to connected
            connectedDevice.connected = true;
            ws.isDeviceConnection = true;
            devicesDirty = true;

            // Send success response back
            response(id, type, { success: true, id: connectedDevice.id, values: values.filter(value => value.device_id == connectedDevice.id) });
            broadcast(type, { id: connectedDevice.id }, true);
        }

        // ###########################################################
        // ########################## VALUES #########################
        // ###########################################################

        // Values index
        if (type == 'values.index') {
            // Send all values back
            response(id, type, {
                values: values.map(value => {
                    value.device = devices.find(device => device.id == value.device_id);
                    return value;
                })
            });
        }

        // Values store
        if (type == 'values.store') {
            // Validate device id
            const device = devices.find(device => device.id == data.device_id);
            if (!('device_id' in data && device != null)) {
                response(id, type, { success: false, error: 'device_id' });
                return;
            }

            // Validate value type
            if (!('type' in data && (data.type == 'boolean' || data.type == 'int' || data.type == 'float' || data.type == 'string'))) {
                response(id, type, { success: false, error: 'type' });
                return;
            }

            // Validate value name
            if (!('name' in data && data.name.length >= 2 && data.name.length <= 48)) {
                response(id, type, { success: false, error: 'name' });
                return;
            }

            // Create new empty value and save
            const newValueId = Date.now();
            const value = {
                id: newValueId,
                device_id: device.id,
                type: data.type,
                name: data.name
            };
            if (value.type == 'boolean') value.value = false;
            if (value.type == 'int' || value.type == 'float') value.value = 0;
            if (value.type == 'string') value.value = '';
            values.push(value);
            valuesDirty = true;

            // Send response message back
            response(id, type, { success: true, value });
            broadcast(type, { value });
        }

        // Values update
        if (type == 'values.update') {
            // Validate value id
            const value = values.find(value => value.id == data.id);
            if (!('id' in data && value != null)) {
                response(id, type, { success: false, error: 'id' });
                return;
            }

            // Validate value type and update
            if ('type' in data) {
                if (!(data.type == 'boolean' || data.type == 'int' || data.type == 'float' || data.type == 'string')) {
                    response(id, type, { success: false, error: 'type' });
                    return;
                }

                value.type = data.type;
                valuesDirty = true;
            }

            // Validate value name and update
            if ('name' in data) {
                if (!(data.name.length >= 2 && data.name.length <= 48)) {
                    response(id, type, { success: false, error: 'name' });
                    return;
                }

                value.name = data.name;
                valuesDirty = true;
            }

            // Updata value value when boolean type
            if ('value' in data && value.type == 'boolean') {
                if (!(data.value == true || data.value == false)) {
                    response(id, type, { success: false, error: 'value' });
                    return;
                }

                value.value = data.value;
                valuesDirty = true;
            }

            // Updata value value when int type
            if ('value' in data && value.type == 'int') {
                if (parseInt(data.value) == NaN) {
                    response(id, type, { success: false, error: 'value' });
                    return;
                }

                value.value = parseInt(data.value);
                valuesDirty = true;
            }

            // Updata value value when float type
            if ('value' in data && value.type == 'float') {
                if (parseFloat(data.value) == NaN) {
                    response(id, type, { success: false, error: 'value' });
                    return;
                }

                value.value = parseFloat(data.value);
                valuesDirty = true;
            }

            // Updata value value when string type
            if ('value' in data && value.type == 'string') {
                if (!(data.value.length <= 255)) {
                    response(id, type, { success: false, error: 'value' });
                    return;
                }

                value.value = data.value;
                valuesDirty = true;
            }

            // Send success message back (and automatic to all connected NodeMCU same websocket channel)
            response(id, type, { success: true, value });
            broadcast(type, { value });
        }

        // Values delete
        if (type == 'values.delete') {
            // Validate value id
            const value = values.find(value => value.id == data.id);
            if (!('id' in data && value != null)) {
                response(id, type, { success: false, error: 'id' });
                return;
            }

            // Remove value from values and save
            values = values.filter(value => value.id != data.id);
            valuesDirty = true;

            // Send success message back
            response(id, type, { success: true, id: value.id, device_id: value.device_id });
            broadcast(type, { id: value.id, device_id: value.device_id });
        }
    });

    ws.on('close', () => {
        // When a connected device (NodeMCU) disconnects broadcast disconnect message
        if (connectedDevice != null) {
            connectedDevice.connected = false;
            devicesDirty = true;
            broadcast('devices.disconnect', { id: connectedDevice.id }, true);
        }
    });
});

// HTTP server
const server = http.createServer((req, res) => {
    console.log(`[HTTP] ${req.method} ${req.url}`);
    const { pathname } = new URL(req.url || '', `http://${req.headers.host}`);

    // Home page
    if (pathname == '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        fs.readFile('index.html', (err, data) => res.end(data));
        return;
    }

    // 404 Not Found
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h1>404 Not Found</h1>');
});

server.on('upgrade', function (req, socket, head) {
    console.log(`[HTTP] UPGRADE ${req.method} ${req.url}`);
    const { pathname } = new URL(req.url || '', `http://${req.headers.host}`);

    // Websocket endpoint
    if (pathname == '/ws') {
        wss.handleUpgrade(req, socket, head, ws => {
            wss.emit('connection', ws, req);
        });
        return;
    }

    socket.destroy();
});

server.listen(SERVER_PORT, () => {
    console.log(`[HTTP] Server is listening on http://localhost:${SERVER_PORT}/`);
});
