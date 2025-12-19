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

// Port open/closing state flags to prevent race conditions
let serverPortOpen = false;
let clientPortOpen = false;

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

const CSV_PATH = path.join(__dirname, 'output', 'anite_AWGN_corrected.csv');

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
  const maxRetries = 3;
  let retryCount = 0;

  function attemptReset() {
    log(`[${tag}] Attempting reset (attempt ${retryCount + 1}/${maxRetries})`);

    const port = new SerialPort({
      path: portPath,
      baudRate: 115200,
      autoOpen: false
    });

    port.open(err => {
      if (err) {
        retryCount++;
        if (retryCount < maxRetries) {
          log(`[${tag}] Reset open failed: ${err.message}, retrying in 500ms...`);
          setTimeout(attemptReset, 500);
        } else {
          log(`[${tag}] Reset open failed after ${maxRetries} attempts: ${err.message}`);
          doneCallback();
        }
        return;
      }

      log(`[${tag}] Reset port opened, toggling DTR`);
      try {
        port.set({ dtr: false }, (err) => {
          if (err) log(`[${tag}] DTR false failed: ${err.message}`);
          
          setTimeout(() => {
            port.set({ dtr: true }, (err) => {
              if (err) log(`[${tag}] DTR true failed: ${err.message}`);

              setTimeout(() => {
                port.close((err) => {
                  if (err) log(`[${tag}] Reset port close failed: ${err.message}`);
                  log(`[${tag}] Reset complete`);
                  doneCallback();
                });
              }, 300);
            });
          }, 100);
        });
      } catch (e) {
        log(`[${tag}] Reset DTR toggle failed: ${e.message}`);
        port.close(() => {
          doneCallback();
        });
      }
    });
  }

  attemptReset();
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
      // Try to mark port as not open
      if (tag === 'SERVER') serverPortOpen = false;
      if (tag === 'CLIENT') clientPortOpen = false;
      return;
    }
    log(`[${tag}] Serial port opened successfully`);
    // Set the open flag here as well
    if (tag === 'SERVER') serverPortOpen = true;
    if (tag === 'CLIENT') clientPortOpen = true;
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
    if (tag === 'SERVER') {
      serverPortOpen = false;
      serverPort = null;
    }
    if (tag === 'CLIENT') {
      clientPortOpen = false;
      clientPort = null;
    }
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

  port.on('open', () => {
    if (tag === 'SERVER') serverPortOpen = true;
    if (tag === 'CLIENT') clientPortOpen = true;
  });

  return port;
}




/* ===================== STOP HELPERS ===================== */

function stopClientInternal() {
  if (!clientPort || !clientPortOpen) {
    log('[CLIENT] Already stopped or port not open');
    clientPort = null;
    clientPortOpen = false;
    return;
  }

  log('[CLIENT] Stopping client');

  // Clear buffers on stop
  clientBuffer = '';
  clientLastPdcAt = 0;

  // Immediately mark port as closing to prevent other operations
  clientPortOpen = false;

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
    log('[CLIENT] Port already null, skipping DTR reset');
    return;
  }

  try {
    const portPath = clientPort.path;
    log('[CLIENT] Performing DTR reset');

    clientPort.set({ dtr: false }, (err) => {
      if (err) {
        log('[CLIENT] DTR set false failed: ' + err.message);
        return;
      }
      
      setTimeout(() => {
        if (!clientPort) return;
        clientPort.set({ dtr: true }, (err) => {
          if (err) {
            log('[CLIENT] DTR set true failed: ' + err.message);
          }

          // Wait a bit, then close port
          setTimeout(() => {
            if (!clientPort) return;
            clientPort.close((err) => {
              if (err) {
                log('[CLIENT] Close failed: ' + err.message);
              } else {
                log('[CLIENT] Closed');
              }
              clientPort = null;
              clientPortOpen = false;
              
              // Ensure the board is reset by opening a fresh port and toggling DTR
              resetBoard(portPath, 'CLIENT_STOP', () => {
                log('[CLIENT] Reset after stop complete');
              });
            });
          }, 200);
        });
      }, 100);
    });
  } catch (e) {
    log('[CLIENT] DTR reset failed: ' + e.message);
    // fallback: just close and attempt a reset
    try {
      const portPath = clientPort ? clientPort.path : null;
      if (clientPort) {
        clientPort.close((err) => {
          if (err) log('[CLIENT] Close failed: ' + err.message);
          log('[CLIENT] Closed');
          clientPort = null;
          clientPortOpen = false;
          if (portPath) {
            resetBoard(portPath, 'CLIENT_STOP', () => {
              log('[CLIENT] Reset after stop complete');
            });
          }
        });
      }
    } catch (err) {
      log('[CLIENT] Fallback close failed: ' + err.message);
      clientPort = null;
      clientPortOpen = false;
    }
  }
}

