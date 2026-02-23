const { app, BrowserWindow, ipcMain } = require('electron');
const { SerialPort } = require('serialport');
const path = require('path');
const fs = require('fs');

// Determine data directory - next to executable when packaged
let DATA_DIR = '';
let emulationProcess = null;

/* ===================== GLOBAL STATE ===================== */


// --- Watchdog ---
let PERF_TIMER = 50;              // seconds (default)
let WATCHDOG_TIMEOUT_MS = 2 * PERF_TIMER * 1000;

let lastSerialActivity = Date.now();
let watchdogTimer = null;

// Last commands sent
let lastServerCmd = null;
let lastClientCmd = null;


let win;
let currentSentPackets = null;
let currentReceivedPackets = null;
let currentSnrForMeasurement = null;


let serverPort = null;
let clientPort = null;
let serverPortOpen = false;
let clientPortOpen = false;

let serverBuffer = '';
let clientBuffer = '';

let sweepActive = false;

let sweepParams = null;


let sweepCurrentMcsIndex = 0;
let sweepCurrentSnr = 0;
let selectedFilename = 'AWGN';

function initializeDataDir() {
  if (app.isPackaged) {
    // For portable EXE, use PORTABLE_EXECUTABLE_DIR (directory containing the .exe)
    const execDir = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(app.getPath('exe'));
    DATA_DIR = path.join(execDir, 'data');
  } else {
    // For development, use ui folder
    DATA_DIR = path.join(__dirname, 'data');
  }
  
  // Create data directory if it doesn't exist
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  // Dynamic filename selection from UI

function getCSVPath() {
  const dateFolder = getTodaysDateFolder();
  return path.join(DATA_DIR, dateFolder, selectedFilename + '.csv');
}
}



// Ensure CSV directory exists
function ensureCSVDirectory() {
  try {
    CSV_PATH = getCSVPath();
    log(`[CSV] CSV_PATH updated to: ${CSV_PATH}`);
    fs.mkdirSync(path.dirname(CSV_PATH), { recursive: true });
  } catch (err) {
    log(`[CSV] Failed to create directory: ${err.message}`);
  }
}


// Get today's date in YYYY-MM-DD format for folder naming
function getTodaysDateFolder() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `measurements_${year}-${month}-${day}`;
}

// Build CSV path with today's date
function getCSVPath() {
  const dateFolder = getTodaysDateFolder();
  return path.join(DATA_DIR, dateFolder, selectedFilename + '.csv');
}

let CSV_PATH = '';

/* ===================== WINDOW ===================== */

function createWindow() {
  win = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  win.loadFile('index.html');
}
app.whenReady().then(() => {
  initializeDataDir();
  CSV_PATH = getCSVPath();
  fs.mkdirSync(path.dirname(CSV_PATH), { recursive: true });

  createWindow();
  
  // Log after window is created so logs appear in UI
  log('[APP] Starting application');
  log(`[APP] Data directory: ${DATA_DIR}`);
  log(`[APP] CSV output directory: ${path.dirname(CSV_PATH)}`);
});

/* ===================== LOGGING ===================== */

function log(msg) {
  console.log(msg);
  if (win) {
    win.webContents.send('debug-log', msg);
  }
}

/* ===================== SERIAL ===================== */

function openSerial(portName, label, onData) {
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
    log(`[${label}] Serial port opened successfully`);
    if (label === 'SERVER') serverPortOpen = true;
    if (label === 'CLIENT') clientPortOpen = true;
  });

  port.on('data', data => {
    onData(data.toString('utf8'));
  });

  port.on('close', () => {
    log(`[${label}] Serial port closed`);
    if (label === 'SERVER') serverPortOpen = false;
    if (label === 'CLIENT') clientPortOpen = false;
  });

  return port;
}


