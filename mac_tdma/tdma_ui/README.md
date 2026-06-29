# TDMA UI Control Panel

A comprehensive Electron-based user interface for controlling DECT NR+ TDMA operations on master and slave devices.

## Features

### Master (Fixed Termination - FT)
- **Connection Management**: Connect/disconnect via serial port
- **Beacon Control**: Start/stop beacon on configurable channel (1640-1680)
- **Real-time Output**: View beacon and network status messages

### Slave (Portable Termination - PT)
- **Connection Management**: Separate serial port connection
- **Association**: Associate with master device with configurable MCS (0-4)
- **RACH TX**: Send data through Random Access Channel
  - Single shot or periodic transmission
  - Configurable MCS (0-4)
  - TX Power control (-20 to +20 dBm)
  - Optional TDMA iteration multiplier for client frame spacing (default 4)
  - Optional TDMA iteration count for the number of scheduled transmissions (default 40)
  - Optional periodic interval (1-3600 seconds)
- **Real-time Output**: View association and transmission status

## Installation

1. Navigate to the tdma_ui directory:
```bash
cd tdma_ui
```

2. Install dependencies:
```bash
npm install
```

## Running the Application

### Development Mode
```bash
npm start
```

### Building Standalone Executable
```bash
npm run build
```

This creates a portable EXE in the `dist` folder.

## Usage

### Master Setup
1. Connect master device via serial port
2. Select port and click "Connect"
3. Configure beacon channel (default: 1677)
4. Click "Start Beacon" to initiate beacon transmission

### Slave Setup
1. Connect slave device via serial port (separate port from master)
2. Select port and click "Connect"
3. Enter master ID (should match beacon master ID)
4. Configure association MCS (0-4, where 4 is highest rate)
5. Click "Associate" to establish connection with master

### Transmitting Data
1. Ensure slave is associated with master
2. Configure RACH TX parameters:
   - **Data**: Text message to send
   - **MCS**: Modulation and coding scheme (0-4)
   - **TX Power**: Transmission power in dBm (-20 to +20)
   - **TDMA Iteration Multiplier**: Multiplier for client TDMA frame spacing (default 4)
   - **TDMA Iteration Count**: Number of client TDMA iterations to schedule (default 40)
   - **Periodic**: Enable for repeated transmission at specified interval

3. Click "Start TX" to begin transmission
4. Click "Stop TX" to halt transmission

## Command Reference

### Master Commands
```bash
# Start beacon on specified channel
dect mac beacon_start -c 1677

# Stop beacon
dect mac beacon_stop
```

### Slave Commands
```bash
# Associate with master
dect mac associate -t <masterId> -m <mcs>

# Dissociate from master
dect mac dissociate -t <masterId>

# Send single TDMA TX
dect mac rach_tx -t <masterId> -d "<data>" -m <mcs> --tx_pwr <power> -q <multiplier> -r <iteration_count>

# Send periodic TDMA TX (interval in seconds)
dect mac rach_tx -t <masterId> -d "<data>" -j -m <mcs> --tx_pwr <power> -i <interval> -q <multiplier> -r <iteration_count>

# Stop RACH TX
dect mac rach_tx stop
```

## Serial Port Connection

The application communicates with DECT devices via serial ports (typically USB-UART adapters):
- **Baud Rate**: 115200
- **Data Bits**: 8
- **Stop Bits**: 1
- **Parity**: None
- **Flow Control**: None

## Parameters

### MCS (Modulation and Coding Scheme)
- **0**: Lowest data rate, best range/reliability
- **1**: Low rate
- **2**: Medium rate
- **3**: High rate
- **4**: Highest data rate, shortest range

### TX Power (dBm)
- Range: -20 to +20 dBm
- Default: 0 dBm
- Negative values reduce range, positive values increase range

### Channel Selection
Valid channels: 1640-1680 MHz
Default: 1677 MHz

## Debug Log

The debug log panel at the top shows all application events including:
- Serial port connections/disconnections
- Commands sent to devices
- Connection status changes
- Errors and warnings

## Architecture

- **main.js**: Electron main process - handles serial communication and IPC
- **renderer.js**: Renderer process - UI logic and event handling
- **index.html**: UI markup
- **style.css**: UI styling
- **preload.js**: IPC bridge (optional, for security)
- **package.json**: Dependencies and build configuration

## Notes

- Each device (master and slave) requires a separate serial port connection
- Beacon must be running on master before slaves can associate
- Master and slaves must be on the same channel
- RACH TX can only be performed by associated slaves
- Output messages are displayed in real-time as received from devices

## Troubleshooting

### Serial Port Not Found
- Ensure devices are connected via USB
- Check Device Manager for COM port assignments
- Click "Refresh ports" to reload available ports

### Association Fails
- Verify beacon is running on master
- Check that slave is on the same channel as master
- Ensure Master ID is correct
- Try reducing MCS (lower values = more reliable)

### TX Errors
- Ensure slave is associated before attempting TX
- Verify Master ID matches beacon master
- Check TX Power is within valid range
- Reduce TX Power if device is too close

## License

ISC
