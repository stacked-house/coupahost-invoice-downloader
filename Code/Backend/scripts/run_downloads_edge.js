#!/usr/bin/env node
/**
 * Coupa Invoice Downloader - JSON Command Executor
 * Interprets the JSON command files and executes them using Puppeteer
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

// Variable storage (like UI.Vision variables)
const variables = {
  '!errorIgnore': 'true',
  '!timeout_wait': '60',
  '!timeout_pageLoad': '60',
  '!URL': '' // Will be set to current page URL
};

/**
 * Substitute variables in a string: ${varName} -> value
 */
function substituteVars(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/\$\{([^}]+)\}/g, (match, varName) => {
    // Handle special ! prefix variables
    const key = varName.startsWith('!') ? varName : varName;
    if (variables.hasOwnProperty(key)) {
      return variables[key];
    }
    return match; // Leave unchanged if not found
  });
}

/**
 * Extract XPath from target string (handles xpath= prefix)
 */
function extractXPath(target) {
  // First substitute variables
  let resolved = substituteVars(target);
  // Remove xpath= prefix if present
  if (resolved.startsWith('xpath=')) {
    resolved = resolved.substring(6);
  }
  return resolved;
}

/**
 * Evaluate a condition expression
 */
function evaluateCondition(expr) {
  // Substitute variables first
  const resolved = substituteVars(expr);
  
  try {
    // Handle common operators
    if (resolved.includes('==')) {
      const [left, right] = resolved.split('==').map(s => s.trim());
      return left === right || Number(left) === Number(right);
    }
    if (resolved.includes('!=')) {
      const [left, right] = resolved.split('!=').map(s => s.trim());
      return left !== right && Number(left) !== Number(right);
    }
    if (resolved.includes('<=')) {
      const [left, right] = resolved.split('<=').map(s => s.trim());
      return Number(left) <= Number(right);
    }
    if (resolved.includes('>=')) {
      const [left, right] = resolved.split('>=').map(s => s.trim());
      return Number(left) >= Number(right);
    }
    if (resolved.includes('<')) {
      const [left, right] = resolved.split('<').map(s => s.trim());
      return Number(left) < Number(right);
    }
    if (resolved.includes('>')) {
      const [left, right] = resolved.split('>').map(s => s.trim());
      return Number(left) > Number(right);
    }
    // Fallback: try JavaScript evaluation (careful!)
    return Boolean(eval(resolved));
  } catch (e) {
    console.error('Failed to evaluate condition:', expr, e);
    return false;
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
      } catch (e) {
        // Ignore files we can't stat
      }
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
    
    // Look for new files or modified files
    for (const [file, mtime] of Object.entries(currentFiles)) {
      // Skip temp download files
      if (file.endsWith('.crdownload') || file.endsWith('.tmp') || file.endsWith('.download')) {
        continue;
      }
      
      // New file appeared
      if (!beforeSnapshot[file]) {
        console.log(`  Download completed: ${file}`);
        return file;
      }
      
      // Existing file was modified (re-downloaded)
      if (mtime > beforeSnapshot[file]) {
        console.log(`  Download updated: ${file}`);
        return file;
      }
    }
  }
  
  console.log('  Download timeout - no new file detected');
  return null;
}

/**
 * Main execution
 */
