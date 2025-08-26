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
  
  // Calculate total devices and occupancy level
  const totalDevices = Object.values(latest?.data || {}).reduce((sum, count) => sum + count, 0);
  const estimatedOccupancy = Math.round(totalDevices * 0.7); // Rough estimate: 70% of devices represent actual people
  
  // Determine occupancy level and colors
  const getOccupancyLevel = (count) => {
    if (count === 0) return { level: 'empty', color: '#94a3b8', label: 'Empty', icon: '🏢' };
    if (count <= 15) return { level: 'low', color: '#22c55e', label: 'Low', icon: '🟢' };
    if (count <= 35) return { level: 'moderate', color: '#f59e0b', label: 'Moderate', icon: '🟡' };
    if (count <= 60) return { level: 'high', color: '#ef4444', label: 'High', icon: '🔴' };
    return { level: 'very-high', color: '#dc2626', label: 'Very High', icon: '⛔' };
  };
  
  const occupancy = getOccupancyLevel(estimatedOccupancy);
  
  // Format timestamps for display
  const formatTimestamp = (timestamp) => {
    if (!timestamp) return 'N/A';
    
    let date;
    if (typeof timestamp === 'number') {
      date = new Date(timestamp * 1000);
    } else if (typeof timestamp === 'string') {
      date = new Date(timestamp);
    } else {
      return 'Invalid';
    }
    
    if (isNaN(date.getTime())) return 'Invalid';
    
    return date.toLocaleString('en-US', {
      timeZone: 'America/Los_Angeles',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short'
    });
  };

  const formatRelativeTime = (timestamp) => {
    if (!timestamp) return 'Unknown';
    
    let date;
    if (typeof timestamp === 'number') {
      date = new Date(timestamp * 1000);
    } else if (typeof timestamp === 'string') {
      date = new Date(timestamp);
    } else {
      return 'Invalid';
    }
    
    if (isNaN(date.getTime())) return 'Invalid';
    
    const now = new Date();
    const diffMs = now - date;
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    
    if (diffSeconds < 60) return `${diffSeconds}s ago`;
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return formatTimestamp(timestamp);
  };
  
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Library Occupancy</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>📚</text></svg>">
  <style>
    :root {
      --bg: #fafafa;
      --surface: #ffffff;
      --text: #1a1a1a;
      --text-muted: #6b7280;
      --border: #e5e7eb;
      --shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1);
      --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
    }
    
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    
    .container {
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
    }
    
    .header {
      text-align: center;
      margin-bottom: 32px;
    }
    
    .header h1 {
      font-size: 2.5rem;
      font-weight: 700;
      margin-bottom: 8px;
      background: linear-gradient(135deg, #1e3a8a, #3b82f6);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    
    .header p {
      color: var(--text-muted);
      font-size: 1.1rem;
    }
    
    .occupancy-card {
      background: var(--surface);
      border-radius: 16px;
      padding: 32px;
      box-shadow: var(--shadow-lg);
      text-align: center;
      margin-bottom: 32px;
      border: 2px solid ${occupancy.color}20;
    }
    
    .occupancy-icon {
      font-size: 3rem;
      margin-bottom: 16px;
      display: block;
    }
    
    .occupancy-count {
      font-size: 4rem;
      font-weight: 800;
      color: ${occupancy.color};
      margin-bottom: 8px;
      font-variant-numeric: tabular-nums;
    }
    
    .occupancy-label {
      font-size: 1.5rem;
      font-weight: 600;
      color: ${occupancy.color};
      margin-bottom: 12px;
    }
    
    .occupancy-subtitle {
      color: var(--text-muted);
      font-size: 1rem;
    }
    
    .occupancy-meter {
      width: 100%;
      height: 12px;
      background: var(--border);
      border-radius: 6px;
      overflow: hidden;
      margin: 20px 0;
    }
    
    .occupancy-fill {
      height: 100%;
      background: linear-gradient(90deg, ${occupancy.color}, ${occupancy.color}bb);
      border-radius: 6px;
      width: ${Math.min(100, (estimatedOccupancy / 80) * 100)}%;
      transition: width 0.5s ease;
    }
    
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-bottom: 32px;
    }
    
    .stat-card {
      background: var(--surface);
      border-radius: 12px;
      padding: 20px;
      box-shadow: var(--shadow);
      text-align: center;
    }
    
    .stat-value {
      font-size: 2rem;
      font-weight: 700;
      color: var(--text);
      margin-bottom: 4px;
      font-variant-numeric: tabular-nums;
    }
    
    .stat-label {
      color: var(--text-muted);
      font-size: 0.9rem;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .networks-section {
      background: var(--surface);
      border-radius: 12px;
      overflow: hidden;
      box-shadow: var(--shadow);
      margin-bottom: 32px;
    }
    
    .section-header {
      padding: 20px;
      border-bottom: 1px solid var(--border);
      background: #f8fafc;
    }
    
    .section-title {
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--text);
      margin: 0;
    }
    
    .networks-table {
      width: 100%;
      border-collapse: collapse;
    }
    
    .networks-table th {
      background: #f8fafc;
      padding: 16px 20px;
      text-align: left;
      font-weight: 600;
      color: var(--text);
      border-bottom: 1px solid var(--border);
    }
    
    .networks-table td {
      padding: 16px 20px;
      border-bottom: 1px solid var(--border);
    }
    
    .networks-table tr:last-child td {
      border-bottom: none;
    }
    
    .networks-table tr:hover {
      background: #f8fafc;
    }
    
    .ssid {
      font-weight: 500;
      max-width: 300px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    
    .device-count {
      text-align: right;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      color: #3b82f6;
    }
    
    .meta-info {
      background: var(--surface);
      border-radius: 12px;
      padding: 20px;
      box-shadow: var(--shadow);
      margin-bottom: 20px;
    }
    
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 16px;
    }
    
    .meta-item {
      display: flex;
      flex-direction: column;
    }
    
    .meta-label {
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }
    
    .meta-value {
      font-size: 0.9rem;
      color: var(--text);
      font-variant-numeric: tabular-nums;
    }
    
    .refresh-button {
      background: #3b82f6;
      color: white;
      border: none;
      padding: 12px 24px;
      border-radius: 8px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      margin: 0 auto;
      display: block;
    }
    
    .refresh-button:hover {
      background: #2563eb;
      transform: translateY(-1px);
    }
    
    .refresh-button:active {
      transform: translateY(0);
    }
    
    .empty-state {
      text-align: center;
      padding: 40px 20px;
      color: var(--text-muted);
    }
    
    .empty-icon {
      font-size: 3rem;
      margin-bottom: 16px;
      opacity: 0.5;
    }
    
    @media (max-width: 640px) {
      .container {
        padding: 16px;
      }
      
      .header h1 {
        font-size: 2rem;
      }
      
      .occupancy-card {
        padding: 24px 20px;
      }
      
      .occupancy-count {
        font-size: 3rem;
      }
      
      .occupancy-label {
        font-size: 1.25rem;
      }
      
      .stat-value {
        font-size: 1.5rem;
      }
      
      .networks-table th,
      .networks-table td {
        padding: 12px 16px;
      }
    }
  </style>
  <meta name="robots" content="noindex" />
</head>
<body>
  <div class="container">
    <header class="header">
      <h1>📚 Library Occupancy</h1>
      <p>Real-time monitoring via WiFi device detection</p>
    </header>
    
    ${latest ? `
    <div class="occupancy-card">
      <div class="occupancy-icon">${occupancy.icon}</div>
      <div class="occupancy-count">${estimatedOccupancy}</div>
      <div class="occupancy-label">${occupancy.label} Occupancy</div>
      <div class="occupancy-subtitle">
        Estimated people currently in the library
      </div>
      <div class="occupancy-meter">
        <div class="occupancy-fill"></div>
      </div>
      <div style="color: var(--text-muted); font-size: 0.9rem;">
        Based on ${totalDevices} detected devices • Updated ${formatRelativeTime(latest.server_timestamp)}
      </div>
    </div>
    
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">${totalDevices}</div>
        <div class="stat-label">Total Devices</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${Object.keys(latest.data || {}).length}</div>
        <div class="stat-label">Networks Found</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${formatRelativeTime(latest.server_timestamp)}</div>
        <div class="stat-label">Last Update</div>
      </div>
    </div>
    ` : `
    <div class="occupancy-card">
      <div class="empty-icon">📡</div>
      <div class="occupancy-count" style="color: var(--text-muted);">—</div>
      <div class="occupancy-label" style="color: var(--text-muted);">No Data</div>
      <div class="occupancy-subtitle">
        Waiting for sensor data...
      </div>
    </div>
    `}
    
    ${sortedNetworks.length > 0 ? `
    <div class="networks-section">
      <div class="section-header">
        <h2 class="section-title">Detected Networks</h2>
      </div>
      <table class="networks-table">
        <thead>
          <tr>
            <th class="ssid">Network Name (SSID)</th>
            <th class="device-count" style="width: 140px;">Devices</th>
          </tr>
        </thead>
        <tbody>
          ${sortedNetworks.map(([ssid, count]) => `
            <tr>
              <td class="ssid">${escapeHtml(ssid)}</td>
              <td class="device-count">${count}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    ` : ''}
    
    ${latest ? `
    <div class="meta-info">
      <div class="meta-grid">
        <div class="meta-item">
          <div class="meta-label">Sensor ID</div>
          <div class="meta-value">${escapeHtml(latest.device_id || 'Unknown')}</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">Sensor Time</div>
          <div class="meta-value">${formatTimestamp(latest.timestamp)}</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">Server Time</div>
          <div class="meta-value">${formatTimestamp(latest.server_timestamp)}</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">Sync Status</div>
          <div class="meta-value">${(() => {
            if (!latest.timestamp || !latest.received_at) return 'Unknown';
            
            const esp32Time = typeof latest.timestamp === 'number' ? latest.timestamp * 1000 : new Date(latest.timestamp).getTime();
            const serverTime = latest.received_at;
            const timeDiff = Math.abs(serverTime - esp32Time) / 1000;
            
            if (timeDiff < 10) return '✅ Synced';
            else if (timeDiff < 60) return `⚠️ ${Math.round(timeDiff)}s off`;
            else return `❌ ${Math.round(timeDiff/60)}m off`;
          })()}</div>
        </div>
      </div>
    </div>
    ` : ''}
    
    <button class="refresh-button" onclick="window.location.reload()">
      🔄 Refresh Data
    </button>
  </div>
  
  <script>
    // Auto-refresh every 30 seconds
    let autoRefreshInterval = setInterval(() => {
      window.location.reload();
    }, 30000);
    
    // Pause auto-refresh when page is not visible
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        clearInterval(autoRefreshInterval);
      } else {
        autoRefreshInterval = setInterval(() => {
          window.location.reload();
        }, 30000);
      }
    });
    
    // Show last refresh time
    console.log('Page loaded at:', new Date().toLocaleTimeString());
  </script>
</body>
</html>`;
}
