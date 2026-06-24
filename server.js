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

// 1. DATABASE MODELS (Step 2)
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    walletBalance: { type: Number, default: 0 },
    lockedCoins: { type: Number, default: 0 },
    isBlocked: { type: Boolean, default: false }
});
const depositSchema = new mongoose.Schema({
    username: String, amount: Number, screenshotUrl: String, 
    status: { type: String, default: 'Pending' }, createdAt: { type: Date, default: Date.now }
});
const withdrawSchema = new mongoose.Schema({
    username: String, amount: Number, upiId: String, 
    status: { type: String, default: 'Pending' }, createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Deposit = mongoose.model('Deposit', depositSchema);
const Withdraw = mongoose.model('Withdraw', withdrawSchema);

// 2. DATABASE CONNECTION
// यहाँ अपना MongoDB Atlas का लिंक डालें!
mongoose.connect('mongodb+srv://YOUR_DB_LINK_HERE')
.then(() => console.log("Database Connected!"))
.catch(err => console.log("DB Error:", err));

// 3. SOCKET & GAME LOGIC (Step 3)
io.on('connection', (socket) => {
    socket.on('join_lobby', (u) => socket.username = u);
    
    socket.on('game_over', async (data) => {
        const { winner, totalPool } = data;
        const netWinning = totalPool * 0.9; // 10% Commission
        await User.findOneAndUpdate({ username: winner }, { $inc: { walletBalance: netWinning } });
        io.emit('winner_alert', `${winner} जीता!`);
    });
});

// 4. API ROUTES
app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        const newUser = new User({ username, password, walletBalance: 200 });
        await newUser.save();
        res.status(201).json({ message: "Success" });
    } catch (e) { res.status(400).json({ error: "Exists" }); }
});

app.post('/api/deposit/request', async (req, res) => {
    const newReq = new Deposit(req.body);
    await newReq.save();
    io.emit('admin_deposit_request', newReq);
    res.json({ message: "Requested!" });
});

app.post('/api/withdraw/request', async (req, res) => {
    const { username, amount } = req.body;
    const user = await User.findOne({ username });
    if(user.walletBalance >= amount) {
        user.walletBalance -= amount;
        user.lockedCoins += amount;
        await user.save();
        await new Withdraw(req.body).save();
        res.json({ message: "Done" });
    } else res.status(400).json({ error: "Low Balance" });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server Running on ${PORT}`));
