# TDMA UI Quick Start Guide

## Overview

The TDMA UI is a complete Electron-based control panel for managing DECT NR+ TDMA operations on master (FT) and slave (PT) devices.

## Installation & Setup

### Prerequisites
- Node.js (v14 or higher)
- Two DECT NR+ devices with thingy91x boards
- USB cables for serial connections

### Quick Setup

```bash
cd c:\Users\pmupm\Desktop\praktikak\dect_v2\dect-nr\mac_tdma\tdma_ui

# Install dependencies
npm install

# Start the application
npm start

# Or build standalone executable
npm run build
```

## Workflow: Master + 2 Slaves

### Step 1: Connect Master Device

1. Connect master device via USB
2. In UI, select port under **Master** → **Connection** → **Serial Port**
3. Click **Connect**
4. Status should show "CONNECTED" (green badge)

### Step 2: Start Beacon

1. In **Master** panel → **Beacon Configuration**
2. Set channel (default 1677, valid range 1640-1680)
3. Click **Start Beacon**
4. Status will change to "BEACON_RUNNING" (orange badge)
5. Output will show beacon initialization messages

### Step 3: Connect First Slave

1. Connect first slave device via separate USB port
2. In UI, select port under **Slave** → **Connection** → **Serial Port**
3. Click **Connect**
4. Status should show "CONNECTED" (green badge)

### Step 4: Slave Associates with Master

1. In **Slave** panel → **Association**
2. Enter **Master ID**: Must match the beacon master ID (default 1234)
3. Select **MCS**: Choose 0-4 (4 = fastest, 0 = most reliable)
4. Click **Associate**
5. Output will show association request/response
6. Status will change to "ASSOCIATED" (orange badge)

### Step 5: Send Data (Single Shot)

1. In **Slave** panel → **Random Access Channel (RACH) TX**
2. Enter **Master ID**: Same as beacon master
3. Enter **Data to Send**: Text message
4. Select **MCS**: 0-4
5. Set **TX Power**: -20 to +20 dBm (0 = default)
6. Leave **Periodic Transmission** unchecked
7. Click **Start TX**
8. Data is transmitted once

### Step 6: Send Data (Periodic)

1. Same as Step 5 but:
2. Check **Periodic Transmission**
3. Set **Interval**: Repeat every N seconds
4. Click **Start TX**
5. Data transmits repeatedly at specified interval
6. Click **Stop TX** to halt

### Step 7: Connect & Use Second Slave

Repeat Steps 3-6 with a second slave device on a different USB port.

## Commands Reference

### Master

| Command | Parameters | Example |
|---------|------------|---------|
| Start Beacon | Channel (1640-1680) | `dect mac beacon_start -c 1677` |
| Stop Beacon | None | `dect mac beacon_stop` |

### Slave

| Command | Parameters | Example |
|---------|------------|---------|
| Associate | Master ID, MCS (0-4) | `dect mac associate -t 1234 -m 4` |
| Dissociate | Master ID | `dect mac dissociate -t 1234` |
| Send Data (Single) | Master ID, Text, MCS, TX Power | `dect mac rach_tx -t 1234 -d "Hello" -m 4 --tx_pwr 0` |
| Send Data (Periodic) | + Interval (seconds) | `dect mac rach_tx -t 1234 -d "Hello" -j -m 4 --tx_pwr 0 -i 10` |
| Stop RACH TX | None | `dect mac rach_tx stop` |

## UI Panels

### Master Panel (Left/Top)

- **Connection**: Select serial port, connect/disconnect
- **Beacon Configuration**: Set channel, start/stop beacon
- **Output**: Real-time messages from master device
- **Status Badge**: Shows connection and beacon state

### Slave Panel (Right/Bottom)

- **Connection**: Select serial port, connect/disconnect
- **Association**: Associate with master, select MCS
- **RACH TX**: Configure and send data
  - Single or periodic transmission
  - MCS selection (0-4)
  - TX Power control
  - Interval for periodic mode
- **Output**: Real-time messages from slave device
- **Status Badge**: Shows connection and association state

## Parameters Explained

### MCS (Modulation and Coding Scheme)

| MCS | Data Rate | Range | Reliability | Use Case |
|-----|-----------|-------|-------------|----------|
| 0 | Lowest | Longest | Highest | Long range, low bandwidth |
| 1 | Low | Long | High | - |
| 2 | Medium | Medium | Medium | Balanced |
| 3 | High | Short | Low | - |
| 4 | Highest | Shortest | Lowest | Short range, max throughput |

### TX Power (dBm)

- **Range**: -20 to +20 dBm
- **Default**: 0 dBm
- **Lower values**: Shorter range, less interference
- **Higher values**: Longer range, more power consumption

### Channel (MHz)

- **Valid Range**: 1640-1680 MHz
- **Recommended**: 1677 MHz (default, usually less congested)
- **Spacing**: 1 MHz channels

## Troubleshooting

### Serial Ports Not Showing

1. Check USB connections with Device Manager
2. Verify devices are powered on
3. Click "Refresh ports" button
4. Try different USB ports/cables

### Cannot Associate

| Issue | Solution |
|-------|----------|
| "Master not found" | Ensure beacon is running on master |
| "Association timeout" | Try lower MCS (0-2) for reliability |
| "Same port error" | Connect master and slave to different USB ports |
| Wrong Master ID | Verify Master ID matches beacon device |

### TX Fails

| Issue | Solution |
|-------|----------|
| "Not associated" | Associate slave with master first |
| "TX power out of range" | Use -20 to +20 dBm |
| "Invalid MCS" | MCS must be 0-4 |
| "No response" | Check devices are on same channel |

### Output Not Appearing

1. Ensure serial port is connected
2. Check baud rate is 115200
3. Clear output and try command again
4. Check Debug Log panel for errors

## Output Examples

### Master Beacon Started
```
Beacon starting
RSSI scan started.
[... scanning channels ...]
Beacon TX scheduled: channel 1677, frame_time 12345678
```

### Slave Associated
```
Sending association_req to FT 1234's random access resource
Association request TX started.
TX for Association Request completed.
Association Response received: ACK, slots assigned
```

### Data Transmitted
```
Client TX to RACH started.
Client data TX completed.
Frame time: 123456789, Assigned slot: 42, MCS: 4
```

## Debug Log

The Debug Log panel (top) shows all application events:
- Port connections/disconnections
- Commands sent
- Status changes
- Errors and warnings

Useful for troubleshooting serial communication issues.

## Performance Tips

1. **Use appropriate MCS**: Lower MCS for reliability, higher for speed
2. **Adjust TX Power**: 
   - Reduce if devices are close (avoid saturation)
   - Increase if devices are far apart
3. **Channel Selection**: Use quieter channels if beacon fails to start
4. **Periodic Intervals**: Use longer intervals for better reliability

## Advanced: Manual Commands

You can manually send commands via serial (for debugging):
1. Connect to device via serial terminal (e.g., PuTTY)
2. Type commands directly: `dect mac beacon_start -c 1677`

## File Structure

```
tdma_ui/
├── main.js           # Electron main process, serial I/O
├── renderer.js       # UI logic, event handlers
├── index.html        # UI markup
├── style.css         # Styling
├── preload.js        # IPC bridge
├── package.json      # Dependencies
└── README.md         # Full documentation
```

## Support

For issues or questions:
1. Check Debug Log panel
2. Review troubleshooting section
3. Consult README.md for complete documentation
4. Check device connections and serial port settings
