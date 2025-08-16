// Vercel serverless function to display probe status
import { createClient } from 'redis';

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'GET') {
    return res.status(405).json({ 
      error: 'Method not allowed',
      message: 'Only GET requests are accepted'
    });
  }
  
  try {
    // Get data from KV storage
    let latest = null;
    let history = [];
    let stats = {
      totalRequests: 0,
      lastUpdate: null,
      deviceInfo: {}
    };
    
    try {
      // Connect to Redis
      const redis = createClient({
        url: process.env.REDIS_URL
      });
      await redis.connect();
      
      const latestRaw = await redis.get('probe:latest');
      latest = latestRaw ? JSON.parse(latestRaw) : null;
      
      const historyRaw = await redis.lrange('probe:history', 0, 49) || [];
      history = historyRaw.map(item => typeof item === 'string' ? JSON.parse(item) : item);
      
      const statsRaw = await redis.get('probe:stats');
      stats = statsRaw ? JSON.parse(statsRaw) : stats;
      
      await redis.disconnect();
    } catch (redisError) {
      console.error('Redis storage error:', redisError);
      // Continue with empty data
    }
    
    const format = req.query.format || 'json';
    
    if (format === 'html') {
      // Return HTML page for browser viewing
      const htmlResponse = generateStatusHTML(latest, stats, history);
      res.setHeader('Content-Type', 'text/html');
      res.send(htmlResponse);
    } else {
      // Return JSON data
      const responseData = {
        server_info: {
          timestamp: new Date().toISOString(),
          platform: 'Vercel Serverless'
        },
        probe_data: {
          latest,
          history,
          stats
        },
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
}

// Generate HTML status page
function generateStatusHTML(latest, stats, history) {
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
            max-height: 400px;
            overflow-y: auto;
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
        .history-list {
            max-height: 300px;
            overflow-y: auto;
            background: rgba(0,0,0,0.2);
            border-radius: 8px;
            padding: 10px;
        }
        .history-item {
            padding: 8px;
            margin-bottom: 8px;
            background: rgba(255,255,255,0.1);
            border-radius: 4px;
            font-size: 0.9rem;
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
                    <tr><td><strong>Platform:</strong></td><td>Vercel Serverless</td></tr>
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
                        ${Object.entries(latest.data || {}).map(([ssid, count]) => 
                            `<tr><td>${ssid}</td><td>${count}</td></tr>`
                        ).join('')}
                    </tbody>
                </table>
            </div>
            ` : ''}

            ${history.length > 0 ? `
            <div class="status-card">
                <h2>Recent History (${history.length} entries)</h2>
                <div class="history-list">
                    ${history.slice(0, 10).map(entry => `
                        <div class="history-item">
                            <strong>${entry.server_timestamp}</strong><br>
                            Device: ${entry.device_id}<br>
                            Networks: ${Object.keys(entry.data || {}).length}
                        </div>
                    `).join('')}
                </div>
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
