
# Coupa Invoice Downloader Desktop App (2025)

This app provides a simple, user-friendly desktop interface for downloading invoices from Coupa using your browser. **All actions are performed through the app's graphical interface—no terminal or command-line steps are required.**

## How to Use

1. **Download and install** the app (or unzip the folder if provided as a portable app).
2. **Open the app** (double-click the executable or run via Electron if developing).
3. **Follow the three-step UI:**
   - **Step 1:** Select your browser (Edge or Chrome) and click "Start/Check Browser". The app will launch the browser with remote debugging enabled if it's not already running.
   - **Step 2:** Enter the full Coupa URL you want to process (e.g., the invoice list page) and click "Validate URL". The app will check that the page is open in your browser.
   - **Step 3:** Click "Download" to start the invoice download process. Progress and results will be shown in the app.

## Features

- No command-line or terminal usage required
- Supports Microsoft Edge and Google Chrome (Chromium-based browsers)
- Automatically launches the browser with the correct settings if needed
- Validates that the correct Coupa page is open before starting
- Downloads all invoice PDFs as described in your Selenium-IDE JSON config
- Progress and results are displayed in the app

## Limitations & Notes

- Only Chromium-based browsers (Edge, Chrome) are supported
- The app uses the first XPath found in your Selenium JSON to identify list rows (custom XPath support may be added in the future)
- If your site is slow, downloads may take longer; the app waits for each file to finish downloading
- PDFs are saved to your default Downloads folder

## Troubleshooting

- If the browser does not launch or connect, ensure no other instance is running with remote debugging disabled
- If downloads do not appear, check that the Coupa page is fully loaded and you are logged in
- For any issues, please contact the maintainer with details about your browser and OS

---

**All previous command-line instructions are now obsolete. Please use only the desktop app interface for all operations.**
