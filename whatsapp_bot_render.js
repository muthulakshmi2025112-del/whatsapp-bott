const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

let client = null;
let qrCode = null;
let isReady = false;
let reconnectAttempts = 0;
let status = { ready: false, qr: null, error: null };

// Ensure session directory exists with proper permissions
const sessionDir = './whatsapp_session';
if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
    console.log('Created session directory:', sessionDir);
}

// Function to find Chrome/Chromium executable path
// Function to find Chrome/Chromium executable path for Render
function findChromeExecutable() {
    // Render.com specific paths (in order of preference)
    const possiblePaths = [
        '/opt/google/chrome/chrome',           // Render's Chrome location
        '/usr/bin/google-chrome-stable',        // Standard Linux location
        '/usr/bin/google-chrome',               // Alternative location
        '/usr/bin/chromium-browser',            // Chromium fallback
        '/usr/bin/chromium',                    // Chromium short name
        process.env.PUPPETEER_EXECUTABLE_PATH,  // Environment variable
        process.env.CHROME_PATH,                // Chrome env variable
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' // Local Windows
    ].filter(Boolean); // Remove null/undefined
    
    console.log('🔍 Searching for Chrome in possible locations...');
    
    for (const chromePath of possiblePaths) {
        if (chromePath && fs.existsSync(chromePath)) {
            console.log(`✅ Found Chrome at: ${chromePath}`);
            return chromePath;
        }
    }
    
    // For Render - try to find in /opt/ directory
    try {
        if (fs.existsSync('/opt/google/chrome')) {
            const chromeExe = '/opt/google/chrome/chrome';
            if (fs.existsSync(chromeExe)) {
                console.log(`✅ Found Chrome at: ${chromeExe}`);
                return chromeExe;
            }
        }
    } catch (e) {
        console.log('Error searching /opt:', e.message);
    }
    
    console.log('⚠️ No Chrome found. Chrome must be installed via build process.');
    return null;
}

// Function to save session data periodically
function saveSessionData() {
    if (client && client.info) {
        console.log('Session is active - will persist automatically');
    }
}

// Initialize WhatsApp client with better persistence
function initClient() {
    console.log('Initializing WhatsApp client...');
    
    // Find Chrome executable
    const chromePath = findChromeExecutable();
    
    // Puppeteer arguments for Render compatibility
    const puppeteerArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920x1080',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
        '--disable-blink-features=AutomationControlled',
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ];
    
    const clientConfig = {
        authStrategy: new LocalAuth({
            dataPath: sessionDir,
            clientId: 'dr-lsk-clinic' // Fixed client ID for consistent session
        }),
        puppeteer: {
            headless: true,
            args: puppeteerArgs
        },
        webVersionCache: {
            type: 'remote',
            remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
        },
        restartOnAuthFail: true,
        qrMaxRetries: 3
    };
    
    // Add executable path only if found
    if (chromePath) {
        clientConfig.puppeteer.executablePath = chromePath;
        console.log(`🔧 Using Chrome at: ${chromePath}`);
    } else {
        console.log('🔧 Using puppeteer bundled Chromium (will download on first run)');
    }
    
    client = new Client(clientConfig);

    client.on('qr', (qr) => {
        console.log('🔄 New QR Code generated at:', new Date().toISOString());
        qrCode = qr;
        status.qr = qr;
        status.ready = false;
        status.error = null;
        qrcode.generate(qr, { small: true });
        console.log('✅ QR Code ready for scanning');
    });

    client.on('authenticated', () => {
        console.log('✅ Client AUTHENTICATED at:', new Date().toISOString());
        status.error = null;
        saveSessionData();
    });

    client.on('ready', () => {
        console.log('✅ WhatsApp Client READY at:', new Date().toISOString());
        isReady = true;
        reconnectAttempts = 0;
        status.ready = true;
        status.qr = null;
        status.error = null;
        qrCode = null;
        console.log('🎉 WhatsApp Web is connected and ready to send messages!');
    });

    client.on('auth_failure', (msg) => {
        console.error('❌ Auth failed:', msg);
        isReady = false;
        status.ready = false;
        status.error = msg;
        status.qr = null;
    });

    client.on('disconnected', (reason) => {
        console.log('⚠️ Client disconnected at:', new Date().toISOString());
        console.log('Disconnect reason:', reason);
        isReady = false;
        status.ready = false;
        status.error = `Disconnected: ${reason}`;
        
        // Attempt to reconnect
        reconnectAttempts++;
        if (reconnectAttempts <= 5) {
            console.log(`Attempting to reconnect (${reconnectAttempts}/5) in 10 seconds...`);
            setTimeout(() => {
                console.log('Re-initializing client...');
                qrCode = null;
                initClient();
            }, 10000);
        } else {
            console.error('Max reconnection attempts reached. Manual restart may be needed.');
        }
    });

    client.on('change_state', (state) => {
        console.log('State changed:', state);
        if (state === 'CONNECTED') {
            console.log('✅ Client state: CONNECTED');
            isReady = true;
            status.ready = true;
        } else if (state === 'DISCONNECTED' || state === 'DISCONNECTING') {
            console.log('❌ Client state: DISCONNECTED');
            isReady = false;
            status.ready = false;
        } else if (state === 'CONNECTING') {
            console.log('🔄 Connecting to WhatsApp...');
        }
    });

    client.initialize().catch(err => {
        console.error('Failed to initialize client:', err);
        status.error = err.message;
        // Retry initialization after 5 seconds
        setTimeout(() => {
            console.log('Retrying client initialization...');
            initClient();
        }, 5000);
    });
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        ready: isReady,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        chromeFound: !!findChromeExecutable()
    });
});

