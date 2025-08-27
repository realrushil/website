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
      overflow: hidden;
    }
    
    #three-container {
      width: 100vw;
      height: 100vh;
      position: relative;
    }
    
    #odometer-overlay {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      text-align: center;
      z-index: 100;
      pointer-events: none;
      background: rgba(20, 20, 20, 0.9);
      border-radius: 15px;
      padding: 30px;
      border: 2px solid #444;
      width: 300px;
      height: 200px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
    }
    
    .gauge-display {
      width: 200px;
      height: 150px;
      position: relative;
      margin-bottom: 15px;
    }
    
    .gauge-bg {
      width: 100%;
      height: 100%;
      border-radius: 50% 50% 0 0;
      background: conic-gradient(
        from 225deg,
        #3d3426 0deg,
        #3d3426 180deg,
        transparent 180deg
      );
      position: relative;
      padding: 15px;
    }
    
    .gauge-fill {
      width: 100%;
      height: 100%;
      border-radius: 50% 50% 0 0;
      background: conic-gradient(
        from 225deg,
        ${occupancy.color} 0deg,
        ${occupancy.color} ${(occupancy.gaugePercentage / 100) * 180}deg,
        transparent ${(occupancy.gaugePercentage / 100) * 180}deg
      );
      position: relative;
    }
    
    .gauge-inner {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -75%);
      text-align: center;
    }
    
    .count {
      font-size: 2.5rem;
      font-weight: 900;
      color: ${occupancy.color};
      line-height: 1;
      margin-bottom: 5px;
      font-variant-numeric: tabular-nums;
    }
    
    .label {
      font-size: 0.8rem;
      color: #a08c6b;
      text-transform: lowercase;
      letter-spacing: 0.5px;
      font-weight: 400;
      font-style: italic;
    }
    
    .timestamp {
      font-size: 0.7rem;
      color: #8b7355;
      font-weight: 400;
      font-style: italic;
      text-align: center;
    }
    
    .loading {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      color: #8b7355;
      font-style: italic;
      z-index: 50;
    }
  </style>
  <meta name="robots" content="noindex" />
