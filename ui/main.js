const { app, BrowserWindow, ipcMain } = require('electron');
const { SerialPort } = require('serialport');
const path = require('path');
const fs = require('fs');




let win;
let serverPort = null;
let clientPort = null;
let serverTimer = null;
let serverResetDone = false;
let clientResetDone = false;

// Buffers to accumulate serial fragments so we can extract full "pdc,..." records
let serverBuffer = '';
let clientBuffer = '';

// Last PDC timestamps (ms since epoch) to detect quiet period after stop
let serverLastPdcAt = 0;
let clientLastPdcAt = 0;

// Stop ACK resolvers (the promise resolve function will be stored here)
let clientStopAckResolve = null;
let serverStopAckResolve = null;

// Regex to find pdc records: pdc,number,number,number (also pdc_err, pcc, pcc_err variants)
const PDC_RE = /p[dc]c(?:_err)?\s*,\s*\d+\s*,\s*\d+\s*,\s*\d+/gi;

const CSV_PATH = path.join(__dirname, 'output', 'server_output.csv');

/* ===================== UTIL ===================== */

function log(msg) {
  console.log(msg);
  if (win) {
    win.webContents.send('debug-log', msg);
  }
}

// Append an array of pdc records to CSV and send to UI/log
function handlePdcRecords(records, event) {
  records.forEach(r => {
    const normalized = r.replace(/\s+/g, '').toLowerCase();
    // Send to UI (preserve newline at end for display)
    if (event) event.sender.send('server-output', normalized + '\n');
    log(`[SERVER] RX: ${normalized}`);
    // Append to CSV with newline
    try {
      fs.appendFileSync(CSV_PATH, normalized + '\n');
    } catch (err) {
      log('[SERVER] Failed to append to CSV: ' + err.message);
    }
  });
}

