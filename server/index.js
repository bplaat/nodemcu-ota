const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const { WebSocket, WebSocketServer } = require('ws');

/*

device.connect
device.disconnect

*/

// Config
const SERVER_PORT = process.env.PORT || 8080;
const UPDATE_WRITEBACK_TIMEOUT = 5000;

// Create db folder when not existing
if (!fs.existsSync('db')) {
    fs.mkdirSync('db');
}

// Devices local database
let devices = [];
if (fs.existsSync('db/devices.json')) {
    devices = JSON.parse(fs.readFileSync('db/devices.json'));
    console.log('[DB] devices.json read');
}
let devicesDirty = false;
function saveDevices() {
    if (devicesDirty) {
        devicesDirty = false;
        fs.writeFile('db/devices.json', JSON.stringify(devices), (err) => {
            if (err) console.log(err);
            console.log('[DB] devices.json written');
            setTimeout(saveDevices, UPDATE_WRITEBACK_TIMEOUT);
        });
    } else {
        setTimeout(saveDevices, UPDATE_WRITEBACK_TIMEOUT);
    }
}
setTimeout(saveDevices, UPDATE_WRITEBACK_TIMEOUT);

// Websocket server
const wss = new WebSocketServer({ noServer: true });
wss.on('connection', ws => {
    function send(type, data) {
        console.log('[WS] SEND', { type, data });
        ws.send(JSON.stringify({ id: Date.now(), type: type, data: data }));
    }

    function response(id, type, data) {
        console.log('[WS] RESPONSE', { id, type, data });
        ws.send(JSON.stringify({ id: id, type: type, data: data }));
    }

    function broadcast(type, data) {
        const id = Date.now();
        wss.clients.forEach(function each(client) {
            if (client != ws && client.readyState == WebSocket.OPEN) {
                console.log('[WS] BROADCAST', { id, type, data });
                client.send(JSON.stringify({ id: id, type: type, data: data }));
            }
        });
    }

    ws.on('message', message => {
        const { id, type, data } = JSON.parse(message);
        console.log('[WS] RECEIVE', { id, type, data });

        // Devices index
        if (type == 'devices.index') {
            response(id, type, { devices: devices });
        }

        // Devices store
        if (type == 'devices.store') {
            if (!('name' in data && data.name.length >= 2)) {
                response(id, type, { success: false });
                return;
            }

            const newDeviceId = Date.now();
            const device = {
                id: newDeviceId,
                name: data.name,
                key: crypto.createHash('md5').update(`${newDeviceId}@super_secure_salt!`).digest('hex'),
                connected: false
            };
            devices.push(device);
            devicesDirty = true;

            response(id, type, { success: true, device: device });
            broadcast(type, { device: device });
        }

        // Devices update
        if (type == 'devices.update') {
            const device = devices.find(device => device.id == data.id);
            if (!('id' in data) || device == null) {
                response(id, type, { success: false });
                return;
            }

            if ('name' in data) {
                if (data.name.length < 2) {
                    response(id, type, { success: false });
                    return;
                }

                device.name = data.name;
                devicesDirty = true;
            }

            response(id, type, { success: true, device: device });
            broadcast(type, { device: device });
        }

        // Devices delete
        if (type == 'devices.delete') {
            const device = devices.find(device => device.id == data.id);
            if (!('id' in data) || device == null) {
                response(id, type, { success: false });
                return;
            }

            devices = devices.filter(device => device.id != data.id);
            devicesDirty = true;

            response(id, type, { success: true, id: device.id });
            broadcast(type, { id: device.id });
        }

        // ...
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