</head>
<body>
  <div id="three-container"></div>
  <div class="loading">Loading library scene...</div>
  
  <div id="odometer-overlay" style="display: none;">
    <div class="gauge-display">
      <div class="gauge-bg">
        <div class="gauge-fill">
          <div class="gauge-inner">
            <div class="count">${latest ? occupancyPercentage + '%' : '—'}</div>
            <div class="label">${latest ? 'capacity' : 'no data'}</div>
          </div>
        </div>
      </div>
    </div>
    <div class="timestamp">
      ${latest ? formatRelativeTime(latest.server_timestamp) : 'Waiting for sensor data...'}
    </div>
  </div>
  
  <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
  <script>
    // Scene setup
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x1a1611);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.getElementById('three-container').appendChild(renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x8b7355, 0.4);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xf4f1ea, 0.8);
    directionalLight.position.set(5, 10, 5);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    scene.add(directionalLight);

    // Create realistic book geometry
    function createBook(width, height, depth, spineColor, coverColor) {
      const book = new THREE.Group();
      
      // Main book body (cover)
      const coverGeometry = new THREE.BoxGeometry(width, height, depth);
      const coverMaterial = new THREE.MeshLambertMaterial({ color: coverColor });
      const cover = new THREE.Mesh(coverGeometry, coverMaterial);
      cover.castShadow = true;
      cover.receiveShadow = true;
      book.add(cover);
      
      // Book spine (slightly different color)
      const spineGeometry = new THREE.BoxGeometry(width * 0.95, height * 0.95, depth * 1.02);
      const spineMaterial = new THREE.MeshLambertMaterial({ color: spineColor });
      const spine = new THREE.Mesh(spineGeometry, spineMaterial);
      spine.position.z = depth * 0.01;
      book.add(spine);
      
      // Pages - visible from the front edge of the book
      const pagesGeometry = new THREE.BoxGeometry(width * 0.85, height * 0.9, depth * 0.92);
      const pagesMaterial = new THREE.MeshLambertMaterial({ color: 0xf8f8f0 }); // Off-white pages
      const pages = new THREE.Mesh(pagesGeometry, pagesMaterial);
      pages.position.set(width * 0.05, 0, 0); // Move pages toward front edge
      pages.castShadow = true;
      pages.receiveShadow = true;
      book.add(pages);
      
      // Page edge visible from the front (right side of book)
      const frontPagesGeometry = new THREE.BoxGeometry(width * 0.03, height * 0.88, depth * 0.9);
      const frontPagesMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff }); // Pure white edge
      const frontPages = new THREE.Mesh(frontPagesGeometry, frontPagesMaterial);
      frontPages.position.set(width * 0.47, 0, 0); // Position at the very front edge
      frontPages.castShadow = true;
      book.add(frontPages);
      
      // Individual page lines for realistic stack effect
      for (let i = 0; i < 3; i++) {
        const lineGeometry = new THREE.BoxGeometry(width * 0.025, height * 0.005, depth * 0.88);
        const lineMaterial = new THREE.MeshLambertMaterial({ 
          color: 0xe8e8e8,
          transparent: true,
          opacity: 0.7
        });
        const line = new THREE.Mesh(lineGeometry, lineMaterial);
        line.position.set(
          width * 0.46, 
          height * (0.3 - i * 0.3), 
          0
        );
        book.add(line);
      }
      
      // Book title area (darker rectangle on spine)
      const titleGeometry = new THREE.BoxGeometry(width * 0.8, height * 0.3, depth * 1.03);
      const titleMaterial = new THREE.MeshLambertMaterial({ 
        color: new THREE.Color(spineColor).multiplyScalar(0.7) 
      });
      const title = new THREE.Mesh(titleGeometry, titleMaterial);
      title.position.y = height * 0.2;
      title.position.z = depth * 0.015;
      book.add(title);
      
      // Add some wear/variation with a subtle overlay
      const wearGeometry = new THREE.BoxGeometry(width * 0.3, height * 0.1, depth * 1.04);
      const wearMaterial = new THREE.MeshLambertMaterial({ 
        color: new THREE.Color(coverColor).multiplyScalar(0.8),
        transparent: true,
        opacity: 0.6
      });
      const wear = new THREE.Mesh(wearGeometry, wearMaterial);
      wear.position.y = -height * 0.3;
      wear.position.x = width * 0.1;
      wear.position.z = depth * 0.02;
      book.add(wear);
      
      return book;
    }

    function createBookshelf(x, side) {
      const shelf = new THREE.Group();
      
      // Shelf base
      const shelfGeometry = new THREE.BoxGeometry(3, 0.2, 1.5);
      const shelfMaterial = new THREE.MeshLambertMaterial({ color: 0x3d2914 });
      const shelfMesh = new THREE.Mesh(shelfGeometry, shelfMaterial);
      shelfMesh.position.set(x, -1, 0);
      shelfMesh.receiveShadow = true;
      shelf.add(shelfMesh);

      // Books on shelf with realistic colors
      const bookData = [
        { spine: 0x8B4513, cover: 0xA0522D }, // Brown
        { spine: 0x2F4F2F, cover: 0x556B2F }, // Dark green
        { spine: 0x8B0000, cover: 0xB22222 }, // Dark red
        { spine: 0x191970, cover: 0x4169E1 }, // Navy blue
        { spine: 0x556B2F, cover: 0x6B8E23 }, // Olive
        { spine: 0x800080, cover: 0x9370DB }, // Purple
        { spine: 0x008B8B, cover: 0x20B2AA }, // Teal
        { spine: 0xB22222, cover: 0xDC143C }  // Crimson
      ];
      
      let bookX = x - 1.3;
      
      for (let i = 0; i < 8; i++) {
        const bookWidth = 0.15 + Math.random() * 0.15;
        const bookHeight = 1.2 + Math.random() * 0.4;
        const bookDepth = 1.0 + Math.random() * 0.4;
        
        const book = createBook(
          bookWidth, 
          bookHeight, 
          bookDepth, 
          bookData[i].spine, 
          bookData[i].cover
        );
        
        book.position.set(bookX + bookWidth/2, -1 + bookHeight/2 + 0.1, 0);
        
        // Add slight random rotation and lean for realism
        book.rotation.z = (Math.random() - 0.5) * 0.1;
        book.rotation.y = (Math.random() - 0.5) * 0.05;
        book.rotation.x = (Math.random() - 0.5) * 0.02;
        
        shelf.add(book);
        bookX += bookWidth + 0.02;
      }

      return shelf;
    }

    // Create laptop
    function createLaptop() {
      const laptop = new THREE.Group();
      
      // Laptop base
      const baseGeometry = new THREE.BoxGeometry(2, 0.1, 1.5);
      const baseMaterial = new THREE.MeshLambertMaterial({ color: 0x2c2c2c });
      const base = new THREE.Mesh(baseGeometry, baseMaterial);
      base.position.set(0, -0.95, 0);
      base.receiveShadow = true;
      laptop.add(base);

      // Laptop screen
      const screenGeometry = new THREE.BoxGeometry(1.8, 1.2, 0.05);
      const screenMaterial = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
      const screen = new THREE.Mesh(screenGeometry, screenMaterial);
      screen.position.set(0, -0.3, -0.7);
      screen.rotation.x = -Math.PI * 0.15;
      screen.receiveShadow = true;
      laptop.add(screen);

      // Screen bezel
      const bezelGeometry = new THREE.BoxGeometry(1.85, 1.25, 0.03);
      const bezelMaterial = new THREE.MeshLambertMaterial({ color: 0x2c2c2c });
      const bezel = new THREE.Mesh(bezelGeometry, bezelMaterial);
      bezel.position.set(0, -0.29, -0.69);
      bezel.rotation.x = -Math.PI * 0.15;
      laptop.add(bezel);

      return laptop;
    }

    // Create desk surface
    const deskGeometry = new THREE.BoxGeometry(12, 0.3, 4);
    const deskMaterial = new THREE.MeshLambertMaterial({ color: 0x3d2914 });
    const desk = new THREE.Mesh(deskGeometry, deskMaterial);
    desk.position.set(0, -1.2, 0);
    desk.receiveShadow = true;
    scene.add(desk);

    // Add bookshelves
    const leftShelf = createBookshelf(-4, 'left');
    const rightShelf = createBookshelf(4, 'right');
    scene.add(leftShelf);
    scene.add(rightShelf);

    // Add laptop
    const laptop = createLaptop();
    scene.add(laptop);

    // Position camera
    camera.position.set(0, 2, 4);
    camera.lookAt(0, 0, 0);

    // Mouse interaction
    let mouseX = 0;
    let mouseY = 0;
    document.addEventListener('mousemove', (event) => {
      mouseX = (event.clientX / window.innerWidth) * 2 - 1;
      mouseY = -(event.clientY / window.innerHeight) * 2 + 1;
    });

    // Animation loop
    function animate() {
      requestAnimationFrame(animate);
      
      // Subtle camera movement based on mouse
      camera.position.x += (mouseX * 0.5 - camera.position.x) * 0.02;
      camera.position.y += (mouseY * 0.3 + 2 - camera.position.y) * 0.02;
      camera.lookAt(0, 0, 0);
      
      renderer.render(scene, camera);
    }

    // Handle window resize
    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // Initialize scene
    document.querySelector('.loading').style.display = 'none';
    document.getElementById('odometer-overlay').style.display = 'flex';
    animate();

    // Auto-refresh functionality
    let autoRefreshInterval = setInterval(() => {
      window.location.reload();
    }, 30000);
    
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
