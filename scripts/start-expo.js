#!/usr/bin/env node

/**
 * Start Expo Go using the real Wi-Fi/LAN IPv4.
 * Windows often advertises WSL or VirtualBox host-only adapters, which makes
 * Expo Go fail with: java.io.IOException: Failed to download remote update
 */
const os = require('os');
const { spawn } = require('child_process');
const qrcode = require('qrcode-terminal');

const SKIP = /wsl|vethernet|virtualbox|vbox|vmware|loopback|bluetooth|hyper-v|default switch/i;
const PREFERRED = ['Wi-Fi', 'WiFi', 'WLAN', 'Ethernet', 'Ethernet 2', 'Ethernet 3'];

function pickLanIp() {
  const ifaces = os.networkInterfaces();

  for (const name of PREFERRED) {
    const list = ifaces[name];
    if (!list) continue;
    const v4 = list.find((i) => (i.family === 'IPv4' || i.family === 4) && !i.internal);
    if (v4) return { name, address: v4.address };
  }

  for (const [name, list] of Object.entries(ifaces)) {
    if (SKIP.test(name) || !list) continue;
    const v4 = list.find((i) => (i.family === 'IPv4' || i.family === 4) && !i.internal);
    if (v4) return { name, address: v4.address };
  }

  return null;
}

const forcedHost = (process.env.SAC_PACKAGER_HOST || '').trim();
const lan = forcedHost ? { name: 'phone link', address: forcedHost } : pickLanIp();
const extraArgs = process.argv.slice(2);

// Bluetooth needs a development build, so --dev-client and --go are mutually
// exclusive. Expo Go can open the screens, but it cannot talk to the necklace.
const useDevClient = extraArgs.includes('--dev-client');
const clientFlag = useDevClient ? [] : ['--go'];
const args = ['expo', 'start', ...clientFlag, ...extraArgs];

function appScheme() {
  try {
    const app = require('../app.json');
    const scheme = app.expo && app.expo.scheme;
    return typeof scheme === 'string' ? scheme : null;
  } catch {
    return null;
  }
}

if (lan) {
  process.env.REACT_NATIVE_PACKAGER_HOSTNAME = lan.address;
  const portFlag = extraArgs.indexOf('--port');
  const port = portFlag >= 0 && extraArgs[portFlag + 1] ? extraArgs[portFlag + 1] : '8081';
  const manifest = `http://${lan.address}:${port}`;
  const scheme = appScheme();
  const scanTarget =
    useDevClient && scheme
      ? `${scheme}://expo-development-client/?url=${encodeURIComponent(manifest)}`
      : `exp://${lan.address}:${port}`;
  console.log(`Using LAN address ${lan.address} (${lan.name}).`);
  console.log(`Scan target: ${scanTarget}`);
  console.log('');
  qrcode.generate(scanTarget, { small: true }, (code) => {
    console.log(code);
    console.log('Scan the code above with the app on your phone.');
    const child = spawn('npx', args, {
      stdio: 'inherit',
      env: process.env,
      shell: true,
    });
    child.on('exit', (code) => process.exit(code ?? 0));
  });
} else {
  console.warn('No LAN IPv4 found. Expo may advertise an unreachable address.');
  const child = spawn('npx', args, {
    stdio: 'inherit',
    env: process.env,
    shell: true,
  });
  child.on('exit', (code) => process.exit(code ?? 0));
}
