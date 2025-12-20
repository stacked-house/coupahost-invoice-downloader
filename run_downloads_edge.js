#!/usr/bin/env node
// Minimal runner that connects to an Edge instance started with --remote-debugging-port
// and clicks PDF links found from a starting tab (or opens a new one).

const fs = require('fs');
const path = require('path');
const os = require('os');
const puppeteer = require('puppeteer-core');

function usage() {
  console.log(`Usage: node run_downloads_edge.js --json <file> [--mode connect|launch] [--browserUrl http://127.0.0.1:9222] [--target-url <partial-url-or-title>] [--downloads <path>]\n`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') opts.json = args[++i];
    else if (a === '--mode') opts.mode = args[++i];
    else if (a === '--browserUrl') opts.browserUrl = args[++i];
    else if (a === '--target-url') opts.target = args[++i];
    else if (a === '--xpath') opts.xpath = args[++i];
    else if (a === '--wait-ms-per-download') opts.waitMsPerDownload = Number(args[++i]);
    else if (a === '--downloads') opts.downloads = args[++i];
    else if (a === '--help' || a === '-h') { usage(); process.exit(0); }
    else { console.error('Unknown arg', a); usage(); process.exit(1); }
  }
  if (!opts.json) { usage(); process.exit(1); }
  opts.mode = opts.mode || 'connect';
  opts.browserUrl = opts.browserUrl || 'http://127.0.0.1:9222';
  opts.downloads = opts.downloads || path.join(process.env.USERPROFILE || os.homedir(), 'Downloads');
  opts.waitMsPerDownload = opts.waitMsPerDownload || 60000; // default 60 seconds per download
  return opts;
}

async function pickPageByPrompt(pages) {
  console.log('Open tabs:');
  pages.forEach((p, idx) => {
    const title = (typeof p.title === 'function' ? p.title() : 'N/A');
    console.log(`${idx}: ${p.url()} - ${String(title).slice(0,80)}`);
  });
  process.stdout.write('Enter the index of the tab to use: ');
  return new Promise((resolve) => {
    process.stdin.once('data', (d) => {
      const idx = Number(d.toString().trim());
      resolve(pages[idx]);
    });
  });
}

function extractXPathsFromJson(obj) {
  const xpaths = new Set();
  if (!obj || !obj.Commands) return [];
  for (const cmd of obj.Commands) {
    if (typeof cmd.Target === 'string') {
      const m = cmd.Target.match(/xpath=\(([^\)]*)\)/i);
      if (m) xpaths.add(m[1]);
      else if (/xpath=/.test(cmd.Target)) {
        // fallback grab after xpath=
        const m2 = cmd.Target.match(/xpath=(.*)/i);
        if (m2) xpaths.add(m2[1]);
      }
    }
    if (typeof cmd.Value === 'string') {
      const m = cmd.Value.match(/xpath=\(([^\)]*)\)/i);
      if (m) xpaths.add(m[1]);
    }
  }
  return Array.from(xpaths);
}