async function stopClientInternal() {
  if (!clientPort || !clientPortOpen) {
    log('[CLIENT] Already stopped or port not open');
    clientPort = null;
    clientPortOpen = false;
    return;
  }

  log('[CLIENT] Stopping client perf operation');

  // Send stop command
  clientPort.write('dect perf stop\n', (err) => {
    if (err) log('[CLIENT] Stop command write failed: ' + err.message);
    else log('[CLIENT] Stop command sent');
  });

  // Wait 500ms for device to process
  await new Promise(r => setTimeout(r, 500));

  // DTR toggle to ensure serial interface reset
  await new Promise(resolve => {
    clientPort.set({ dtr: false }, (err) => {
      if (err) log('[CLIENT] DTR set false failed: ' + err.message);
      setTimeout(() => {
        if (!clientPort) return resolve();
        clientPort.set({ dtr: true }, (err) => {
          if (err) log('[CLIENT] DTR set true failed: ' + err.message);
          resolve();
        });
      }, 100);
    });
  });

  // Wait a bit before closing
  await new Promise(r => setTimeout(r, 200));

  try {
    const path = clientPort.path;
    clientPort.close((err) => {
      if (err) log('[CLIENT] Close failed: ' + err.message);
      log('[CLIENT] Serial port closed');
      clientPort = null;
      clientPortOpen = false;

      
     
    });
  } catch (e) {
    log('[CLIENT] Exception closing port: ' + e.message);
    clientPort = null;
    clientPortOpen = false;
  }
}

async function stopServerInternal() {
  if (!serverPort || !serverPortOpen) {
    log('[SERVER] Already stopped or port not open');
    serverPort = null;
    serverPortOpen = false;
    return;
  }

  log('[SERVER] Stopping server perf operation');

  // Send stop command first
  serverPort.write('dect perf stop\n', (err) => {
    if (err) log('[SERVER] Stop command write failed: ' + err.message);
    else log('[SERVER] Stop command sent');
  });

  // Wait 500ms for the device to process
  await new Promise(r => setTimeout(r, 500));

  // DTR toggle to ensure the serial interface resets
  await new Promise(resolve => {
    serverPort.set({ dtr: false }, (err) => {
      if (err) log('[SERVER] DTR set false failed: ' + err.message);
      setTimeout(() => {
        if (!serverPort) return resolve();
        serverPort.set({ dtr: true }, (err) => {
          if (err) log('[SERVER] DTR set true failed: ' + err.message);
          resolve();
        });
      }, 100);
    });
  });

  // Short delay before closing
  await new Promise(r => setTimeout(r, 200));

  try {
    const path = serverPort.path;
    serverPort.close((err) => {
      if (err) log('[SERVER] Close failed: ' + err.message);
      log('[SERVER] Serial port closed');
      serverPort = null;
      serverPortOpen = false;

      
    });
  } catch (e) {
    log('[SERVER] Exception closing port: ' + e.message);
    serverPort = null;
    serverPortOpen = false;
  }
}



function stopServerOperation(serverPort) {
  
if(!serverPort) return;
    log('[SERVER] Stopping DECT operation...');
    serverPort.write('dect perf stop\n', 'utf-8', err => {
      if (err) log(`[SERVER] Error sending stop command: ${err.message}`);
      // give device time to stop
      setTimeout(() => {
        try {
          serverPort.close(err => {
            if (err) log(`[SERVER] Error closing port: ${err.message}`);
            log('[SERVER] Serial port closed');
            serverPort = null;
            serverPortOpen = false;
            resolve();
          });
        } catch (e) {
          log(`[SERVER] Exception closing port: ${e.message}`);
          resolve();
        }
      }, 1000); // 1s wait
    });

}

function stopClientOperation(clientPort) {
  if(!clientPort) return;

    log('[CLIENT] Stopping DECT operation...');
    clientPort.write('dect perf stop\n', 'utf-8', err => {
      if (err) log(`[CLIENT] Error sending stop command: ${err.message}`);
      setTimeout(() => {
        try {
          clientPort.close(err => {
            if (err) log(`[CLIENT] Error closing port: ${err.message}`);
            log('[CLIENT] Serial port closed');
            clientPort = null;
            clientPortOpen = false;
            resolve();
          });
        } catch (e) {
          log(`[CLIENT] Exception closing port: ${e.message}`);
          resolve();
        }
      }, 1000);
    });
  
}


