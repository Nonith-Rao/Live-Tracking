// server.js - Node.js backend with WebSocket support
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Initialize express app
const app = express();
const server = http.createServer(app);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// WebSocket server
const wss = new WebSocket.Server({ server });

// Store user data
const users = {};
const locations = {};

// Handle WebSocket connections
wss.on('connection', (ws) => {
    console.log('A client connected');
    
    // Generate a temporary ID for this connection
    const connectionId = uuidv4();
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            // Handle different message types
            switch (data.type) {
                case 'register':
                    // Register user
                    const userId = data.userId;
                    users[userId] = {
                        userId: userId,
                        name: data.name || 'Anonymous',
                        connectionId: connectionId,
                        ws: ws
                    };
                    
                    // Associate this connection with the user ID
                    ws.userId = userId;
                    
                    console.log(`User registered: ${userId}`);
                    
                    // Send current user list to everyone
                    broadcastUserList();
                    
                    // Send existing locations to new user
                    sendLocations(ws);
                    break;
                    
                case 'location_update':
                    // Update user's location
                    locations[data.userId] = {
                        userId: data.userId,
                        lat: data.lat,
                        lng: data.lng,
                        name: data.name || 'Anonymous',
                        timestamp: Date.now()
                    };
                    
                    // Broadcast location update to all clients
                    broadcastLocationUpdate(data);
                    break;
                    
                case 'stop_sharing':
                    // Remove user's location data
                    if (locations[data.userId]) {
                        delete locations[data.userId];
                        broadcastLocationStop(data.userId);
                    }
                    break;
                    
                case 'track_user':
                    // Send specific user's location if available
                    if (locations[data.targetUserId]) {
                        ws.send(JSON.stringify({
                            type: 'location_update',
                            ...locations[data.targetUserId]
                        }));
                    }
                    break;
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    });
    
    ws.on('close', () => {
        console.log('Client disconnected');
        
        // Remove user from users list
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
        // Only send locations that are less than 5 minutes old
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
    
    // Remove locations older than 5 minutes
    Object.keys(locations).forEach(userId => {
        if (now - locations[userId].timestamp > 5 * 60 * 1000) {
            delete locations[userId];
        }
    });
}, 60 * 1000);

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});