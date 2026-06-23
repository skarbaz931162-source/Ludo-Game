const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());

// --- 1. DATABASES MONGODB ATLAS CONNECTION ---
const mongoURI = process.env.MONGO_URI;

mongoose.connect(mongoURI)
.then(() => console.log("🔥 MongoDB Connected Successfully!"))
.catch(err => console.log("❌ Database Connection Error:", err));

// --- 2. SCHEMAS & MODELS ---
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    walletBalance: { type: Number, default: 200 }, // Shuruat mein 200 free coins
    lockedCoins: { type: Number, default: 0 }      // Withdrawal ke samay lock hone wale coins
});

const depositSchema = new mongoose.Schema({
    username: { type: String, required: true },
    amount: { type: Number, required: true },
    screenshotUrl: { type: String, required: true },
    status: { type: String, default: 'Pending' }, // Pending, Approved, Rejected
    createdAt: { type: Date, default: Date.now }
});

const withdrawSchema = new mongoose.Schema({
    username: { type: String, required: true },
    amount: { type: Number, required: true },
    upiId: { type: String, required: true },
    status: { type: String, default: 'Pending' }, // Pending, Paid, Rejected
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Deposit = mongoose.model('Deposit', depositSchema);
const Withdraw = mongoose.model('Withdraw', withdrawSchema);

// --- 3. GAME RULES CONFIGURATION ---
const MINIMUM_COIN_LIMIT = 100; // Minimum coin limit rule
const COMMISSION_PERCENTAGE = 10; // 10% Admin Commission

// --- 4. REAL-TIME LOBBY & SOCKET.IO LOGIC ---
io.on('connection', (socket) => {
    console.log('A User Connected: ' + socket.id);

    // Jab koi naya banda online aaye (Global Lobby)
    socket.on('join_lobby', (username) => {
        socket.username = username;
        io.emit('user_status_alert', `${username} is now Online!`);
    });

    // Open Price Post Option (With Min 100 filter)
    socket.on('post_challenge', async (data) => {
        const { username, coins } = data;
        
        if (coins < MINIMUM_COIN_LIMIT) {
            return socket.emit('error_message', `Bhai, kam se kam ${MINIMUM_COIN_LIMIT} coins se hi khel sakte ho!`);
        }

        // Agar coins sahi hain toh puri lobby mein broadcast kar do
        io.emit('lobby_broadcast', {
            username: username,
            message: `${username} ${coins} Coins ka match khelna chahta hai!`,
            coins: coins
        });
    });

    // Private Match Request Approval Logic
    socket.on('send_match_request', (data) => {
        socket.broadcast.emit('match_request_received', data);
    });

    // Game Complete & Automatic Commission Deductor
    socket.on('game_over', async (data) => {
        const { winner, loser, totalPool } = data;
        
        const commission = (totalPool * COMMISSION_PERCENTAGE) / 100;
        const netWinning = totalPool - commission;

        // Wallet update in Database for Winner
        await User.findOneAndUpdate({ username: winner }, { $inc: { walletBalance: netWinning } });
        
        io.emit('admin_profit_update', { commissionEarned: commission });
        io.emit('winner_alert', `${winner} jeet gaya! ${commission} coins admin commission kata.`);
    });

    socket.on('disconnect', () => {
        console.log('User Disconnected: ' + socket.id);
    });
});

// --- 5. ADMIN CONTROL & AUTH API ROUTES ---

// Registration Route with Password Hashing
app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        // Secure Password Hashing
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const newUser = new User({ username, password: hashedPassword, walletBalance: 200 });
        await newUser.save();
        
        io.emit('admin_new_user_alert', { message: `Ding! New User Registered: ${username}` });
        res.status(201).json({ message: "Registration Successful!", user: { username: newUser.username, walletBalance: newUser.walletBalance } });
    } catch (error) {
        res.status(400).json({ error: "Username already exists!" });
    }
});

// Login Route with Password Verification
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username });
        if (!user) return res.status(400).json({ error: "User nahi mila!" });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ error: "Galat Password!" });

        res.json({ message: "Login Successful!", username: user.username, walletBalance: user.walletBalance });
    } catch (error) {
        res.status(500).json({ error: "Server Error!" });
    }
});

// Deposit Request (User Page)
app.post('/api/deposit/request', async (req, res) => {
    try {
        const { username, amount, screenshotUrl } = req.body;
        const newRequest = new Deposit({ username, amount, screenshotUrl });
        await newRequest.save();

        io.emit('admin_deposit_request', newRequest);
        res.json({ message: "Payment Screenshot Submitted! Waiting for Admin Approval." });
    } catch (error) {
        res.status(500).json({ error: "Request fail ho gayi!" });
    }
});

// Admin Approval for Deposit
app.post('/api/admin/approve-deposit', async (req, res) => {
    try {
        const { requestId, status } = req.body;
        const deposit = await Deposit.findById(requestId);

        if (deposit && status === 'Approved' && deposit.status === 'Pending') {
            deposit.status = 'Approved';
            await deposit.save();
            
            await User.findOneAndUpdate({ username: deposit.username }, { $inc: { walletBalance: deposit.amount } });
            res.json({ message: "Coins Credited to User Successfully!" });
        } else {
            res.json({ message: "Request Rejected or Already Processed!" });
        }
    } catch (error) {
        res.status(500).json({ error: "Approval failed!" });
    }
});

// Withdrawal Request & Coin Locking
app.post('/api/withdraw/request', async (req, res) => {
    try {
        const { username, amount, upiId } = req.body;
        const user = await User.findOne({ username });

        if (!user) return res.status(400).json({ error: "User nahi mila!" });

        if (user.walletBalance >= amount) {
            user.walletBalance -= amount;
            user.lockedCoins += amount;
            await user.save();

            const newWithdraw = new Withdraw({ username, amount, upiId });
            await newWithdraw.save();

            io.emit('admin_withdraw_request', newWithdraw);
            res.json({ message: "Withdrawal Requested! Your coins are locked until paid." });
        } else {
            res.status(400).json({ error: "Inadequate wallet balance!" });
        }
    } catch (error) {
        res.status(500).json({ error: "Withdrawal fail ho gaya!" });
    }
});

// --- 6. DYNAMIC PORT FOR RENDER ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running perfectly on port: ${PORT}`);
});

