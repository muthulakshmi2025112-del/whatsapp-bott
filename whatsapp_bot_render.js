const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let qrCodeData = null;
let isReady = false;
let qrCodeImage = null;

// Single client instance - reuse session
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: './whatsapp_session',
        clientId: 'lsk-clinic-permanent'
    }),
    puppeteer: {
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage'
        ],
        headless: true
    }
});

client.on('authenticated', () => {
    console.log('✅ Client AUTHENTICATED - Session saved');
    isReady = true;
});

client.on('ready', () => {
    console.log('✅ Client READY - Bot is online!');
    isReady = true;
    qrCodeData = null;
    qrCodeImage = null;
});

client.on('auth_failure', (msg) => {
    console.error('❌ Auth failure:', msg);
    isReady = false;
});

client.on('qr', (qr) => {
    console.log('🔄 New QR Code generated');
    qrCodeData = qr;
    qrcode.toDataURL(qr, (err, url) => {
        if (!err) qrCodeImage = url;
    });
});

client.on('disconnected', (reason) => {
    console.log('⚠️ Client disconnected:', reason);
    isReady = false;
    qrCodeData = null;
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
                fetch('/status').then(r=>r.json()).then(data=>{
                    if(data.ready){
                        document.getElementById('status').innerHTML='<h2 style="color:green">✅ Bot is READY!</h2>';
                    } else if(data.qr){
                        document.getElementById('status').innerHTML='<h2>⏳ Scan QR Code</h2>';
                        document.getElementById('qr').innerHTML='<img src="'+data.qr+'" width="300">';
                    }
                });
            </script>
        </body>
        </html>
    `);
});

app.get('/qr-page', async (req, res) => {
    if (qrCodeImage) {
        res.send(`
            <html>
            <head><title>Scan QR</title></head>
            <body style="text-align:center;font-family:Arial;padding:20px;">
                <h1>📱 Scan with WhatsApp</h1>
                <img src="${qrCodeImage}" width="300">
                <p>Open WhatsApp → Settings → Linked Devices → Link a Device</p>
                <p id="status"></p>
                <script>
                    setInterval(()=>{
                        fetch('/status').then(r=>r.json()).then(data=>{
                            if(data.ready) location.href='/qr-page';
                        });
                    },3000);
                </script>
            </body>
            </html>
        `);
    } else if (isReady) {
        res.send('<h1>✅ Already Connected!</h1><p>Bot is ready.</p>');
    } else {
        res.send('<h1>⏳ Loading...</h1>');
    }
});

app.get('/status', async (req, res) => {
    let qr = null;
    if (qrCodeData) {
        qr = await qrcode.toDataURL(qrCodeData);
    }
    res.json({ ready: isReady, qr: qr });
});

app.post('/send', async (req, res) => {
    const { number, message } = req.body;
    if (!isReady) return res.status(503).json({ error: 'Bot not ready' });
    try {
        const formattedNumber = number.includes('@c.us') ? number : `${number}@c.us`;
        await client.sendMessage(formattedNumber, message);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`✅ WhatsApp Bot running on port ${PORT}`);
    console.log(`📱 QR Page: https://whatsapp-bott-iu4h.onrender.com/qr-page`);
});
