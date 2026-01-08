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
    // Each extension is now handled individually
    return `contains(@href,'.${ext}')`;
  });
  
  return `.//a[${conditions.join(' or ')}]`;
}

// Download directory
const downloadDir = path.join(os.homedir(), 'Downloads');

// Track downloaded files (with their folders)
const downloadedFiles = [];
const failedDownloads = [];

// State tracking for graceful shutdown
let shouldStop = false;
let currentInvoiceNumber = 0;
let currentInvoiceId = '';
let currentInvoiceFileCount = 0;
let currentInvoiceTotalFiles = 0;
let processedInvoices = 0;
let totalInvoices = 0;
let totalDownloads = 0;
let activeBrowser = null;

/**
 * Print download summary
 */
function printSummary() {
  try {
    console.log('');
    console.log('========================================');
    
    if (shouldStop) {
      console.log('⏸ Download Stopped');
      console.log('');
      console.log('📍 Stopped at:');
      console.log(`   Invoice: ${currentInvoiceId} (${currentInvoiceNumber}/${totalInvoices})`);
      if (currentInvoiceTotalFiles > 0) {
        console.log(`   Progress: Downloaded ${currentInvoiceFileCount} of ${currentInvoiceTotalFiles} file(s) from this invoice`);
      }
      console.log('');
    } else {
      console.log('✓ Download Complete!');
      console.log('');
    }
    
    console.log('📊 Summary:');
    console.log(`   Fully Processed: ${processedInvoices} invoice(s)`);
    console.log(`   Total Files Downloaded: ${totalDownloads} file(s)`);
    
    if (failedDownloads.length > 0) {
      console.log('');
      console.log(`⚠ Failed Downloads: ${failedDownloads.length}`);
      
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
      console.log(`   Failed Downloads: 0`);
    }
    
    console.log('========================================');
  } catch (summaryErr) {
    console.log('');
    console.log('========================================');
    if (shouldStop) {
      console.log('⏸ Download Stopped');
    } else {
      console.log('✓ Download Complete!');
    }
    console.log(`Stats: ${processedInvoices} invoices, ${totalDownloads} files, ${failedDownloads.length} failures`);
    console.log('========================================');
  }
}

// Handle graceful shutdown on SIGTERM (stop button) and Windows exit signals
const gracefulShutdown = async () => {
  shouldStop = true;
  console.log('\n');
  console.log('⏸ Stop requested - finishing current file...');
  
  // Give it 1.5 seconds for current operation to finish and loop to break naturally
  // If process is still running after 1.5s, force summary and exit
  setTimeout(async () => {
    printSummary();
    
    // Disconnect browser
    if (activeBrowser) {
      try {
        await activeBrowser.disconnect();
      } catch (e) {}
    }
    
    process.exit(0);
  }, 1500); // 1.5 second grace period (frontend waits 2 seconds)
};

