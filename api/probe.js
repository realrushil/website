// Vercel serverless function to handle Arduino probe data
import { kv } from '@vercel/kv';

// Rate limiting helper
const rateLimit = new Map();

function checkRateLimit(ip, maxRequests = 10, windowMs = 60000) {
  const now = Date.now();
  const windowStart = now - windowMs;
  
  if (!rateLimit.has(ip)) {
    rateLimit.set(ip, []);
  }
  
  const requests = rateLimit.get(ip);
  const validRequests = requests.filter(time => time > windowStart);
  
  if (validRequests.length >= maxRequests) {
    return false;
  }
  
  validRequests.push(now);
  rateLimit.set(ip, validRequests);
  
  // Clean up old entries
  setTimeout(() => {
    for (const [key, times] of rateLimit.entries()) {
      const valid = times.filter(time => time > Date.now() - windowMs);
      if (valid.length === 0) {
        rateLimit.delete(key);
      } else {
        rateLimit.set(key, valid);
      }
    }
  }, windowMs);
  
  return true;
}

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      error: 'Method not allowed',
      message: 'Only POST requests are accepted'
    });
  }
  
  try {
    // Rate limiting
    const clientIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
    if (!checkRateLimit(clientIP)) {
      return res.status(429).json({ 
        error: 'Too many requests',
        message: 'Rate limit exceeded. Max 10 requests per minute.'
      });
    }
    
    const data = req.body;
    
    // Validate incoming data structure
    if (!data.device_id || !data.timestamp || !data.data) {
      return res.status(400).json({ 
        error: 'Invalid data format',
        message: 'Required fields: device_id, timestamp, data'
      });
    }
    
    // Add server timestamp
    const serverTimestamp = new Date().toISOString();
    const enrichedData = {
      ...data,
      server_timestamp: serverTimestamp,
      received_at: Date.now(),
      client_ip: clientIP
    };
    
    try {
      // Store in Vercel KV (Redis-compatible storage)
      await kv.set('probe:latest', enrichedData);
      
      // Add to history (keep last 50 for performance)
      const historyKey = 'probe:history';
      const history = await kv.lrange(historyKey, 0, 48) || [];
      await kv.lpush(historyKey, JSON.stringify(enrichedData));
      await kv.ltrim(historyKey, 0, 49); // Keep only last 50
      
      // Update stats
      const stats = await kv.get('probe:stats') || {
        totalRequests: 0,
        deviceInfo: {}
      };
      
      stats.totalRequests++;
      stats.lastUpdate = serverTimestamp;
      stats.deviceInfo[data.device_id] = {
        lastSeen: serverTimestamp,
        lastData: data.data
      };
      
      await kv.set('probe:stats', stats);
      
      console.log(`[${serverTimestamp}] Received data from ${data.device_id}`);
      console.log('Data:', JSON.stringify(data.data, null, 2));
      
    } catch (kvError) {
      console.error('KV storage error:', kvError);
      // Continue without storage for now
    }
    
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
}