// Send bulk messages endpoint
app.post('/api/send-bulk', async (req, res) => {
    const { messages } = req.body;
    
    if (!isReady || !client) {
        return res.json({ 
            success: false, 
            message: 'Bot not ready. Please ensure WhatsApp is connected.',
            ready: false,
            sent: 0,
            failed: 0
        });
    }
    
    const results = [];
    let sent = 0;
    let failed = 0;
    
    for (const msg of messages) {
        try {
            const chatId = `${msg.phone}@c.us`;
            await client.sendMessage(chatId, msg.message);
            sent++;
            results.push({ phone: msg.phone, status: 'sent', name: msg.name });
            console.log(`✅ Sent to ${msg.name} (${msg.phone})`);
            await new Promise(r => setTimeout(r, 2000));
        } catch (error) {
            failed++;
            results.push({ phone: msg.phone, status: 'failed', error: error.message, name: msg.name });
            console.error(`❌ Failed to send to ${msg.name}:`, error.message);
        }
    }
    
    res.json({ 
        success: true, 
        sent: sent, 
        failed: failed, 
        total: messages.length, 
        results: results 
    });
});

// Send endpoint for PHP
app.post('/send', async (req, res) => {
    const { messages } = req.body;
    
    if (!isReady || !client) {
        return res.json({ 
            success: false, 
            message: 'WhatsApp not ready',
            sent: 0, 
            failed: 0 
        });
    }
    
    let sent = 0;
    let failed = 0;
    const details = [];
    
    for (const msg of messages) {
        try {
            const chatId = `${msg.phone}@c.us`;
            await client.sendMessage(chatId, msg.message);
            sent++;
            details.push({ name: msg.name, phone: msg.phone, status: 'sent' });
            console.log(`✅ Sent to ${msg.name} (${msg.phone})`);
        } catch (error) {
            failed++;
            details.push({ name: msg.name, phone: msg.phone, status: 'failed', error: error.message });
            console.error(`❌ Failed to send to ${msg.name}:`, error.message);
        }
        await new Promise(r => setTimeout(r, 2000));
    }
    
    res.json({ sent: sent, failed: failed, total: messages.length, details: details });
});

// Status endpoint
app.get('/status', (req, res) => {
    res.json({
        ready: isReady,
        qr: qrCode,
        error: status.error,
        timestamp: new Date().toISOString(),
        reconnectAttempts: reconnectAttempts
    });
});

// QR endpoint as JSON
app.get('/qr', (req, res) => {
    if (qrCode) {
        res.json({ qr: qrCode, ready: false, message: 'Scan QR code with WhatsApp' });
    } else if (isReady) {
        res.json({ ready: true, message: 'Already connected', qr: null });
    } else {
        res.json({ ready: false, message: 'Waiting for QR code...', qr: null });
    }
});

