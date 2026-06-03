const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, makeInMemoryStore } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const P = require('pino');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let qrCodeData = null;
let isReady = false;
let sock = null;

// ✅ In-memory store for Baileys (optional, but good for caching)
const store = makeInMemoryStore({ logger: P({ level: 'silent' }) });

async function startSock() {
    // Session save to 'auth_info' folder (Render will persist this)
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false, // We'll capture QR manually
        logger: P({ level: 'silent' }), // Reduce noise
        browser: ['WhatsApp Bot', 'Chrome', '110.0.0']
    });
    
    store.bind(sock.ev);
    
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('QR Code generated');
            qrCodeData = qr;
            qrcode.toDataURL(qr, (err, url) => {
                if (!err) qrCodeImage = url;
            });
        }
        
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed due to', lastDisconnect?.error, ', reconnecting:', shouldReconnect);
            if (shouldReconnect) {
                startSock();
            } else {
                isReady = false;
                console.log('Logged out, please restart and scan QR again');
            }
        } else if (connection === 'open') {
            console.log('✅ Client READY - Bot is online!');
            isReady = true;
            qrCodeData = null;
        }
    });
    
    sock.ev.on('creds.update', saveCreds);
    
    // Optional: Listen to messages if you want to log
    sock.ev.on('messages.upsert', (m) => {
        console.log('New message received');
    });
}

startSock();

// Keep track of QR image for web display
let qrCodeImage = null;

// ========== Web Routes ==========
app.get('/', (req, res) => {
    res.send(`
        <html>
        <head><title>WhatsApp Bot (Baileys)</title></head>
        <body style="text-align:center;font-family:Arial;padding:20px;">
            <h1>📱 WhatsApp Bot (Lightweight Mode)</h1>
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
                        document.getElementById('qr').innerHTML += '<p>Open WhatsApp → Linked Devices → Link a Device</p>';
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
        res.send('<h1>✅ Already Connected!</h1><p>Bot is ready. Using lightweight Baileys engine.</p><a href="/">Home</a>');
    } else {
        res.send('<h1>⏳ Loading...</h1><p>Initializing, please wait.</p><a href="/qr-page">Refresh</a>');
    }
});

app.get('/status', (req, res) => {
    res.json({ ready: isReady, qr: qrCodeImage });
});

app.post('/send', async (req, res) => {
    const { number, message } = req.body;
    if (!isReady) return res.status(503).json({ error: 'Bot not ready' });
    if (!sock) return res.status(503).json({ error: 'Socket not initialized' });
    
    try {
        // Format number to JID (WhatsApp ID format)
        let jid = number.includes('@s.whatsapp.net') ? number : `${number}@s.whatsapp.net`;
        await sock.sendMessage(jid, { text: message });
        res.json({ success: true, message: 'Sent!' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/send-bulk', async (req, res) => {
    const { numbers, message } = req.body;
    if (!isReady) return res.status(503).json({ error: 'Bot not ready' });
    
    const results = [];
    for (const number of numbers) {
        try {
            let jid = number.includes('@s.whatsapp.net') ? number : `${number}@s.whatsapp.net`;
            await sock.sendMessage(jid, { text: message });
            results.push({ number, status: 'sent' });
        } catch (error) {
            results.push({ number, status: 'failed', error: error.message });
        }
    }
    res.json(results);
});

app.listen(PORT, () => {
    console.log(`✅ WhatsApp Bot (Baileys) running on port ${PORT}`);
    console.log(`📱 QR Page: https://whatsapp-bott-iu4h.onrender.com/qr-page`);
    console.log(`💡 This version is LIGHTWEIGHT and will work on Render free tier!`);
});
