
# Coupa Invoice Downloader

A desktop app for batch downloading invoice attachments from Coupa. Works on Mac and Windows.

## Features

- 📥 Download multiple invoice attachments at once
- 📁 Automatically organizes files into folders with date-prefixed names (e.g., `2025-06-23 - INV-12345`)
- � Real-time progress bar showing invoice count (e.g., "Processing: 12 of 90 invoices")
- 🔄 Retry logic for failed downloads (up to 3 attempts)
- 📄 Filter by file type: PDF, Excel, CSV, Word, PNG, JPG, XML
- 🖥️ Clean, modern interface with selectable console output
- 🤖 Smart auto-detection of invoice columns and page layouts
- 💤 Prevents system sleep during downloads (keeps screen awake)
- 📝 Detailed error reporting with specific filenames for timeouts
- 📋 Copy/paste support with right-click context menus
- 🔄 Automatic page refresh to ensure accurate invoice counts
- 📊 Concise summary with failed download tracking
- 🔒 Works without admin rights

---

## Installation

### Mac

1. Download the `.dmg` file:
   - **Apple Silicon (M1/M2/M3):** `Coupa Invoice Downloader-1.0.0-arm64.dmg`
   - **Intel Mac:** `Coupa Invoice Downloader-1.0.0.dmg`
2. Double-click to open the DMG
3. Drag the app to your Applications folder
4. Open from Applications (right-click → Open if you see a security warning)

### Windows

1. Download `Coupa Invoice Downloader-1.0.0-win.zip`
2. Right-click → **Extract All** to a folder (e.g., Desktop or Documents)
3. Open the extracted folder
4. Double-click **`Setup - Run Me First.bat`**
   - This hides dependency files and creates a desktop shortcut
5. Use the **desktop shortcut** to launch the app

> **Note:** Keep the extracted folder - the shortcut needs it. You can move the folder anywhere before running setup.

---

## Usage

### Step 1: Start Your Browser

The app connects to an already-running browser. Start Edge or Chrome with remote debugging:

**Edge (Windows):**
```
"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --remote-debugging-port=9222
```

**Edge (Mac):**
```
/Applications/Microsoft\ Edge.app/Contents/MacOS/Microsoft\ Edge --remote-debugging-port=9222
```

**Chrome (similar):**
```
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```

Or use the app's **Start Browser** button to launch it automatically.

### Step 2: Navigate to Coupa

1. In the browser you just started, log into Coupa
2. Navigate to the invoice list page you want to download from

### Step 3: Download

1. Open the **Coupa Invoice Downloader** app
2. Click **Check Browser** to connect to Edge or Chrome
3. Paste the Coupa invoice list URL and click **Validate**
4. Select the file types you want to download (PDF, Excel, etc.)
5. Click **Start Download**

**The app will automatically:**
- Reload the page to ensure accurate invoice counts
- Detect the invoice column regardless of its position in the table
- Extract invoice dates and create chronologically sortable folders
- Download all attachments from each invoice
- Show a visual progress bar tracking invoice completion
- Prevent your computer from sleeping during the download
- Show detailed error messages with specific filenames if downloads fail
- Display a summary with failed downloads (if any)

Files are saved to your Downloads folder in date-prefixed folders like:
```
Downloads/
├── 2025-06-23 - INV-12345/
│   ├── invoice.pdf
│   └── receipt.xlsx
├── 2025-06-24 - INV-12346/
│   └── contract.pdf
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Failed to connect to browser" | Make sure the browser is running with `--remote-debugging-port=9222` |
| "Skipping row - link not found" | The app auto-detects invoice columns; ensure you're on an invoice list page |
| Downloads timeout | Check your internet connection; the app will retry automatically |
| No attachments found | Verify that the invoice detail page has downloadable files |
| Wrong folder names | Dates are extracted from the table; if missing, only invoice number is used |
| Windows: App won't start | Wait 30-60 seconds on first launch (extracting files) |
| Mac: "App can't be opened" | Right-click → Open → Open |

**Tips:**
- Works with both "Invoices" and "Invoice Lines" pages automatically
- Right-click in any input field to access copy/paste menu
- The invoice column can be in any position - the app finds it automatically
- Failed downloads show specific filenames and reasons at the end
- You can select and copy text from the console output
- The system will stay awake during downloads - no need to keep your screen active
- Progress bar updates in real-time as each invoice is processed
- Page refreshes automatically to get accurate counts when switching date filters

---

## Development

```bash
# Clone the repo
git clone https://github.com/stacked-house/coupahost-invoice-downloader.git
cd coupahost-invoice-downloader/Code/Backend/electron

# Install dependencies
npm install

# Run in development
npm start

# Build for Mac
npm run build:mac

# Build for Windows
npm run build:win
```

---

## Tech Stack

- **Electron** - Desktop app framework
- **Puppeteer-core** - Browser automation
- **Node.js** - Runtime

---

## Author

**stacked_house**

## License

MIT
