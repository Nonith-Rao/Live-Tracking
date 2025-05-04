const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Initialize express app
const app = express();
const server = http.createServer(app);

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));
console.log('Serving static files from:', path.join(__dirname, 'public'));

// Health check endpoint for Render
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Fallback to serve index.html for all unmatched routes
app.get('*', (req, res) => {
    const indexPath = path.join(__dirname, 'index.html');
    console.log(`Attempting to serve: ${indexPath}`);
    res.sendFile(indexPath, (err) => {
        if (err) {
            console.error('Error serving index.html:', err);
            res.status(404).send('Cannot GET / - index.html not found');
        }
    });
});

// WebSocket server
const wss = new WebSocket.Server({ server });

// Store user data
const users = {};
const locations = {};

// Handle WebSocket connections
wss.on('connection', (ws) => {
    console.log('A client connected');

    const connectionId = uuidv4();

    ws.on('message', (message) => {
        console.log('Received WebSocket message:', message.toString());
        try {
            const data = JSON.parse(message);

            switch (data.type) {
                case 'register':
                    const userId = data.userId;
                    users[userId] = {
                        userId: userId,
                        name: data.name || 'Anonymous',
                        connectionId: connectionId,
                        ws: ws
                    };
                    ws.userId = userId;
                    console.log(`User registered: ${userId}`);
                    broadcastUserList();
                    sendLocations(ws);
                    break;

                case 'location_update':
                    locations[data.userId] = {
                        userId: data.userId,
                        lat: data.lat,
                        lng: data.lng,
                        name: data.name || 'Anonymous',
                        timestamp: Date.now()
                    };
                    console.log(`Location updated for ${data.userId}`);
                    broadcastLocationUpdate(data);
                    break;

                case 'stop_sharing':
                    if (locations[data.userId]) {
                        delete locations[data.userId];
                        console.log(`Stopped sharing for ${data.userId}`);
                        broadcastLocationStop(data.userId);
                    }
                    break;

                case 'track_user':
                    console.log(`Tracking user: ${data.targetUserId}`);
                    if (locations[data.targetUserId]) {
                        ws.send(JSON.stringify({
                            type: 'location_update',
                            ...locations[data.targetUserId]
                        }));
                    } else {
                        console.log(`No location found for ${data.targetUserId}`);
                    }
                    break;
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        if (ws.userId && users[ws.userId]) {
            delete users[ws.userId];
            broadcastUserList();
        }
    });
});

// Broadcast user list to all clients
function broadcastUserList() {
    const userList = Object.values(users).map(user => ({
        userId: user.userId,
        name: user.name
    }));
    const message = JSON.stringify({
        type: 'user_list',
        users: userList
    });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// Broadcast location update to all clients
function broadcastLocationUpdate(data) {
    const message = JSON.stringify({
        type: 'location_update',
        userId: data.userId,
        lat: data.lat,
        lng: data.lng,
        name: data.name || 'Anonymous',
        timestamp: Date.now()
    });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// Broadcast location stop to all clients
function broadcastLocationStop(userId) {
    const message = JSON.stringify({
        type: 'location_stop',
        userId: userId
    });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// Send current locations to a specific client
function sendLocations(ws) {
    Object.values(locations).forEach(location => {
        if (Date.now() - location.timestamp < 5 * 60 * 1000) {
            ws.send(JSON.stringify({
                type: 'location_update',
                ...location
            }));
        }
    });
}

// Clean up old location data every minute
setInterval(() => {
    const now = Date.now();
    Object.keys(locations).forEach(userId => {
        if (now - locations[userId].timestamp > 5 * 60 * 1000) {
            delete locations[userId];
        }
    });
}, 60 * 1000);

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
