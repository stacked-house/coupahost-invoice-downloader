
# Coupa Invoice Downloader

A desktop app for batch downloading invoice attachments from Coupa. Works on Mac and Windows.

## Features

- 📥 Download multiple invoice attachments at once
- 📁 Automatically organizes files into folders by invoice name
- 🔄 Retry logic for failed downloads (up to 3 attempts)
- 📄 Filter by file type: PDF, Excel, CSV, Word, PNG, JPG
- 🖥️ Clean, modern interface with real-time progress
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
2. Select the browser (Edge or Chrome)
3. Paste the Coupa URL and click **Validate**
4. Check the file types you want (PDF, Excel, etc.)
5. Click **Download**

Files are saved to your Downloads folder, organized by invoice name.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Failed to connect to browser" | Make sure the browser is running with `--remote-debugging-port=9222` |
| First invoice fails | The app will automatically retry up to 3 times |
| No attachments found | Check that the invoice detail page has downloadable files |
| Windows: App won't start | Wait 30-60 seconds on first launch (extracting files) |
| Mac: "App can't be opened" | Right-click → Open → Open |

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
