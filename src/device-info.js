/**
 * Collects all available device information from the browser environment.
 * Returns a flat object with all sensor data, permissions, and hardware info.
 */
export async function collectDeviceInfo() {
  const info = {
    // ─── Basic browser info ──────────────────────
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    languages: navigator.languages ? [...navigator.languages] : [],
    cookieEnabled: navigator.cookieEnabled,
    onLine: navigator.onLine,
    doNotTrack: navigator.doNotTrack,

    // ─── Screen ──────────────────────────────────
    screenWidth: screen.width,
    screenHeight: screen.height,
    screenAvailWidth: screen.availWidth,
    screenAvailHeight: screen.availHeight,
    colorDepth: screen.colorDepth,
    pixelDepth: screen.pixelDepth,
    devicePixelRatio: window.devicePixelRatio,

    // ─── Viewport ────────────────────────────────
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,

    // ─── Hardware ────────────────────────────────
    hardwareConcurrency: navigator.hardwareConcurrency || 'unknown',
    maxTouchPoints: navigator.maxTouchPoints || 0,
    deviceMemory: navigator.deviceMemory || 'unknown',

    // ─── Connection ──────────────────────────────
    connection: null,

    // ─── Time ────────────────────────────────────
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    timezoneOffset: new Date().getTimezoneOffset(),
    localTime: new Date().toISOString(),

    // ─── Dynamic sensors (populated below) ───────
    geolocation: null,
    battery: null,
    permissions: {},
    mediaDevices: [],
    storageEstimate: null,
    gpu: null,
    deviceOrientation: null,
    ambientLight: null,
    networkInfo: null,
  };

  // ─── Connection info ────────────────────────────
  if (navigator.connection) {
    const conn = navigator.connection;
    info.connection = {
      effectiveType: conn.effectiveType,
      downlink: conn.downlink,
      rtt: conn.rtt,
      saveData: conn.saveData,
      type: conn.type || 'unknown',
    };
  }

  // ─── Geolocation ───────────────────────────────
  info.geolocation = await getGeolocation();

  // ─── Battery ───────────────────────────────────
  info.battery = await getBatteryInfo();

  // ─── Permissions ───────────────────────────────
  info.permissions = await checkPermissions();

  // ─── Media Devices ─────────────────────────────
  info.mediaDevices = await getMediaDevices();

  // ─── Storage ───────────────────────────────────
  info.storageEstimate = await getStorageEstimate();

  // ─── GPU / WebGL ───────────────────────────────
  info.gpu = getGpuInfo();

  return info;
}

async function getGeolocation() {
  if (!navigator.geolocation) return { supported: false };
  try {
    const pos = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        timeout: 5000,
        maximumAge: 60000,
      });
    });
    return {
      supported: true,
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      altitude: pos.coords.altitude,
      accuracy: pos.coords.accuracy,
      altitudeAccuracy: pos.coords.altitudeAccuracy,
      heading: pos.coords.heading,
      speed: pos.coords.speed,
      timestamp: pos.timestamp,
    };
  } catch (err) {
    return { supported: true, error: err.message, code: err.code };
  }
}

async function getBatteryInfo() {
  if (!navigator.getBattery) return { supported: false };
  try {
    const battery = await navigator.getBattery();
    return {
      supported: true,
      charging: battery.charging,
      chargingTime: battery.chargingTime,
      dischargingTime: battery.dischargingTime,
      level: battery.level,
    };
  } catch {
    return { supported: false };
  }
}

async function checkPermissions() {
  const names = [
    'geolocation',
    'notifications',
    'camera',
    'microphone',
    'accelerometer',
    'gyroscope',
    'magnetometer',
    'ambient-light-sensor',
    'clipboard-read',
    'clipboard-write',
  ];
  const results = {};
  for (const name of names) {
    try {
      const status = await navigator.permissions.query({ name });
      results[name] = status.state; // 'granted' | 'denied' | 'prompt'
    } catch {
      results[name] = 'unsupported';
    }
  }
  return results;
}

async function getMediaDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.map((d) => ({
      kind: d.kind,
      label: d.label || `${d.kind} (no label)`,
      deviceId: d.deviceId ? d.deviceId.slice(0, 8) + '...' : 'unknown',
      groupId: d.groupId ? d.groupId.slice(0, 8) + '...' : 'unknown',
    }));
  } catch {
    return [];
  }
}

async function getStorageEstimate() {
  if (!navigator.storage?.estimate) return { supported: false };
  try {
    const est = await navigator.storage.estimate();
    return {
      supported: true,
      quota: est.quota,
      usage: est.usage,
      usagePercent: est.quota ? ((est.usage / est.quota) * 100).toFixed(2) + '%' : 'unknown',
    };
  } catch {
    return { supported: false };
  }
}

function getGpuInfo() {
  try {
    const canvas = document.createElement('canvas');
    const gl =
      canvas.getContext('webgl2') ||
      canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl');
    if (!gl) return { supported: false };
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      supported: true,
      vendor: debugInfo
        ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL)
        : gl.getParameter(gl.VENDOR),
      renderer: debugInfo
        ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER),
      version: gl.getParameter(gl.VERSION),
      shadingVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      maxViewportDims: Array.from(gl.getParameter(gl.MAX_VIEWPORT_DIMS)),
    };
  } catch {
    return { supported: false };
  }
}

/**
 * Subscribes to live sensor updates (orientation, motion, ambient light).
 * Returns a cleanup function.
 */
export function subscribeSensors(callback) {
  const handlers = [];

  // Device orientation
  const orientHandler = (e) => {
    callback('orientation', {
      alpha: e.alpha,
      beta: e.beta,
      gamma: e.gamma,
      absolute: e.absolute,
    });
  };
  window.addEventListener('deviceorientation', orientHandler);
  handlers.push(() => window.removeEventListener('deviceorientation', orientHandler));

  // Device motion (accelerometer + gyroscope)
  const motionHandler = (e) => {
    callback('motion', {
      acceleration: e.acceleration
        ? { x: e.acceleration.x, y: e.acceleration.y, z: e.acceleration.z }
        : null,
      accelerationIncludingGravity: e.accelerationIncludingGravity
        ? {
            x: e.accelerationIncludingGravity.x,
            y: e.accelerationIncludingGravity.y,
            z: e.accelerationIncludingGravity.z,
          }
        : null,
      rotationRate: e.rotationRate
        ? {
            alpha: e.rotationRate.alpha,
            beta: e.rotationRate.beta,
            gamma: e.rotationRate.gamma,
          }
        : null,
      interval: e.interval,
    });
  };
  window.addEventListener('devicemotion', motionHandler);
  handlers.push(() => window.removeEventListener('devicemotion', motionHandler));

  // Ambient light sensor
  if ('AmbientLightSensor' in window) {
    try {
      const sensor = new AmbientLightSensor();
      sensor.addEventListener('reading', () => {
        callback('ambientLight', { illuminance: sensor.illuminance });
      });
      sensor.start();
      handlers.push(() => sensor.stop());
    } catch {
      // Sensor not available
    }
  }

  // Online/offline
  const onlineHandler = () => callback('connectivity', { online: navigator.onLine });
  window.addEventListener('online', onlineHandler);
  window.addEventListener('offline', onlineHandler);
  handlers.push(() => {
    window.removeEventListener('online', onlineHandler);
    window.removeEventListener('offline', onlineHandler);
  });

  return () => handlers.forEach((h) => h());
}