async function main() {
  // Load JSON commands
  const jsonContent = fs.readFileSync(jsonPath, 'utf-8');
  const config = JSON.parse(jsonContent);
  const commands = config.Commands || [];
  
  console.log(`Loaded ${commands.length} commands from ${config.Name || jsonPath}`);
  
  // Connect to browser
  console.log(`Connecting to browser at ${browserUrl}...`);
  const browser = await puppeteer.connect({
    browserURL: browserUrl,
    defaultViewport: null
  });
  
  // Find the target tab
  const pages = await browser.pages();
  let page = null;
  
  if (targetUrl) {
    for (const p of pages) {
      const url = await p.url();
      if (url.startsWith(targetUrl) || url.includes(targetUrl)) {
        page = p;
        console.log(`Found target tab: ${url}`);
        break;
      }
    }
  }
  
  if (!page && pages.length > 0) {
    // Use the first non-blank page
    for (const p of pages) {
      const url = await p.url();
      if (url && url !== 'about:blank' && !url.startsWith('chrome://')) {
        page = p;
        console.log(`Using tab: ${url}`);
        break;
      }
    }
  }
  
  if (!page) {
    console.error('No suitable tab found. Please open the Coupa page first.');
    await browser.disconnect();
    process.exit(1);
  }
  
  // Set the !URL variable to current page URL
  variables['!URL'] = await page.url();
  
  // Control flow stacks
  const ifStack = [];      // Stack of { skip: boolean, executed: boolean }
  const whileStack = [];   // Stack of { startIndex: number, condition: string }
  
  let i = 0;
  while (i < commands.length) {
    const cmd = commands[i];
    const command = cmd.Command.toLowerCase();
    const target = cmd.Target || '';
    const value = cmd.Value || '';
    
    // Check if we're skipping due to if/else
    const shouldSkip = ifStack.length > 0 && ifStack[ifStack.length - 1].skip;
    
    // Always process control flow commands
    if (command === 'if_v2' || command === 'if') {
      if (shouldSkip) {
        // Already skipping, push another skip
        ifStack.push({ skip: true, executed: true });
      } else {
        const condition = evaluateCondition(target);
        ifStack.push({ skip: !condition, executed: condition });
      }
      i++;
      continue;
    }
    
    if (command === 'else') {
      if (ifStack.length > 0) {
        const current = ifStack[ifStack.length - 1];
        // Only execute else if we haven't executed the if block
        current.skip = current.executed;
      }
      i++;
      continue;
    }
    
    if (command === 'endif') {
      if (ifStack.length > 0) {
        ifStack.pop();
      }
      i++;
      continue;
    }
    
    if (command === 'while_v2' || command === 'while') {
      if (shouldSkip) {
        // Skip the entire while block
        let depth = 1;
        let j = i + 1;
        while (j < commands.length && depth > 0) {
          const c = commands[j].Command.toLowerCase();
          if (c === 'while_v2' || c === 'while') depth++;
          if (c === 'endwhile') depth--;
          j++;
        }
        i = j;
        continue;
      }
      
      const condition = evaluateCondition(target);
      if (condition) {
        whileStack.push({ startIndex: i, condition: target });
        i++;
      } else {
        // Skip to endWhile
        let depth = 1;
        let j = i + 1;
        while (j < commands.length && depth > 0) {
          const c = commands[j].Command.toLowerCase();
          if (c === 'while_v2' || c === 'while') depth++;
          if (c === 'endwhile') depth--;
          j++;
        }
        i = j;
      }
      continue;
    }
    
    if (command === 'endwhile') {
      if (whileStack.length > 0) {
        const loop = whileStack[whileStack.length - 1];
        const condition = evaluateCondition(loop.condition);
        if (condition) {
          // Go back to start of while
          i = loop.startIndex + 1;
        } else {
          // Exit the loop
          whileStack.pop();
          i++;
        }
      } else {
        i++;
      }
      continue;
    }
    
    // Skip non-control-flow commands if in a skipped block
    if (shouldSkip) {
      i++;
      continue;
    }
    
    // Execute the command
    try {
      await executeCommand(page, command, target, value);
    } catch (err) {
      console.error(`Error executing ${command}: ${err.message}`);
      if (variables['!errorIgnore'] !== 'true') {
        throw err;
      }
    }
    
    i++;
  }
  
  console.log('\nExecution complete!');
  await browser.disconnect();
}

/**
 * Execute a single command
 */
