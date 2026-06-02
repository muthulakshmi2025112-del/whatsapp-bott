const express = require('express');
const { Client, RemoteAuth } = require('whatsapp-web.js');
const { MongoStore } = require('wwebjs-mongo');
const mongoose = require('mongoose');
const qrcode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let qrCodeData = null;
let isReady = false;
let qrCodeImage = null;

// Connect to MongoDB Atlas
mongoose.connect(process.env.MONGODB_URI).then(() => {
    console.log('✅ MongoDB Atlas Connected');
    
    const store = new MongoStore({ mongoose: mongoose });
    const client = new Client({
        authStrategy: new RemoteAuth({
            store: store,
            clientId: 'lsk-clinic-permanent',
            backupSyncIntervalMs: 300000
        }),
        puppeteer: {
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--single-process', '--disable-gpu'],
            headless: true
        }
    });

    client.on('qr', async (qr) => {
        qrCodeData = qr;
        qrCodeImage = await qrcode.toDataURL(qr);
        console.log('🔄 QR Code generated');
    });

    client.on('ready', () => {
        isReady = true;
        qrCodeData = null;
        console.log('✅ Client READY');
    });

    client.on('remote_session_saved', () => {
        console.log('✅ Session SAVED to MongoDB');
    });

    client.on('disconnected', () => {
        isReady = false;
    });

    client.initialize();

    // Routes
    app.get('/', (req, res) => {
        res.send(`<html><head><title>WhatsApp Bot</title></head>
        <body style="text-align:center;font-family:Arial;padding:20px;">
            <h1>📱 WhatsApp Bot</h1>
            <div id="status"></div><div id="qr"></div>
            <script>
                fetch('/status').then(r=>r.json()).then(data=>{
                    if(data.ready) document.getElementById('status').innerHTML='<h2 style="color:green">✅ Bot READY</h2>';
                    else if(data.qr) document.getElementById('qr').innerHTML='<img src="'+data.qr+'" width="300"><p>Scan with WhatsApp</p>';
                });
            </script>
        </body></html>`);
    });

    app.get('/qr-page', async (req, res) => {
        if (qrCodeImage && !isReady) {
            res.send(`<html><body style="text-align:center;"><img src="${qrCodeImage}" width="300"><p>Scan with WhatsApp</p></body></html>`);
        } else {
            res.send('<h1>✅ Already Connected!</h1>');
        }
    });

    app.get('/status', async (req, res) => {
        let qr = null;
        if (qrCodeData && !isReady) qr = await qrcode.toDataURL(qrCodeData).catch(() => null);
        res.json({ ready: isReady, qr });
    });

    app.post('/send', async (req, res) => {
        if (!isReady) return res.status(503).json({ error: 'Bot not ready' });
        const { number, message } = req.body;
        try {
            await client.sendMessage(`${number}@c.us`, message);
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.listen(PORT, () => console.log(`✅ Bot running on port ${PORT}`));
}).catch(err => console.error('❌ MongoDB connection failed:', err));
