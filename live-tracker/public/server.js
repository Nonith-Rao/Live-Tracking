const express = require('express');
const mongoose = require('mongoose');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: 'http://localhost:3000', // Update to match frontend port
        methods: ['GET', 'POST'],
    },
});

app.use(cors());
app.use(express.json());

// MongoDB connection
mongoose.connect('mongodb+srv://hack:hack123@cluster0.khugb.mongodb.net/bbfb?retryWrites=true&w=majority&appName=Cluster0', {
    serverSelectionTimeoutMS: 5000, // Timeout after 5 seconds
    connectTimeoutMS: 10000, // Connection timeout
    socketTimeoutMS: 45000, // Socket timeout
}).then(() => console.log('Connected to MongoDB')).catch(err => console.error('MongoDB connection error:', err));

// Location schema
const locationSchema = new mongoose.Schema({
    username: String,
    latitude: Number,
    longitude: Number,
    timestamp: { type: Date, default: Date.now },
});

const Location = mongoose.model('Location', locationSchema);

// API to get all locations
app.get('/api/locations', async (req, res) => {
    try {
        const locations = await Location.find();
        res.json(locations);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// API to get a single location by ID
app.get('/api/locations/:id', async (req, res) => {
    try {
        const location = await Location.findById(req.params.id);
        if (!location) {
            return res.status(404).json({ error: 'Location not found' });
        }
        res.json(location);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// API to share a location
app.post('/api/locations', async (req, res) => {
    const { username, latitude, longitude } = req.body;
    if (!username || !latitude || !longitude) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        const location = new Location({ username, latitude, longitude });
        await location.save();
        io.emit('newLocation', location); // Broadcast new location to all clients
        res.status(201).json(location);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Socket.IO connection
io.on('connection', (socket) => {
    console.log('A user connected');
    socket.on('disconnect', () => {
        console.log('User disconnected');
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