function stopServer() {
  if (!serverPort) return Promise.resolve();

  return new Promise((resolve) => {
    if (!serverPortOpen) {
      serverPort = null;
      return resolve();
    }

    serverPort.close(err => {
      if (err) log(`[SERVER] Error closing port: ${err.message}`);
      log('[SERVER] Serial port closed');
      serverPort = null;
      serverPortOpen = false;
      resolve();
    });
  });
}

function stopClient() {
  if (!clientPort) return Promise.resolve();

  return new Promise((resolve) => {
    if (!clientPortOpen) {
      clientPort = null;
      return resolve();
    }

    clientPort.close(err => {
      if (err) log(`[CLIENT] Error closing port: ${err.message}`);
      log('[CLIENT] Serial port closed');
      clientPort = null;
      clientPortOpen = false;
      resolve();
    });
  });
}


/* ===================== BUFFER PARSING ===================== */


function processIncomingChunkForBuffer(bufferName, rawChunk) {
  const ansiRegex = /\x1B\[[0-?]*[ -/]*[@-~]/g;
  let s = rawChunk.replace(ansiRegex, '').replace(/\r/g, '\n');

  let buffer = bufferName === 'server' ? serverBuffer : clientBuffer;
  buffer += s;

  const lines = buffer.split('\n');
  const completeLines = lines.slice(0, -1);
  buffer = lines[lines.length - 1];

  if (bufferName === 'server') serverBuffer = buffer;
  else clientBuffer = buffer;

  completeLines.forEach(line => {
    const l = line.trim();

    // --- Log everything immediately ---
    if (bufferName === 'server') {
       win.webContents.send('server-output', l + '\n');
      log(`[SERVER SERIAL] ${l}`);
    } else {
      win.webContents.send('client-output', l + '\n');
      log(`[CLIENT SERIAL] ${l}`);
    }

    // CLIENT: sent packets
    if (bufferName === 'client') {
      const sentMatch = l.match(/sent packets:\s+(\d+)/i);
      if (sentMatch) {
        currentSentPackets = parseInt(sentMatch[1], 10);
        log(`[CLIENT] Parsed sent packets: ${currentSentPackets}`);
        checkMeasurementComplete();
      }
    }

    // SERVER: received packets
    if (bufferName === 'server') {
      const rxMatch = l.match(/Received packets:\s*(\d+)/i);
      if (rxMatch) {
        currentReceivedPackets = parseInt(rxMatch[1], 10);
        log(`[SERVER] Parsed received packets: ${currentReceivedPackets}`);
        checkMeasurementComplete();
      }
    }
  });
  lastSerialActivity = Date.now();
  return completeLines;
}

function checkMeasurementComplete() {
  if (
    currentSentPackets !== null &&
    currentReceivedPackets !== null &&
    currentSnrForMeasurement !== null
  ) {
    log(`[SWEEP] Measurement complete @ SNR=${currentSnrForMeasurement} dB → sent=${currentSentPackets}, received=${currentReceivedPackets}`);

    appendCsvRow(currentSentPackets, currentReceivedPackets, currentSnrForMeasurement, sweepParams.enabledMcs[sweepCurrentMcsIndex]);

    // Cleanup before next point
    stopServer();
    stopClient();

    advanceSweep();

  }
}




function advanceSweep() {
  const { enabledMcs, snrRanges, serverSerial, clientSerial } = sweepParams;
  const mcs = enabledMcs[sweepCurrentMcsIndex];
  const range = snrRanges[mcs];

  sweepCurrentSnr += range.step;

  if (sweepCurrentSnr > range.max) {
    sweepCurrentMcsIndex++;

    if (sweepCurrentMcsIndex >= enabledMcs.length) {
      log('[SWEEP] === SWEEP COMPLETE ===');
      sweepActive = false;
      return;
    }

    const nextMcs = enabledMcs[sweepCurrentMcsIndex];
    sweepCurrentSnr = snrRanges[nextMcs].min;
  }

  // wait 5 seconds before next point
  setTimeout(() => {
    runNextSweepPoint(serverSerial, clientSerial);
  }, 5000);
  
}


/* ===================== START / STOP ===================== */




function appendCsvRow(sent, received, snr, mcs) {
  const header = 'sent,received,snr,mcs\n';

  if (!fs.existsSync(CSV_PATH)) {
    fs.writeFileSync(CSV_PATH, header);
  }

  const row = `${sent},${received},${snr},${mcs}\n`;
  fs.appendFileSync(CSV_PATH, row);
}


/* ===================== SERVER ===================== */

function startServer(serial, snr) {
  serverBuffer = '';

  serverPort = openSerial(serial, 'SERVER', data => {
    // Only parse summary output (Received packets)
    processIncomingChunkForBuffer('server', data);
  });

  setTimeout(() => {
    if (!serverPort || !serverPortOpen) return;

    const cmd = `dect perf -s --pdc_number=${snr}\n`;
    lastServerCmd = { serial, cmd };
    log(`[SERVER] TX: ${cmd.trim()}`);
    serverPort.write(cmd);
  }, 200);
}


/* ===================== CLIENT ===================== */

function startClient(serial, mcs) {
  clientBuffer = '';

  clientPort = openSerial(serial, 'CLIENT', data => {
    processIncomingChunkForBuffer('client', data);
    
  });

  setTimeout(() => {
    if (!clientPort || !clientPortOpen) return;
    const cmd = `dect perf -c --c_tx_mcs ${mcs} --c_tx_pwr -30 -t ${PERF_TIMER}\n`;
    log(`[CLIENT] TX: ${cmd.trim()}`);
    clientPort.write(cmd);
    lastClientCmd = { serial, cmd };
  }, 200);
}

/* ===================== SWEEP ===================== */
async function runNextSweepPoint(serverSerial, clientSerial) {
  if (!sweepActive || !sweepParams) return;

   const { enabledMcs, snrRanges, channelType } = sweepParams;
  const mcs = enabledMcs[sweepCurrentMcsIndex];
  const snr = sweepCurrentSnr;

  currentSentPackets = null;
  currentReceivedPackets = null;
  currentSnrForMeasurement = snr;

  log(`[SWEEP] Preparing measurement: MCS=${mcs}, SNR=${snr}`);

  if (emulationProcess) {
    log(`[SWEEP] Updating ANITE SNR to ${snr} dB...`);
    await updateAniteSNR(snr, channelType);
  }

  await stopServerInternal();
  await stopClientInternal();

  // Small delay to be safe
  setTimeout(() => {
    startServer(serverSerial, snr);
    startClient(clientSerial, mcs);
  }, 500);
    

}






/* ===================== ANITE ===================== */




function updateAniteSNR(snrValue, channelType) {
  if (!emulationProcess) {
    log(`[SWEEP SNR UPDATE] No ANITE process running, cannot update SNR`);
    return Promise.reject('No ANITE process');
  }

  const updateCommand = `snr_update:${snrValue}:${channelType}\n`;
  
  return new Promise((resolve) => {
    // Listen for stdout confirmation once
    const onData = (data) => {
      const output = data.toString();
      if (output.includes(`SNR updated to ${snrValue}`)) {
        log(`[SWEEP SNR UPDATE] ANITE confirmed SNR=${snrValue} dB`);
        emulationProcess.stdout.off('data', onData);
        resolve();
      }
    };

    emulationProcess.stdout.on('data', onData);

    emulationProcess.stdin.write(updateCommand, 'utf-8', (err) => {
      if (err) {
        log(`[SWEEP SNR UPDATE] Error sending SNR update: ${err.message}`);
        emulationProcess.stdout.off('data', onData);
        resolve();
      } else {
        log(`[SWEEP SNR UPDATE] Command sent to ANITE: ${snrValue} dB`);
      }
    });
  });
}


function stopAniteEmulation() {
  if (!emulationProcess) {
    log('[ANITE] No emulation process running');
    return;
  }
  try {
    emulationProcess.stdin.write('stop\n', 'utf-8');
    emulationProcess.kill();
    emulationProcess = null;
    log('[ANITE] Emulation stopped');
  }
  catch (e) {
    log(`[ANITE] Error stopping emulation: ${e.message}`);
  }
}
ipcMain.on('test-connection', () => {
  log('[ANITE] Test connection requested');
  //run anite_connection.py
  const { exec } = require('child_process');
  exec('python anite_connection.py', (error, stdout, stderr) => {
    if (error) {
      log(`[ANITE] Error: ${error.message}`);
      return;
    }
    if (stderr) {
      log(`[ANITE] Stderr: ${stderr}`);
      return;
    }
    log(`[ANITE] Stdout: ${stdout}`);
    
    
  });
});


ipcMain.on('stop-emulation', () => {
  log('[ANITE] Stop emulation requested');
  
  if (!emulationProcess) {
    log('[ANITE] No emulation process running');
    return;
  }

  try {
    emulationProcess.kill();
    emulationProcess = null;
    log('[ANITE] Emulation stopped');
  } catch (e) {
    log(`[ANITE] Error stopping emulation: ${e.message}`);
  }
});

/* ===================== FILENAME SELECTION ===================== */

ipcMain.on('select-filename', (event, { filename }) => {
  const validFilenames = ['TDL-A', 'TDL-B', 'TDL-C', 'AWGN'];
  if (!validFilenames.includes(filename)) {
    log(`[FILENAME] Invalid filename: ${filename}`);
    return;
  }
  
  selectedFilename = filename;
  CSV_PATH = getCSVPath();
  ensureCSVDirectory();
  log(`[FILENAME] Selected: ${selectedFilename}, CSV path: ${CSV_PATH}`);
});



function startWatchdog() {
  if (watchdogTimer) clearInterval(watchdogTimer);

  watchdogTimer = setInterval(async () => {
    const now = Date.now();
    const delta = now - lastSerialActivity;

    if (delta > WATCHDOG_TIMEOUT_MS) {
      log('[WATCHDOG] No serial response for 2 minutes — recovering');

      lastSerialActivity = Date.now(); // prevent loop storms

      await stopServerInternal();
      await stopClientInternal();

      // Small delay to let boards reset
      setTimeout(() => {
        if (lastServerCmd) {
          log('[WATCHDOG] Re-sending last server command');
          startServer(lastServerCmd.serial, extractSnr(lastServerCmd.cmd));
        }

        if (lastClientCmd) {
          log('[WATCHDOG] Re-sending last client command');
          startClient(lastClientCmd.serial, extractMcs(lastClientCmd.cmd));
        }
      }, 1000);
    }
  }, 20000); // check every 20s
}
function extractSnr(cmd) {
  const m = cmd.match(/--pdc_number=([-\d.]+)/);
  return m ? parseFloat(m[1]) : 0;
}

function extractMcs(cmd) {
  const m = cmd.match(/--c_tx_mcs\s+(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}





/* ===================== DATA DIRECTORY IPC ===================== */
ipcMain.on('start-sweep', (event, { snrRanges, channelType, serverSerial, clientSerial, snrStep, sweepTimer }) => {
  if (sweepActive) {
    log('[SWEEP] Sweep already running');
    return;
  }
  
    // --- Apply sweep timer from UI ---
  PERF_TIMER = Number(sweepTimer) || 50;
  WATCHDOG_TIMEOUT_MS = 1.2 * PERF_TIMER * 1000;

  log(`[SWEEP] Perf timer set to ${PERF_TIMER}s`);
  log(`[WATCHDOG] Timeout set to ${WATCHDOG_TIMEOUT_MS / 1000}s`);

  startWatchdog();

  const enabledMcs = [];
  const normalizedRanges = {};

  for (let mcs = 0; mcs <= 4; mcs++) {
    if (snrRanges[mcs] && snrRanges[mcs].min !== undefined && snrRanges[mcs].max !== undefined) {
      normalizedRanges[mcs] = {
        min: parseFloat(snrRanges[mcs].min),
        max: parseFloat(snrRanges[mcs].max),
        step: parseFloat(snrStep) || 0.5
      };
      enabledMcs.push(mcs);
    }
  }

  if (enabledMcs.length === 0) {
    log('[SWEEP] ERROR: No enabled MCS');
    return;
  }

  sweepParams = {
    channelType,
    serverSerial,
    clientSerial,
    snrRanges: normalizedRanges,
    enabledMcs
  };

  sweepCurrentMcsIndex = 0;
  sweepCurrentSnr = normalizedRanges[enabledMcs[0]].min;
  sweepActive = true;



 log(`[ANITE] Start emulation requested with SNR=${sweepCurrentSnr}, Channel=${channelType}`);
  
  if (emulationProcess) {
    log('[ANITE] Emulation already running');
    return;
  }

  const { spawn } = require('child_process');
  emulationProcess = spawn('python', ['anite_connection.py', sweepCurrentSnr.toString(), channelType]);

  emulationProcess.stdout.on('data', (data) => {
    const output = data.toString();
    log(`[ANITE] ${output}`);
    if (win) {
      win.webContents.send('emulation-output', output);
    }
  });

  emulationProcess.stderr.on('data', (data) => {
    const output = data.toString();
    log(`[ANITE] ERROR: ${output}`);
    if (win) {
      win.webContents.send('emulation-error', output);
    }
  });

  emulationProcess.on('close', (code) => {
    log(`[ANITE] Emulation process exited with code ${code}`);
    emulationProcess = null;
  });

  log('[ANITE] Emulation started');

  // stop server and client if running
  stopServer();
  stopClient();
  if (!snrRanges || typeof snrRanges !== 'object') {
    log('[SWEEP] ERROR: snrRanges missing or invalid');
    return;
  }



  log(`[SWEEP] Starting sweep with MCS: ${enabledMcs.join(', ')}`);
  runNextSweepPoint(serverSerial, clientSerial);
});



ipcMain.on('stop-sweep', () => {
  
   log('[SWEEP] Stop sweep requested');
  
  stopServerInternal();
  stopClientInternal();
  sweepActive = false;
  sweepRunning = false;
  sweepCurrentSnr = 0;
  sweepMaxSnr = 0;
  sweepCurrentMcs = 0;
  sweepMaxMcs = 4;
  sweepEvent = null;
  sweepParams = null;
  
  if (emulationProcess) {
    try {
      stopAniteEmulation();
    } catch (e) {
      log(`[SWEEP] Error stopping Anite: ${e.message}`);
    }
  }

  if (watchdogTimer) {
  clearInterval(watchdogTimer);
  watchdogTimer = null;
}

});

ipcMain.handle('get-data-dir', async () => {
  return DATA_DIR;
});

ipcMain.on('create-graph', (event, { channelType }) => {
  log(`[GRAPH] Create graph requested for channel: ${channelType}`);
  const { spawn } = require('child_process');
  
  // Run per_snr.py with channel type as argument and data directory
  const pythonProcess = spawn('python', [
    'per_snr.py',
    channelType,
    DATA_DIR
  ]);

  let output = '';
  pythonProcess.stdout.on('data', (data) => {
    output += data.toString();
    log(`[GRAPH] ${data.toString()}`);
  });

  pythonProcess.stderr.on('data', (data) => {
    log(`[GRAPH] ERROR: ${data.toString()}`);
  });

  pythonProcess.on('close', (code) => {
    if (code === 0) {
      log(`[GRAPH] Graph created successfully`);
      // Notify renderer to refresh the graph
      if (win) {
        win.webContents.send('graph-created', { channelType });
      }
    } else {
      log(`[GRAPH] Python script exited with code ${code}`);
    }
  });
});