// Helper: normalize buffer content for ack detection (remove non-alphanum)
function normalizeForAck(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Schedule a resolution only when we have seen a short quiet period after the last PDC line
function scheduleStopAckResolution(bufferName, resolveFn, opts = {}) {
  const maxWait = opts.maxWaitMs || 5000; // overall max wait
  const quietMs = opts.quietMs || 500; // required quiet period after last PDC
  let interval = null;
  let timeout = null;
  let resolved = false;

  function clearTimers() {
    if (interval) clearInterval(interval);
    if (timeout) clearTimeout(timeout);
  }

  // Immediately check if we already have a quiet period
  const lastPdc = bufferName === 'server' ? serverLastPdcAt : clientLastPdcAt;
  if (!lastPdc || (Date.now() - lastPdc) >= quietMs) {
    resolved = true;
    log(`[${bufferName.toUpperCase()}] quiet period satisfied (no PDC for ${quietMs}ms) - resolving stop ack`);
    resolveFn(true);
    return;
  }

  // Poll until quiet or until overall timeout
  interval = setInterval(() => {
    const last = bufferName === 'server' ? serverLastPdcAt : clientLastPdcAt;
    if (!last || (Date.now() - last) >= quietMs) {
      if (resolved) return;
      resolved = true;
      clearTimers();
      log(`[${bufferName.toUpperCase()}] quiet period observed after stop phrase - resolving stop ack`);
      resolveFn(true);
    }
  }, 100);

  // Overall timeout
  timeout = setTimeout(() => {
    if (resolved) return;
    resolved = true;
    clearTimers();
    log(`[${bufferName.toUpperCase()}] stop ack quiet wait timed out after ${maxWait}ms - resolving with failure`);
    resolveFn(false);
  }, maxWait);
}

// Check buffer (server/client) for stop ACK phrases in a normalized way
function checkForStopAck(bufferName) {
  const buf = bufferName === 'server' ? serverBuffer : clientBuffer;
  if (!buf || buf.length === 0) return;

  const norm = normalizeForAck(buf);
  // phrases to match (normalized)
  const keys = [
    'perfcommandstopping',
    'perfcommandcompleted',
    'perfcommanddone',
    'dectperfstop',
    'perfstop',
    'perfstopping'
  ];

  for (const k of keys) {
    if (norm.includes(k)) {      log(`[${bufferName.toUpperCase()}] Stop ack phrase matched: ${k}`);      // found an ack phrase; if a resolve function is waiting, schedule a quiet-period resolution
      if (bufferName === 'server' && serverStopAckResolve) {
        scheduleStopAckResolution('server', serverStopAckResolve, { maxWaitMs: 5000, quietMs: 500 });
        serverStopAckResolve = null;
      }
      if (bufferName === 'client' && clientStopAckResolve) {
        scheduleStopAckResolution('client', clientStopAckResolve, { maxWaitMs: 5000, quietMs: 500 });
        clientStopAckResolve = null;
      }
      break;
    }
  }
}

// Process new incoming raw chunk for a given buffer and return found records
function processIncomingChunkForBuffer(bufferName, rawChunk) {
  // Remove ANSI sequences and convert carriage returns to newlines
  const ansiRegex = /\x1B\[[0-?]*[ -\/]*[@-~]/g;
  let s = rawChunk.replace(ansiRegex, '');
  s = s.replace(/\r/g, '\n');

  if (bufferName === 'server') {
    serverBuffer += s;
    let matches = [];
    let lastConsumed = 0;
    let m;
    // reset lastIndex
    PDC_RE.lastIndex = 0;
    while ((m = PDC_RE.exec(serverBuffer)) !== null) {
      matches.push(m[0]);
      lastConsumed = m.index + m[0].length;
    }
    if (lastConsumed > 0) {
      serverBuffer = serverBuffer.slice(lastConsumed);
    }
    // Update last PDC timestamp if matches appear
    if (matches.length > 0) {
      serverLastPdcAt = Date.now();
    }

    // Check for stop ack across chunks (normalized search that tolerates fragmentation/ANSI)
    checkForStopAck('server');
    // Prevent buffer from growing forever in case no matches appear
    if (serverBuffer.length > 10000) {
      serverBuffer = serverBuffer.slice(-1000);
    }
    return matches;
  } else {
    clientBuffer += s;
    let matches = [];
    let lastConsumed = 0;
    let m;
    PDC_RE.lastIndex = 0;
    while ((m = PDC_RE.exec(clientBuffer)) !== null) {
      matches.push(m[0]);
      lastConsumed = m.index + m[0].length;
    }
    if (lastConsumed > 0) {
      clientBuffer = clientBuffer.slice(lastConsumed);
    }
    // Update last PDC timestamp if matches appear
    if (matches.length > 0) {
      clientLastPdcAt = Date.now();
    }

    // Check for stop ack across chunks (normalized search that tolerates fragmentation/ANSI)
    checkForStopAck('client');
    if (clientBuffer.length > 10000) {
      clientBuffer = clientBuffer.slice(-1000);
    }
    return matches;
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 900,
    height: 750,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  win.loadFile('index.html');
}

app.whenReady().then(() => {
  fs.mkdirSync(path.dirname(CSV_PATH), { recursive: true });
  log('[APP] Starting application');


  /* ======================================= */

  createWindow();
});

/* ===================== UART HELPERS ===================== */
function resetBoard(portPath, tag, doneCallback) {
  log(`[${tag}] Performing one-time reset`);

  const port = new SerialPort({
    path: portPath,
    baudRate: 115200,
    autoOpen: false
  });

  port.open(err => {
    if (err) {
      log(`[${tag}] Reset open failed: ${err.message}`);
      return;
    }

    try {
      port.set({ dtr: false });
      setTimeout(() => {
        port.set({ dtr: true });
      }, 100);
    } catch (e) {
      log(`[${tag}] Reset failed`);
    }

    setTimeout(() => {
      port.close(() => {
        log(`[${tag}] Reset complete`);
        doneCallback();
      });
    }, 300);
  });
}


function openSerial(portPath, tag, onData) {
 
  log(`[${tag}] Opening serial port ${portPath}`);

  const port = new SerialPort({
    path: portPath,
    baudRate: 115200,
    autoOpen: false
  });

  port.open(err => {
    if (err) {
      log(`[${tag}] ERROR opening port: ${err.message}`);
      return;
    }
    log(`[${tag}] Serial port opened`);
  });

port.on('data', data => {
    // Pass raw data (string) to the handler and let the handler perform
    // buffering and extraction so we don't lose fragments across chunks.
    const raw = data.toString();
    log(`[${tag}] RX RAW: ${raw.replace(/\n/g, '\\n').replace(/\r/g, '\\r')}`);
    onData(raw);
});

  port.on('error', err => {
    log(`[${tag}] SERIAL ERROR: ${err.message}`);
  });

  port.on('close', () => {
    log(`[${tag}] Serial port closed`);
    // If we had a pending stop ack wait, resolve it (we're closed so proceed)
    if (tag === 'SERVER' && serverStopAckResolve) {
      log('[SERVER] Port closed while waiting for stop ack - resolving wait');
      serverStopAckResolve(false);
      serverStopAckResolve = null;
    }
    if (tag === 'CLIENT' && clientStopAckResolve) {
      log('[CLIENT] Port closed while waiting for stop ack - resolving wait');
      clientStopAckResolve(false);
      clientStopAckResolve = null;
    }
  });

  return port;
}




/* ===================== STOP HELPERS ===================== */

function stopClientInternal() {
  if (!clientPort) {
    log('[CLIENT] Already stopped');
    return;
  }

  log('[CLIENT] Stopping client');

  // Pause briefly to let rapid output settle before sending stop command
  setTimeout(() => {
    if (!clientPort) {
      log('[CLIENT] Port closed before stop command could be sent');
      return;
    }

    // Send stop command with explicit callback to verify write
    const cmd = 'dect perf stop\n';
    clientPort.write(cmd, (err) => {
      if (err) {
        log('[CLIENT] Stop command write failed: ' + err.message);
      } else {
        log('[CLIENT] Stop command sent successfully');
      }
    });

    // Wait a bit for the device to process the command and start emitting stop response
    setTimeout(() => {
      executeClientStopWaitAndReset();
    }, 300);
  }, 150);
}

function executeClientStopWaitAndReset() {
  // Wait up to 5000ms for "perf command stopping" ack (and a short quiet period) before DTR reset
  const waitClientAck = new Promise((resolve) => {
    clientStopAckResolve = resolve; // resolve will be called by checkForStopAck -> scheduleStopAckResolution
    const timeout = setTimeout(() => {
      clientStopAckResolve = null;
      resolve(false);
    }, 5000);
  });

  waitClientAck.then((ok) => {
    if (!ok) log('[CLIENT] Stop ack not detected within timeout; proceeding with reset');
    else log('[CLIENT] Stop ack detected and quiet period observed; proceeding with reset');

    // Add extra delay before DTR to ensure device has finished emitting
    setTimeout(() => {
      performClientDtrReset();
    }, 200);
  });
}

function performClientDtrReset() {
  if (!clientPort) {
    log('[CLIENT] Port already closed, skipping DTR reset');
    return;
  }

  try {
    const portPath = clientPort.path;
    log('[CLIENT] Performing DTR reset');

    clientPort.set({ dtr: false });
    setTimeout(() => {
      if (!clientPort) return;
      clientPort.set({ dtr: true });

      // Wait a bit, then close port and perform a reset using a fresh open
      setTimeout(() => {
        if (!clientPort) return;
        clientPort.close(() => {
          log('[CLIENT] Closed');
          // Ensure the board is reset by opening a fresh port and toggling DTR
          resetBoard(portPath, 'CLIENT_STOP', () => {
            log('[CLIENT] Reset after stop complete');
          });
        });
        clientPort = null;
      }, 200);

    }, 100);
  } catch (e) {
    log('[CLIENT] DTR reset failed: ' + e.message);
    // fallback: just close and attempt a reset
    try {
      const portPath = clientPort ? clientPort.path : null;
      clientPort.close(() => {
        log('[CLIENT] Closed');
        if (portPath) {
          resetBoard(portPath, 'CLIENT_STOP', () => {
            log('[CLIENT] Reset after stop complete');
          });
        }
      });
    } catch (err) {
      log('[CLIENT] Close failed: ' + err.message);
    }
    clientPort = null;
  }
}

function stopServerInternal() {
  if (!serverPort) {
    log('[SERVER] Already stopped');
    return;
  }

  log('[SERVER] Stopping server');

  // Stop periodic timer first
  if (serverTimer) {
    clearInterval(serverTimer);
    serverTimer = null;
  }

  // Stop client first
  stopClientInternal();

  // Pause briefly to let rapid output settle before sending stop command
  setTimeout(() => {
    if (!serverPort) {
      log('[SERVER] Port closed before stop command could be sent');
      return;
    }

    // Send stop command with explicit callback to verify write
    const cmd = 'dect perf stop\n';
    serverPort.write(cmd, (err) => {
      if (err) {
        log('[SERVER] Stop command write failed: ' + err.message);
      } else {
        log('[SERVER] Stop command sent successfully');
      }
    });

    // Wait a bit for the device to process the command and start emitting stop response
    setTimeout(() => {
      executeServerStopWaitAndReset();
    }, 300);
  }, 150);
}

function executeServerStopWaitAndReset() {
  // Wait up to 5000ms for "perf command stopping" ack (and quiet period) before DTR reset
  const waitServerAck = new Promise((resolve) => {
    serverStopAckResolve = resolve; // resolve will be called by checkForStopAck -> scheduleStopAckResolution
    const timeout = setTimeout(() => {
      serverStopAckResolve = null;
      resolve(false);
    }, 5000);
  });

  waitServerAck.then((ok) => {
    if (!ok) log('[SERVER] Stop ack not detected within timeout; proceeding with reset');
    else log('[SERVER] Stop ack detected and quiet period observed; proceeding with reset');

    // Add extra delay before DTR to ensure device has finished emitting
    setTimeout(() => {
      performServerDtrReset();
    }, 200);
  });
}

function performServerDtrReset() {
  if (!serverPort) {
    log('[SERVER] Port already closed, skipping DTR reset');
    return;
  }

  try {
    const portPath = serverPort.path;
    log('[SERVER] Performing DTR reset');

    serverPort.set({ dtr: false });
    setTimeout(() => {
      if (!serverPort) return;
      serverPort.set({ dtr: true });

      setTimeout(() => {
        if (!serverPort) return;
        serverPort.close(() => {
          log('[SERVER] Closed');
          // Ensure the board is reset by performing an explicit reset
          resetBoard(portPath, 'SERVER_STOP', () => {
            log('[SERVER] Reset after stop complete');
          });
        });
        serverPort = null;
      }, 200);

    }, 100);
  } catch (e) {
    log('[SERVER] DTR reset failed: ' + e.message);
    // fallback: try closing and then reset using the path
    try {
      const portPath = serverPort ? serverPort.path : null;
      serverPort.close(() => {
        log('[SERVER] Closed');
        if (portPath) {
          resetBoard(portPath, 'SERVER_STOP', () => {
            log('[SERVER] Reset after stop complete');
          });
        }
      });
    } catch (err) {
      log('[SERVER] Close failed: ' + err.message);
    }
    serverPort = null;
  }

}

/* ===================== SERVER ===================== */

ipcMain.on('start-server', (event, { serial, snr }) => {
  log('[SERVER] Start requested');

  if (!serverResetDone) {
   
    
    resetBoard(serial, 'SERVER', () => {
      
      startServerAfterReset(event, serial, snr);
      serverResetDone = true;

    });
    return;
  }

  startServerAfterReset(event, serial, snr);
});

ipcMain.on('stop-server', () => {
  log('[SERVER] Stop requested manually');
  stopServerInternal();
});

function startServerAfterReset(event, serial, snr) {
  if (serverPort) {
    
    stopServerInternal();
    serverPort = null;
    startServerAfterReset(event, serial, snr);
    return;
  }



serverPort = openSerial(serial, 'SERVER', data => {
    // data is raw chunk (string), use buffering to extract full pdc records
    const matches = processIncomingChunkForBuffer('server', data);
    if (matches && matches.length > 0) {
      handlePdcRecords(matches, event);
    }

    // Optionally: show non-pdc cleaned lines in the debug output (for visibility)
    const cleaned = stripAnsi(data);
    const otherLines = cleaned.split('\n').map(l => l.trim()).filter(l => l && !/p[dc]c(?:_err)?\s*,/i.test(l));
    if (otherLines.length) {
      otherLines.forEach(l => log(`[SERVER] INFO: ${l}`));
    }

    // Also check cleaned output for stop ack phrases (normalized)
    checkForStopAck('server');
});

  function sendServerCmd() {
    if (!serverPort) return;

    const cmd = `dect perf -s -p ${snr} -t 100\n`;
    log(`[SERVER] TX: ${cmd.trim()}`);
    serverPort.write(cmd);
  }

  sendServerCmd();
  serverTimer = setInterval(sendServerCmd, 110000);
}


/* ===================== CLIENT ===================== */

ipcMain.on('start-client', (event, { serial, mcs }) => {
  log('[CLIENT] Start requested');

  if (!clientResetDone) {
    resetBoard(serial, 'CLIENT', () => {
      clientResetDone = true;
      startClientAfterReset(event, serial, mcs);
    });
    return;
  }

  startClientAfterReset(event, serial, mcs);
});


function startClientAfterReset(event, serial, mcs) {
  if (clientPort) {
    stopClientInternal();
    clientPort = null;
    startClientAfterReset(event, serial, mcs);
    return;
  }

  clientPort = openSerial(serial, 'CLIENT', data => {
    // Use buffering and extraction for client side too if you expect pdc records
    const matches = processIncomingChunkForBuffer('client', data);
    if (matches && matches.length) {
      // For client, forward matches to client-output and log + CSV
      matches.forEach(r => {
        const normalized = r.replace(/\s+/g, '').toLowerCase();
        event.sender.send('client-output', normalized + '\n');
        log(`[CLIENT] RX: ${normalized}`);
      });
    }

    // Also forward raw cleaned lines to UI client-output for visibility
    const cleaned = stripAnsi(data);
    const otherLines = cleaned.split('\n').map(l => l.trim()).filter(l => l);
    if (otherLines.length) {
      otherLines.forEach(l => event.sender.send('client-output', l + '\n'));
    }

    // Also check cleaned output for stop ack phrases (normalized)
    checkForStopAck('client');
  });

  const cmd = `dect perf -c --c_tx_mcs ${mcs} -t 10000\n`;
  log(`[CLIENT] TX: ${cmd.trim()}`);
  clientPort.write(cmd);
}


ipcMain.on('stop-client', () => {
  log('[CLIENT] Stop requested manually');
  stopClientInternal();
});



/* ===================== GRAPH ===================== */

ipcMain.on('create-graph', () => {
  log('[GRAPH] Create graph requested');
  // run per_snr.py and visualize the /output/AWGN.pdf file
  const { exec } = require('child_process');
  exec('python per_snr.py', (error, stdout, stderr) => {
    if (error) {
      log(`[GRAPH] Error: ${error.message}`);
      return;
    }
    if (stderr) {
      log(`[GRAPH] Stderr: ${stderr}`);
      return;
    }
    log(`[GRAPH] Stdout: ${stdout}`);
   
    
  });
  // refresh the embedded PDF
  if (win) {
    win.webContents.send('refresh-graph'); 

  }
});

/* ===================== UTIL ===================== */

  
 function stripAnsi(str) {
  // Remove ANSI escape sequences (CSI and similar sequences)
  const ansiRegex = /\x1B\[[0-?]*[ -\/]*[@-~]/g;
  let s = str.replace(ansiRegex, '');

  // Replace carriage returns with newlines so updates that overwrite the
  // same line (\r) become separate lines we can parse individually.
  s = s.replace(/\r/g, '\n');

  // Fallback: return cleaned non-empty lines
  return s
    .split('\n')
    .map(l => l.trim())
    .filter(l => l !== '')
    .join('\n');
}

/* ===================== ANITE ===================== */

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