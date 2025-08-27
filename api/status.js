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
  // Calculate total devices and occupancy level
  const totalDevices = Object.values(latest?.data || {}).reduce((sum, count) => sum + count, 0);
  const estimatedPeople = Math.round(totalDevices * 0.7);
  
  // Assume max capacity of 100 people for percentage calculation
  const maxCapacity = 100;
  const occupancyPercentage = Math.min(100, Math.round((estimatedPeople / maxCapacity) * 100));
  
  // Determine occupancy level and colors based on percentage
  const getOccupancyLevel = (percentage) => {
    if (percentage === 0) return { color: '#8b5cf6', gaugePercentage: 0 };
    if (percentage <= 25) return { color: '#10b981', gaugePercentage: 25 };
    if (percentage <= 50) return { color: '#f59e0b', gaugePercentage: 50 };
    if (percentage <= 75) return { color: '#ef4444', gaugePercentage: 75 };
    return { color: '#dc2626', gaugePercentage: 100 };
  };
  
  const occupancy = getOccupancyLevel(occupancyPercentage);
  
  // Format relative time
  const formatRelativeTime = (timestamp) => {
    if (!timestamp) return 'No data';
    
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
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffSeconds < 60) {
      const seconds = diffSeconds === 1 ? 'second' : 'seconds';
      return `Updated ${diffSeconds} ${seconds} ago`;
    }
    if (diffMinutes < 60) {
      const minutes = diffMinutes === 1 ? 'minute' : 'minutes';
      return `Updated ${diffMinutes} ${minutes} ago`;
    }
    if (diffHours < 24) {
      const hours = diffHours === 1 ? 'hour' : 'hours';
      return `Updated ${diffHours} ${hours} ago`;
    }
    const days = diffDays === 1 ? 'day' : 'days';
    return `Updated ${diffDays} ${days} ago`;
  };
  
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Doe Status</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>D</text></svg>">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: "Georgia", "Times New Roman", serif;
      background: #1a1611;
      color: #f4f1ea;
      height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    
    .meter-container {
      text-align: center;
      position: relative;
    }
    
    .gauge {
      width: 300px;
      height: 300px;
      position: relative;
      margin: 0 auto 30px;
    }
    
    .gauge-bg {
      width: 100%;
      height: 100%;
      border-radius: 50%;
      background: conic-gradient(
        from 135deg,
        #3d3426 0deg,
        #3d3426 270deg,
        transparent 270deg
      );
      position: relative;
      padding: 20px;
    }
    
    .gauge-fill {
      width: 100%;
      height: 100%;
      border-radius: 50%;
      background: conic-gradient(
        from 135deg,
        ${occupancy.color} 0deg,
        ${occupancy.color} ${occupancy.gaugePercentage * 2.7}deg,
        transparent ${occupancy.gaugePercentage * 2.7}deg
      );
      position: relative;
    }
    
    .gauge-inner {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 200px;
      height: 200px;
      background: #1a1611;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
    }
    
    .count {
      font-size: 4rem;
      font-weight: 900;
      color: ${occupancy.color};
      line-height: 1;
      margin-bottom: 5px;
      font-variant-numeric: tabular-nums;
    }
    
    .label {
      font-size: 1rem;
      color: #a08c6b;
      text-transform: lowercase;
      letter-spacing: 0.5px;
      font-weight: 400;
      font-style: italic;
    }
    
    .timestamp {
      font-size: 1.1rem;
      color: #8b7355;
      margin-top: 20px;
      font-weight: 400;
      font-style: italic;
    }
    
    .no-data {
      color: #666;
    }
    
    .no-data .count {
      color: #666;
    }
    
    .no-data .gauge-fill {
      background: conic-gradient(
        from 135deg,
        #3d3426 0deg,
        #3d3426 270deg,
        transparent 270deg
      );
    }
    
    @media (max-width: 480px) {
      .gauge {
        width: 250px;
        height: 250px;
      }
      
      .gauge-inner {
        width: 170px;
        height: 170px;
      }
      
      .count {
        font-size: 3rem;
      }
      
      .label {
        font-size: 0.9rem;
      }
      
      .timestamp {
        font-size: 1rem;
      }
    }
  </style>
  <meta name="robots" content="noindex" />
</head>
<body>
  <div class="meter-container ${!latest ? 'no-data' : ''}">
    <div class="gauge">
      <div class="gauge-bg">
        <div class="gauge-fill">
          <div class="gauge-inner">
            <div class="count">${latest ? occupancyPercentage + '%' : '—'}</div>
            <div class="label">${latest ? 'Capacity' : 'No Data'}</div>
          </div>
        </div>
      </div>
    </div>
    <div class="timestamp">
      ${latest ? formatRelativeTime(latest.server_timestamp) : 'Waiting for sensor data...'}
    </div>
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
  </script>
</body>
</html>`;
}