function stopServerInternal() {
  if (!serverPort || !serverPortOpen) {
    log('[SERVER] Already stopped or port not open');
    serverPort = null;
    serverPortOpen = false;
    return;
  }

  log('[SERVER] Stopping server');

  // Clear buffers on stop
  serverBuffer = '';
  serverLastPdcAt = 0;

  // Stop periodic timer first
  if (serverTimer) {
    clearInterval(serverTimer);
    serverTimer = null;
  }

  // Immediately mark port as closing to prevent other operations
  serverPortOpen = false;

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
    log('[SERVER] Port already null, skipping DTR reset');
    return;
  }

  try {
    const portPath = serverPort.path;
    log('[SERVER] Performing DTR reset');

    serverPort.set({ dtr: false }, (err) => {
      if (err) {
        log('[SERVER] DTR set false failed: ' + err.message);
        return;
      }
      
      setTimeout(() => {
        if (!serverPort) return;
        serverPort.set({ dtr: true }, (err) => {
          if (err) {
            log('[SERVER] DTR set true failed: ' + err.message);
          }

          setTimeout(() => {
            if (!serverPort) return;
            serverPort.close((err) => {
              if (err) {
                log('[SERVER] Close failed: ' + err.message);
              } else {
                log('[SERVER] Closed');
              }
              serverPort = null;
              serverPortOpen = false;
              
              // Ensure the board is reset by performing an explicit reset
              resetBoard(portPath, 'SERVER_STOP', () => {
                log('[SERVER] Reset after stop complete');
              });
            });
          }, 200);
        });
      }, 100);
    });
  } catch (e) {
    log('[SERVER] DTR reset failed: ' + e.message);
    // fallback: try closing and then reset using the path
    try {
      const portPath = serverPort ? serverPort.path : null;
      if (serverPort) {
        serverPort.close((err) => {
          if (err) log('[SERVER] Close failed: ' + err.message);
          log('[SERVER] Closed');
          serverPort = null;
          serverPortOpen = false;
          if (portPath) {
            resetBoard(portPath, 'SERVER_STOP', () => {
              log('[SERVER] Reset after stop complete');
            });
          }
        });
      }
    } catch (err) {
      log('[SERVER] Fallback close failed: ' + err.message);
      serverPort = null;
      serverPortOpen = false;
    }
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
  // If a server port already exists, stop it and try again
  if (serverPort && serverPortOpen) {
    log('[SERVER] Server already running, stopping first');
    stopServerInternal();
    // Wait a moment for cleanup before retrying
    setTimeout(() => {
      startServerAfterReset(event, serial, snr);
    }, 500);
    return;
  }

  // Clear old references
  serverPort = null;
  serverPortOpen = false;

  // Clear buffers before starting fresh
  serverBuffer = '';
  serverLastPdcAt = 0;

  // Parse SNR as integer with validation
  const snrValue = parseInt(snr, 10);
  if (isNaN(snrValue)) {
    log('[SERVER] Invalid SNR value: ' + snr);
    return;
  }

  log(`[SERVER] Opening new port for perf command with SNR=${snrValue}`);

  serverPort = openSerial(serial, 'SERVER', data => {
    // Only process if port is still open
    if (!serverPortOpen) {
      log('[SERVER] Received data but port is marked as closed, ignoring');
      return;
    }

    // data is raw chunk (string), use buffering to extract full pdc records
    const matches = processIncomingChunkForBuffer('server', data);
    if (matches && matches.length > 0) {
      handlePdcRecords(matches, event);
    }

    // Optionally: show non-pdc cleaned lines in the debug output (for visibility)
    /*
    const cleaned = stripAnsi(data);
    const otherLines = cleaned.split('\n').map(l => l.trim()).filter(l => l && !/p[dc]c(?:_err)?\s*,/i.test(l));
    if (otherLines.length) {
      otherLines.forEach(l => log(`[SERVER] INFO: ${l}`));
  }
*/
  
    // Also check cleaned output for stop ack phrases (normalized)
    checkForStopAck('server');
  });

  // Wait a bit for port to be fully open before sending command
  setTimeout(() => {
    sendServerCmd();
  }, 100);

  function sendServerCmd() {
    if (!serverPort || !serverPortOpen) {
      log('[SERVER] Port not ready when trying to send perf command');
      return;
    }

    const cmd = `dect perf -s -p ${snrValue}\n`;
    log(`[SERVER] TX: ${cmd.trim()}`);
    serverPort.write(cmd, (err) => {
      if (err) {
        log(`[SERVER] Write failed: ${err.message}`);
      }
    });
  }
  
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
  // If a client port already exists, stop it and try again
  if (clientPort && clientPortOpen) {
    log('[CLIENT] Client already running, stopping first');
    stopClientInternal();
    // Wait a moment for cleanup before retrying
    setTimeout(() => {
      startClientAfterReset(event, serial, mcs);
    }, 500);
    return;
  }

  // Clear old references
  clientPort = null;
  clientPortOpen = false;

  // Clear buffers before starting fresh
  clientBuffer = '';
  clientLastPdcAt = 0;

  // Parse MCS as integer with validation
  const mcsValue = parseInt(mcs, 10);
  if (isNaN(mcsValue)|| mcsValue < 1 || mcsValue > 4) {
    log('[CLIENT] Invalid MCS value: ' + mcs);
    return;
  }

  log(`[CLIENT] Opening new port for perf command with MCS=${mcsValue}`);

  clientPort = openSerial(serial, 'CLIENT', data => {
    // Only process if port is still open
    if (!clientPortOpen) {
      log('[CLIENT] Received data but port is marked as closed, ignoring');
      return;
    }

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

  // Wait a bit for port to be fully open before sending command
  setTimeout(() => {
    sendClientCmd();
  }, 100);

  function sendClientCmd() {
    if (!clientPort || !clientPortOpen) {
      log('[CLIENT] Port not ready when trying to send perf command');
      return;
    }

    const cmd = `dect perf -c --c_tx_mcs ${mcsValue} --c_tx_pwr -20 -t 10000\n`;
    log(`[CLIENT] TX: ${cmd.trim()}`);
    clientPort.write(cmd, (err) => {
      if (err) {
        log(`[CLIENT] Write failed: ${err.message}`);
      }
    });
  }
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