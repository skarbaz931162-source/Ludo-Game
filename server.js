const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// अपना MongoDB Atlas लिंक यहाँ डालें
mongoose.connect('mongodb+srv://YOUR_DB_LINK_HERE')
.then(() => console.log("DB Connected!"))
.catch(err => console.log("DB Error:", err));

// बेसिक स्कीम
const User = mongoose.model('User', new mongoose.Schema({ username: String, walletBalance: Number }));

io.on('connection', (socket) => {
    console.log('User Joined: ' + socket.id);
});

// APIs
app.post('/api/register', async (req, res) => {
    const newUser = new User({ username: req.body.username, walletBalance: 200 });
    await newUser.save();
    res.json({ message: "User Registered" });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server Running on Port 3000"));
