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

// MongoDB Connection
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
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--single-process',
                '--disable-gpu'
            ],
            headless: true
        }
    });

    // ✅ CRITICAL: Event Handlers
    client.on('qr', async (qr) => {
        console.log('🔄 QR Code generated');
        qrCodeData = qr;
        qrCodeImage = await qrcode.toDataURL(qr);
    });

    client.on('authenticated', () => {
        console.log('✅ Client AUTHENTICATED - Session saved to MongoDB');
        isReady = true;
    });

    client.on('ready', () => {
        console.log('✅ Client READY - Bot is online!');
        isReady = true;
        qrCodeData = null;
        qrCodeImage = null;
    });

    client.on('remote_session_saved', () => {
        console.log('✅ Session SAVED to MongoDB Atlas - Permanent!');
    });

    client.on('auth_failure', (msg) => {
        console.error('❌ Auth failure:', msg);
        isReady = false;
    });

    client.on('disconnected', (reason) => {
        console.log('⚠️ Client disconnected:', reason);
        isReady = false;
    });

    client.initialize();

    // Routes
    app.get('/', (req, res) => {
        res.send(`
            <html>
            <head><title>WhatsApp Bot</title></head>
            <body style="text-align:center;font-family:Arial;padding:20px;">
                <h1>📱 WhatsApp Bot</h1>
                <div id="status"></div>
                <div id="qr"></div>
                <script>
                    async function checkStatus() {
                        const resp = await fetch('/status');
                        const data = await resp.json();
                        if(data.ready){
                            document.getElementById('status').innerHTML='<h2 style="color:green">✅ Bot is READY!</h2>';
                            document.getElementById('qr').innerHTML='';
                        } else if(data.qr){
                            document.getElementById('status').innerHTML='<h2 style="color:orange">⏳ Scan QR Code</h2>';
                            document.getElementById('qr').innerHTML='<img src="'+data.qr+'" width="300">';
                        } else {
                            document.getElementById('status').innerHTML='<h2>⏳ Initializing...</h2>';
                        }
                    }
                    checkStatus();
                    setInterval(checkStatus, 3000);
                </script>
            </body>
            </html>
        `);
    });

    app.get('/qr-page', async (req, res) => {
        if (qrCodeImage && !isReady) {
            res.send(`
                <html>
                <head><title>Scan QR</title></head>
                <body style="text-align:center;font-family:Arial;padding:20px;">
                    <h1>📱 Scan with WhatsApp</h1>
                    <img src="${qrCodeImage}" width="300">
                    <p>Open WhatsApp → Settings → Linked Devices → Link a Device</p>
                    <p id="status">Status: Waiting for scan...</p>
                    <script>
                        setInterval(()=>{
                            fetch('/status').then(r=>r.json()).then(data=>{
                                if(data.ready) location.reload();
                            });
                        },3000);
                    </script>
                </body>
                </html>
            `);
        } else if (isReady) {
            res.send('<h1>✅ Already Connected!</h1><p>Bot is ready. Session saved in MongoDB permanently.</p><a href="/">Home</a>');
        } else {
            res.send('<h1>⏳ Loading...</h1><p>Initializing, please wait.</p><a href="/qr-page">Refresh</a>');
        }
    });

    app.get('/status', async (req, res) => {
        let qr = null;
        if (qrCodeData && !isReady) {
            qr = await qrcode.toDataURL(qrCodeData).catch(() => null);
        }
        res.json({ ready: isReady, qr: qr });
    });

    app.post('/send', async (req, res) => {
        const { number, message } = req.body;
        if (!isReady) return res.status(503).json({ error: 'Bot not ready' });
        try {
            let formattedNumber = number.includes('@c.us') ? number : `${number}@c.us`;
            await client.sendMessage(formattedNumber, message);
            res.json({ success: true, message: 'Sent!' });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.post('/send-bulk', async (req, res) => {
        const { numbers, message } = req.body;
        if (!isReady) return res.status(503).json({ error: 'Bot not ready' });
        
        const results = [];
        for (const number of numbers) {
            try {
                await client.sendMessage(`${number}@c.us`, message);
                results.push({ number, status: 'sent' });
            } catch (error) {
                results.push({ number, status: 'failed', error: error.message });
            }
        }
        res.json(results);
    });

    // Keep alive every 45 seconds
    setInterval(() => {
        if (isReady) console.log('💓 Bot alive - Session in MongoDB');
    }, 45000);

    app.listen(PORT, () => {
        console.log(`✅ Bot running on port ${PORT}`);
        console.log(`📱 QR Page: https://whatsapp-bott-iu4h.onrender.com/qr-page`);
    });

}).catch(err => {
    console.error('❌ MongoDB connection failed:', err);
    process.exit(1);
});
