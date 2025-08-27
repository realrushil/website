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
  <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js"></script>
  <script>
    // Scene setup
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x1a1611);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    
    // Improve color rendering
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    document.getElementById('three-container').appendChild(renderer.domElement);

    // Dynamic lighting based on time of day
    function getTimeBasedLighting() {
      const now = new Date();
      const hour = now.getHours();
      
      // Define lighting scenarios
      let ambientColor, ambientIntensity, sunColor, sunIntensity, sunPosition;
      
      if (hour >= 6 && hour < 8) {
        // Early morning - soft golden light
        ambientColor = 0xffffff;
        ambientIntensity = 0.3;
        sunColor = 0xffd4a6;
        sunIntensity = 0.7;
        sunPosition = [8, 4, 8];
      } else if (hour >= 8 && hour < 12) {
        // Morning - bright white light
        ambientColor = 0xffffff;
        ambientIntensity = 0.4;
        sunColor = 0xffffff;
        sunIntensity = 0.9;
        sunPosition = [6, 10, 6];
      } else if (hour >= 12 && hour < 17) {
        // Afternoon - bright neutral light
        ambientColor = 0xffffff;
        ambientIntensity = 0.5;
        sunColor = 0xffffff;
        sunIntensity = 1.0;
        sunPosition = [4, 12, 4];
      } else if (hour >= 17 && hour < 19) {
        // Late afternoon - warm light
        ambientColor = 0xffffff;
        ambientIntensity = 0.4;
        sunColor = 0xffcc99;
        sunIntensity = 0.8;
        sunPosition = [8, 6, 8];
      } else if (hour >= 19 && hour < 21) {
        // Evening - golden hour
        ambientColor = 0xffffff;
        ambientIntensity = 0.3;
        sunColor = 0xff9966;
        sunIntensity = 0.6;
        sunPosition = [10, 3, 10];
      } else {
        // Night - warm indoor lighting
        ambientColor = 0xffffff;
        ambientIntensity = 0.2;
        sunColor = 0xffaa66;
        sunIntensity = 0.4;
        sunPosition = [5, 8, 5];
      }
      
      return { ambientColor, ambientIntensity, sunColor, sunIntensity, sunPosition };
    }
    
    // Set up lighting
    const lighting = getTimeBasedLighting();
    
    // Update background color based on time
    const hour = new Date().getHours();
    let backgroundColor;
    if (hour >= 6 && hour < 19) {
      backgroundColor = 0x2a2520; // Lighter brown for daytime
    } else {
      backgroundColor = 0x1a1611; // Darker brown for evening/night
    }
    renderer.setClearColor(backgroundColor);
    
    const ambientLight = new THREE.AmbientLight(lighting.ambientColor, lighting.ambientIntensity);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(lighting.sunColor, lighting.sunIntensity);
    directionalLight.position.set(...lighting.sunPosition);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 0.1;
    directionalLight.shadow.camera.far = 50;
    directionalLight.shadow.camera.left = -15;
    directionalLight.shadow.camera.right = 15;
    directionalLight.shadow.camera.top = 15;
    directionalLight.shadow.camera.bottom = -15;
    scene.add(directionalLight);
    
    // Add a subtle fill light to brighten shadows and preserve colors
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.2);
    fillLight.position.set(-5, 5, -5);
    scene.add(fillLight);

    // Load GLB assets
    const loader = new THREE.GLTFLoader();
    let bookStackModel = null;
    let libraryTableModel = null;
    
    function loadBookStack() {
      return new Promise((resolve, reject) => {
        loader.load(
          '/assets/book_stack.glb',
          function (gltf) {
            bookStackModel = gltf.scene;
            
            // Enable shadows for all meshes in the model
            bookStackModel.traverse(function (child) {
              if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
              }
            });
            
            console.log('Book stack model loaded successfully');
            resolve(bookStackModel);
          },
          function (progress) {
            console.log('Loading progress:', (progress.loaded / progress.total * 100) + '%');
          },
          function (error) {
            console.error('Error loading book stack model:', error);
            reject(error);
          }
        );
      });
    }
    
    function loadLibraryTable() {
      return new Promise((resolve, reject) => {
        loader.load(
          '/assets/library_table_with_studio_lights.glb',
          function (gltf) {
            libraryTableModel = gltf.scene;
            
            // Enable shadows for all meshes in the model
            libraryTableModel.traverse(function (child) {
              if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
              }
            });
            
            console.log('Library table model loaded successfully');
            resolve(libraryTableModel);
          },
          function (progress) {
            console.log('Loading table progress:', (progress.loaded / progress.total * 100) + '%');
          },
          function (error) {
            console.error('Error loading library table model:', error);
            reject(error);
          }
        );
      });
    }

    function createBookshelf(x, side) {
      const shelf = new THREE.Group();
      
      // Add book stack model if loaded (no shelf base needed)
      if (bookStackModel) {
        const bookStack = bookStackModel.clone();
        
        // Scale and position the book stack appropriately
        bookStack.scale.set(0.8, 0.8, 0.8); // Adjust scale as needed
        bookStack.position.set(x, -1.2, 0); // Position on ground level with table
        
        // Add slight random rotation for variation
        bookStack.rotation.y = (Math.random() - 0.5) * 0.3;
        
        shelf.add(bookStack);
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

    // Library table will be loaded from GLB asset instead of manual creation

    // Initialize scene and load assets
    async function initScene() {
      try {
        // Load both assets simultaneously
        await Promise.all([
          loadBookStack(),
          loadLibraryTable()
        ]);
        
        // Add library table
        if (libraryTableModel) {
          const table = libraryTableModel.clone();
          // Position and scale the table appropriately
          table.scale.set(0.8, 0.8, 0.8); // Scale down to fit scene better
          table.position.set(0, -2, 0); // Position lower and centered between book stacks
          scene.add(table);
        }
        
        // Add bookshelves with loaded book models
        const leftShelf = createBookshelf(-3, 'left');
        const rightShelf = createBookshelf(3, 'right');
        scene.add(leftShelf);
        scene.add(rightShelf);

        // Laptop temporarily removed for cleaner evaluation of assets
        // const laptop = createLaptop();
        // scene.add(laptop);

        // Hide loading and keep overlay hidden for now
        document.querySelector('.loading').style.display = 'none';
        document.getElementById('odometer-overlay').style.display = 'none';
        
        console.log('Scene initialized successfully');
      } catch (error) {
        console.error('Error initializing scene:', error);
        // Fall back to showing the scene without models
        document.querySelector('.loading').style.display = 'none';
        document.getElementById('odometer-overlay').style.display = 'none';
      }
    }

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

    // Initialize scene and start animation
    initScene();
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
