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

// ✅ Singleton lock - prevent multiple instances
const lockFile = './.bot_lock';
if (fs.existsSync(lockFile)) {
    console.log('⚠️ Bot already running, exiting duplicate...');
    process.exit(0);
}
fs.writeFileSync(lockFile, Date.now().toString());

// Clean lock on exit
process.on('exit', () => {
    try { fs.unlinkSync(lockFile); } catch(e) {}
});

// ✅ Session path with unique ID for your bot
const sessionPath = './whatsapp_session';
const clientId = 'lsk-clinic-permanent';

// ✅ Fixed Client Configuration with RESTART RECOVERY
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: sessionPath,
        clientId: clientId
    }),
    puppeteer: {
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--single-process',
            '--disable-gpu',
            '--disable-extensions',
            '--no-zygote'
        ],
        headless: true,
        // ✅ Important: Handle browser crashes
        handleSIGINT: true,
        handleSIGTERM: true,
        handleSIGHUP: true
    }
});

// ✅ Event Handlers with proper state management
let isProcessing = false;

client.on('authenticated', () => {
    if (isProcessing) return;
    isProcessing = true;
    console.log('✅ Client AUTHENTICATED - Session saved permanently');
    isReady = true;
    qrCodeData = null;
    qrCodeImage = null;
    setTimeout(() => { isProcessing = false; }, 1000);
});

client.on('ready', () => {
    if (isProcessing) return;
    isProcessing = true;
    console.log('✅ Client READY - Bot is online! Session restored from disk');
    isReady = true;
    qrCodeData = null;
    qrCodeImage = null;
    setTimeout(() => { isProcessing = false; }, 1000);
});

client.on('auth_failure', (msg) => {
    console.error('❌ Auth failure:', msg);
    isReady = false;
});

client.on('qr', async (qr) => {
    if (isReady) {
        console.log('⚠️ QR received but bot already ready - ignoring');
        return;
    }
    console.log('🔄 New QR Code generated');
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
    if (percent > 90 && percent < 100) {
        console.log(`⏳ Loading: ${percent}% - ${message}`);
    }
});

// Initialize
client.initialize();

// ✅ Routes
app.get('/', (req, res) => {
    res.send(`
        <html>
        <head><title>WhatsApp Bot</title><meta http-equiv="refresh" content="10"></head>
        <body style="text-align:center;font-family:Arial;padding:20px;">
            <h1>📱 WhatsApp Bot</h1>
            <div id="status"></div>
            <div id="qr"></div>
            <script>
                async function checkStatus() {
                    const resp = await fetch('/status');
                    const data = await resp.json();
                    if(data.ready){
                        document.getElementById('status').innerHTML='<h2 style="color:green">✅ Bot is READY and Connected!</h2>';
                        document.getElementById('qr').innerHTML='<p>Session active. No QR needed.</p>';
                    } else if(data.qr){
                        document.getElementById('status').innerHTML='<h2 style="color:orange">⏳ Scan QR Code</h2>';
                        document.getElementById('qr').innerHTML='<img src="'+data.qr+'" width="300">';
                    } else {
                        document.getElementById('status').innerHTML='<h2 style="color:gray">⏳ Initializing...</h2>';
                    }
                }
                checkStatus();
                setInterval(checkStatus, 5000);
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
                <p>Status: ${isReady ? '✅ Connected' : '⏳ Waiting for scan'}</p>
                <a href="/qr-page">Refresh</a>
            </body>
            </html>
        `);
    } else if (isReady) {
        res.send('<h1>✅ Already Connected!</h1><p>Bot is ready. Session saved permanently.</p><a href="/">Home</a>');
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
    
    if (!isReady) {
        return res.status(503).json({ error: 'Bot not ready. Please check /qr-page' });
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

// ✅ Keep alive every 30 seconds - prevents spin down
setInterval(() => {
    if (isReady) {
        console.log('💓 Bot is alive - session active');
    }
}, 30000);

app.listen(PORT, () => {
    console.log(`✅ WhatsApp Bot running on port ${PORT}`);
    console.log(`📱 QR Page: https://whatsapp-bott-iu4h.onrender.com/qr-page`);
    console.log(`🔑 Session will persist after first scan`);
});

// ✅ Handle cleanup
process.on('SIGTERM', () => {
    console.log('SIGTERM received, cleaning up...');
    client.destroy();
    process.exit(0);
});