async function run() {
  const opts = parseArgs();
  const jsonText = fs.readFileSync(opts.json, 'utf8');
  const scriptObj = JSON.parse(jsonText);
  const foundXPaths = extractXPathsFromJson(scriptObj);

  console.log('Found XPaths in JSON:', foundXPaths);

  let browser;
  if (opts.mode === 'connect') {
    console.log('Connecting to Edge at', opts.browserUrl);
    browser = await puppeteer.connect({ browserURL: opts.browserUrl });
  } else {
    // launch Edge if available
    const edgePaths = [
      process.env['PROGRAMFILES(X86)'] + '\\Microsoft\\Edge\\Application\\msedge.exe',
      process.env['PROGRAMFILES'] + '\\Microsoft\\Edge\\Application\\msedge.exe'
    ];
    const exe = edgePaths.find(p => p && fs.existsSync(p));
    if (!exe) { console.error('Could not find msedge.exe on this machine. Provide mode connect or install Edge.'); process.exit(1); }
    browser = await puppeteer.launch({ executablePath: exe, headless: false, args: ['--no-sandbox'] });
  }

  let pages = await browser.pages();

  let page;
  if (opts.target) {
    page = pages.find(p => {
      const title = (typeof p.title === 'function' ? p.title() : '');
      return p.url().includes(opts.target) || String(title).includes(opts.target);
    });
  }
  if (!page) {
    // choose first non-empty URL page or prompt
    const candidates = pages.filter(p => p.url() && p.url() !== 'about:blank');
    if (candidates.length === 0) {
      page = await browser.newPage();
      console.log('No existing tab found, opened a new tab');
    } else if (candidates.length === 1) {
      page = candidates[0];
    } else {
      if (opts.target) {
        page = candidates[0];
      } else {
        page = await pickPageByPrompt(candidates);
      }
    }
  }

  console.log('Using tab with URL:', page.url());

  // Navigate to the invoice list (remove any /invoices/XXXXX detail path)
  const pageUrl = new URL(page.url());
  const invoiceListPath = '/invoices';
  if (!pageUrl.pathname.endsWith(invoiceListPath)) {
    const listUrl = pageUrl.protocol + '//' + pageUrl.host + invoiceListPath;
    console.log('Navigating to invoice list:', listUrl);
    try {
      await page.goto(listUrl, { waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(1000);
    } catch (e) {
      console.warn('Navigation to list failed:', e.message);
    }
  }

  // set download behavior via CDP
  const client = await page.target().createCDPSession();
  await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: opts.downloads });
  console.log('Downloads will be saved to', opts.downloads);
  console.log('Note: Opening each download in a new tab to avoid Adobe/viewers opening files');

  // If no XPath found, fallback to find rows with anchors in tables
  const xpathToUse = opts.xpath || (foundXPaths.length > 0 ? foundXPaths[0] : "//table//tbody//tr//td//a[contains(@href,'/')]");

  // We'll gather the hrefs and iterate; re-query each time to avoid stale element handles
  const listUrl = page.url();

  // Helper: click first N link matches by XPath
  const linkXpaths = [xpathToUse];
  // Helper for download folder snapshot and waiting
  function snapshotDir(folder) {
    try {
      const files = fs.readdirSync(folder);
      const map = new Map();
      for (const f of files) {
        try {
          const p = path.join(folder, f);
          const st = fs.statSync(p);
          map.set(f, { mtimeMs: st.mtimeMs, size: st.size });
        } catch (e) {
          // ignore
        }
      }
      return map;
    } catch (e) {
      return new Map();
    }
  }

  async function waitForNewFiles(folder, prevSnapshot, expectedNew = 1, timeoutMs = 120000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const snap = snapshotDir(folder);
      // compute new files, excluding .tmp, .crdownload, and .download files
      // Also check for files renamed with (1), (2), etc. when duplicates exist
      const newFiles = Array.from(snap.keys()).filter(k => {
        // Skip temp files
        if (k.endsWith('.tmp') || k.endsWith('.crdownload') || k.endsWith('.download')) return false;
        // File is new if not in previous snapshot
        if (!prevSnapshot.has(k)) return true;
        // Also check if file was modified (size or time changed) - handles duplicate renaming
        const prev = prevSnapshot.get(k);
        const curr = snap.get(k);
        if (prev && curr && (curr.mtimeMs > prev.mtimeMs || curr.size !== prev.size)) return true;
        return false;
      });
      // ignore temporary .crdownload presence but still count it as new
      if (newFiles.length >= expectedNew) {
        // wait for their completion (no .crdownload)
        const waitStart = Date.now();
        while (Date.now() - waitStart < timeoutMs) {
          const snap2 = snapshotDir(folder);
          // if any .crdownload file exists in folder, wait
          const anyCr = Array.from(snap2.keys()).some(fn => fn.endsWith('.crdownload') || fn.endsWith('.download'));
          if (!anyCr) return Array.from(newFiles);
          await new Promise(r => setTimeout(r, 1000));
        }
        return Array.from(newFiles);
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    return [];
  }

  for (const lx of linkXpaths) {
    // Count matches
    const elements = await page.$x(lx);
    console.log(`Found ${elements.length} candidate invoice links using XPath: ${lx}`);
    
    // Track which invoices we've already processed
    const processedInvoices = new Set();
    
    for (let i = 0; i < elements.length; ++i) {
      try {

        // Re-query to avoid stale handles
        const es = await page.$x(lx);
        if (!es[i]) continue;
        let text = '';
        try {
          text = await page.evaluate(e => e.textContent.trim(), es[i]);
        } catch (e) {
          text = 'unknown';
        }

        // Skip if we've already processed this invoice (resume capability)
        if (processedInvoices.has(text)) {
          console.log(`Skipping row ${i + 1}/${es.length}: ${text} (already processed)`);
          continue;
        }

        console.log(`Clicking row ${i + 1}/${es.length}: ${text}`);
        processedInvoices.add(text);

        // Get the href before clicking
        let href = '';
        try {
          href = await page.evaluate(e => e.href, es[i]);
        } catch (e) {
          // ignore
        }

        try {
          await Promise.all([
            es[i].click(),
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {}),
          ]);
        } catch (err) {
          console.warn('Click or navigation failed, retrying navigation via href');
          if (href) {
            try {
              await page.goto(href, { waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {});
            } catch (e) {
              console.warn('Navigation failed:', e.message);
            }
          }
          await page.waitForTimeout(800);
        }


        // After navigation, robustly re-query for PDF links on the new page to avoid stale handles
        // Wait for a known selector (table or attachment container) to ensure page is ready
        let pdfs = [];
        let queryAttempts = 0;
        let lastError = null;
        while (queryAttempts < 3) {
          try {
            // Wait for a table or any anchor to appear (adjust selector as needed)
            await page.waitForSelector('table, a', { timeout: 5000 }).catch(() => {});
            pdfs = await page.$x("//a[contains(translate(@href,'PDF','pdf'),'.pdf') or contains(translate(@href,'ZIP','zip'),'.zip') or contains(translate(@href,'EXCEL','excel'),'.xls') or contains(translate(@href,'CSV','csv'),'.csv')]");
            lastError = null;
            break;
          } catch (e) {
            lastError = e;
            if (e.message && e.message.includes('Execution context was destroyed')) {
              console.warn(`Retrying attachment query for row ${i + 1} due to navigation/context error...`);
              await page.waitForTimeout(1200);
            } else {
              console.warn(`Failed to query attachments for row ${i + 1}: ${e.message}`);
              break;
            }
          }
          queryAttempts++;
        }

        if (lastError && queryAttempts >= 3) {
          console.error(`Failed to query attachments for row ${i + 1} after 3 attempts: ${lastError.message}`);
        }

        if (!pdfs || pdfs.length === 0) {
          console.log('No PDF attachments found on this page');
        } else {
          console.log(`Found ${pdfs.length} attachments on this detail page`);
          // Prepare download folder snapshot
          let prevSnap = snapshotDir(opts.downloads);
          for (let j = 0; j < pdfs.length; ++j) {
            let ptext = '';
            try {
              ptext = await page.evaluate(e => e.textContent.trim(), pdfs[j]);
            } catch (e) {
              ptext = `attachment-${j+1}`;
            }
            console.log(`Downloading attachment ${j + 1}/${pdfs.length}: ${ptext}`);

            let href = '';
            try {
              href = await page.evaluate(e => e.href, pdfs[j]);
            } catch (e) {
              // ignore
            }

            try {
              if (href) {
                // Simple direct click approach - let Edge handle the download
                const downloadPromise = client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: opts.downloads });

                // Simply click the link - Edge will download it automatically
                await page.evaluate((url) => {
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = '';
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                }, href);

                await downloadPromise;
              } else {
                console.warn(`No href found for attachment ${j + 1}, skipping`);
              }
            } catch (e) {
              console.warn(`Failed to download attachment ${j + 1}: ${e.message}`);
            }

            // Wait for a new file to appear and complete
            const newFiles = await waitForNewFiles(opts.downloads, prevSnap, 1, opts.waitMsPerDownload);
            if (newFiles.length === 0) {
              console.error(`\n*** TIMEOUT: No file downloaded after ${opts.waitMsPerDownload/1000} seconds for attachment ${j + 1} ***`);
              console.error(`*** Attachment text: ${ptext}`);
              console.error(`*** Attachment href: ${href}`);
              console.error(`*** Current page URL: ${page.url()}`);
              // Enhanced diagnostics
              try {
                const pageContent = await page.content();
                fs.writeFileSync(path.join(opts.downloads, `debug_row_${i+1}_attachment_${j+1}.html`), pageContent, 'utf8');
                console.error(`*** Saved page HTML for debugging: debug_row_${i+1}_attachment_${j+1}.html`);
              } catch (e) {
                console.error('*** Failed to save page HTML for diagnostics:', e.message);
              }
              try {
                const cookies = await page.cookies();
                fs.writeFileSync(path.join(opts.downloads, `debug_row_${i+1}_attachment_${j+1}_cookies.json`), JSON.stringify(cookies, null, 2), 'utf8');
                console.error(`*** Saved cookies for debugging: debug_row_${i+1}_attachment_${j+1}_cookies.json`);
              } catch (e) {
                console.error('*** Failed to save cookies for diagnostics:', e.message);
              }
              console.error(`*** Stopping script to diagnose the issue ***\n`);
              process.exit(1);
            } else {
              console.log('Downloaded:', newFiles.join(', '));
            }
            // refresh snapshot for next attachment
            prevSnap = snapshotDir(opts.downloads);
            await page.waitForTimeout(200);
          }
        }

        // Return to list page
        try {
          await page.goto(listUrl, { waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
        } catch (e) {
          console.warn('Failed to go back to list URL', e.message);
        }
        await page.waitForTimeout(300);
      } catch (e) {
        console.error(`Error processing row ${i + 1}: ${e.message}`);
      }
    }
  }

  console.log('Done. Attempted link set. Check your Downloads folder for saved PDFs.');

  if (opts.mode === 'connect') {
    await browser.disconnect();
  } else {
    await browser.close();
  }
}

run().catch(err => { console.error(err); process.exit(1); });
