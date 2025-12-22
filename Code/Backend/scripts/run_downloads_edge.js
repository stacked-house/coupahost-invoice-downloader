#!/usr/bin/env node
/**
 * Coupa Invoice Downloader
 * Downloads invoice PDFs from Coupa using Puppeteer
 * Clean, user-friendly console output
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Try to find puppeteer-core - check bundled location first, then normal require
let puppeteer;
try {
  // Check if we're running from a packaged app (Resources folder exists)
  const bundledPath = path.join(__dirname, '..', 'node_modules', 'puppeteer-core');
  if (fs.existsSync(bundledPath)) {
    puppeteer = require(bundledPath);
  } else {
    puppeteer = require('puppeteer-core');
  }
} catch (e) {
  console.error('Error loading puppeteer-core:', e.message);
  process.exit(1);
}

// Parse command line arguments
const args = process.argv.slice(2);
let jsonPath = '';
let browserUrl = 'http://127.0.0.1:9222';
let targetUrl = '';
let fileTypes = ['pdf']; // Default to PDF only

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--json' && args[i + 1]) {
    jsonPath = args[i + 1];
    i++;
  } else if (args[i] === '--browserUrl' && args[i + 1]) {
    browserUrl = args[i + 1];
    i++;
  } else if (args[i] === '--target-url' && args[i + 1]) {
    targetUrl = args[i + 1];
    i++;
  } else if (args[i] === '--file-types' && args[i + 1]) {
    fileTypes = args[i + 1].split(',').map(t => t.trim().toLowerCase());
    i++;
  }
}

if (!jsonPath) {
  console.error('Usage: node run_downloads_edge.js --json <path> --browserUrl <url> --target-url <url> --file-types <types>');
  process.exit(1);
}

/**
 * Build XPath for finding links with selected file types
 */
function buildFileTypeXpath(types) {
  // Build an XPath that matches any of the selected file extensions
  const conditions = types.map(ext => {
    // Handle variations (e.g., xlsx also matches xls)
    if (ext === 'xlsx') {
      return `contains(@href,'.xlsx') or contains(@href,'.xls')`;
    } else if (ext === 'docx') {
      return `contains(@href,'.docx') or contains(@href,'.doc')`;
    } else if (ext === 'jpg') {
      return `contains(@href,'.jpg') or contains(@href,'.jpeg')`;
    } else {
      return `contains(@href,'.${ext}')`;
    }
  });
  
  return `.//a[${conditions.join(' or ')}]`;
}

// Download directory
const downloadDir = path.join(os.homedir(), 'Downloads');

// Track downloaded files (with their folders)
const downloadedFiles = [];

/**
 * Sanitize a string for use as a folder name
 */
function sanitizeFolderName(name) {
  // Remove or replace characters that are invalid in folder names
  return name
    .replace(/[<>:"/\\|?*]/g, '') // Remove invalid characters
    .replace(/\s+/g, ' ')          // Normalize whitespace
    .trim();
}

/**
 * Create invoice folder if it doesn't exist
 */
function ensureInvoiceFolder(invoiceName) {
  const folderName = sanitizeFolderName(invoiceName);
  const folderPath = path.join(downloadDir, folderName);
  
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }
  
  return { folderName, folderPath };
}

/**
 * Move a file from Downloads to the invoice folder
 */
function moveToInvoiceFolder(fileName, invoiceFolderPath) {
  const sourcePath = path.join(downloadDir, fileName);
  const destPath = path.join(invoiceFolderPath, fileName);
  
  try {
    // If file already exists in destination, add a number
    let finalPath = destPath;
    let counter = 1;
    while (fs.existsSync(finalPath)) {
      const ext = path.extname(fileName);
      const base = path.basename(fileName, ext);
      finalPath = path.join(invoiceFolderPath, `${base} (${counter})${ext}`);
      counter++;
    }
    
    fs.renameSync(sourcePath, finalPath);
    return path.basename(finalPath);
  } catch (e) {
    // If move fails, try copy + delete
    try {
      fs.copyFileSync(sourcePath, destPath);
      fs.unlinkSync(sourcePath);
      return fileName;
    } catch (copyErr) {
      return null;
    }
  }
}

/**
 * Get current download directory snapshot
 */
function getDownloadSnapshot() {
  try {
    const files = fs.readdirSync(downloadDir);
    const result = {};
    for (const file of files) {
      const fullPath = path.join(downloadDir, file);
      try {
        const stat = fs.statSync(fullPath);
        result[file] = stat.mtimeMs;
      } catch (e) {}
    }
    return result;
  } catch (e) {
    return {};
  }
}

/**
 * Wait for a new file in download directory
 */
async function waitForNewDownload(beforeSnapshot, timeoutMs = 30000) {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const currentFiles = getDownloadSnapshot();
    
    for (const [file, mtime] of Object.entries(currentFiles)) {
      // Skip temp download files
      if (file.endsWith('.crdownload') || file.endsWith('.tmp') || file.endsWith('.download')) {
        continue;
      }
      
      // New file or modified file
      if (!beforeSnapshot[file] || mtime > beforeSnapshot[file]) {
        // Wait a moment to ensure file is complete
        await new Promise(resolve => setTimeout(resolve, 500));
        return file;
      }
    }
  }
  
  return null;
}

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Main execution
 */
