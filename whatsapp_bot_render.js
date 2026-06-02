const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let qrCodeData = null;
let isReady = false;
let qrCodeImage = null;

// ✅ Session path with unique ID for your bot
const sessionPath = './whatsapp_session';
const clientId = 'lsk-clinic-permanent';  // 🔑 FIXED ID - very important!

// ⚠️ One-time cleanup: Delete old corrupted session
if (process.env.CLEAN_SESSION === 'true') {
    if (fs.existsSync(sessionPath)) {
        fs.rmSync(sessionPath, { recursive: true, force: true });
        console.log('🧹 Session cleaned - will need fresh QR scan');
    }
}

// ✅ Fixed Client Configuration
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: sessionPath,
        clientId: clientId  // 🔑 Same ID every time - session persists!
    }),
    puppeteer: {
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--single-process',  // ✅ Critical for Render free tier
            '--disable-gpu',
            '--disable-extensions',
            '--no-zygote'
        ],
        headless: true
    }
});

// ✅ Event Handlers
client.on('authenticated', () => {
    console.log('✅ Client AUTHENTICATED - Session saved permanently');
    isReady = true;
    qrCodeData = null;
    qrCodeImage = null;
});

client.on('ready', () => {
    console.log('✅ Client READY - Bot is online! Session restored from disk');
    isReady = true;
    qrCodeData = null;
    qrCodeImage = null;
});

client.on('auth_failure', (msg) => {
    console.error('❌ Auth failure:', msg);
    isReady = false;
});

client.on('qr', async (qr) => {
    console.log('🔄 New QR Code generated (first time only)');
    qrCodeData = qr;
    try {
        qrCodeImage = await qrcode.toDataURL(qr);
    } catch (err) {
        console.error('QR generation error:', err);
    }
});

client.on('disconnected', (reason) => {
    console.log('⚠️ Client disconnected:', reason);
    isReady = false;
    qrCodeData = null;
});

client.on('loading_screen', (percent, message) => {
    console.log(`⏳ Loading: ${percent}% - ${message}`);
});

// Initialize
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
            <head><title>Scan QR</title>
            <meta http-equiv="refresh" content="5">
            </head>
            <body style="text-align:center;font-family:Arial;padding:20px;">
                <h1>📱 Scan with WhatsApp</h1>
                <img src="${qrCodeImage}" width="300">
                <p>Open WhatsApp → Settings → Linked Devices → Link a Device</p>
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
        res.send('<h1>✅ Already Connected!</h1><p>Bot is ready. Session saved permanently.</p><a href="/">Home</a>');
    } else {
        res.send('<h1>⏳ Loading...</h1><p>Initializing, please wait.</p><meta http-equiv="refresh" content="3">');
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
    
    if (!isReady) {
        return res.status(503).json({ error: 'Bot not ready. Please scan QR code first.' });
    }
    
    if (!number || !message) {
        return res.status(400).json({ error: 'Missing "number" or "message"' });
    }
    
    try {
        let formattedNumber = number;
        if (!formattedNumber.includes('@c.us')) {
            formattedNumber = `${formattedNumber}@c.us`;
        }
        await client.sendMessage(formattedNumber, message);
        console.log(`✅ Message sent to ${number}`);
        res.json({ success: true, message: 'Sent!' });
    } catch (error) {
        console.error(`❌ Send failed: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

// ✅ Keep alive every 45 seconds
setInterval(() => {
    if (isReady) {
        console.log('💓 Bot is alive - session active');
    }
}, 45000);

app.listen(PORT, () => {
    console.log(`✅ WhatsApp Bot running on port ${PORT}`);
    console.log(`📱 QR Page: https://whatsapp-bott-iu4h.onrender.com/qr-page`);
    console.log(`🔑 Client ID: ${clientId} - Session will persist after first scan`);
});
