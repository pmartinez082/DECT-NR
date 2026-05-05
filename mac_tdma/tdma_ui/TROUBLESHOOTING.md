# Output Display Troubleshooting & Testing Guide

## Changes Made

Fixed several issues to ensure serial output is properly captured and displayed:

### 1. **Line Ending Handling** 
Changed from splitting by single `\n` to handling both `\r\n` (Windows) and `\n` (Unix):
```javascript
// Before: split('\n')
// After: split(/\r?\n/) 
```

### 2. **Buffer Management**
Improved buffer parsing to properly preserve incomplete lines and process complete ones.

### 3. **Command Formatting**
Updated command sending to use proper line ending (`\r\n`):
```javascript
const fullCmd = cmd + '\r\n';  // Instead of just '\r'
```

### 4. **Error Handling**
Added try-catch around data processing to catch any parsing errors.

### 5. **Improved Logging**
- Debug log now shows timestamps
- Commands shown with `>>>` prefix for clarity
- Better error messages

## Testing Steps

### Step 1: Start the Application
```bash
cd tdma_ui
npm start
```

You should see in the Debug Log:
```
[12:34:56] [APP] TDMA UI Application Started
```

### Step 2: Connect Master Device

1. Select port from dropdown
2. Click **Connect**
3. Debug log should show:
   ```
   [12:34:57] [MASTER] Attempting to connect to COM3
   [12:34:57] [MASTER] Serial port opened successfully on COM3
   ```

### Step 3: Send Beacon Scan Command

In your terminal connected to the device, type:
```bash
dect mac beacon_scan -c 1677
```

OR use the UI (once beacon is running):
1. Set channel to 1677
2. Click **Start Beacon**

You should see output appearing in the **Master Output** panel like:
```
Beacon scan started.
Starting RX: channel 1677, rssi_level 0, duration 4 secs.
PDC received at frame_time 140745515318
  Network ID (24bit MSB):  1193046 (0x123456)
  Transmitter ID:          38 (0x00000026)
  ...
```

### Step 4: Verify Debug Log

The Debug Log should show:
```
[12:35:01] [MASTER] >>> dect mac beacon_scan -c 1677
```

## If Output Still Doesn't Appear

### 1. **Check Console for Errors**
- Open DevTools: Press `F12` in the Electron window
- Check Console tab for JavaScript errors
- Check Network tab for IPC issues

### 2. **Verify Serial Port Connection**
```bash
# On Windows PowerShell
Get-WmiObject Win32_SerialPort | Select-Object Name, Description, DeviceID
```

### 3. **Test Serial Port Directly**
Use a terminal program like PuTTY to verify the device is responding:
- Port: COM3 (or your port)
- Baud: 115200
- Data Bits: 8
- Stop Bits: 1
- Parity: None

Type a command and you should see output.

### 4. **Check if Data is Being Received**
Add debugging to renderer.js temporarily:

```javascript
ipcRenderer.on('master-output', (_, data) => {
  console.log('Received master output:', data);  // Add this line
  if (masterOutput && data) {
    masterOutput.textContent += data + '\n';
    masterOutput.scrollTop = masterOutput.scrollHeight;
  }
});
```

Then check the DevTools Console to see if messages are appearing there.

### 5. **Verify IPC Communication**
Add debugging to main.js:

```javascript
masterPort = openSerial(port, 'MASTER', 'master', (data) => {
  const dataStr = data.toString();
  console.log('Raw data received:', dataStr);  // Add this line
  masterBuffer += dataStr;
  ...
});
```

Restart and check console output.

## Expected TX ID Extraction

When a slave associates with the master, the association response contains important information that should be parsed. The output you showed:

```
Transmitter ID: 38 (0x00000026)
short rd id 7762 (0x1e52)
```

The `short rd id` (7762 in this case) is what should be used as the TX ID in future RACH transmissions from that slave.

### Parsing Strategy

The UI could extract this by looking for lines containing "short rd id" pattern:

```javascript
// Pattern: "short rd id XXXX (0xHEXHEX)"
const match = line.match(/short rd id (\d+)/);
if (match) {
  const txId = parseInt(match[1]);
  // Store this for later reference
}
```

## Sample Complete Workflow

### Master Side
```
1. Connect to port COM3
   [MASTER] Serial port opened successfully on COM3
   
2. Send beacon_start
   [MASTER] >>> dect mac beacon_start -c 1677
   
3. See beacon output
   Beacon starting
   RSSI scan started
   Beacon TX scheduled: channel 1677, frame_time ...
```

### Slave Side
```
1. Connect to port COM4
   [SLAVE1] Serial port opened successfully on COM4
   
2. Send associate
   [SLAVE1] >>> dect mac associate -t 1234 -m 4
   
3. See association response
   Sending association_req to FT 1234
   Association request TX started
   TX for Association Request completed
   Association Response received: ACK
   
4. Note TX ID from response
   short rd id 7762 (0x1e52)
   
5. Use that TX ID for future RACH TX
   [SLAVE1] >>> dect mac rach_tx -t 1234 -d "Test" -m 4
```

## Performance Notes

- Serial data is processed as it arrives in chunks
- Buffers are cleared after each complete line is sent
- Maximum display size: Limited by textarea (can be large, ~10MB+ on modern browsers)
- Scrolling is automatic for new messages

## Limitations

- Currently handles single master + single slave per UI instance
- No log persistence (clears on restart)
- Output display limited to visible textarea size
- No filtering or searching of output

## Next Steps

Once output is working:

1. **Implement TX ID Parsing**: Extract `short rd id` from association responses
2. **Track Association State**: Store master↔slave mappings for proper TX routing
3. **Enhanced Output Formatting**: Parse RACH RX messages to extract slots and timing info
4. **Data Logging**: Save output to CSV or JSON for analysis

## Quick Checklist

- [ ] npm start works without errors
- [ ] Debug log shows "[APP] TDMA UI Application Started"  
- [ ] Can connect to master port
- [ ] Master port status shows "CONNECTED"
- [ ] Can send commands (see ">>>" in debug log)
- [ ] Output appears in Master Output panel
- [ ] Can connect to slave port
- [ ] Slave status shows "CONNECTED"
- [ ] Can send commands from slave
- [ ] Slave output appears in Slave Output panel

If all checkboxes pass, the basic functionality is working correctly!