process.on('SIGTERM', gracefulShutdown); // Unix
process.on('SIGINT', gracefulShutdown);  // Ctrl+C
if (process.platform === 'win32') {
  // Windows-specific signals
  process.on('SIGBREAK', gracefulShutdown);
  // Also handle when parent process dies
  process.on('beforeExit', () => {
    if (shouldStop) {
      printSummary();
    }
  });
}

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
function ensureInvoiceFolder(invoiceName, invoiceDate = '', supplierName = '') {
  let folderName = sanitizeFolderName(invoiceName);
  
  // If we couldn't extract the invoice name, it will be 'Unknown'
  // In that case, we'll try to use the date or just skip
  if (folderName === 'Unknown' && !invoiceDate) {
    folderName = `Unknown_${Date.now()}`;
  }
  
  // Build folder name: date - Supplier - invoice #
  const parts = [];
  
  if (invoiceDate) {
    const normalizedDate = normalizeDate(invoiceDate);
    if (normalizedDate) {
      parts.push(normalizedDate);
    }
  }
  
  if (supplierName) {
    let sanitizedSupplier = sanitizeFolderName(supplierName);
    if (sanitizedSupplier && sanitizedSupplier !== 'Unknown') {
      // Truncate supplier name to 80 characters max to avoid path length issues
      if (sanitizedSupplier.length > 80) {
        sanitizedSupplier = sanitizedSupplier.substring(0, 80).trim();
      }
      parts.push(sanitizedSupplier);
    }
  }
  
  if (folderName !== 'Unknown') {
    parts.push(folderName);
  }
  
  if (parts.length > 0) {
    folderName = parts.join(' - ');
  } else {
    folderName = `Unknown_${Date.now()}`;
  }
  
  // Final safety check - ensure total folder name doesn't exceed 200 chars
  // This leaves room for the full path (downloadDir + folderName + filename)
  if (folderName.length > 200) {
    folderName = folderName.substring(0, 200).trim();
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
        // Wait for file to stabilize (no size changes for 1 second)
        const filePath = path.join(downloadDir, file);
        let previousSize = -1;
        let stableCount = 0;
        
        for (let i = 0; i < 5; i++) { // Check up to 5 times (5 seconds max)
          try {
            const stat = fs.statSync(filePath);
            const currentSize = stat.size;
            
            if (currentSize === previousSize && currentSize > 0) {
              stableCount++;
              if (stableCount >= 2) { // Stable for 2 checks (1 second)
                return file;
              }
            } else {
              stableCount = 0;
            }
            
            previousSize = currentSize;
            await new Promise(resolve => setTimeout(resolve, 500));
          } catch (e) {
            // File might have been moved/deleted, break inner loop
            break;
          }
        }
        
        // If we get here, file exists and hasn't changed recently
        if (previousSize > 0) {
          return file;
        }
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
    activeBrowser = browser; // Store for SIGTERM handler
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
  let supplierColumnIndex = null;
  try {
    const columnIndices = await page.evaluate(() => {
      const headers = Array.from(document.querySelectorAll('table th'));
      let invoice = null;
      let supplier = null;
      let invoicePartial = null;
      let supplierPartial = null;
      
      for (let i = 0; i < headers.length; i++) {
        const headerText = headers[i].textContent?.toLowerCase() || '';
        const trimmedHeader = headerText.trim();
        
        // Prioritize "Invoice #" or "Invoice" over "Invoice Date"
        if ((trimmedHeader === 'invoice #' || trimmedHeader === 'invoice') && !invoice) {
          invoice = i + 1; // XPath is 1-indexed
        } else if (headerText.includes('invoice #') && !invoice) {
          invoice = i + 1;
        } else if (headerText.includes('invoice') && !invoice && !invoicePartial) {
          invoicePartial = i + 1; // Store partial match as fallback
        }
        
        // Exact match for supplier (prioritize)
        if (trimmedHeader === 'supplier' && !supplier) {
          supplier = i + 1;
        } else if (headerText.includes('supplier') && !supplier && !supplierPartial) {
          supplierPartial = i + 1; // Store partial match as fallback
        }
      }
      
      // Use partial matches if no exact match found
      if (!invoice && invoicePartial) {
        invoice = invoicePartial;
      }
      if (!supplier && supplierPartial) {
        supplier = supplierPartial;
      }
      
      return { invoice, supplier };
    });
    invoiceColumnIndex = columnIndices.invoice;
    supplierColumnIndex = columnIndices.supplier;
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
  
  if (supplierColumnIndex !== null) {
    console.log(`Detected Supplier column at position ${supplierColumnIndex}`);
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
  
  totalInvoices = invoiceCount; // Track total for stop summary
  
  // Process each invoice
  for (let i = 1; i <= invoiceCount; i++) {
    // Check if user requested stop
    if (shouldStop) {
      console.log('');
      break;
    }
    
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
        let supplierName = '';
        try {
          const linkInfo = await page.evaluate((el, supplierColIndex) => {
            // Get the invoice link text from the passed element
            const text = el.textContent?.trim() || '';
            
            // Try to find the date and supplier from the same row
            let date = '';
            let supplier = '';
            const row = el.closest('tr');
            if (row) {
              const cells = row.querySelectorAll('td');
              
              // If we know the supplier column, use it directly
              if (supplierColIndex !== null && cells[supplierColIndex - 1]) {
                supplier = cells[supplierColIndex - 1].textContent?.trim() || '';
              }
              
              // Look for date and fallback supplier if not found
              for (let i = 0; i < cells.length; i++) {
                const cellText = cells[i].textContent?.trim() || '';
                
                // Match date patterns like MM/DD/YYYY, MM/DD/YY, or YYYY-MM-DD
                if (!date) {
                  const dateMatch = cellText.match(/(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})/);
                  if (dateMatch) {
                    date = dateMatch[0];
                  }
                }
                
                // Fallback supplier detection if column not detected
                if (!supplier && cellText.length > 3 && !cellText.match(/^\d+$/) && !cellText.match(/\d{1,2}\/\d{1,2}\/\d{2,4}/)) {
                  // Avoid the invoice number cell
                  if (cells[i] !== el.closest('td')) {
                    // Check if this looks like a supplier name
                    if (cellText.match(/[a-zA-Z]/) && cellText.length < 100) {
                      supplier = cellText;
                    }
                  }
                }
              }
            }
            
            return {
              text: text,
              href: el.href || '',
              date: date,
              supplier: supplier
            };
          }, linkElements[0], supplierColumnIndex);
          linkText = linkInfo.text || 'Unknown';
          linkHref = linkInfo.href;
          invoiceDate = linkInfo.date;
          supplierName = linkInfo.supplier;
        } catch (e) {
          // If we can't get info, try to continue anyway
        }
        
        // Create folder for this invoice
        const { folderName, folderPath } = ensureInvoiceFolder(linkText, invoiceDate, supplierName);
      
      // Update current state tracking
      currentInvoiceNumber = i;
      currentInvoiceId = linkText;
      
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
      currentInvoiceTotalFiles = 0;
      currentInvoiceFileCount = 0;
    } else {
      console.log(`  Found ${fileCount} attachment(s)`);
      currentInvoiceTotalFiles = fileCount;
      currentInvoiceFileCount = 0;
      
      // Download each file
      for (let j = 1; j <= fileCount; j++) {
        // Check if user requested stop
        if (shouldStop) {
          console.log('');
          console.log('  ⏸ Stopping at current position...');
          break;
        }
        
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
              currentInvoiceFileCount++;
            } else {
              console.log(`✓ ${downloadedFile} (could not move to folder)`);
              downloadedFiles.push({ folder: 'Downloads', file: downloadedFile });
              totalDownloads++;
              currentInvoiceFileCount++;
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
    
    // If stopped, break out of retry loop immediately
    if (shouldStop) {
      break;
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
  printSummary();
  
  // Ensure output is flushed before disconnecting
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Disconnect browser (wrapped in try-catch to avoid errors if already disconnected)
  try {
    await browser.disconnect();
  } catch (disconnectErr) {
    // Browser may have already disconnected
  }
}

// Run
main().catch(err => {
  console.error('');
  console.error('✗ Error:', err.message);
  process.exit(1);
});
