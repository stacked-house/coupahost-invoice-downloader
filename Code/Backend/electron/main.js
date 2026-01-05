
const { app, BrowserWindow, ipcMain, Menu, powerSaveBlocker } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
let mainWindow;
let currentDownloadProcess = null;
let powerSaveBlockerId = null;

// Determine if we're running in development or packaged mode
const isDev = !app.isPackaged;

// Get the correct paths based on whether we're in dev or packaged mode
function getResourcePath(relativePath) {
  if (isDev) {
    return path.join(__dirname, relativePath);
  } else {
    return path.join(process.resourcesPath, relativePath);
  }
}

// Ensure fetch is available in Node (Node 18+ has global fetch, otherwise use node-fetch)
if (typeof fetch === 'undefined') {
  global.fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
}

function createWindow() {
  // Paths differ between dev and packaged
  const preloadPath = isDev 
    ? path.join(__dirname, '../../Frontend/frontend/preload.js')
    : path.join(process.resourcesPath, 'frontend/preload.js');
  
  const htmlPath = isDev
    ? path.join(__dirname, '../../Frontend/frontend/index.html')
    : path.join(process.resourcesPath, 'frontend/index.html');

  mainWindow = new BrowserWindow({
    width: 990,
    height: 1200,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  mainWindow.loadFile(htmlPath);
  
  // Enable right-click context menu for input fields
  mainWindow.webContents.on('context-menu', (event, params) => {
    const { editFlags } = params;
    const { isEditable } = params;
    
    if (isEditable) {
      const menu = Menu.buildFromTemplate([
        { role: 'cut', enabled: editFlags.canCut },
        { role: 'copy', enabled: editFlags.canCopy },
        { role: 'paste', enabled: editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll', enabled: editFlags.canSelectAll }
      ]);
      menu.popup({ window: mainWindow });
    }
  });
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

ipcMain.handle('start-download', async (event, url, script, configFile, fileTypes) => {
  // Run the download script with the given URL, script file, and config file
  const scriptsDir = isDev 
    ? path.join(__dirname, '../scripts')
    : path.join(process.resourcesPath, 'scripts');
  const scriptPath = path.join(scriptsDir, script);
  const jsonPath = path.join(scriptsDir, configFile || 'Download_Invoices.json');
  
  // Find Node.js - try common paths
  let node = 'node'; // Default to PATH
  if (process.platform === 'darwin') {
    // macOS common paths
    const fs = require('fs');
    const nodePaths = [
      '/opt/homebrew/bin/node',
      '/usr/local/bin/node',
      '/usr/bin/node'
    ];
    for (const p of nodePaths) {
      if (fs.existsSync(p)) {
        node = p;
        break;
      }
    }
  }
  
  // Build file types argument
  const fileTypesArg = fileTypes && fileTypes.length > 0 ? fileTypes.join(',') : 'pdf';
  
  // Set NODE_PATH to include the packaged node_modules
  const nodeModulesPath = isDev
    ? path.join(__dirname, 'node_modules')
    : path.join(process.resourcesPath, 'node_modules');
  
  const env = {
    ...process.env,
    NODE_PATH: nodeModulesPath
  };
  
  // Start preventing system sleep
  if (powerSaveBlockerId === null) {
    powerSaveBlockerId = powerSaveBlocker.start('prevent-display-sleep');
  }
  
  return new Promise((resolve) => {
    const proc = spawn(node, [scriptPath, '--json', jsonPath, '--browserUrl', 'http://127.0.0.1:9222', '--target-url', url, '--file-types', fileTypesArg], { 
      stdio: 'pipe',
      env: env
    });
    currentDownloadProcess = proc;
    
    let output = '';
    
    // Stream stdout to renderer in real-time
    proc.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      // Send to renderer for real-time display
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('download-output', text);
      }
    });
    
    proc.stderr.on('data', (data) => {
      const text = data.toString();
      output += text;
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('download-output', text);
      }
    });
    
    proc.on('close', (code) => {
      currentDownloadProcess = null;
      
      // Stop preventing system sleep
      if (powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId)) {
        powerSaveBlocker.stop(powerSaveBlockerId);
        powerSaveBlockerId = null;
      }
      
      resolve({ success: code === 0, output });
    });
  });
});

ipcMain.handle('stop-download', async () => {
  if (currentDownloadProcess) {
    try {
      currentDownloadProcess.kill('SIGTERM');
      currentDownloadProcess = null;
      
      // Stop preventing system sleep
      if (powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId)) {
        powerSaveBlocker.stop(powerSaveBlockerId);
        powerSaveBlockerId = null;
      }
      
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
  return { success: false, error: 'No download in progress' };
});
