// server.js - Enhanced Node.js backend with WebSocket support and deployment fixes
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');

// Initialize express app
const app = express();

// Enhanced CORS configuration
app.use(cors({
    origin: '*', // In production, specify your domain
    methods: ['GET', 'POST'],
    credentials: true
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Create HTTP server
const server = http.createServer(app);

// WebSocket server with enhanced configuration
const wss = new WebSocket.Server({
    server,
    perMessageDeflate: false,
    maxPayload: 1024 * 1024, // 1MB max payload
});

// Enhanced data storage
const users = new Map();
const locations = new Map();
const userConnections = new Map();

// Rate limiting map
const rateLimits = new Map();

// Configuration
const CONFIG = {
    LOCATION_TIMEOUT: 5 * 60 * 1000, // 5 minutes
    CLEANUP_INTERVAL: 60 * 1000, // 1 minute
    RATE_LIMIT_WINDOW: 1000, // 1 second
    MAX_REQUESTS_PER_WINDOW: 10,
    MAX_USERS: 100
};

// Rate limiting function
function isRateLimited(userId) {
    const now = Date.now();
    const userRequests = rateLimits.get(userId) || [];

    // Remove old requests outside the window
    const validRequests = userRequests.filter(timestamp =>
        now - timestamp < CONFIG.RATE_LIMIT_WINDOW
    );

    if (validRequests.length >= CONFIG.MAX_REQUESTS_PER_WINDOW) {
        return true;
    }

    validRequests.push(now);
    rateLimits.set(userId, validRequests);
    return false;
}

// Enhanced logging
function log(message, level = 'info') {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`);
}

// Serve the main HTML file at root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        activeUsers: users.size,
        activeLocations: locations.size,
        uptime: process.uptime()
    });
});

// API endpoint to get active users count
app.get('/api/stats', (req, res) => {
    res.json({
        activeUsers: users.size,
        activeLocations: locations.size,
        timestamp: new Date().toISOString()
    });
});

// Handle WebSocket connections
wss.on('connection', (ws, req) => {
    const clientIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    log(`New WebSocket connection from ${clientIp}`);

    // Connection timeout
    const connectionTimeout = setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.close(1000, 'Connection timeout - no registration received');
        }
    }, 30000); // 30 seconds to register

    ws.on('message', (message) => {
        try {
            // Parse and validate message
            const data = JSON.parse(message.toString());

            if (!data.type) {
                ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
                return;
            }

            // Check rate limiting
            if (ws.userId && isRateLimited(ws.userId)) {
                ws.send(JSON.stringify({ type: 'error', message: 'Rate limit exceeded' }));
                return;
            }

            handleWebSocketMessage(ws, data, connectionTimeout);

        } catch (error) {
            log(`Error processing message: ${error.message}`, 'error');
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
        }
    });

    ws.on('close', (code, reason) => {
        clearTimeout(connectionTimeout);
        handleClientDisconnect(ws);
        log(`WebSocket connection closed: ${code} - ${reason}`);
    });

    ws.on('error', (error) => {
        log(`WebSocket error: ${error.message}`, 'error');
    });

    // Send welcome message
    ws.send(JSON.stringify({
        type: 'welcome',
        message: 'Connected to location tracker server'
    }));
});

// Handle different WebSocket message types
function handleWebSocketMessage(ws, data, connectionTimeout) {
    switch (data.type) {
        case 'register':
            handleUserRegistration(ws, data, connectionTimeout);
            break;

        case 'location_update':
            handleLocationUpdate(ws, data);
            break;

        case 'stop_sharing':
            handleStopSharing(ws, data);
            break;

        case 'track_user':
            handleTrackUser(ws, data);
            break;

        case 'ping':
            ws.send(JSON.stringify({ type: 'pong' }));
            break;

        default:
            ws.send(JSON.stringify({
                type: 'error',
                message: `Unknown message type: ${data.type}`
            }));
    }
}

// Handle user registration
function handleUserRegistration(ws, data, connectionTimeout) {
    clearTimeout(connectionTimeout);

    const userId = data.userId;
    const userName = data.name || 'Anonymous';

    if (!userId || typeof userId !== 'string') {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid user ID' }));
        return;
    }

    // Check user limit
    if (users.size >= CONFIG.MAX_USERS && !users.has(userId)) {
        ws.send(JSON.stringify({ type: 'error', message: 'Server at capacity' }));
        ws.close(1013, 'Server at capacity');
        return;
    }

    // Store user information
    users.set(userId, {
        userId: userId,
        name: userName,
        connectedAt: Date.now(),
        lastSeen: Date.now()
    });

    // Associate WebSocket with user
    ws.userId = userId;
    userConnections.set(userId, ws);

    log(`User registered: ${userId} (${userName})`);

    // Send confirmation
    ws.send(JSON.stringify({
        type: 'registration_success',
        userId: userId
    }));

    // Broadcast updated user list
    broadcastUserList();

    // Send existing locations to new user
    sendExistingLocations(ws);
}

// Handle location updates
function handleLocationUpdate(ws, data) {
    if (!ws.userId) {
        ws.send(JSON.stringify({ type: 'error', message: 'Not registered' }));
        return;
    }

    // Validate location data
    if (!isValidLocation(data.lat, data.lng)) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid location data' }));
        return;
    }

    // Update location
    locations.set(data.userId, {
        userId: data.userId,
        lat: parseFloat(data.lat),
        lng: parseFloat(data.lng),
        name: data.name || 'Anonymous',
        timestamp: Date.now()
    });

    // Update user's last seen
    if (users.has(data.userId)) {
        const user = users.get(data.userId);
        user.lastSeen = Date.now();
        users.set(data.userId, user);
    }

    log(`Location updated for user: ${data.userId}`);

    // Broadcast location update
    broadcastLocationUpdate(data);
}

// Handle stop sharing
function handleStopSharing(ws, data) {
    if (!ws.userId) return;

    const userId = data.userId || ws.userId;

    if (locations.has(userId)) {
        locations.delete(userId);
        broadcastLocationStop(userId);
        log(`User stopped sharing location: ${userId}`);
    }
}

// Handle track user request
function handleTrackUser(ws, data) {
    const targetUserId = data.targetUserId;

    if (!targetUserId) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid target user ID' }));
        return;
    }

    if (locations.has(targetUserId)) {
        const location = locations.get(targetUserId);
        // Only send if location is recent
        if (Date.now() - location.timestamp < CONFIG.LOCATION_TIMEOUT) {
            ws.send(JSON.stringify({
                type: 'location_update',
                ...location
            }));
        }
    }
}

// Handle client disconnect
function handleClientDisconnect(ws) {
    if (ws.userId) {
        // Remove user
        users.delete(ws.userId);
        userConnections.delete(ws.userId);

        // Remove location
        if (locations.has(ws.userId)) {
            locations.delete(ws.userId);
            broadcastLocationStop(ws.userId);
        }

        // Update user list
        broadcastUserList();

        log(`User disconnected: ${ws.userId}`);
    }
}

// Validation functions
function isValidLocation(lat, lng) {
    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);

    return !isNaN(latitude) &&
        !isNaN(longitude) &&
        latitude >= -90 &&
        latitude <= 90 &&
        longitude >= -180 &&
        longitude <= 180;
}

// Broadcasting functions
function broadcastUserList() {
    const userList = Array.from(users.values()).map(user => ({
        userId: user.userId,
        name: user.name,
        connectedAt: user.connectedAt
    }));

    const message = JSON.stringify({
        type: 'user_list',
        users: userList,
        timestamp: Date.now()
    });

    broadcastToAll(message);
}

function broadcastLocationUpdate(data) {
    const message = JSON.stringify({
        type: 'location_update',
        userId: data.userId,
        lat: parseFloat(data.lat),
        lng: parseFloat(data.lng),
        name: data.name || 'Anonymous',
        timestamp: Date.now()
    });

    broadcastToAll(message);
}

function broadcastLocationStop(userId) {
    const message = JSON.stringify({
        type: 'location_stop',
        userId: userId,
        timestamp: Date.now()
    });

    broadcastToAll(message);
}

function broadcastToAll(message) {
    let sentCount = 0;

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            try {
                client.send(message);
                sentCount++;
            } catch (error) {
                log(`Error sending message to client: ${error.message}`, 'error');
            }
        }
    });

    log(`Broadcast sent to ${sentCount} clients`);
}

// Send existing locations to a specific client
function sendExistingLocations(ws) {
    let sentCount = 0;

    locations.forEach(location => {
        // Only send recent locations
        if (Date.now() - location.timestamp < CONFIG.LOCATION_TIMEOUT) {
            try {
                ws.send(JSON.stringify({
                    type: 'location_update',
                    ...location
                }));
                sentCount++;
            } catch (error) {
                log(`Error sending location to client: ${error.message}`, 'error');
            }
        }
    });

    log(`Sent ${sentCount} existing locations to new client`);
}

// Cleanup old data periodically
setInterval(() => {
    const now = Date.now();
    let cleanedLocations = 0;
    let cleanedRateLimits = 0;

    // Clean old locations
    locations.forEach((location, userId) => {
        if (now - location.timestamp > CONFIG.LOCATION_TIMEOUT) {
            locations.delete(userId);
            cleanedLocations++;
        }
    });

    // Clean rate limit data
    rateLimits.forEach((requests, userId) => {
        const validRequests = requests.filter(timestamp =>
            now - timestamp < CONFIG.RATE_LIMIT_WINDOW
        );
        if (validRequests.length === 0) {
            rateLimits.delete(userId);
            cleanedRateLimits++;
        } else {
            rateLimits.set(userId, validRequests);
        }
    });

    if (cleanedLocations > 0 || cleanedRateLimits > 0) {
        log(`Cleanup completed: ${cleanedLocations} locations, ${cleanedRateLimits} rate limits`);
    }
}, CONFIG.CLEANUP_INTERVAL);

// Graceful shutdown
process.on('SIGTERM', () => {
    log('SIGTERM received, shutting down gracefully');

    // Close all WebSocket connections
    wss.clients.forEach(client => {
        client.close(1001, 'Server shutting down');
    });

    server.close(() => {
        log('Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    log('SIGINT received, shutting down gracefully');
    process.exit(0);
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    log(`🚀 Server running on port ${PORT}`);
    log(`📊 Health check available at /health`);
    log(`📈 Stats available at /api/stats`);
});

// Export for testing
module.exports = { app, server, wss };
