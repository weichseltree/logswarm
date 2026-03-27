/**
 * Permission gate — requests all available device permissions on load
 * so the swarm can ingest local sensor data as streams.
 */

export interface PermissionStatus {
  camera: 'granted' | 'denied' | 'pending';
  microphone: 'granted' | 'denied' | 'pending';
  accelerometer: 'granted' | 'denied' | 'not-supported';
  gyroscope: 'granted' | 'denied' | 'not-supported';
  magnetometer: 'granted' | 'denied' | 'not-supported';
  gamepad: 'granted' | 'not-supported';
  midi: 'granted' | 'denied' | 'not-supported';
}

export async function requestAllPermissions(): Promise<PermissionStatus> {
  const status: PermissionStatus = {
    camera: 'pending',
    microphone: 'pending',
    accelerometer: 'not-supported',
    gyroscope: 'not-supported',
    magnetometer: 'not-supported',
    gamepad: 'not-supported',
    midi: 'not-supported',
  };

  // Camera + Microphone
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    status.camera = 'granted';
    status.microphone = 'granted';
    // Stop tracks immediately — the receiver will reopen later
    for (const track of stream.getTracks()) track.stop();
  } catch {
    // Try video only
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      status.camera = 'granted';
      for (const track of stream.getTracks()) track.stop();
    } catch {
      status.camera = 'denied';
    }
    status.microphone = 'denied';
  }

  // Sensor permissions (non-blocking)
  const sensorChecks = [
    { name: 'accelerometer' as const, permName: 'accelerometer' },
    { name: 'gyroscope' as const, permName: 'gyroscope' },
    { name: 'magnetometer' as const, permName: 'magnetometer' },
  ];

  for (const sensor of sensorChecks) {
    try {
      const result = await navigator.permissions.query({
        name: sensor.permName as PermissionName,
      });
      status[sensor.name] = result.state === 'granted' ? 'granted' : 'denied';
    } catch {
      status[sensor.name] = 'not-supported';
    }
  }

  // Gamepad (no permission needed)
  if (typeof navigator.getGamepads === 'function') {
    status.gamepad = 'granted';
  }

  // MIDI
  if (typeof navigator.requestMIDIAccess === 'function') {
    try {
      await navigator.requestMIDIAccess();
      status.midi = 'granted';
    } catch {
      status.midi = 'denied';
    }
  }

  return status;
}
