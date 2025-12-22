
const browserSelect = document.getElementById('browser');
const startBtn = document.getElementById('start-browser');
const browserStatus = document.getElementById('browser-status');
const urlInput = document.getElementById('url');
const validateBtn = document.getElementById('validate-url');
const urlStatus = document.getElementById('url-status');

const downloadType = document.getElementById('download-type');
const downloadBtn = document.getElementById('download-btn');
const outputDiv = document.getElementById('output');

let browserReady = false;
let urlReady = false;

function setStatus(el, ok, msg) {
  el.innerHTML = ok
    ? `<span style='color:green'>&#10003;</span> <span>${msg}</span>`
    : `<span style='color:red'>&#10007;</span> <span>${msg}</span>`;
}



startBtn.addEventListener('click', async () => {
  browserStatus.textContent = 'Checking browser...';
  const browser = browserSelect.value;
  let res = await window.coupaAPI.checkBrowser(browser);
  if (!res.running) {
    browserStatus.textContent = 'No browser found, launching...';
    const launchRes = await window.coupaAPI.launchBrowser(browser);
    // Retry up to 5 times, waiting 1s between each, for up to 5 seconds
    let attempts = 0;
    const maxAttempts = 5;
    const delay = 1000;
    let found = false;
    while (attempts < maxAttempts) {
      await new Promise(r => setTimeout(r, delay));
      res = await window.coupaAPI.checkBrowser(browser);
      if (res.running) {
        found = true;
        break;
      }
      attempts++;
    }
    if (found) {
      setStatus(browserStatus, true, 'Browser ready');
      browserReady = true;
      downloadBtn.disabled = !(browserReady && urlReady);
    } else {
      setStatus(browserStatus, false, 'Failed to launch browser');
      browserReady = false;
      downloadBtn.disabled = true;
    }
  } else {
    setStatus(browserStatus, true, 'Browser ready');
    browserReady = true;
    downloadBtn.disabled = !(browserReady && urlReady);
  }
});

validateBtn.addEventListener('click', async () => {
  urlStatus.textContent = 'Validating URL...';
  const url = urlInput.value.trim();
  if (!url.startsWith('http')) {
    setStatus(urlStatus, false, 'Invalid URL format');
    urlReady = false;
    downloadBtn.disabled = true;
    return;
  }
  const res = await window.coupaAPI.validateUrl(url);
  if (res.valid) {
    setStatus(urlStatus, true, 'URL is valid and connected');
    urlReady = true;
    downloadBtn.disabled = !(browserReady && urlReady);
  } else {
    setStatus(urlStatus, false, 'URL not found in browser tabs');
    urlReady = false;
    downloadBtn.disabled = true;
  }
});

downloadBtn.addEventListener('click', async () => {
  outputDiv.textContent = 'Starting download...';
  const url = urlInput.value.trim();
  const configFile = downloadType.value;
  // Pass both the script and the config file to the backend
  const res = await window.coupaAPI.startDownload(url, 'run_downloads_edge.js', configFile);
  if (res.success) {
    outputDiv.textContent = 'Download complete!\n' + res.output;
  } else {
    outputDiv.textContent = 'Download failed.\n' + res.output;
  }
});
