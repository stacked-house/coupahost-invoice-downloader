
# Coupa Invoice Downloader

A desktop app for batch downloading invoice attachments from Coupa. Works on Mac and Windows.

## Features

- 📥 Download multiple invoice attachments at once
- 📁 Automatically organizes files by date, supplier, and invoice number (e.g., `2025-06-23 - Acme Corp - INV-12345`)
- 📊 Real-time progress bar showing invoice count (e.g., "Processing: 12 of 90 invoices")
- 🔄 Smart retry logic: Each failed file is automatically retried up to 3 times with 30-second delays
- 📄 Filter by 27 file types: PDF, Excel (xlsx/xls/xlsm), Word (docx/doc), PowerPoint (pptx/ppt), CSV, TXT, XML, JSON, HTML, ZIP, Images (JPG/JPEG/PNG/GIF/BMP/TIFF/TIF), Email (EML/MSG)
- 🎯 Collapsible file type selector with Select All/Deselect All toggle
- 🖥️ Clean, modern interface with selectable console output
- 🤖 Smart auto-detection of invoice columns, suppliers, and page layouts
- 💤 Prevents system sleep during downloads (keeps screen awake)
- 📝 Detailed error reporting with specific filenames for timeouts
- 📋 Copy/paste support with right-click context menus
- 🔄 Automatic page refresh to ensure accurate invoice counts
- ⏸️ Stop button with detailed summary report showing current position
- 📊 Concise summary with failed download tracking
- 🔒 Works without admin rights
- 🛡️ Path length protection (handles long supplier names for Windows compatibility)

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
4. Double-click **`RUN ME FIRST - Setup.bat`**
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
4. Select the file types you want to download (all 27 types selected by default - click the dropdown to customize)
5. Click **Start Download**

**The app will automatically:**
- Reload the page to ensure accurate invoice counts
- Detect the invoice column and supplier information regardless of position in the table
- Extract invoice dates and suppliers to create folders like: `2025-06-23 - Acme Corp - INV-12345`
- Download all attachments from each invoice
- Retry failed downloads up to 3 times (with 30-second delays between attempts)
- Show a visual progress bar tracking invoice completion
- Prevent your computer from sleeping during the download
- Show detailed error messages with specific filenames if downloads fail
- Display a summary with failed downloads (if any)

**Stop Mid-Download:**
- Click the **Stop** button during download to gracefully halt the process
- You'll receive a detailed report showing:
  - Which invoice it stopped on (e.g., "Invoice INV-12345 (5/90)")
  - Files downloaded from the current invoice (e.g., "Downloaded 3 of 7 files")
  - Total invoices fully processed
  - Total files downloaded
  - Any failed downloads

Files are saved to your Downloads folder in organized folders like:
```
Downloads/
├── 2025-06-23 - Acme Corporation - INV-12345/
│   ├── invoice.pdf
│   └── receipt.xlsx
├── 2025-06-24 - Widget Inc - INV-12346/
│   └── contract.pdf
│   └── contract.pdf
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Failed to connect to browser" | Make sure the browser is running with `--remote-debugging-port=9222` |
| "Skipping row - link not found" | The app auto-detects invoice columns; ensure you're on an invoice list page |
| Downloads timeout | Check your internet connection; the app retries automatically (up to 3 attempts per file) |
| No attachments found | Verify that the invoice detail page has downloadable files |
| Wrong folder names | Dates are extracted from the table; if missing, only invoice number is used |
| Windows: App won't start | Wait 30-60 seconds on first launch (extracting files) |
| Mac: "App can't be opened" | Right-click → Open → Open |

**Tips:**
- Works with both "Invoices" and "Invoice Lines" pages automatically
- Right-click in any input field to access copy/paste menu
- The invoice column can be in any position - the app finds it automatically
- Supplier names are extracted from the table row and included in folder names
- Long supplier names are automatically truncated to avoid Windows path length issues
- All 27 file types are selected by default - click the dropdown to customize
- Failed downloads show specific filenames and reasons at the end
- You can select and copy text from the console output
- The system will stay awake during downloads - no need to keep your screen active
- Progress bar updates in real-time as each invoice is processed
- Page refreshes automatically to get accurate counts when switching date filters
- Use the Stop button to gracefully halt downloads and get a detailed summary report

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
```

---

## Building & Packaging

### Prerequisites
- Node.js 16+ installed
- All dependencies installed (`npm install`)

### Mac Installers

The build process creates two DMG files for Intel and Apple Silicon Macs:

```bash
cd coupahost-invoice-downloader/Code/Backend/electron

# Build both Mac installers (Intel + ARM64)
npm run build

# Or build individually
npm run build:mac      # Builds both architectures
```

**Output:**
- `dist/Coupa Invoice Downloader-1.0.0-arm64.dmg` (~245MB) - Apple Silicon (M1/M2/M3)
- `dist/Coupa Invoice Downloader-1.0.0.dmg` (~250MB) - Intel Mac

**Distribution:**
Copy both DMG files to your distribution folder. Users double-click the DMG, drag the app to Applications, and run.

### Windows Installer

The Windows build requires a special packaging process to create a clean user experience:

```bash
cd coupahost-invoice-downloader/Code/Backend/electron

# Build Windows package
npm run build:win
```

This creates `dist/win-unpacked/` with all application files. To package for distribution:

**Step 1: Create folder structure**
```bash
cd dist
mkdir -p "Coupa Invoice Downloader"
mkdir -p "Coupa Invoice Downloader/Application Files"
```

**Step 2: Copy application files**
```bash
cp -R win-unpacked/* "Coupa Invoice Downloader/Application Files/"
```

**Step 3: Add setup script**
```bash
cp ../setup-windows.bat "Coupa Invoice Downloader/RUN ME FIRST - Setup.bat"
```

**Step 4: Update setup script path**
Edit `Coupa Invoice Downloader/RUN ME FIRST - Setup.bat` and change line 24 to:
```batch
echo oLink.TargetPath = "%~dp0Application Files\Coupa Invoice Downloader.exe" >> %SCRIPT%
```
And line 25 to:
```batch
echo oLink.WorkingDirectory = "%~dp0Application Files" >> %SCRIPT%
```

**Step 5: Create final zip**
```bash
zip -qr "Coupa Invoice Downloader-1.0.0-win.zip" "Coupa Invoice Downloader"
```

**Output:**
- `dist/Coupa Invoice Downloader-1.0.0-win.zip` (~440MB)

**What the setup script does:**
- Hides all dependency files (.dll, .pak files) to keep folder clean
- Creates a desktop shortcut pointing to the app
- Makes the installation folder portable and user-friendly

**Distribution:**
The zip contains exactly 2 items users see:
1. `RUN ME FIRST - Setup.bat` - Creates shortcut and hides dependencies
2. `Application Files/` - Contains all app files

**Complete Build Process (All Platforms):**
```bash
# From the electron directory
npm run build        # Builds Mac Intel + ARM64
npm run build:win    # Builds Windows

# Then package Windows following steps above

# Copy all installers to distribution folder
mkdir -p ~/Desktop/CoupaInvoiceDownloader-Installers
cp dist/*.dmg ~/Desktop/CoupaInvoiceDownloader-Installers/
cp "dist/Coupa Invoice Downloader-1.0.0-win.zip" ~/Desktop/CoupaInvoiceDownloader-Installers/
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
