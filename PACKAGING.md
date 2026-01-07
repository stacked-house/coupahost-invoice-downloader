# Packaging Guide

Complete guide for building and packaging Coupa Invoice Downloader installers for macOS and Windows.

## Prerequisites

- Node.js 16+ installed
- Git repository cloned
- All dependencies installed: `npm install`

## Directory Structure

```
Code/Backend/electron/
├── dist/                           # Build output directory
│   ├── Coupa Invoice Downloader-1.0.0-arm64.dmg
│   ├── Coupa Invoice Downloader-1.0.0.dmg
│   ├── Coupa Invoice Downloader-1.0.0-win.zip
│   └── win-unpacked/               # Windows build files
├── main.js                         # Electron main process
├── renderer.js                     # UI logic
├── index.html                      # App interface
├── setup-windows.bat               # Windows setup script template
└── package.json                    # Build configuration
```

---

## Mac Packaging (macOS)

### Build Process

```bash
cd /path/to/coupahost-invoice-downloader/Code/Backend/electron
npm run build
```

### What Happens

electron-builder automatically:
1. Packages the app for both Intel and Apple Silicon
2. Creates DMG installers with app bundle
3. Generates blockmap files for delta updates
4. Outputs to `dist/` folder

### Output Files

- **Coupa Invoice Downloader-1.0.0-arm64.dmg** (~245MB)
  - For Apple Silicon Macs (M1, M2, M3, M4)
  - Architecture: arm64
  
- **Coupa Invoice Downloader-1.0.0.dmg** (~250MB)
  - For Intel Macs
  - Architecture: x64

### Distribution

1. Copy both DMG files to your distribution folder:
   ```bash
   cp dist/*.dmg ~/Desktop/CoupaInvoiceDownloader-Installers/
   ```

2. Users install by:
   - Double-clicking the DMG
   - Dragging app to Applications folder
   - Right-click → Open (first time only, for security)

---

## Windows Packaging (Cross-platform)

Windows packaging requires additional steps to create a clean user experience.

### Step 1: Build Windows Files

```bash
cd /path/to/coupahost-invoice-downloader/Code/Backend/electron
npm run build:win
```

This creates `dist/win-unpacked/` containing:
- `Coupa Invoice Downloader.exe` (176MB)
- DLL files (libEGL.dll, libGLESv2.dll, ffmpeg.dll, etc.)
- PAK files (chrome_100_percent.pak, resources.pak, etc.)
- `locales/` folder with language files
- `resources/` folder with app code

### Step 2: Create Packaging Structure

```bash
cd dist
rm -rf "Coupa Invoice Downloader"  # Clean previous build
mkdir -p "Coupa Invoice Downloader/Application Files"
```

### Step 3: Copy Application Files

```bash
cp -R win-unpacked/* "Coupa Invoice Downloader/Application Files/"
```

### Step 4: Add Setup Script

The setup script (`setup-windows.bat`) provides a clean installation experience:

```bash
cp ../setup-windows.bat "Coupa Invoice Downloader/RUN ME FIRST - Setup.bat"
```

**Edit the copied setup script** to update paths for the subfolder structure:

Open `"Coupa Invoice Downloader/RUN ME FIRST - Setup.bat"` and modify:

**Line 24:** Change from:
```batch
echo oLink.TargetPath = "%~dp0Coupa Invoice Downloader.exe" >> %SCRIPT%
```
To:
```batch
echo oLink.TargetPath = "%~dp0Application Files\Coupa Invoice Downloader.exe" >> %SCRIPT%
```

**Line 25:** Change from:
```batch
echo oLink.WorkingDirectory = "%~dp0" >> %SCRIPT%
```
To:
```batch
echo oLink.WorkingDirectory = "%~dp0Application Files" >> %SCRIPT%
```

### Step 5: Create Final ZIP

```bash
zip -qr "Coupa Invoice Downloader-1.0.0-win.zip" "Coupa Invoice Downloader"
```

### What the Setup Script Does

The `setup-windows.bat` script:

1. **Hides dependency files** to keep folder clean:
   - All .dll files
   - All .pak files
   - locales/ folder
   - resources/ folder
   - Other technical files

2. **Creates desktop shortcut**:
   - Named "Coupa Invoice Downloader"
   - Points to the .exe in Application Files
   - Includes description
   - Uses proper working directory

3. **Hides itself** after running

### Output Structure

The final ZIP contains exactly 2 visible items:

