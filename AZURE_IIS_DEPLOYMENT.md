# Azure IIS VM Deployment Guide for ancoraLens

This guide walks you through deploying the ancoraLens dashboard to an Azure Windows VM running IIS.

---

## Prerequisites

- Azure VM with Windows Server (2019 or 2022 recommended)
- RDP access to the VM
- Administrator credentials

---

## Step 1: Install IIS on the Azure VM

1. **Connect to your Azure VM via RDP**

2. **Open Server Manager** → Click "Add roles and features"

3. **Install IIS:**
   - Select "Role-based or feature-based installation"
   - Select your server
   - Check **Web Server (IIS)**
   - In Features, also check:
     - ✅ .NET Framework 4.8 Features (optional but helpful)
   - Click through and **Install**

4. **Verify IIS is running:**
   - Open a browser on the VM
   - Navigate to `http://localhost`
   - You should see the default IIS welcome page

---

## Step 2: Install URL Rewrite Module (Required for SPA)

This is **critical** for single-page applications like React/Vite.

1. **Download URL Rewrite Module:**
   - Go to: https://www.iis.net/downloads/microsoft/url-rewrite
   - Or direct link: https://download.microsoft.com/download/1/2/8/128E2E22-C1B9-44A4-BE2A-5859ED1D4592/rewrite_amd64_en-US.msi

2. **Install it** by running the MSI

3. **Restart IIS:**
   ```powershell
   iisreset
   ```

---

## Step 3: Create web.config File

Create this file in your `dist` folder **before** copying to the server:

**File: `dist/web.config`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <rule name="SPA Routes" stopProcessing="true">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll">
            <add input="{REQUEST_FILENAME}" matchType="IsFile" negate="true" />
            <add input="{REQUEST_FILENAME}" matchType="IsDirectory" negate="true" />
          </conditions>
          <action type="Rewrite" url="/index.html" />
        </rule>
      </rules>
    </rewrite>
    <staticContent>
      <remove fileExtension=".js" />
      <mimeMap fileExtension=".js" mimeType="application/javascript" />
      <remove fileExtension=".css" />
      <mimeMap fileExtension=".css" mimeType="text/css" />
      <remove fileExtension=".json" />
      <mimeMap fileExtension=".json" mimeType="application/json" />
      <remove fileExtension=".woff" />
      <mimeMap fileExtension=".woff" mimeType="font/woff" />
      <remove fileExtension=".woff2" />
      <mimeMap fileExtension=".woff2" mimeType="font/woff2" />
    </staticContent>
    <httpProtocol>
      <customHeaders>
        <add name="X-Content-Type-Options" value="nosniff" />
      </customHeaders>
    </httpProtocol>
  </system.webServer>
</configuration>
```

---

## Step 4: Copy Files to the VM

### Option A: Using File Copy (Simplest)

1. **On the Azure VM**, create a folder:
   ```
   C:\inetpub\wwwroot\ancoralens
   ```

2. **Copy the entire `dist` folder contents** (including web.config) to this location:
   - You can use RDP file copy (drag and drop)
   - Or use Azure File Share
   - Or zip and transfer

### Option B: Using PowerShell (If files are on a network share)

```powershell
# On the VM
Copy-Item -Path "\\your-share\dist\*" -Destination "C:\inetpub\wwwroot\ancoralens" -Recurse -Force
```

---

## Step 5: Set Folder Permissions (IMPORTANT - This fixes your error!)

This is likely causing your "web.config no permissions" error.

1. **Open PowerShell as Administrator** on the Azure VM

2. **Run these commands:**

```powershell
# Navigate to the folder
cd C:\inetpub\wwwroot\ancoralens

# Grant IIS_IUSRS read permissions
icacls "C:\inetpub\wwwroot\ancoralens" /grant "IIS_IUSRS:(OI)(CI)RX" /T

# Grant IUSR read permissions
icacls "C:\inetpub\wwwroot\ancoralens" /grant "IUSR:(OI)(CI)RX" /T