async function main() {
  console.log('Connecting to browser...');
  
  let browser;
  try {
    browser = await puppeteer.connect({
      browserURL: browserUrl,
      defaultViewport: null
    });
  } catch (err) {
    console.log('✗ Failed to connect to browser');
    console.log('  Make sure Edge is running with remote debugging enabled');
    process.exit(1);
  }
  
  // Find the target tab
  const pages = await browser.pages();
  let page = null;
  
  for (const p of pages) {
    const url = await p.url();
    if (targetUrl && (url.startsWith(targetUrl) || url.includes(targetUrl))) {
      page = p;
      break;
    }
    if (!page && url && url !== 'about:blank' && !url.startsWith('chrome://') && !url.startsWith('edge://')) {
      page = p;
    }
  }
  
  if (!page) {
    console.log('✗ No suitable browser tab found');
    console.log('  Please open the Coupa invoice list page first');
    await browser.disconnect();
    process.exit(1);
  }
  
  console.log('Connected! Starting download process...');
  console.log('');
  
  // Store the list URL to return to
  const listUrl = await page.url();
  
  // Find all invoice links on the page
  // Looking for invoice links in a table - first column links
  const invoiceRowXpath = `.//table[contains(@class,'table')]//tbody/tr[.//td[1]//a]`;
  let invoiceRows = await page.$$(`xpath/${invoiceRowXpath}`);
  let invoiceCount = invoiceRows.length;
  
  // If no results with table class, try a more generic approach
  if (invoiceCount === 0) {
    const altXpath = `.//table//tbody//tr[.//td//a]`;
    invoiceRows = await page.$$(`xpath/${altXpath}`);
    invoiceCount = invoiceRows.length;
  }
  
  if (invoiceCount === 0) {
    console.log('✗ No invoices found on this page');
    console.log('  Make sure you are on an invoice list page');
    await browser.disconnect();
    process.exit(1);
  }
  
  console.log(`Found ${invoiceCount} invoice(s) to process`);
  console.log('');
  
  let totalDownloads = 0;
  let processedInvoices = 0;
  
  // Process each invoice
  for (let i = 1; i <= invoiceCount; i++) {
    let retryCount = 0;
    const maxRetries = 2; // Try 3 times total (initial + 2 retries)
    
    while (retryCount <= maxRetries) {
      try {
        // Re-navigate to list if not there
        const currentUrl = await page.url();
        if (currentUrl !== listUrl) {
          await page.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
          await sleep(2000);
        }
        
        // Wait for the table to load
        try {
          await page.waitForSelector(`xpath/.//table//tbody//tr//td//a`, { timeout: 15000 });
          await sleep(500); // Extra wait for page stability
        } catch (e) {
          console.log(`  ✗ Page did not load correctly, retrying...`);
          await page.reload({ waitUntil: 'domcontentloaded' });
          await sleep(2000);
        }
        
        // Get the invoice link (nth link in first column)
        const linkXpath = `(.//table//tbody//tr//td[1]//a)[${i}]`;
        const linkElements = await page.$$(`xpath/${linkXpath}`);
        
        if (linkElements.length === 0) {
          console.log(`Skipping row ${i} - link not found`);
          break; // Exit retry loop
        }
        
        // Get the invoice name/number and href BEFORE clicking (to avoid context issues)
        let linkText = 'Unknown';
        let linkHref = '';
        try {
          const linkInfo = await page.evaluate(el => ({
            text: el.textContent?.trim() || 'Unknown',
          href: el.href || ''
        }), linkElements[0]);
        linkText = linkInfo.text;
        linkHref = linkInfo.href;
      } catch (e) {
        // If we can't get info, try to continue anyway
      }
      
      // Create folder for this invoice
      const { folderName, folderPath } = ensureInvoiceFolder(linkText);
      
      console.log(`Opening invoice ${i}/${invoiceCount}: ${linkText}`);
      console.log(`  📁 Folder: ${folderName}/`);
      
      // Click the invoice link and wait for navigation
      try {
        // Use Promise.all to handle click + navigation together
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {}),
          linkElements[0].click()
        ]);
        await sleep(1500);
      } catch (e) {
        // If click fails, try navigating directly to href
        if (linkHref) {
          try {
            await page.goto(linkHref, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await sleep(1500);
          } catch (navErr) {
            console.log(`  ✗ Failed to open invoice`);
            continue;
          }
        } else {
          console.log(`  ✗ Failed to click invoice link`);
          continue;
        }
      }
      
      // Store the detail page URL
      const detailUrl = await page.url();
    
    // Build XPath for selected file types
    const fileXpath = buildFileTypeXpath(fileTypes);
    let fileLinks = await page.$$(`xpath/${fileXpath}`);
    let fileCount = fileLinks.length;
    
    // If no direct file links, try looking for generic attachment links
    if (fileCount === 0) {
      const attachXpath = `.//a[contains(@class,'attachment') or contains(text(),'Download')]`;
      fileLinks = await page.$$(`xpath/${attachXpath}`);
      fileCount = fileLinks.length;
    }
    
    if (fileCount === 0) {
      console.log(`  No attachments found`);
    } else {
      console.log(`  Found ${fileCount} attachment(s)`);
      
      // Download each file
      for (let j = 1; j <= fileCount; j++) {
        const beforeSnapshot = getDownloadSnapshot();
        
        // Re-query file links (in case page state changed)
        const currentFileXpath = `(${fileXpath})[${j}]`;
        const currentFileLinks = await page.$$(`xpath/${currentFileXpath}`);
        
        if (currentFileLinks.length === 0) {
          console.log(`  Downloading ${j}/${fileCount}... ✗ Link not found`);
          continue;
        }
        
        process.stdout.write(`  Downloading ${j}/${fileCount}... `);
        
        try {
          await currentFileLinks[0].click();
          await sleep(1500);
        } catch (e) {
          console.log(`✗ Click failed`);
          continue;
        }
        
        // Wait for download
        const downloadedFile = await waitForNewDownload(beforeSnapshot, 30000);
        
        if (downloadedFile) {
          // Move file to invoice folder
          const movedFileName = moveToInvoiceFolder(downloadedFile, folderPath);
          if (movedFileName) {
            console.log(`✓ ${movedFileName}`);
            downloadedFiles.push({ folder: folderName, file: movedFileName });
            totalDownloads++;
          } else {
            console.log(`✓ ${downloadedFile} (could not move to folder)`);
            downloadedFiles.push({ folder: 'Downloads', file: downloadedFile });
            totalDownloads++;
          }
        } else {
          console.log(`✗ Download timeout`);
        }
        
        // Navigate back to detail page if there are more files and we left
        const afterUrl = await page.url();
        if (j < fileCount && afterUrl !== detailUrl) {
          await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
          await sleep(800);
        }
      }
    }
    
    processedInvoices++;
    
    // Navigate back to the invoice list for the next iteration
    try {
      await page.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await sleep(500);
    } catch (e) {
      // Will retry at start of next loop
    }
    
    console.log(''); // Empty line between invoices
    
    break; // Success - exit retry loop
    
    } catch (loopErr) {
      retryCount++;
      if (retryCount <= maxRetries) {
        console.log(`  ✗ Error: ${loopErr.message} - Retrying (${retryCount}/${maxRetries})...`);
        // Navigate back to list for retry
        try {
          await page.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
          await sleep(2000);
        } catch (e) {}
      } else {
        console.log(`  ✗ Error processing invoice: ${loopErr.message}`);
        // Try to get back to list for next invoice
        try {
          await page.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
          await sleep(1000);
        } catch (e) {}
        console.log('');
      }
    }
    } // End while retry loop
  }
  
  // Print summary
  console.log('========================================');
  console.log('Download Complete!');
  console.log(`Processed ${processedInvoices} invoice(s)`);
  console.log(`Downloaded ${totalDownloads} file(s)`);
  
  if (downloadedFiles.length > 0) {
    console.log('');
    console.log('Files organized by invoice:');
    
    // Clean up filenames by removing duplicate indicators like (2), (3), etc.
    const cleanFileName = (name) => name.replace(/\s*\(\d+\)(?=\.[^.]+$)/, '');
    
    // Group files by folder
    const folderGroups = {};
    downloadedFiles.forEach(item => {
      if (!folderGroups[item.folder]) {
        folderGroups[item.folder] = [];
      }
      folderGroups[item.folder].push(item.file);
    });
    
    // Display grouped by folder
    for (const [folder, files] of Object.entries(folderGroups)) {
      console.log(`  📁 ${folder}/`);
      files.forEach(file => {
        console.log(`     └─ ${cleanFileName(file)}`);
      });
    }
  }
  
  console.log('========================================');
  
  await browser.disconnect();
}

// Run
main().catch(err => {
  console.error('');
  console.error('✗ Error:', err.message);
  process.exit(1);
});