```
Coupa Invoice Downloader-1.0.0-win.zip
└── Coupa Invoice Downloader/
    ├── RUN ME FIRST - Setup.bat          # User clicks this first
    └── Application Files/                # Contains all app files
        ├── Coupa Invoice Downloader.exe
        ├── *.dll (hidden after setup)
        ├── *.pak (hidden after setup)
        ├── locales/ (hidden after setup)
        └── resources/ (hidden after setup)
```

### Distribution

1. Copy the ZIP to your distribution folder:
   ```bash
   cp "Coupa Invoice Downloader-1.0.0-win.zip" ~/Desktop/CoupaInvoiceDownloader-Installers/
   ```

2. Users install by:
   - Extracting the ZIP to a permanent location (Desktop, Documents, etc.)
   - Double-clicking `RUN ME FIRST - Setup.bat`
   - Using the desktop shortcut created by the setup script

### Output File

- **Coupa Invoice Downloader-1.0.0-win.zip** (~440MB)
  - Contains setup script + Application Files folder
  - Setup script creates desktop shortcut
  - No admin rights required

---

## Complete Build Workflow

### Build All Platforms

```bash
# Navigate to electron directory
cd /path/to/coupahost-invoice-downloader/Code/Backend/electron

# Build Mac installers (both architectures)
npm run build

# Build Windows package
npm run build:win

# Package Windows with clean structure
cd dist
rm -rf "Coupa Invoice Downloader"
mkdir -p "Coupa Invoice Downloader/Application Files"
cp -R win-unpacked/* "Coupa Invoice Downloader/Application Files/"
cp ../setup-windows.bat "Coupa Invoice Downloader/RUN ME FIRST - Setup.bat"

# Edit the setup script paths (lines 24-25) as described above

# Create Windows ZIP
zip -qr "Coupa Invoice Downloader-1.0.0-win.zip" "Coupa Invoice Downloader"
cd ..

# Copy all installers to distribution folder
mkdir -p ~/Desktop/CoupaInvoiceDownloader-Installers
cp dist/Coupa\ Invoice\ Downloader-1.0.0-arm64.dmg ~/Desktop/CoupaInvoiceDownloader-Installers/
cp dist/Coupa\ Invoice\ Downloader-1.0.0.dmg ~/Desktop/CoupaInvoiceDownloader-Installers/
cp "dist/Coupa Invoice Downloader-1.0.0-win.zip" ~/Desktop/CoupaInvoiceDownloader-Installers/

# Verify files
ls -lh ~/Desktop/CoupaInvoiceDownloader-Installers/
```

### Expected Output Sizes

- Mac ARM64 DMG: ~245MB
- Mac Intel DMG: ~250MB
- Windows ZIP: ~440MB

---

## Troubleshooting

### Mac: "App can't be opened"
- User must right-click → Open on first launch
- This is normal macOS security for unsigned apps

### Windows: Extract error on Mac
- Ignore errors about symlinks when extracting on macOS
- The Windows ZIP will extract correctly on Windows systems
- These are Mac-specific Electron framework symlinks

### Windows: Setup script doesn't run
- Ensure user extracted to a permanent location (not in Downloads)
- User must have the folder they want to keep the app in
- Script creates shortcut to .exe location

### Build fails: "Cannot find module"
- Run `npm install` to ensure all dependencies are installed
- Delete `node_modules/` and run `npm install` again

### DMG won't open
- Ensure file wasn't corrupted during transfer
- Try re-downloading or re-building

---

## Version Management

Update version in `package.json` before building:

```json
{
  "name": "coupa-invoice-downloader",
  "version": "1.0.0",  // Update this
  "description": "Batch download invoice attachments from Coupa"
}
```

This version number appears in:
- File names (Coupa Invoice Downloader-1.0.0-win.zip)
- App About dialog
- System properties

---

## Security Notes

- Apps are not code-signed (would require Apple Developer account for Mac, certificate for Windows)
- Users will see security warnings on first launch
- This is expected for free/internal distribution
- For production distribution, consider code signing

---

## Testing Checklist

Before distributing:

**Mac:**
- [ ] DMG opens without errors
- [ ] App drags to Applications
- [ ] App launches after installation
- [ ] All features work (browser connection, downloads, etc.)
- [ ] Test on both Intel and Apple Silicon if possible

**Windows:**
- [ ] ZIP extracts without errors
- [ ] Contains exactly 2 visible items (setup script + Application Files)
- [ ] Setup script creates desktop shortcut
- [ ] Setup script hides dependency files
- [ ] Shortcut launches app correctly
- [ ] App connects to browser and downloads files

**Both platforms:**
- [ ] File sizes are reasonable (~245-440MB)
- [ ] README.md accurately reflects current version
- [ ] All features documented work as expected
