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
let sock = null;

async function startSock() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: P({ level: 'silent' })
    });
    
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('🔄 QR Code generated');
            qrCodeData = qr;
            qrcode.toDataURL(qr, (err, url) => {
                if (!err) qrCodeImage = url;
            });
        }
        
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed, reconnecting:', shouldReconnect);
            if (shouldReconnect) startSock();
            else isReady = false;
        } else if (connection === 'open') {
            console.log('✅ Client READY - Bot is online!');
            isReady = true;
            qrCodeData = null;
        }
    });
    
    sock.ev.on('creds.update', saveCreds);
}

startSock();

let qrCodeImage = null;

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
            <head><title>Scan QR</title></head>
            <body style="text-align:center;font-family:Arial;padding:20px;">
                <h1>📱 Scan with WhatsApp</h1>
                <img src="${qrCodeImage}" width="300">
                <p>Open WhatsApp → Settings → Linked Devices → Link a Device</p>
            </body>
            </html>
        `);
    } else if (isReady) {
        res.send('<h1>✅ Already Connected!</h1>');
    } else {
        res.send('<h1>⏳ Loading...</h1>');
    }
});

app.get('/status', (req, res) => {
    res.json({ ready: isReady, qr: qrCodeImage });
});

app.post('/send', async (req, res) => {
    const { number, message } = req.body;
    if (!isReady) return res.status(503).json({ error: 'Bot not ready' });
    
    try {
        let jid = number.includes('@s.whatsapp.net') ? number : `${number}@s.whatsapp.net`;
        await sock.sendMessage(jid, { text: message });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`✅ WhatsApp Bot running on port ${PORT}`);
    console.log(`📱 QR Page: https://whatsapp-bott-iu4h.onrender.com/qr-page`);
});