async function executeCommand(page, command, target, value) {
  const resolvedTarget = substituteVars(target);
  const resolvedValue = substituteVars(value);
  
  switch (command) {
    case 'store': {
      // Store a value in a variable
      // Target = value to store, Value = variable name
      let valToStore = resolvedTarget;
      
      // Handle special ${!URL} case
      if (target === '${!URL}') {
        valToStore = await page.url();
      }
      
      variables[resolvedValue] = valToStore;
      console.log(`store: ${resolvedValue} = "${valToStore}"`);
      break;
    }
    
    case 'echo': {
      console.log(`echo: ${resolvedTarget}`);
      break;
    }
    
    case 'pause': {
      const ms = parseInt(resolvedTarget) || 1000;
      console.log(`pause: ${ms}ms`);
      await new Promise(resolve => setTimeout(resolve, ms));
      break;
    }
    
    case 'open': {
      console.log(`open: ${resolvedTarget}`);
      await page.goto(resolvedTarget, { waitUntil: 'domcontentloaded', timeout: 60000 });
      // Update !URL
      variables['!URL'] = await page.url();
      break;
    }
    
    case 'selectwindow': {
      // Usually tab=0, just ensure we're on the right page
      console.log(`selectWindow: ${resolvedTarget}`);
      break;
    }
    
    case 'selectframe': {
      // Handle frame selection
      if (target === 'relative=top') {
        // We're already at top level with page
        console.log('selectFrame: relative=top');
      }
      break;
    }
    
    case 'storexpathcount': {
      const xpath = extractXPath(target);
      console.log(`storeXpathCount: ${xpath} -> ${resolvedValue}`);
      try {
        const elements = await page.$$(`::-p-xpath(${xpath})`);
        variables[resolvedValue] = String(elements.length);
        console.log(`  Found ${elements.length} elements`);
      } catch (e) {
        console.error(`  XPath error: ${e.message}`);
        variables[resolvedValue] = '0';
      }
      break;
    }
    
    case 'storetext': {
      const xpath = extractXPath(target);
      console.log(`storeText: ${xpath} -> ${resolvedValue}`);
      try {
        const elements = await page.$$(`::-p-xpath(${xpath})`);
        if (elements.length > 0) {
          const text = await page.evaluate(el => el.textContent || '', elements[0]);
          variables[resolvedValue] = text.trim();
          console.log(`  Text: "${text.trim()}"`);
        } else {
          variables[resolvedValue] = '';
        }
      } catch (e) {
        console.error(`  Error: ${e.message}`);
        variables[resolvedValue] = '';
      }
      break;
    }
    
    case 'waitforelementpresent': {
      const xpath = extractXPath(target);
      const timeout = parseInt(variables['!timeout_wait']) * 1000 || 60000;
      console.log(`waitForElementPresent: ${xpath}`);
      try {
        await page.waitForSelector(`::-p-xpath(${xpath})`, { timeout });
        console.log('  Element found');
      } catch (e) {
        console.error(`  Timeout waiting for element`);
      }
      break;
    }
    
    case 'click': {
      const xpath = extractXPath(target);
      console.log(`click: ${xpath}`);
      
      // Take download snapshot before click (in case it triggers a download)
      const beforeSnapshot = getDownloadSnapshot();
      
      try {
        const elements = await page.$$(`::-p-xpath(${xpath})`);
        if (elements.length > 0) {
          // Check if this is a download link
          const href = await page.evaluate(el => el.href || '', elements[0]);
          const isDownloadLink = href && (href.includes('.pdf') || href.includes('.xlsx') || href.includes('.csv'));
          
          await elements[0].click();
          console.log('  Clicked');
          
          // If it's a download link, wait for download
          if (isDownloadLink) {
            console.log('  Waiting for download...');
            await waitForNewDownload(beforeSnapshot, 30000);
          } else {
            // Wait a bit for navigation/page updates
            await new Promise(resolve => setTimeout(resolve, 500));
          }
          
          // Update !URL after navigation
          try {
            variables['!URL'] = await page.url();
          } catch (e) {
            // Page might have navigated, that's ok
          }
        } else {
          console.log('  No elements found to click');
        }
      } catch (e) {
        if (e.message.includes('Execution context was destroyed')) {
          console.log('  Page navigated, continuing...');
          // Wait for new page to load
          await new Promise(resolve => setTimeout(resolve, 2000));
          try {
            variables['!URL'] = await page.url();
          } catch (e2) {
            // Ignore
          }
        } else {
          console.error(`  Error: ${e.message}`);
        }
      }
      break;
    }
    
    case 'throwerror': {
      console.error(`throwError: ${resolvedTarget}`);
      if (variables['!errorIgnore'] !== 'true') {
        throw new Error(resolvedTarget);
      }
      break;
    }
    
    case 'executescript_sandbox': {
      // Execute JavaScript and store result
      console.log(`executeScript_Sandbox: ${target} -> ${resolvedValue}`);
      try {
        // Create a simple expression evaluator
        const expr = target.replace(/return\s+/, '');
        // Substitute variables
        let evalExpr = expr;
        for (const [key, val] of Object.entries(variables)) {
          const regex = new RegExp(`\\$\\{${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}`, 'g');
          evalExpr = evalExpr.replace(regex, val);
        }
        // Evaluate
        const result = eval(evalExpr);
        variables[resolvedValue] = String(result);
        console.log(`  Result: ${result}`);
      } catch (e) {
        console.error(`  Error: ${e.message}`);
      }
      break;
    }
    
    default: {
      console.log(`[Unhandled command: ${command}] target=${target}, value=${value}`);
    }
  }
}

// Run
main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