// QR Code HTML Page
app.get('/qr-page', (req, res) => {
    if (qrCode) {
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>WhatsApp Connection - Dr. LSK Clinic</title>
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    body {
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        min-height: 100vh;
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
                        background: linear-gradient(135deg, #075e54 0%, #128C7E 100%);
                        margin: 0;
                        padding: 20px;
                    }
                    .container {
                        background: white;
                        padding: 30px;
                        border-radius: 24px;
                        text-align: center;
                        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                        max-width: 500px;
                        width: 100%;
                        animation: fadeIn 0.5s ease;
                    }
                    @keyframes fadeIn {
                        from { opacity: 0; transform: translateY(-20px); }
                        to { opacity: 1; transform: translateY(0); }
                    }
                    h2 { color: #075e54; margin-bottom: 5px; }
                    h3 { color: #128C7E; margin-bottom: 20px; font-size: 16px; font-weight: normal; }
                    .qr-box {
                        background: white;
                        padding: 20px;
                        margin: 20px 0;
                        border: 3px solid #25D366;
                        border-radius: 16px;
                        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
                    }
                    img {
                        max-width: 100%;
                        height: auto;
                    }
                    .status {
                        padding: 12px;
                        border-radius: 12px;
                        margin: 15px 0;
                        font-weight: 600;
                        font-size: 14px;
                    }
                    .status-waiting { background: #fff3cd; color: #856404; border-left: 4px solid #ffc107; }
                    .status-connected { background: #d4edda; color: #155724; border-left: 4px solid #28a745; }
                    .status-error { background: #f8d7da; color: #721c24; border-left: 4px solid #dc3545; }
                    .btn {
                        background: #25D366;
                        color: white;
                        border: none;
                        padding: 10px 24px;
                        border-radius: 30px;
                        font-size: 14px;
                        font-weight: 600;
                        cursor: pointer;
                        margin-top: 15px;
                        transition: transform 0.2s, background 0.2s;
                    }
                    .btn:hover {
                        background: #128C7E;
                        transform: translateY(-2px);
                    }
                    .instructions {
                        text-align: left;
                        margin-top: 20px;
                        padding: 15px;
                        background: #f8f9fa;
                        border-radius: 12px;
                    }
                    .instructions h4 {
                        color: #075e54;
                        margin-bottom: 10px;
                        font-size: 14px;
                    }
                    .instructions ol {
                        padding-left: 20px;
                        color: #666;
                        font-size: 13px;
                    }
                    .instructions li {
                        margin: 8px 0;
                    }
                    small { color: #999; font-size: 11px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h2>📱 Dr. LSK Clinic</h2>
                    <h3>WhatsApp Business Bot</h3>
                    
                    <div id="statusDiv" class="status status-waiting">⏳ Loading...</div>
                    
                    <div id="qrContainer" class="qr-box">
                        <img id="qrImage" src="" alt="QR Code">
                        <p style="margin-top: 10px; color: #666; font-size: 12px;">Scan with WhatsApp mobile app</p>
                    </div>
                    
                    <div class="instructions">
                        <h4>📌 How to connect:</h4>
                        <ol>
                            <li>Open <strong>WhatsApp</strong> on your phone</li>
                            <li>Tap <strong>Settings</strong> (Android) or bottom menu (iOS)</li>
                            <li>Tap <strong>Linked Devices</strong></li>
                            <li>Tap <strong>Link a Device</strong></li>
                            <li><strong>Scan this QR code</strong> with your phone</li>
                        </ol>
                    </div>
                    
                    <button class="btn" onclick="location.reload()">⟳ Refresh Page</button>
                    <p style="margin-top: 15px;"><small>Page auto-checks connection every 5 seconds</small></p>
                </div>
                
                <script>
                    let checkCount = 0;
                    
                    async function checkStatus() {
                        try {
                            const response = await fetch('/status');
                            const data = await response.json();
                            const statusDiv = document.getElementById('statusDiv');
                            const qrContainer = document.getElementById('qrContainer');
                            
                            if (data.ready === true) {
                                statusDiv.innerHTML = '✅ CONNECTED! WhatsApp is ready to send messages!';
                                statusDiv.className = 'status status-connected';
                                qrContainer.style.display = 'none';
                                console.log('Bot is ready!');
                            } else if (data.qr) {
                                statusDiv.innerHTML = '⏳ Scan QR code with WhatsApp mobile app';
                                statusDiv.className = 'status status-waiting';
                                qrContainer.style.display = 'block';
                                const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=' + encodeURIComponent(data.qr);
                                document.getElementById('qrImage').src = qrUrl;
                                checkCount++;
                                if (checkCount > 12) {
                                    statusDiv.innerHTML = '⏳ Still waiting for scan. Make sure to scan with WhatsApp on your phone.';
                                }
                            } else if (data.error) {
                                statusDiv.innerHTML = '⚠️ Error: ' + data.error.substring(0, 100);
                                statusDiv.className = 'status status-error';
                            } else {
                                statusDiv.innerHTML = '⏳ Waiting for QR code to generate...';
                                statusDiv.className = 'status status-waiting';
                            }
                        } catch (err) {
                            console.log('Status check error:', err);
                            document.getElementById('statusDiv').innerHTML = '❌ Cannot connect to bot. Make sure server is running.';
                            document.getElementById('statusDiv').className = 'status status-error';
                        }
                    }
                    
                    checkStatus();
                    setInterval(checkStatus, 5000);
                </script>
            </body>
            </html>
        `);
    } else if (isReady) {
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>WhatsApp Connected - Dr. LSK Clinic</title>
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    body {
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        min-height: 100vh;
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
                        background: linear-gradient(135deg, #075e54 0%, #128C7E 100%);
                        margin: 0;
                        padding: 20px;
                    }
                    .container {
                        background: white;
                        padding: 50px;
                        border-radius: 24px;
                        text-align: center;
                        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                        max-width: 500px;
                    }
                    .checkmark {
                        font-size: 80px;
                        color: #28a745;
                        margin-bottom: 20px;
                    }
                    h2 { color: #075e54; margin-bottom: 20px; }
                    p { color: #666; margin-bottom: 30px; line-height: 1.6; }
                    .btn {
                        background: #25D366;
                        color: white;
                        padding: 12px 30px;
                        border: none;
                        border-radius: 30px;
                        font-size: 16px;
                        font-weight: 600;
                        cursor: pointer;
                        text-decoration: none;
                        display: inline-block;
                    }
                    .btn:hover { background: #128C7E; transform: translateY(-2px); }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="checkmark">✅</div>
                    <h2>WhatsApp is Connected!</h2>
                    <p>Your bot is ready to send messages to patients.<br>
                    You can now close this page and use the clinic system.</p>
                    <a href="/status" class="btn">Check Status</a>
                </div>
            </body>
            </html>
        `);
    } else {
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Loading WhatsApp Bot - Dr. LSK Clinic</title>
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="refresh" content="10">
                <style>
                    body {
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        min-height: 100vh;
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
                        background: linear-gradient(135deg, #075e54 0%, #128C7E 100%);
                        margin: 0;
                        padding: 20px;
                    }
                    .container {
                        background: white;
                        padding: 40px;
                        border-radius: 24px;
                        text-align: center;
                        max-width: 400px;
                    }
                    .loader {
                        border: 4px solid #f3f3f3;
                        border-top: 4px solid #25D366;
                        border-radius: 50%;
                        width: 60px;
                        height: 60px;
                        animation: spin 1s linear infinite;
                        margin: 20px auto;
                    }
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                    h2 { color: #075e54; margin-bottom: 10px; }
                    p { color: #666; margin: 15px 0; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h2>🔄 Loading WhatsApp Bot</h2>
                    <div class="loader"></div>
                    <p>Please wait while the bot initializes...</p>
                    <p><small>Page will auto-refresh in 10 seconds</small></p>
                    <p style="margin-top: 10px;"><small>First time setup may take 1-2 minutes</small></p>
                </div>
            </body>
            </html>
        `);
    }
});

app.get('/', (req, res) => {
    res.redirect('/qr-page');
});

// Keep-alive ping to prevent Render from spinning down (for free tier)
setInterval(() => {
    if (isReady) {
        console.log('💓 Keep-alive ping - Bot is ready');
    } else {
        console.log('💓 Keep-alive ping - Bot initializing...');
    }
}, 60000);

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, closing...');
    if (client) {
        client.destroy();
    }
    process.exit(0);
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`========================================`);
    console.log(`✅ WhatsApp Bot API server running`);
    console.log(`📡 Port: ${PORT}`);
    console.log(`📱 QR Page: https://drlsk-wv9j.onrender.com/qr-page`);
    console.log(`========================================`);
    initClient();
});