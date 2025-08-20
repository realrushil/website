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

// Escape potentially unsafe characters in SSID strings
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Generate HTML status page
function generateStatusHTML(latest, stats, history) {
  const networks = latest && latest.data ? Object.entries(latest.data) : [];
  const sortedNetworks = networks.sort((a, b) => b[1] - a[1]);
  
  // Format timestamps for display
  const formatTimestamp = (timestamp) => {
    if (!timestamp) return 'N/A';
    
    // Handle both Unix timestamps (seconds) and ISO strings
    let date;
    if (typeof timestamp === 'number') {
      // ESP32 sends Unix timestamp in seconds
      date = new Date(timestamp * 1000);
    } else if (typeof timestamp === 'string') {
      date = new Date(timestamp);
    } else {
      return 'Invalid';
    }
    
    if (isNaN(date.getTime())) return 'Invalid';
    
    // Format in PST timezone
    return date.toLocaleString('en-US', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short'
    });
  };
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Wi‑Fi Networks</title>
  <style>
    :root { --text:#111; --muted:#777; --border:#eee; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #fff;
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    .container { max-width: 720px; margin: 0 auto; padding: 32px 16px; }
    h1 { font-size: 28px; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 24px; }
    h2 { font-size: 18px; font-weight: 600; margin: 0 0 12px; color: var(--text); }
    .card { border: 1px solid var(--border); border-radius: 12px; overflow: hidden; margin-bottom: 24px; }
    .info-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; padding: 16px; background: #fafafa; }
    .info-item { display: flex; flex-direction: column; }
    .info-label { font-size: 12px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
    .info-value { font-size: 14px; font-weight: 500; color: var(--text); font-variant-numeric: tabular-nums; }
    table { width: 100%; border-collapse: collapse; }
    thead th { text-align: left; font-weight: 600; padding: 14px 16px; background: #fafafa; border-bottom: 1px solid var(--border); }
    tbody td { padding: 12px 16px; border-bottom: 1px solid var(--border); }
    tbody tr:last-child td { border-bottom: none; }
    .ssid { max-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .count { text-align: right; font-variant-numeric: tabular-nums; }
    .empty { padding: 32px; text-align: center; color: var(--muted); }
  </style>
  <meta name="robots" content="noindex" />
</head>
<body>
  <main class="container">
    <h1>ESP32 WiFi Probe Monitor</h1>
    
    ${latest ? `
    <div class="card">
      <div class="info-grid">
        <div class="info-item">
          <div class="info-label">Device ID</div>
          <div class="info-value">${escapeHtml(latest.device_id || 'Unknown')}</div>
        </div>
        <div class="info-item">
          <div class="info-label">ESP32 Timestamp</div>
          <div class="info-value">${formatTimestamp(latest.timestamp)}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Server Received</div>
          <div class="info-value">${formatTimestamp(latest.server_timestamp)}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Networks Found</div>
          <div class="info-value">${Object.keys(latest.data || {}).length}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Total Devices</div>
          <div class="info-value">${Object.values(latest.data || {}).reduce((sum, count) => sum + count, 0)}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Time Sync Status</div>
          <div class="info-value">${(() => {
            if (!latest.timestamp || !latest.received_at) return 'Unknown';
            
            const esp32Time = typeof latest.timestamp === 'number' ? latest.timestamp * 1000 : new Date(latest.timestamp).getTime();
            const serverTime = latest.received_at;
            const timeDiff = Math.abs(serverTime - esp32Time) / 1000; // difference in seconds
            
            if (timeDiff < 10) return '✅ Synced';
            else if (timeDiff < 60) return `⚠️ ${Math.round(timeDiff)}s diff`;
            else if (timeDiff < 3600) return `❌ ${Math.round(timeDiff/60)}m diff`;
            else return `❌ ${Math.round(timeDiff/3600)}h diff`;
          })()}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Client IP</div>
          <div class="info-value">${escapeHtml(latest.client_ip || 'Unknown')}</div>
        </div>
      </div>
    </div>
    ` : ''}
    
    <h2>Detected Networks</h2>
    <div class="card">
      ${sortedNetworks.length === 0 ? `
        <div class="empty">No networks detected yet.</div>
      ` : `
        <table>
          <thead>
            <tr>
              <th class="ssid">SSID</th>
              <th class="count" style="width:140px">Devices</th>
            </tr>
          </thead>
          <tbody>
            ${sortedNetworks.map(([ssid, count]) => `
              <tr>
                <td class="ssid">${escapeHtml(ssid)}</td>
                <td class="count">${count}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}
    </div>
  </main>
</body>
</html>`;
  
}
