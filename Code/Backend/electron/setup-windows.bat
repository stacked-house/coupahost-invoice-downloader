@echo off
echo Setting up Coupa Invoice Downloader...
echo.

:: Hide all dependency files and folders (but not the main exe or this script)
attrib +h "chrome_100_percent.pak" 2>nul
attrib +h "chrome_200_percent.pak" 2>nul
attrib +h "d3dcompiler_47.dll" 2>nul
attrib +h "ffmpeg.dll" 2>nul
attrib +h "icudtl.dat" 2>nul
attrib +h "libEGL.dll" 2>nul
attrib +h "libGLESv2.dll" 2>nul
attrib +h "LICENSE.electron.txt" 2>nul
attrib +h "LICENSES.chromium.html" 2>nul
attrib +h "resources.pak" 2>nul
attrib +h "snapshot_blob.bin" 2>nul
attrib +h "v8_context_snapshot.bin" 2>nul
attrib +h "vk_swiftshader.dll" 2>nul
attrib +h "vk_swiftshader_icd.json" 2>nul
attrib +h "vulkan-1.dll" 2>nul
attrib +h "resources" /d 2>nul
attrib +h "locales" /d 2>nul

:: Hide Application Files folder
attrib +h "Application Files" /d 2>nul

:: Create desktop shortcut
echo Creating desktop shortcut...
set SCRIPT="%TEMP%\CreateShortcut.vbs"
echo Set oWS = WScript.CreateObject("WScript.Shell") > %SCRIPT%
echo sLinkFile = oWS.SpecialFolders("Desktop") ^& "\Coupa Invoice Downloader.lnk" >> %SCRIPT%
echo Set oLink = oWS.CreateShortcut(sLinkFile) >> %SCRIPT%
echo oLink.TargetPath = "%~dp0Coupa Invoice Downloader.exe" >> %SCRIPT%
echo oLink.WorkingDirectory = "%~dp0" >> %SCRIPT%
echo oLink.Description = "Download invoices from Coupa" >> %SCRIPT%
echo oLink.Save >> %SCRIPT%
cscript /nologo %SCRIPT%
del %SCRIPT%

:: Hide this setup script too
attrib +h "%~f0"

echo.
echo ========================================
echo Setup complete!
echo.
echo A shortcut has been created on your Desktop.
echo You can now use "Coupa Invoice Downloader" from there.
echo.
echo You may delete this folder or move it somewhere safe.
echo (The app will run from the shortcut)
echo ========================================
echo.
pause
