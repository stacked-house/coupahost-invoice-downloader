# Edge download runner

This helper connects to a Microsoft Edge instance started with --remote-debugging-port and runs a simple automation that:

- Uses an XPath extracted from your Selenium-IDE JSON file to find list rows
- Clicks each row and clicks PDF attachments on the detail page
- Forces downloads to a specified directory (default: your Downloads folder)

How it works
- You either start Edge with remote debugging enabled and run the script in `connect` mode, or run it without attaching (launch mode) and it will start Edge for you.

Important note about attaching to an existing tab
- You can only attach to an existing Edge process if it was started with `--remote-debugging-port` enabled. If Edge is already open without that flag you won't be able to attach to the running instance.

## How to use (3 steps)

1. **Stop all Edge processes:**
	```powershell
	Stop-Process -Name msedge -Force -ErrorAction SilentlyContinue
	```
2. **Start Edge with remote debugging:**
	```powershell
	Start-Process "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" -ArgumentList '--remote-debugging-port=9222','--no-first-run','--no-default-browser-check'
	```
3. **Run the downloader:**
	```powershell
	node run_downloads_edge.js --json Download_Invoices.json --mode connect --browserUrl http://127.0.0.1:9222 --target-url "coupahost" --xpath "//table[contains(@class,'table')]//tbody/tr[.//td[1]//a]//td[1]//a"
	```

In Edge, log in and open the invoice page/tab you want before running the Node command.
```

If you cannot start Edge with `--remote-debugging-port`, use `--mode launch` (the script will open a new Edge instance and run the flow there) — however this will not operate on a tab you already had open.

Limitations & notes
- The script extracts the first XPath it finds inside the Selenium JSON and uses that to identify list rows. You can override that with the `--xpath` option to specify an exact XPath for the list rows (recommended for reliability).
- The script uses simple waits (timeouts) around clicks; you may need to increase waits if your site is slow.
- The script attempts to click PDF links and relies on Chrome/Edge behavior to save PDFs rather than open them in a viewer. If the site opens PDFs in a viewer page, the script will open them in a new tab to trigger the download behavior.

- The script now watches the download folder for newly added files and waits for them to finish downloading before continuing. If your attachments are large or your connection is slow, increase the per-download timeout with `--wait-ms-per-download` (milliseconds; default 120000 = 2 minutes).

Troubleshooting: permission/elevation prompts (run without admin) ⚠️

- If you were prompted for elevated/admin permissions while running `npm install` or the script, you can usually avoid that by:
	- Running all commands in your workspace folder (no global installs). From PowerShell run in the project folder:

```powershell
cd "C:\Users\C127660\Desktop\Download_Scirpts"
npm install --no-audit --no-fund --no-package-lock
```

	- If a package's install script tries to download a browser binary, use `--ignore-scripts` to prevent postinstall scripts from running:

```powershell
npm ci --ignore-scripts
```

	- Ensure you're not installing packages globally (no `-g`) and that `NODE_PATH` or `npm` prefix settings aren't pointing to a system directory that requires admin rights.

- The runner uses `puppeteer-core`, which does not auto-download a Chromium binary (so it shouldn't require extra downloads). If you see a download request, please copy the terminal output here so I can identify which package or step triggered it.

- If the permission prompt is coming from starting Edge (e.g., a Windows UAC), that usually indicates an updater or installer trying to run — starting Edge with `Start-Process` as shown in the Quick Start generally does not require admin rights.

- If you continue to see a prompt, paste the terminal output or error message here and I'll diagnose the exact cause and either remove the step that requires elevation or provide an alternative (for example, using the already-running Edge `--remote-debugging-port` attach flow, or vendorizing the node modules).

If you'd like, I can:

- Add a `--xpath` parameter so you can supply the exact XPath to the list rows
- Add better file-download monitoring (watch the folder and wait until expected files appear)
- Convert this to a Python + Playwright version if you prefer Python

Happy to update the script to better match your site structure — tell me which option you prefer or whether you want me to implement the `--xpath` arg.
