
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
let mainWindow;

// Ensure fetch is available in Node (Node 18+ has global fetch, otherwise use node-fetch)
if (typeof fetch === 'undefined') {
  global.fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, '../../Frontend/frontend/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  mainWindow.loadFile(path.join(__dirname, '../../Frontend/frontend/index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// IPC handlers
const getBrowserPath = (browser) => {
  if (process.platform === 'win32') {
    if (browser === 'edge') return 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    if (browser === 'chrome') return 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  } else if (process.platform === 'darwin') {
    if (browser === 'edge') return '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
    if (browser === 'chrome') return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  }
  return null;
};

ipcMain.handle('check-browser', async (event, browser) => {
  // Try to connect to remote debugging port
  const port = 9222;
  const url = `http://127.0.0.1:${port}/json/version`;
  try {
    const res = await fetch(url);
    if (res.ok) return { running: true };
    return { running: false };
  } catch (err) {
    return { running: false };
  }
});

ipcMain.handle('launch-browser', async (event, browser) => {
  const browserPath = getBrowserPath(browser);
  if (!browserPath) return { success: false, error: 'Browser not found' };

  // Create a temp user data dir for Chrome/Edge
  const os = require('os');
  const fs = require('fs');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coupa-chrome-profile-'));

  const args = [
    '--remote-debugging-port=9222',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${tmpDir}`
  ];
  try {
    const proc = spawn(browserPath, args, { detached: true, stdio: 'ignore' });
    proc.unref();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('validate-url', async (event, url) => {
  // Try to connect to the browser and check if the tab is open
  const port = 9222;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json`);
    const tabs = await res.json();
    const found = tabs.some(tab => tab.url && tab.url.startsWith(url));
    return { valid: found };
  } catch {
    return { valid: false };
  }
});

ipcMain.handle('start-download', async (event, url, script, configFile) => {
  // Run the download script with the given URL, script file, and config file
  const scriptsDir = path.join(__dirname, '../scripts');
  const scriptPath = path.join(scriptsDir, script);
  const jsonPath = path.join(scriptsDir, configFile || 'Download_Invoices.json');
  const node = '/opt/homebrew/bin/node';
  return new Promise((resolve) => {
    const proc = spawn(node, [scriptPath, '--json', jsonPath, '--browserUrl', 'http://127.0.0.1:9222', '--target-url', url], { stdio: 'pipe' });
    let output = '';
    proc.stdout.on('data', (data) => { output += data.toString(); });
    proc.stderr.on('data', (data) => { output += data.toString(); });
    proc.on('close', (code) => {
      resolve({ success: code === 0, output });
    });
  });
});
