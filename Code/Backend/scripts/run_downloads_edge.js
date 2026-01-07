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
    } else if (ext === 'xml') {
      return `contains(@href,'.xml')`;
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
const failedDownloads = [];

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
 * Convert date format to YYYY-MM-DD
 */
function normalizeDate(dateStr) {
  if (!dateStr) return '';
  
  // If already in YYYY-MM-DD format, return as-is
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }
  
  // Convert MM/DD/YYYY to YYYY-MM-DD
  let match = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    const month = String(match[1]).padStart(2, '0');
    const day = String(match[2]).padStart(2, '0');
    const year = match[3];
    return `${year}-${month}-${day}`;
  }
  
  // Convert MM/DD/YY to YYYY-MM-DD (assuming 20YY for 00-99)
  match = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (match) {
    const month = String(match[1]).padStart(2, '0');
    const day = String(match[2]).padStart(2, '0');
    let year = parseInt(match[3], 10);
    // Assume 2000+ for 2-digit years
    year = year < 100 ? 2000 + year : year;
    return `${year}-${month}-${day}`;
  }
  
  return '';
}

/**
 * Create invoice folder if it doesn't exist
 */
function ensureInvoiceFolder(invoiceName, invoiceDate = '') {
  let folderName = sanitizeFolderName(invoiceName);
  
  // If we couldn't extract the invoice name, it will be 'Unknown'
  // In that case, we'll try to use the date or just skip
  if (folderName === 'Unknown' && !invoiceDate) {
    folderName = `Unknown_${Date.now()}`;
  }
  
  // Prepend date if available and not already in the name
  if (invoiceDate && folderName !== 'Unknown') {
    const normalizedDate = normalizeDate(invoiceDate);
    if (normalizedDate && !folderName.startsWith(normalizedDate)) {
      folderName = `${normalizedDate} - ${folderName}`;
    }
  } else if (!invoiceDate && folderName !== 'Unknown') {
    // If no date found, just use invoice name as-is (already sanitized)
  }
  
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
  
  // Force a page reload to ensure we get fresh data (not cached from previous date selections)
  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(1500); // Give the page time to fully render
    await page.waitForSelector('xpath/.//table//tbody//tr//td//a', { timeout: 15000 });
    await sleep(500); // Additional stabilization time
  } catch (e) {
    console.log('✗ Could not find invoice table on page');
    await browser.disconnect();
    process.exit(1);
  }
  
  // Dynamically find the Invoice column by looking for header containing "invoice"
  let invoiceColumnIndex = null;
  try {
    invoiceColumnIndex = await page.evaluate(() => {
      const headers = Array.from(document.querySelectorAll('table th'));
      for (let i = 0; i < headers.length; i++) {
        const headerText = headers[i].textContent?.toLowerCase() || '';
        if (headerText.includes('invoice')) {
          return i + 1; // XPath is 1-indexed
        }
      }
      return null;
    });
  } catch (e) {
    // If header detection fails, we'll use fallback
  }
  
  // Build XPath based on whether we found the invoice column
  let invoiceRowXpath;
  if (invoiceColumnIndex !== null) {
    // Use the detected invoice column
    invoiceRowXpath = `.//table//tbody/tr[.//td[${invoiceColumnIndex}]//a]`;
    console.log(`Detected Invoice column at position ${invoiceColumnIndex}`);
  } else {
    // Fallback: any row with a link
    invoiceRowXpath = `.//table//tbody/tr[.//td//a]`;
    console.log('Using fallback: searching all table rows with links');
  }
  
  // Get initial count of invoices
  let invoiceRows = await page.$$(`xpath/${invoiceRowXpath}`);
  let invoiceCount = invoiceRows.length;
  
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
    const maxRetries = 3; // Try 4 times total (initial + 3 retries)
    
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
        
        // Get the invoice link (nth row in the invoice column, or first link in row if no column detected)
        let linkXpath;
        if (invoiceColumnIndex !== null) {
          linkXpath = `(.//table//tbody/tr//td[${invoiceColumnIndex}]//a)[${i}]`;
        } else {
          // Fallback: get the first link in the nth row
          linkXpath = `(.//table//tbody/tr[.//td//a])[${i}]//td//a[1]`;
        }
        const linkElements = await page.$$(`xpath/${linkXpath}`);
        
        if (linkElements.length === 0) {
          console.log(`Skipping row ${i} - link not found`);
          break; // Exit retry loop
        }
        
        // Get the invoice name/number, date, and href BEFORE clicking (to avoid context issues)
        let linkText = 'Unknown';
        let linkHref = '';
        let invoiceDate = '';
        try {
          const linkInfo = await page.evaluate(el => {
            // Get the invoice link text from the passed element
            const text = el.textContent?.trim() || '';
            
            // Try to find the date from the same row
            let date = '';
            const row = el.closest('tr');
            if (row) {
              // Look for date patterns in the row cells
              const cells = row.querySelectorAll('td');
              for (const cell of cells) {
                const cellText = cell.textContent?.trim() || '';
                // Match date patterns like MM/DD/YYYY, MM/DD/YY, or YYYY-MM-DD
                const dateMatch = cellText.match(/(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})/);
                if (dateMatch) {
                  date = dateMatch[0];
                  break;
                }
              }
            }
            
            return {
              text: text,
              href: el.href || '',
              date: date
            };
          }, linkElements[0]);
          linkText = linkInfo.text || 'Unknown';
          linkHref = linkInfo.href;
          invoiceDate = linkInfo.date;
        } catch (e) {
          // If we can't get info, try to continue anyway
        }
        
        // Create folder for this invoice
        const { folderName, folderPath } = ensureInvoiceFolder(linkText, invoiceDate);
      
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
        const maxRetries = 3;
        let downloadSuccess = false;
        let lastError = '';
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          const beforeSnapshot = getDownloadSnapshot();
          
          // Re-query file links (in case page state changed)
          const currentFileXpath = `(${fileXpath})[${j}]`;
          const currentFileLinks = await page.$$(`xpath/${currentFileXpath}`);
          
          if (currentFileLinks.length === 0) {
            if (attempt === 1) {
              console.log(`  Downloading ${j}/${fileCount}... ✗ Link not found`);
            }
            lastError = 'Link not found';
            break; // No point retrying if link doesn't exist
          }
          
          // Get file name/url for error reporting
          let fileName = `File ${j}`;
          try {
            fileName = await currentFileLinks[0].evaluate(el => {
              // Try to get filename from href
              const href = el.href || '';
              const urlParts = href.split('/');
              const nameFromUrl = urlParts[urlParts.length - 1]?.split('?')[0] || '';
              
              // Try to get filename from text content
              const textName = el.textContent?.trim() || '';
              
              // Prefer text content, fallback to URL
              return nameFromUrl || textName || `File ${j}`;
            });
          } catch (e) {
            // Use default if we can't get filename
          }
          
          if (attempt === 1) {
            process.stdout.write(`  Downloading ${j}/${fileCount}... `);
          } else {
            process.stdout.write(`  Retry ${attempt}/${maxRetries}... `);
          }
          
          try {
            // Try to get the href and use page.evaluate to trigger download
            const href = await currentFileLinks[0].evaluate(el => el.href);
            
            if (href) {
              // Create a temporary download link with download attribute
              await page.evaluate((url) => {
                const a = document.createElement('a');
                a.href = url;
                a.download = '';
                a.style.display = 'none';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
              }, href);
            } else {
              // Fallback to regular click
              await currentFileLinks[0].click();
            }
            await sleep(2000);
          } catch (e) {
            console.log(`✗ Click failed: ${e.message}`);
            lastError = 'Click failed';
            if (attempt < maxRetries) {
              console.log(`  Waiting 30 seconds before retry...`);
              await sleep(30000);
              continue;
            }
            break;
          }
          
          // Wait for download
          const downloadedFile = await waitForNewDownload(beforeSnapshot, 60000);
          
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
            downloadSuccess = true;
            break; // Success! Exit retry loop
          } else {
            lastError = `Download timeout - ${fileName}`;
            if (attempt < maxRetries) {
              console.log(`✗ ${lastError}`);
              console.log(`  Waiting 30 seconds before retry...`);
              await sleep(30000);
            }
          }
        }
        
        // If all retries failed, record the failure
        if (!downloadSuccess) {
          console.log(`✗ ${lastError} (failed after ${maxRetries} attempts)`);
          failedDownloads.push({ invoice: folderName, file: fileName, reason: lastError });
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
        // Simplify common error messages
        let friendlyMsg = 'Page changed during processing';
        if (loopErr.message.includes('Execution context was destroyed')) {
          friendlyMsg = 'Page navigated unexpectedly';
        } else if (loopErr.message.includes('mutated')) {
          friendlyMsg = 'Page content updated';
        } else if (loopErr.message.includes('timeout')) {
          friendlyMsg = 'Page load timeout';
        }
        console.log(`  ⚠ ${friendlyMsg}, retrying (${retryCount}/${maxRetries})...`);
        // Navigate back to list for retry
        try {
          await page.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
          await sleep(2000);
        } catch (e) {}
      } else {
        console.log(`  ✗ Failed after ${maxRetries + 1} attempts, skipping invoice`);
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
  
  if (failedDownloads.length > 0) {
    console.log('');
    console.log(`Failed Downloads: ${failedDownloads.length}`);
    
    // Group failures by invoice
    const failuresByInvoice = {};
    failedDownloads.forEach(item => {
      if (!failuresByInvoice[item.invoice]) {
        failuresByInvoice[item.invoice] = [];
      }
      const detail = item.file ? `${item.reason} - ${item.file}` : item.reason;
      failuresByInvoice[item.invoice].push(detail);
    });
    
    // Display grouped by invoice
    for (const [invoice, reasons] of Object.entries(failuresByInvoice)) {
      console.log(`  📁 ${invoice}/`);
      reasons.forEach(reason => {
        console.log(`     └─ ${reason}`);
      });
    }
  } else {
    console.log('');
    console.log('Failed Downloads: 0');
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
