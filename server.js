const express = require('express');
const mongoose = require('mongoose');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs'); // पासवर्ड सिक्योर करने के लिए

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

app.use(express.json());

// 🔗 मोंगोडीबी कनेक्शन
const MONGO_URI = process.env.MONGO_URI;
mongoose.connect(MONGO_URI)
    .then(() => console.log("🔥 MongoDB Connected Successfully!"))
    .catch(err => console.error("❌ Database Connection Error:", err));


// ==========================================
// 📁 1. SCHEMAS & MODELS (आपके द्वारा दिए गए)
// ==========================================

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    walletBalance: { type: Number, default: 0 },
    lockedCoins: { type: Number, default: 0 }, 
    isBlocked: { type: Boolean, default: false } 
});

const depositSchema = new mongoose.Schema({
    username: { type: String, required: true },
    amount: { type: Number, required: true },
    screenshotUrl: { type: String, required: true }, 
    status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
    createdAt: { type: Date, default: Date.now }
});

const withdrawSchema = new mongoose.Schema({
    username: { type: String, required: true },
    amount: { type: Number, required: true },
    upiId: { type: String, required: true },
    status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Deposit = mongoose.model('Deposit', depositSchema);
const Withdraw = mongoose.model('Withdraw', withdrawSchema);


// ==========================================
// 🛠️ 2. API ROUTES (लॉगिन, डिपॉज़िट, विथड्रॉल)
// ==========================================

// 🔑 A. यूज़र रजिस्ट्रेशन और लॉगिन (All-in-One Route)
app.post('/api/auth', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Username और Password ज़रूरी हैं" });

    try {
        let user = await User.findOne({ username });

        if (user) {
            // अगर यूज़र ब्लॉक है
            if (user.isBlocked) return res.status(403).json({ error: "आपका अकाउंट ब्लॉक कर दिया गया है!" });

            // लॉगिन के लिए पासवर्ड चेक करें
            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) return res.status(400).json({ error: "गलत पासवर्ड!" });

            return res.json({ message: "लॉगिन सफल!", user: { username: user.username, walletBalance: user.walletBalance } });
        } else {
            // नया यूज़र रजिस्टर करें
            const hashedPassword = await bcrypt.hash(password, 10);
            user = new User({ username, password: hashedPassword });
            await user.save();

            return res.json({ message: "रजिस्ट्रेशन सफल!", user: { username: user.username, walletBalance: user.walletBalance } });
        }
    } catch (error) {
        res.status(500).json({ error: "सर्वर एरर" });
    }
});

// 💰 B. डिपॉज़िट रिक्वेस्ट सबमिट करना (Payment Screenshot के साथ)
app.post('/api/deposit', async (req, res) => {
    const { username, amount, screenshotUrl } = req.body;
    if (!username || !amount || !screenshotUrl) return res.status(400).json({ error: "सभी डिटेल्स ज़रूरी हैं" });

    try {
        const newDeposit = new Deposit({ username, amount: Number(amount), screenshotUrl });
        await newDeposit.save();
        res.json({ success: true, message: "डिपॉज़िट रिक्वेस्ट एडमिन के पास भेज दी गई है!" });
    } catch (error) {
        res.status(500).json({ error: "डिपॉज़िट रिक्वेस्ट फेल हुई" });
    }
});

// 💸 C. विथड्रॉल रिक्वेस्ट सबमिट करना (Coins Lock करने के साथ)
app.post('/api/withdraw', async (req, res) => {
    const { username, amount, upiId } = req.body;
    if (!username || !amount || !upiId) return res.status(400).json({ error: "सभी डिटेल्स ज़रूरी हैं" });

    try {
        const user = await User.findOne({ username });
        if (!user || user.walletBalance < amount) return res.status(400).json({ error: "अपर्याप्त बैलेंस!" });

        // वॉलेट से अमाउंट घटाकर lockedCoins में डालना
        user.walletBalance -= Number(amount);
        user.lockedCoins += Number(amount);
        await user.save();

        const newWithdraw = new Withdraw({ username, amount: Number(amount), upiId });
        await newWithdraw.save();

        res.json({ success: true, message: "विथड्रॉल रिक्वेस्ट सबमिट हो गई, कोइन्स लॉक कर दिए गए हैं!", newBalance: user.walletBalance });
    } catch (error) {
        res.status(500).json({ error: "विथड्रॉल प्रोसेस फेल हुआ" });
    }
});


// ==========================================
// 🎮 3. REAL-TIME MATCHMAKING & LOBBY (Sockets)
// ==========================================
let activeChallenges = [];

io.on('connection', (socket) => {
    console.log(`🔌 प्लेयर कनेक्ट हुआ: ${socket.id}`);

    // चैलेंज (Open Price Post) बनाना
    socket.on('createChallenge', async ({ username, amount }) => {
        try {
            const user = await User.findOne({ username });
            if (!user || user.walletBalance < amount) {
                return socket.emit('error', { message: "मैच लगाने के लिए बैलेंस कम है!" });
            }

            const newChallenge = {
                challengeId: `room_${Date.now()}`,
                creator: username,
                amount: Number(amount),
                status: 'WAITING',
                joinedBy: null
            };

            activeChallenges.push(newChallenge);
            io.emit('lobbyUpdate', activeChallenges);
            socket.emit('challengeCreated', newChallenge);
        } catch (err) {
            socket.emit('error', { message: "चैलेंज क्रिएट करने में एरर" });
        }
    });

    // चैलेंज जॉइन करना
    socket.on('joinChallenge', async ({ challengeId, username }) => {
        try {
            const challenger = await User.findOne({ username });
            const challenge = activeChallenges.find(c => c.challengeId === challengeId);

            if (!challenge || challenge.status !== 'WAITING') return socket.emit('error', { message: "चैलेंज उपलब्ध नहीं है" });
            if (challenge.creator === username) return socket.emit('error', { message: "आप अपना खुद का चैलेंज जॉइन नहीं कर सकते" });
            if (!challenger || challenger.walletBalance < challenge.amount) return socket.emit('error', { message: "आपका बैलेंस कम है" });

            challenge.status = 'STARTING';
            challenge.joinedBy = username;

            // दोनों के वॉलेट से पैसे काटना
            await User.updateOne({ username: challenge.creator }, { $inc: { walletBalance: -challenge.amount } });
            await User.updateOne({ username: challenge.joinedBy }, { $inc: { walletBalance: -challenge.amount } });

            socket.join(challenge.challengeId);
            io.emit('lobbyUpdate', activeChallenges);
            
            io.to(challenge.challengeId).emit('gameReady', {
                roomId: challenge.challengeId,
                player1: challenge.creator,
                player2: challenge.joinedBy,
                prizePool: challenge.amount * 2 * 0.9 // 10% एडमिन फीस कटकर
            });
        } catch (err) {
            socket.emit('error', { message: "मैच जॉइन करने में समस्या आई" });
        }
    });

    socket.on('disconnect', () => {
        console.log(`❌ प्लेयर डिस्कनेक्ट हुआ: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
