// DOM Elements
const browserSelect = document.getElementById('browser');
const startBtn = document.getElementById('start-browser');
const browserStatus = document.getElementById('browser-status');
const urlInput = document.getElementById('url');
const validateBtn = document.getElementById('validate-url');
const urlStatus = document.getElementById('url-status');
const downloadType = document.getElementById('download-type');
const downloadBtn = document.getElementById('download-btn');
const stopBtn = document.getElementById('stop-btn');
const refreshBtn = document.getElementById('refresh-btn');
const clearOutputBtn = document.getElementById('clear-output');
const outputDiv = document.getElementById('output');

// State
let browserReady = false;
let urlReady = false;
let isDownloading = false;

// Utility Functions
function setStatusBadge(el, status, msg) {
  el.className = 'status-badge ' + status;
  if (status === 'success') {
    el.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg> ${msg}`;
  } else if (status === 'error') {
    el.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg> ${msg}`;
  } else if (status === 'pending') {
    el.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><circle cx="12" cy="12" r="10"></circle></svg> ${msg}`;
  } else {
    el.innerHTML = '';
  }
}

function appendOutput(text) {
  const timestamp = new Date().toLocaleTimeString();
  outputDiv.textContent += `[${timestamp}] ${text}\n`;
  outputDiv.scrollTop = outputDiv.scrollHeight;
}

function clearOutput() {
  outputDiv.textContent = '';
}

function updateDownloadButtonState() {
  downloadBtn.disabled = !(browserReady && urlReady) || isDownloading;
}

function setDownloadingState(downloading) {
  isDownloading = downloading;
  downloadBtn.disabled = downloading;
  stopBtn.disabled = !downloading;
  
  if (downloading) {
    downloadBtn.innerHTML = `
      <svg class="loading" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"></circle>
      </svg>
      Downloading...
    `;
  } else {
    downloadBtn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="7 10 12 15 17 10"></polyline>
        <line x1="12" y1="15" x2="12" y2="3"></line>
      </svg>
      Start Download
    `;
    updateDownloadButtonState();
  }
}

// Event Listeners
startBtn.addEventListener('click', async () => {
  setStatusBadge(browserStatus, 'pending', 'Checking...');
  startBtn.disabled = true;
  
  const browser = browserSelect.value;
  let res = await window.coupaAPI.checkBrowser(browser);
  
  if (!res.running) {
    setStatusBadge(browserStatus, 'pending', 'Launching...');
    await window.coupaAPI.launchBrowser(browser);
    
    // Retry up to 5 times
    let attempts = 0;
    let found = false;
    while (attempts < 5) {
      await new Promise(r => setTimeout(r, 1000));
      res = await window.coupaAPI.checkBrowser(browser);
      if (res.running) {
        found = true;
        break;
      }
      attempts++;
    }
    
    if (found) {
      setStatusBadge(browserStatus, 'success', 'Connected');
      browserReady = true;
      appendOutput('Browser connected successfully');
    } else {
      setStatusBadge(browserStatus, 'error', 'Failed');
      browserReady = false;
      appendOutput('Failed to connect to browser');
    }
  } else {
    setStatusBadge(browserStatus, 'success', 'Connected');
    browserReady = true;
    appendOutput('Browser already connected');
  }
  
  startBtn.disabled = false;
  updateDownloadButtonState();
});

validateBtn.addEventListener('click', async () => {
  const url = urlInput.value.trim();
  
  if (!url.startsWith('http')) {
    setStatusBadge(urlStatus, 'error', 'Invalid URL');
    urlReady = false;
    updateDownloadButtonState();
    appendOutput('Invalid URL format - must start with http:// or https://');
    return;
  }
  
  setStatusBadge(urlStatus, 'pending', 'Validating...');
  validateBtn.disabled = true;
  
  const res = await window.coupaAPI.validateUrl(url);
  
  if (res.valid) {
    setStatusBadge(urlStatus, 'success', 'Valid');
    urlReady = true;
    appendOutput('URL validated - found matching tab in browser');
  } else {
    setStatusBadge(urlStatus, 'error', 'Not Found');
    urlReady = false;
    appendOutput('URL not found in browser tabs - make sure the page is open');
  }
  
  validateBtn.disabled = false;
  updateDownloadButtonState();
});

downloadBtn.addEventListener('click', async () => {
  setDownloadingState(true);
  clearOutput();
  
  const url = urlInput.value.trim();
  const configFile = downloadType.value;
  
  // Set up real-time output listener
  window.coupaAPI.onDownloadOutput((data) => {
    // Append output directly without timestamp for cleaner look
    outputDiv.textContent += data;
    outputDiv.scrollTop = outputDiv.scrollHeight;
  });
  
  const res = await window.coupaAPI.startDownload(url, 'run_downloads_edge.js', configFile);
  
  // Clean up listener
  window.coupaAPI.removeDownloadOutputListener();
  
  if (!res.success) {
    outputDiv.textContent += '\n\n✗ Process exited with errors\n';
  }
  
  setDownloadingState(false);
});

stopBtn.addEventListener('click', async () => {
  outputDiv.textContent += '\nStopping download...\n';
  const res = await window.coupaAPI.stopDownload();
  if (res.success) {
    outputDiv.textContent += 'Download stopped by user\n';
  }
  window.coupaAPI.removeDownloadOutputListener();
  setDownloadingState(false);
});

refreshBtn.addEventListener('click', async () => {
  // Reset all state
  browserReady = false;
  urlReady = false;
  isDownloading = false;
  
  // Clear all status badges
  setStatusBadge(browserStatus, '', '');
  setStatusBadge(urlStatus, '', '');
  
  // Reset URL input
  urlInput.value = '';
  
  // Reset buttons
  setDownloadingState(false);
  downloadBtn.disabled = true;
  stopBtn.disabled = true;
  
  // Clear console and show ready message
  clearOutput();
  appendOutput('App reset. Ready to download invoices...');
});

clearOutputBtn.addEventListener('click', () => {
  clearOutput();
  appendOutput('Console cleared');
});

// Initialize
appendOutput('Ready to download invoices...');
