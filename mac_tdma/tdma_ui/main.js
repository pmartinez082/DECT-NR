const { app, BrowserWindow, ipcMain } = require('electron');
const { SerialPort } = require('serialport');
const path = require('path');
const fs = require('fs');

/* ===================== UTILITY FUNCTIONS ===================== */

// Simple ANSI escape code stripper (replacement for strip-ansi)
function stripAnsi(str) {
  if (typeof str !== 'string') return str;
  // Remove ANSI escape sequences: ESC [ ... m pattern
  return str.replace(/\x1b\[[0-9;]*m/g, '')
            .replace(/\x1b\[K/g, '')
            .replace(/\x1b\[\?25[lh]/g, '');
}

/* ===================== GLOBAL STATE ===================== */

let win;
let masterPort = null;
let slavePorts = {}; // { slave1: port, slave2: port, ... }
let masterPortOpen = false;
let slavePortsOpen = {}; // { slave1: true/false, slave2: true/false, ... }

let masterBuffer = '';
let slaveBuffers = {}; // { slave1: '', slave2: '', ... }

let masterStatus = 'disconnected'; // disconnected, connected, beacon_running
let slaveStatuses = {}; // { slave1: 'disconnected', slave2: 'disconnected', ... }

// Track scanned beacon info
let scannedBeaconInfo = {
  masterId: null,
  txId: null,
  timestamp: null
};

// Track association data per slave
let slaveAssociationData = {}; // { slave1: {...}, slave2: {...}, ... }

let activeMasterCommand = null;
let activeSlaveCommands = {}; 
// Number of slaves to support
const NUM_SLAVES = 2;

/* ===================== WINDOW ===================== */

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 900,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  win.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();
  log('[APP] TDMA UI Application Started');
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

/* ===================== LOGGING ===================== */

function log(msg) {
  console.log(msg);
  if (win) {
    win.webContents.send('debug-log', msg);
  }
}

/* ===================== SERIAL COMMUNICATION ===================== */

function openSerial(portName, label, role, onData) {
  const port = new SerialPort({
    path: portName,
    baudRate: 115200,
    autoOpen: false
  });

  port.open(err => {
    if (err) {
      log(`[${label}] ERROR opening port: ${err.message}`);
      return;
    }

    log(`[${label}] Serial port opened successfully on ${portName}`);
    
    if (role === 'master') {
      masterPortOpen = true;
      masterStatus = 'connected';
    } else if (role.startsWith('slave')) {
      const slaveNum = role.replace('slave', '');
      
      slavePortsOpen[`slave${slaveNum}`] = true;
      slaveStatuses[`slave${slaveNum}`] = 'connected';
    }

    updateStatusUI();

    port.on('data', (data) => {
      try {
        onData(data);
      } catch (err) {
        log(`[${label}] Error processing data: ${err.message}`);
      }
    });

    port.on('error', (err) => {
      log(`[${label}] Serial port error: ${err.message}`);
    });

    port.on('close', () => {
      log(`[${label}] Serial port closed`);
      if (role === 'master') {
        masterPortOpen = false;
        masterStatus = 'disconnected';
      } else if (role.startsWith('slave')) {
        const slaveNum = role.replace('slave', '');
        slavePortsOpen[`slave${slaveNum}`] = false;
        slaveStatuses[`slave${slaveNum}`] = 'disconnected';
      }
      updateStatusUI();
    });
  });

  return port;
}

function closeSerial(port, label) {
  if (port && port.isOpen) {
    port.close((err) => {
      if (err) {
        log(`[${label}] Error closing port: ${err.message}`);
      } else {
        log(`[${label}] Serial port closed`);
      }
    });
  }
}

function sendSerialCommand(port, cmd, label) {
  if (!port || !port.isOpen) {
    log(`[${label}] ERROR: Port not open`);
    return;
  }

  // Add carriage return for line ending
  const fullCmd = cmd + '\r\n';
  
  port.write(fullCmd, (err) => {
    if (err) {
      log(`[${label}] ERROR sending command: ${err.message}`);
    } else {
      log(`[${label}] >>> ${cmd}`);
    }
  });
}

function updateStatusUI() {
  if (win) {
    win.webContents.send('status-update', {
      masterStatus,
      masterPortOpen,
      slaveStatuses,
      slavePortsOpen
    });
  }
}


// ===================== TDMA CSV LOGGER =====================

const CSV_FILE = 'tdma.csv';

// Create stream in append mode
const tdmaStream = fs.createWriteStream(CSV_FILE, { flags: 'a' });

// Write header only if file is new
if (!fs.existsSync(CSV_FILE) || fs.statSync(CSV_FILE).size === 0) {
  tdmaStream.write('frame_time,reset,seq,payload,tx_id\n');
}

// State machine for current PDC block
let currentPdc = null;

function processTDMALine(line) {
  let m;

  // ---- Start of new PDC ----
  if ((m = line.match(/PDC received at frame_time (\d+)/))) {
    // flush previous incomplete (optional)
    if (currentPdc && currentPdc.tx_id !== null) {
      writeTDMARow(currentPdc);
    }

    currentPdc = {
      frame_time: Number(m[1]),
      reset: null,
      seq: null,
      payload: null,
      tx_id: null
    };
    return;
  }

  if (!currentPdc) return;

  // ---- Fields ----
  if ((m = line.match(/Reset:\s*(\w+)/i))) {
    currentPdc.reset = m[1];
  }

  else if ((m = line.match(/Seq Nbr:\s*(\d+)/i))) {
    currentPdc.seq = Number(m[1]);
  }

  else if ((m = line.match(/Payload length:\s*(\d+)/i))) {
    currentPdc.payload = Number(m[1]);
  }

  else if ((m = line.match(/Tx id:\s*(\d+)/i))) {
    currentPdc.tx_id = Number(m[1]);

    // ✅ finalize record when TX ID arrives
    writeTDMARow(currentPdc);
    currentPdc = null;
  }
}

function writeTDMARow(r) {
  tdmaStream.write(
    `${r.frame_time},${r.reset},${r.seq},${r.payload},${r.tx_id}\n`
  );
}

/* ===================== IPC HANDLERS ===================== */

// Connect to serial ports
ipcMain.on('connect-master', (event, { port }) => {
  log(`[MASTER] Attempting to connect to ${port}`);
  
  if (masterPort && masterPortOpen) {
    closeSerial(masterPort, 'MASTER');
  }

  masterPort = openSerial(port, 'MASTER', 'master', (data) => {
    const dataStr = data.toString();
    masterBuffer += dataStr;
    
    // Handle both \r\n and \n line endings
    const lines = masterBuffer.split(/\r?\n/);
    masterBuffer = lines[lines.length - 1];

    for (let i = 0; i < lines.length - 1; i++) {
      const rawLine = lines[i];
      const cleanLine = stripAnsi(rawLine).trim();
      
      if (cleanLine.length > 0) {
        processTDMALine(cleanLine);
        if (win) {
          win.webContents.send('master-output', cleanLine);
        }
        
        // Parse beacon status
        if (cleanLine.toLowerCase().includes('beacon starting')) {
          masterStatus = 'beacon_running';
          updateStatusUI();
        } else if (cleanLine.toLowerCase().includes('beacon stopped')) {
          masterStatus = 'connected';
          updateStatusUI();
        }

       
       
      }
    }
  });
});

ipcMain.on('connect-slave', (event, { port, slaveNum }) => {
  log(`[SLAVE${slaveNum}] Attempting to connect to ${port}`);
  
  const slaveKey = `slave${slaveNum}`;

  // Close existing connection if open
  if (slavePorts[slaveKey] && slavePortsOpen[slaveKey]) {
    closeSerial(slavePorts[slaveKey], `SLAVE${slaveNum}`);
  }

  // Initialize buffers and state
  slaveBuffers[slaveKey] = '';

  if (!slaveAssociationData[slaveKey]) {
    slaveAssociationData[slaveKey] = {
      masterId: null,
      txId: null,
      mcs: null,
      timestamp: null
    };
  }

  slavePorts[slaveKey] = openSerial(
    port,
    `SLAVE${slaveNum}`,
    `slave${slaveNum}`,
    (data) => {
      const dataStr = data.toString();
      slaveBuffers[slaveKey] += dataStr;

      // Split into lines
      const lines = slaveBuffers[slaveKey].split(/\r?\n/);
      slaveBuffers[slaveKey] = lines[lines.length - 1];

      for (let i = 0; i < lines.length - 1; i++) {
        const rawLine = lines[i];
        const cleanLine = stripAnsi(rawLine).trim();

        if (cleanLine.length === 0) continue;

        // Send to UI
        if (win) {
          win.webContents.send(`slave${slaveNum}-output`, cleanLine);
        }

        // Optional debug
        // log(`[SLAVE${slaveNum}] LINE: ${cleanLine}`);

        /* ===================== BEACON SCAN PARSING ===================== */
        if (activeSlaveCommands[slaveKey] === 'beacon_scan') {

          let beaconTxId = null;

          const txMatch = cleanLine.match(/transmitter\s+id[:\s]+(\d+)/i);
          const neighborMatch = cleanLine.match(/neighbor\s+with\s+long\s+rd\s+id\s+(\d+)/i);

          if (txMatch) {
            beaconTxId = parseInt(txMatch[1]);
          } else if (neighborMatch) {
            beaconTxId = parseInt(neighborMatch[1]);
          }

          if (!isNaN(beaconTxId) && beaconTxId > 0) {

            log(`[SLAVE${slaveNum}] Extracted Beacon TX ID: ${beaconTxId}`);

            if (win) {
              win.webContents.send('beacon-scan-result', {
                slaveNum,
                txId: beaconTxId,
                timestamp: Date.now()
              });
            }

            // Stop parsing after first valid hit
            activeSlaveCommands[slaveKey] = null;
          }
        }

        /* ===================== ASSOCIATION PARSING ===================== */
        if (
          cleanLine.toLowerCase().includes('transmitter id') &&
          cleanLine.includes('(0x')
        ) {
          const txIdMatch = cleanLine.match(/transmitter\s+id[:\s]+(\d+)/i);

          if (txIdMatch) {
            const extractedTxId = parseInt(txIdMatch[1]);

            if (!isNaN(extractedTxId) && extractedTxId > 0) {
              slaveAssociationData[slaveKey].txId = extractedTxId;
              slaveAssociationData[slaveKey].timestamp = Date.now();

              log(`[SLAVE${slaveNum}] Extracted TX ID (association): ${extractedTxId}`);

              if (win) {
                win.webContents.send(
                  `association-info-${slaveNum}`,
                  slaveAssociationData[slaveKey]
                );
              }
            }
          }
        }

        /* ===================== STATUS PARSING ===================== */
        if (cleanLine.toLowerCase().includes('rx for association response completed')) {
          slaveStatuses[slaveKey] = 'associated';
          updateStatusUI();
        } else if (cleanLine.toLowerCase().includes('association release')) {
          slaveStatuses[slaveKey] = 'connected';

          slaveAssociationData[slaveKey] = {
            masterId: null,
            txId: null,
            mcs: null,
            timestamp: null
          };

          updateStatusUI();
        }
      }
    }
  );
});

// Disconnect from serial ports
ipcMain.on('disconnect-master', (event) => {
  log('[MASTER] Disconnecting');
  closeSerial(masterPort, 'MASTER');
  masterPort = null;
});

ipcMain.on('disconnect-slave', (event, { slaveNum }) => {
  const slaveKey = `slave${slaveNum}`;
  log(`[SLAVE${slaveNum}] Disconnecting`);
  if (slavePorts[slaveKey]) {
    closeSerial(slavePorts[slaveKey], `SLAVE${slaveNum}`);
    slavePorts[slaveKey] = null;
  }
});

// Master commands
ipcMain.on('beacon-start', (event, { channel }) => {
  const cmd = `dect mac beacon_start -c ${channel}`;
  activeMasterCommand = 'beacon_start';
  log(`[MASTER] Starting beacon on channel ${channel}`);
  sendSerialCommand(masterPort, cmd, 'MASTER');
});

ipcMain.on('beacon-stop', (event) => {
  const cmd = `dect mac beacon_stop`;
  activeMasterCommand = null;
  log(`[MASTER] Stopping beacon`);
  sendSerialCommand(masterPort, cmd, 'MASTER');
});

ipcMain.on('beacon-scan', (event, { channel, slaveNum }) => {
  const slaveKey = `slave${slaveNum}`;

  const cmd = `dect mac beacon_scan -c ${channel}`;

  activeSlaveCommands[slaveKey] = 'beacon_scan'; // ✅ FIX

  log(`[SLAVE${slaveNum}] Starting beacon scan on channel ${channel}`);

  sendSerialCommand(slavePorts[slaveKey], cmd, `SLAVE${slaveNum}`);
});

// Slave commands
ipcMain.on('associate', (event, { slaveNum, masterId, mcs }) => {
  const slaveKey = `slave${slaveNum}`;
  const cmd = `dect mac associate -t ${masterId} -m ${mcs}`;
  activeSlaveCommands[slaveKey] = 'associate';
  slaveAssociationData[slaveKey].masterId = masterId;
  slaveAssociationData[slaveKey].mcs = mcs;
  log(`[SLAVE${slaveNum}] Associating to master ${masterId} with MCS ${mcs}`);
  sendSerialCommand(slavePorts[slaveKey], cmd, `SLAVE${slaveNum}`);
});

ipcMain.on('dissociate', (event, { slaveNum, masterId }) => {
  const slaveKey = `slave${slaveNum}`;
  const cmd = `dect mac dissociate -t ${masterId}`;
  activeSlaveCommands[slaveKey] = null;
  log(`[SLAVE${slaveNum}] Dissociating from master ${masterId}`);
  sendSerialCommand(slavePorts[slaveKey], cmd, `SLAVE${slaveNum}`);
});

ipcMain.on('rach-tx-start', (event, { slaveNum, masterId, data, mcs, txPower, interval }) => {
  const slaveKey = `slave${slaveNum}`;
  const cmd = interval 
    ? `dect mac rach_tx -t ${masterId} -d "${data}" -j -m ${mcs} --tx_pwr ${txPower} -i ${interval}`
    : `dect mac rach_tx -t ${masterId} -d "${data}" -m ${mcs} --tx_pwr ${txPower}`;
  activeSlaveCommands[slaveKey] = 'rach_tx';
  log(`[SLAVE${slaveNum}] Starting RACH TX to master ${masterId}`);
  sendSerialCommand(slavePorts[slaveKey], cmd, `SLAVE${slaveNum}`);
});

ipcMain.on('rach-tx-stop', (event, { slaveNum }) => {
  const slaveKey = `slave${slaveNum}`;
  const cmd = `dect mac rach_tx stop`;
  activeSlaveCommands[slaveKey] = null;
  log(`[SLAVE${slaveNum}] Stopping RACH TX`);
  sendSerialCommand(slavePorts[slaveKey], cmd, `SLAVE${slaveNum}`);
});

// Get available serial ports
ipcMain.handle('list-ports', async () => {
  try {
    const ports = await SerialPort.list();
    return ports.map(p => ({
      port: p.path,
      manufacturer: p.manufacturer || 'Unknown',
      serialNumber: p.serialNumber || 'N/A'
    }));
  } catch (err) {
    log(`Error listing ports: ${err.message}`);
    return [];
  }
});

// Get association info
ipcMain.handle('get-association-info', async () => {
  return slaveAssociationData;
});

// Clear output
ipcMain.on('clear-master-output', (event) => {
  if (win) {
    win.webContents.send('clear-master-output');
  }
});

ipcMain.on('clear-slave-output', (event, { slaveNum }) => {
  if (win) {
    win.webContents.send(`clear-slave${slaveNum}-output`);
  }
});

// Handler to get scanned beacon info
ipcMain.handle('get-beacon-scan-result', async () => {
  return scannedBeaconInfo;
});
