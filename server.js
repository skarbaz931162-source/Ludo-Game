const express = require('express');
const mongoose = require('mongoose');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

app.use(express.json());

// 🔗 मोंगोडीबी कनेक्शन (Render पर हम इसे सीक्रेट तरीके से जोड़ेंगे, इसलिए इसे ऐसे ही रहने दें)
const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI)
    .then(() => console.log("🔥 MongoDB Connected Successfully!"))
    .catch(err => console.error("❌ Database Connection Error:", err));

// 🎮 Step 1: Wallet Login Route
app.post('/api/login', async (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: "User ID ज़रूरी है" });

    try {
        let user = await mongoose.model('User', new mongoose.Schema({
            userId: { type: String, required: true, unique: true },
            walletBalance: { type: Number, default: 0 },
            isBlocked: { type: Boolean, default: false }
        })).findOne({ userId });
        
        if (user && user.isBlocked) {
            return res.status(403).json({ error: "यह अकाउंट ब्लॉक है!" });
        }

        if (!user) {
            user = new (mongoose.model('User'))({ userId, walletBalance: 0 });
            await user.save();
        }

        res.json({ success: true, user });
    } catch (error) {
        res.status(500).json({ error: "सर्वर एरर" });
    }
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

