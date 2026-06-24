const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const app = express();

app.use(express.json());
app.use(cors());

// डेटाबेस कनेक्शन
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("Database Connected Successfully"))
    .catch(err => console.log("DB Connection Error:", err));

// डिपॉजिट सेव करने का लॉजिक
app.post('/api/deposit', async (req, res) => {
    try {
        const { amount, player } = req.body;
        // ये सीधे आपके MongoDB में रिक्वेस्ट सेव कर देगा
        const db = mongoose.connection.db;
        await db.collection('deposits').insertOne({
            amount: amount,
            player: player,
            status: 'pending',
            date: new Date()
        });
        res.json({ success: true, message: "Request received!" });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// एडमिन के लिए रिक्वेस्ट देखने का कोड
app.get('/api/deposits', async (req, res) => {
    const db = mongoose.connection.db;
    const requests = await db.collection('deposits').find({}).toArray();
    res.json(requests);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