# Grant Network Service read permissions (sometimes needed)
icacls "C:\inetpub\wwwroot\ancoralens" /grant "NETWORK SERVICE:(OI)(CI)RX" /T
```

3. **Verify permissions:**
```powershell
icacls "C:\inetpub\wwwroot\ancoralens"
```

You should see IIS_IUSRS and IUSR with (RX) permissions.

---

## Step 6: Create IIS Website

1. **Open IIS Manager** (search for "IIS" in Start menu)

2. **Right-click "Sites"** → "Add Website..."

3. **Configure the website:**
   - **Site name:** ancoraLens
   - **Physical path:** `C:\inetpub\wwwroot\ancoralens`
   - **Binding:**
     - Type: http (or https if you have a certificate)
     - IP Address: All Unassigned (or your VM's private IP)
     - Port: 80 (or your preferred port)
     - Host name: (leave blank or enter your domain)

4. **Click OK**

---

## Step 7: Configure Application Pool (Optional but Recommended)

1. In IIS Manager, click **Application Pools**

2. Find the pool created for your site (usually same name as site)

3. Right-click → **Advanced Settings...**

4. Set these values:
   - **Identity:** ApplicationPoolIdentity (default is fine)
   - **.NET CLR Version:** No Managed Code (since this is a static site)
   - **Start Mode:** AlwaysRunning (optional, for faster first load)

---

## Step 8: Configure Azure NSG (Firewall)

Make sure your Azure VM's Network Security Group allows traffic:

1. **Go to Azure Portal** → Your VM → **Networking**

2. **Add inbound rule:**
   - Source: Any (or your IP range)
   - Source port ranges: *
   - Destination: Any
   - Destination port ranges: 80 (and 443 if using HTTPS)
   - Protocol: TCP
   - Action: Allow
   - Priority: 100-300
   - Name: Allow-HTTP

---

## Step 9: Configure Windows Firewall on the VM

On the Azure VM:

```powershell
# Allow HTTP (port 80)
New-NetFirewallRule -DisplayName "Allow HTTP" -Direction Inbound -Protocol TCP -LocalPort 80 -Action Allow

# Allow HTTPS (port 443) if needed
New-NetFirewallRule -DisplayName "Allow HTTPS" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow
```

---

## Step 10: Test the Deployment

1. **On the VM**, open a browser and go to:
   ```
   http://localhost
   ```

2. **From your computer**, go to:
   ```
   http://<your-vm-public-ip>
   ```
   
   Find your public IP in Azure Portal → VM → Overview → Public IP address

---

## Troubleshooting

### "web.config has no permissions" Error

Run these commands as Administrator:

```powershell
# Take ownership
takeown /f "C:\inetpub\wwwroot\ancoralens\web.config" /a

# Grant full permissions to Administrators
icacls "C:\inetpub\wwwroot\ancoralens\web.config" /grant Administrators:F

# Grant read to IIS
icacls "C:\inetpub\wwwroot\ancoralens\web.config" /grant "IIS_IUSRS:R"
icacls "C:\inetpub\wwwroot\ancoralens\web.config" /grant "IUSR:R"
```

### 500 Error

1. Check if URL Rewrite module is installed
2. Verify web.config syntax is correct
3. Look at Event Viewer → Windows Logs → Application for errors

### 404 Error on Refresh

This means the URL Rewrite isn't working. Ensure:
1. URL Rewrite module is installed
2. web.config is in the root of your site folder
3. Restart IIS: `iisreset`

### Blank Page

1. Check browser console (F12) for JavaScript errors
2. Verify all files were copied correctly
3. Check that MIME types are set (see web.config)

---

## Quick Reference Commands

```powershell
# Restart IIS
iisreset

# Check IIS status
Get-Service W3SVC

# List all websites
Get-IISSite

# Check permissions
icacls "C:\inetpub\wwwroot\ancoralens"

# View recent IIS logs
Get-Content "C:\inetpub\logs\LogFiles\W3SVC1\*.log" -Tail 50
```

---

## File Structure After Deployment

```
C:\inetpub\wwwroot\ancoralens\
├── index.html
├── web.config          ← Required for SPA routing
├── assets/
│   ├── index-xxxxx.js
│   └── index-xxxxx.css
└── (other static files)
```

---

## Need HTTPS?

For production, you should use HTTPS. Options:

1. **Azure Application Gateway** with SSL termination
2. **Let's Encrypt** with win-acme: https://www.win-acme.com/
3. **Azure-provided SSL certificate** if using custom domain

---

**Your deployment should now be working! Access it at your VM's public IP.**
