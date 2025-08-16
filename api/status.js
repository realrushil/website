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
    h1 { font-size: 28px; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 16px; }
    .card { border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
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
    <h1>Detected Wi‑Fi networks</h1>
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
