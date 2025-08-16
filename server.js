const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// In-memory storage for probe data
let probeData = {
    latest: null,
    history: [],
    stats: {
        totalRequests: 0,
        lastUpdate: null,
        deviceInfo: {}
    }
};

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('.'));

// Rate limiting for probe endpoint
const probeRateLimit = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 10, // Limit each device to 10 requests per minute
    message: { error: 'Too many requests from this device' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Rate limiting for status endpoint
const statusRateLimit = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 60, // Limit to 60 requests per minute for status endpoint
    message: { error: 'Too many status requests' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Serve the main website
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// POST endpoint to receive data from Arduino probe
app.post('/', probeRateLimit, (req, res) => {
    try {
        const data = req.body;
        
        // Validate incoming data structure
        if (!data.device_id || !data.timestamp || !data.data) {
            return res.status(400).json({ 
                error: 'Invalid data format. Required: device_id, timestamp, data' 
            });
        }

        // Add server timestamp
        const serverTimestamp = new Date().toISOString();
        const enrichedData = {
            ...data,
            server_timestamp: serverTimestamp,
            received_at: Date.now()
        };

        // Store latest data
        probeData.latest = enrichedData;
        
        // Add to history (keep last 100 entries)
        probeData.history.unshift(enrichedData);
        if (probeData.history.length > 100) {
            probeData.history = probeData.history.slice(0, 100);
        }

        // Update stats
        probeData.stats.totalRequests++;
        probeData.stats.lastUpdate = serverTimestamp;
        probeData.stats.deviceInfo[data.device_id] = {
            lastSeen: serverTimestamp,
            lastData: data.data
        };

        console.log(`[${serverTimestamp}] Received data from ${data.device_id}`);
        console.log('Data:', JSON.stringify(data.data, null, 2));

        // Respond to Arduino
        res.status(200).json({ 
            status: 'success', 
            message: 'Data received successfully',
            server_timestamp: serverTimestamp
        });

    } catch (error) {
        console.error('Error processing probe data:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            message: error.message 
        });
    }
});

// GET endpoint to display status and data
app.get('/status', statusRateLimit, (req, res) => {
    try {
        const format = req.query.format || 'json';
        
        if (format === 'html') {
            // Return HTML page for browser viewing
            const htmlResponse = generateStatusHTML();
            res.setHeader('Content-Type', 'text/html');
            res.send(htmlResponse);
        } else {
            // Return JSON data
            const responseData = {
                server_info: {
                    uptime: process.uptime(),
                    memory_usage: process.memoryUsage(),
                    timestamp: new Date().toISOString()
                },
                probe_data: probeData,
                endpoints: {
                    main_site: '/',
                    probe_endpoint: '/ (POST)',
                    status_json: '/status',
                    status_html: '/status?format=html'
                }
            };
            
            res.json(responseData);
        }
    } catch (error) {
        console.error('Error generating status:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            message: error.message 
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Generate HTML status page
function generateStatusHTML() {
    const latest = probeData.latest;
    const stats = probeData.stats;
    
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Probe Status - Rushil Saraf</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            margin: 0;
            padding: 20px;
            background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
            color: white;
            min-height: 100vh;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        .header {
            text-align: center;
            margin-bottom: 40px;
        }
        .header h1 {
            font-size: 3rem;
            margin-bottom: 10px;
            text-shadow: 0 0 20px rgba(255,255,255,0.5);
        }
        .status-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .status-card {
            background: rgba(255,255,255,0.1);
            border-radius: 15px;
            padding: 25px;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255,255,255,0.2);
            box-shadow: 0 8px 32px rgba(0,0,0,0.3);
        }
        .status-card h2 {
            margin-top: 0;
            color: #64c8ff;
            font-size: 1.5rem;
        }
        .data-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 15px;
        }
        .data-table th, .data-table td {
            padding: 8px 12px;
            text-align: left;
            border-bottom: 1px solid rgba(255,255,255,0.2);
        }
        .data-table th {
            background: rgba(255,255,255,0.1);
            font-weight: 600;
        }
        .json-data {
            background: rgba(0,0,0,0.3);
            border-radius: 8px;
            padding: 15px;
            font-family: 'Courier New', monospace;
            font-size: 0.9rem;
            overflow-x: auto;
            white-space: pre-wrap;
            word-break: break-word;
        }
        .timestamp {
            color: #a0a0a0;
            font-size: 0.9rem;
        }
        .status-indicator {
            display: inline-block;
            width: 12px;
            height: 12px;
            border-radius: 50%;
            margin-right: 8px;
        }
        .status-online {
            background: #4CAF50;
            box-shadow: 0 0 10px #4CAF50;
        }
        .status-offline {
            background: #f44336;
        }
        .refresh-btn {
            background: rgba(100, 200, 255, 0.2);
            border: 1px solid rgba(100, 200, 255, 0.5);
            color: white;
            padding: 10px 20px;
            border-radius: 25px;
            cursor: pointer;
            font-size: 1rem;
            transition: all 0.3s ease;
        }
        .refresh-btn:hover {
            background: rgba(100, 200, 255, 0.3);
            box-shadow: 0 0 20px rgba(100, 200, 255, 0.5);
        }
        .back-link {
            color: #64c8ff;
            text-decoration: none;
            font-size: 1.1rem;
            margin-top: 20px;
            display: inline-block;
        }
        .back-link:hover {
            text-shadow: 0 0 10px #64c8ff;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Arduino Probe Status</h1>
            <p class="timestamp">Last updated: ${new Date().toISOString()}</p>
            <button class="refresh-btn" onclick="location.reload()">Refresh Data</button>
        </div>

        <div class="status-grid">
            <div class="status-card">
                <h2>
                    <span class="status-indicator ${latest ? 'status-online' : 'status-offline'}"></span>
                    System Status
                </h2>
                <table class="data-table">
                    <tr><td><strong>Status:</strong></td><td>${latest ? 'Online' : 'No Data'}</td></tr>
                    <tr><td><strong>Total Requests:</strong></td><td>${stats.totalRequests}</td></tr>
                    <tr><td><strong>Last Update:</strong></td><td>${stats.lastUpdate || 'Never'}</td></tr>
                    <tr><td><strong>Server Uptime:</strong></td><td>${Math.floor(process.uptime())} seconds</td></tr>
                </table>
            </div>

            ${latest ? `
            <div class="status-card">
                <h2>Latest Probe Data</h2>
                <table class="data-table">
                    <tr><td><strong>Device ID:</strong></td><td>${latest.device_id}</td></tr>
                    <tr><td><strong>Device Time:</strong></td><td>${latest.timestamp}s</td></tr>
                    <tr><td><strong>Received:</strong></td><td>${latest.server_timestamp}</td></tr>
                    <tr><td><strong>Interval:</strong></td><td>${latest.interval_ms}ms</td></tr>
                </table>
            </div>

            <div class="status-card">
                <h2>WiFi Networks Detected</h2>
                <table class="data-table">
                    <thead>
                        <tr><th>SSID</th><th>Unique Devices</th></tr>
                    </thead>
                    <tbody>
                        ${Object.entries(latest.data).map(([ssid, count]) => 
                            `<tr><td>${ssid}</td><td>${count}</td></tr>`
                        ).join('')}
                    </tbody>
                </table>
            </div>
            ` : ''}
        </div>

        ${latest ? `
        <div class="status-card">
            <h2>Raw JSON Data</h2>
            <div class="json-data">${JSON.stringify(latest, null, 2)}</div>
        </div>
        ` : ''}

        <div style="text-align: center; margin-top: 40px;">
            <a href="/" class="back-link">← Back to Main Site</a>
            <br><br>
            <a href="/status" class="back-link">View JSON Data</a>
        </div>
    </div>

    <script>
        // Auto-refresh every 30 seconds
        setTimeout(() => {
            location.reload();
        }, 30000);
    </script>
</body>
</html>`;
}

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ 
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ 
        error: 'Not found',
        message: `Route ${req.method} ${req.path} not found`,
        available_endpoints: ['/', '/status', '/health']
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📱 Main site: http://localhost:${PORT}/`);
    console.log(`📊 Status page: http://localhost:${PORT}/status`);
    console.log(`🔍 Status HTML: http://localhost:${PORT}/status?format=html`);
    console.log(`❤️  Health check: http://localhost:${PORT}/health`);
    console.log(`\n📡 Arduino should POST to: http://localhost:${PORT}/`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM received, shutting down gracefully');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🛑 SIGINT received, shutting down gracefully');
    process.exit(0);
});
