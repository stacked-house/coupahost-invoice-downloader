#!/usr/bin/env node
/**
 * Coupa Invoice Downloader
 * Downloads invoice PDFs from Coupa using Puppeteer
 * Clean, user-friendly console output
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Parse command line arguments
const args = process.argv.slice(2);
let jsonPath = '';
let browserUrl = 'http://127.0.0.1:9222';
let targetUrl = '';

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
  }
}

if (!jsonPath) {
  console.error('Usage: node run_downloads_edge.js --json <path> --browserUrl <url> --target-url <url>');
  process.exit(1);
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
    try {
      // Re-navigate to list if not there
      const currentUrl = await page.url();
      if (currentUrl !== listUrl) {
        await page.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await sleep(1500);
      }
      
      // Wait for the table to load
      try {
        await page.waitForSelector(`xpath/.//table//tbody//tr//td//a`, { timeout: 15000 });
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
        continue;
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
    
    // Find all PDF links on the detail page
    const pdfXpath = `.//a[contains(@href,'.pdf')]`;
    let pdfLinks = await page.$$(`xpath/${pdfXpath}`);
    let pdfCount = pdfLinks.length;
    
    // If no direct PDF links, try looking for attachment links
    if (pdfCount === 0) {
      const attachXpath = `.//a[contains(@class,'attachment') or contains(text(),'Download') or contains(text(),'PDF')]`;
      pdfLinks = await page.$$(`xpath/${attachXpath}`);
      pdfCount = pdfLinks.length;
    }
    
    if (pdfCount === 0) {
      console.log(`  No attachments found`);
    } else {
      console.log(`  Found ${pdfCount} attachment(s)`);
      
      // Download each PDF
      for (let j = 1; j <= pdfCount; j++) {
        const beforeSnapshot = getDownloadSnapshot();
        
        // Re-query PDF links (in case page state changed)
        const currentPdfXpath = `(${pdfXpath})[${j}]`;
        const currentPdfLinks = await page.$$(`xpath/${currentPdfXpath}`);
        
        if (currentPdfLinks.length === 0) {
          console.log(`  Downloading ${j}/${pdfCount}... ✗ Link not found`);
          continue;
        }
        
        process.stdout.write(`  Downloading ${j}/${pdfCount}... `);
        
        try {
          await currentPdfLinks[0].click();
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
        
        // Navigate back to detail page if there are more PDFs and we left
        const afterUrl = await page.url();
        if (j < pdfCount && afterUrl !== detailUrl) {
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
    
    } catch (loopErr) {
      console.log(`  ✗ Error processing invoice: ${loopErr.message}`);
      // Try to get back to list for next invoice
      try {
        await page.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await sleep(1000);
      } catch (e) {}
      console.log('');
    }
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
