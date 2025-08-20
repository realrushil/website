// Vercel serverless function to handle Arduino probe data
import { createClient } from 'redis';

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
    if (!data.device_id || !data.timestamp) {
      return res.status(400).json({ 
        error: 'Invalid data format',
        message: 'Required fields: device_id, timestamp'
      });
    }
    
    // Extract SSID data from the payload (everything except device_id and timestamp)
    const { device_id, timestamp, ...ssidData } = data;
    
    // Check if we have any SSID data
    if (Object.keys(ssidData).length === 0) {
      return res.status(400).json({ 
        error: 'Invalid data format',
        message: 'No SSID data found in payload'
      });
    }
    
    // Add server timestamp and restructure data for storage
    const serverTimestamp = new Date().toISOString();
    const enrichedData = {
      device_id: data.device_id,
      timestamp: data.timestamp,
      data: ssidData, // Store SSID data in 'data' field for consistency with existing storage
      server_timestamp: serverTimestamp,
      received_at: Date.now(),
      client_ip: clientIP
    };
    
    try {
      // Connect to Redis
      const redis = createClient({
        url: process.env.REDIS_URL
      });
      await redis.connect();
      
      // Store in Redis
      await redis.set('probe:latest', JSON.stringify(enrichedData));
      
      // Add to history (keep last 50 for performance)
      const historyKey = 'probe:history';
      await redis.lpush(historyKey, JSON.stringify(enrichedData));
      await redis.ltrim(historyKey, 0, 49); // Keep only last 50
      
      // Update stats
      const statsRaw = await redis.get('probe:stats');
      const stats = statsRaw ? JSON.parse(statsRaw) : {
        totalRequests: 0,
        deviceInfo: {}
      };
      
      stats.totalRequests++;
      stats.lastUpdate = serverTimestamp;
      stats.deviceInfo[data.device_id] = {
        lastSeen: serverTimestamp,
        lastData: ssidData
      };
      
      await redis.set('probe:stats', JSON.stringify(stats));
      
      console.log(`[${serverTimestamp}] Received data from ${data.device_id}`);
      console.log('Data:', JSON.stringify(ssidData, null, 2));
      
      await redis.disconnect();
      
    } catch (redisError) {
      console.error('Redis storage error:', redisError);
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
