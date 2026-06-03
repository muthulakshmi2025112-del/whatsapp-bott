const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const P = require('pino');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let qrCodeData = null;
let isReady = false;
let qrCodeImage = null;
let sock = null;
let reconnectAttempts = 0;

async function startSock() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState('auth_info');
        
        sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: P({ level: 'silent' }),
            browser: ['WhatsApp Bot (Render)', 'Chrome', '110.0.0'],
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 10000,
            emitOwnEvents: true
        });
        
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                console.log('🔄 QR Code generated');
                qrCodeData = qr;
                qrcode.toDataURL(qr, (err, url) => {
                    if (!err) qrCodeImage = url;
                });
                reconnectAttempts = 0;
            }
            
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                console.log(`Connection closed (code: ${statusCode}), reconnecting: ${shouldReconnect}`);
                
                if (shouldReconnect && reconnectAttempts < 10) {
                    reconnectAttempts++;
                    setTimeout(startSock, 5000 * reconnectAttempts);
                } else if (statusCode === DisconnectReason.loggedOut) {
                    console.log('Logged out, clearing session...');
                    isReady = false;
                }
            } else if (connection === 'open') {
                console.log('✅ Client READY - Bot is online!');
                isReady = true;
                qrCodeData = null;
                qrCodeImage = null;
                reconnectAttempts = 0;
            }
        });
        
        sock.ev.on('creds.update', saveCreds);
        
    } catch (error) {
        console.error('Error starting socket:', error);
        setTimeout(startSock, 10000);
    }
}

startSock();

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
            <head><title>Scan QR</title>
            <meta http-equiv="refresh" content="10">
            </head>
            <body style="text-align:center;font-family:Arial;padding:20px;">
                <h1>📱 Scan with WhatsApp</h1>
                <img src="${qrCodeImage}" width="300">
                <p>Open WhatsApp → Settings → Linked Devices → Link a Device</p>
                <p id="status">Status: Waiting for scan...</p>
                <script>
                    setInterval(()=>{
                        fetch('/status').then(r=>r.json()).then(data=>{
                            if(data.ready) location.href = '/';
                        });
                    },3000);
                </script>
            </body>
            </html>
        `);
    } else if (isReady) {
        res.send('<h1>✅ Already Connected!</h1><p>Bot is ready to use.</p><a href="/">Home</a>');
    } else {
        res.send('<h1>⏳ Loading...</h1><p>Initializing connection...</p><a href="/qr-page">Refresh</a>');
    }
});

app.get('/status', (req, res) => {
    res.json({ ready: isReady, qr: qrCodeImage });
});

app.post('/send', async (req, res) => {
    const { number, message } = req.body;
    if (!isReady) return res.status(503).json({ error: 'Bot not ready. Please scan QR first.' });
    if (!sock) return res.status(503).json({ error: 'Connection not established.' });
    
    try {
        let jid = number.includes('@s.whatsapp.net') ? number : `${number}@s.whatsapp.net`;
        await sock.sendMessage(jid, { text: message });
        console.log(`✅ Message sent to ${number}`);
        res.json({ success: true, message: 'Sent!' });
    } catch (error) {
        console.error('Send error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Keep-alive ping
setInterval(() => {
    if (isReady) {
        console.log('💓 Bot alive');
    }
}, 30000);

app.listen(PORT, () => {
    console.log(`✅ WhatsApp Bot running on port ${PORT}`);
    console.log(`📱 QR Page: https://whatsapp-bott-iu4h.onrender.com/qr-page`);
});
