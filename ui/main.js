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

// Periodic server/client loop control
let serverClientLoopTimer = null;
let serverClientLoopEvent = null;
let serverClientLoopParams = null;

// SNR Sweep control
let sweepTimer = null;
let sweepEvent = null;
let sweepParams = null;
let sweepCurrentSnr = 0;
let sweepMaxSnr = 0;
let sweepCurrentMcs = 1;
let sweepMaxMcs = 4;
let sweepRunning = false;

// Regex to find pdc records: pdc,number,number,number (also pdc_err, pcc, pcc_err variants)
// Updated regex to capture complete PDC records: pdc,value,mcs,snr
// More flexible to handle various whitespace/formatting
const PDC_RE = /p[dc]c(?:_err)?\s*,\s*[\d.]+\s*,\s*\d+\s*,\s*\d+/gi;

// Dynamic filename selection from UI
let selectedFilename = 'TDL-A';

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
  return path.join(__dirname, dateFolder, selectedFilename + '.csv');
}

let CSV_PATH = getCSVPath();

/* ===================== UTIL ===================== */

function log(msg) {
  console.log(msg);
  if (win) {
    win.webContents.send('debug-log', msg);
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

// Append an array of pdc records to CSV and send to UI/log
function handlePdcRecords(records, event) {
  if (!records || records.length === 0) return;
  
  // Batch all records into a single write to minimize I/O
  const csv_lines = records
    .map(r => r.replace(/\s+/g, ',').toLowerCase())
    .join('\n') + '\n';
  
  // Use async write to avoid blocking event loop
  fs.appendFile(CSV_PATH, csv_lines, (err) => {
    if (err) {
      log('[CSV] Failed to append: ' + err.message);
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
    
    // Split by newlines and process only complete lines
    const lines = serverBuffer.split('\n');
    
    // Keep the last potentially incomplete line in the buffer
    const completeLines = lines.slice(0, -1);
    serverBuffer = lines[lines.length - 1];
    
    // Test each complete line for PDC pattern
    completeLines.forEach(line => {
      // Use a non-global regex for testing to avoid lastIndex issues
      const lineRegex = /^p[dc]c(?:_err)?\s*,\s*[\d.]+\s*,\s*\d+\s*,\s*\d+\s*$/i;
      if (lineRegex.test(line.trim())) {
        matches.push(line.trim());
      }
    });
    
    if (matches.length > 0) {
      serverLastPdcAt = Date.now();
      log(`[SERVER] Found ${matches.length} PDC records`);
      matches.forEach(m => log(`[SERVER] Raw match: "${m}"`));
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
    
    // Split by newlines and process only complete lines
    const lines = clientBuffer.split('\n');
    
    // Keep the last potentially incomplete line in the buffer
    const completeLines = lines.slice(0, -1);
    clientBuffer = lines[lines.length - 1];
    
    // Test each complete line for PDC pattern
    completeLines.forEach(line => {
      // Use a non-global regex for testing to avoid lastIndex issues
      const lineRegex = /^p[dc]c(?:_err)?\s*,\s*[\d.]+\s*,\s*\d+\s*,\s*\d+\s*$/i;
      if (lineRegex.test(line.trim())) {
        matches.push(line.trim());
      }
    });
    
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
  CSV_PATH = getCSVPath();
  fs.mkdirSync(path.dirname(CSV_PATH), { recursive: true });
  log('[APP] Starting application');
  log(`[APP] CSV output directory: ${path.dirname(CSV_PATH)}`);


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
    autoOpen: false,
    highWaterMark: 256 * 1024  // 256KB buffer to handle high data rates
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
   // log(`[${tag}] RX RAW: ${raw.replace(/\n/g, '\\n').replace(/\r/g, '\\r')}`);
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

  // Save port reference and null it out to prevent other operations
  // Don't set clientPortOpen = false yet, let the close event handle that
  const port = clientPort;
  clientPort = null;

  // Pause briefly to let rapid output settle before sending stop command
  setTimeout(() => {
    if (!port) {
      log('[CLIENT] Port was closed before stop command');
      clientPortOpen = false;
      return;
    }

    // Send stop command with explicit callback to verify write
    const cmd = 'dect perf stop\n';
    port.write(cmd, (err) => {
      if (err) {
        log('[CLIENT] Stop command write failed: ' + err.message);
      } else {
        log('[CLIENT] Stop command sent successfully');
      }
    });

    // Wait a bit for the device to process the command and start emitting stop response
    setTimeout(() => {
      executeClientStopWaitAndReset(port);
    }, 300);
  }, 150);
}

function executeClientStopWaitAndReset(port) {
  // Wait up to 5000ms for "perf command stopping" ack (and a short quiet period) before closing port
  const waitClientAck = new Promise((resolve) => {
    clientStopAckResolve = resolve; // resolve will be called by checkForStopAck -> scheduleStopAckResolution
    const timeout = setTimeout(() => {
      clientStopAckResolve = null;
      resolve(false);
    }, 5000);
  });

  waitClientAck.then((ok) => {
    if (!ok) log('[CLIENT] Stop ack not detected within timeout; closing port');
    else log('[CLIENT] Stop ack detected and quiet period observed; closing port');

    // Close the port (which will trigger the close event to set clientPortOpen = false)
    if (port) {
      port.close((err) => {
        if (err) {
          log(`[CLIENT] Error closing port: ${err.message}`);
          clientPortOpen = false;
        }
      });
    } else {
      clientPortOpen = false;
    }
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

  // Save port reference and null it out to prevent other operations
  // Don't set serverPortOpen = false yet, let the close event handle that
  const port = serverPort;
  serverPort = null;

  // Stop client first
  stopClientInternal();

  // Pause briefly to let rapid output settle before sending stop command
  setTimeout(() => {
    if (!port) {
      log('[SERVER] Port was closed before stop command');
      serverPortOpen = false;
      return;
    }

    // Send stop command with explicit callback to verify write
    const cmd = 'dect perf stop\n';
    port.write(cmd, (err) => {
      if (err) {
        log('[SERVER] Stop command write failed: ' + err.message);
      } else {
        log('[SERVER] Stop command sent successfully');
      }
    });

    // Wait a bit for the device to process the command and start emitting stop response
    setTimeout(() => {
      executeServerStopWaitAndReset(port);
    }, 300);
  }, 150);
}

function executeServerStopWaitAndReset(port) {
  // Wait up to 5000ms for "perf command stopping" ack (and quiet period) before closing port
  const waitServerAck = new Promise((resolve) => {
    serverStopAckResolve = resolve; // resolve will be called by checkForStopAck -> scheduleStopAckResolution
    const timeout = setTimeout(() => {
      serverStopAckResolve = null;
      resolve(false);
    }, 5000);
  });

  waitServerAck.then((ok) => {
    if (!ok) log('[SERVER] Stop ack not detected within timeout; closing port');
    else log('[SERVER] Stop ack detected and quiet period observed; closing port');

    // Close the port (which will trigger the close event to set serverPortOpen = false)
    if (port) {
      port.close((err) => {
        if (err) {
          log(`[SERVER] Error closing port: ${err.message}`);
          serverPortOpen = false;
        }
      });
    } else {
      serverPortOpen = false;
    }
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
  stopServerClientLoop();
  stopServerInternal();
});

/* ===================== PERIODIC SERVER/CLIENT LOOP ===================== */

function stopServerClientLoop() {
  if (serverClientLoopTimer) {
    clearInterval(serverClientLoopTimer);
    serverClientLoopTimer = null;
    log('[LOOP] Periodic server/client loop stopped');
  }
}

function executeServerClientLoopCycle() {
  if (!serverClientLoopEvent || !serverClientLoopParams) {
    log('[LOOP] Loop parameters missing, stopping loop');
    stopServerClientLoop();
    return;
  }

  const { serial_server, snr, serial_client, mcs } = serverClientLoopParams;
  
  log('[LOOP] === CYCLE START: Stopping server ===');
  stopServerInternal();

  // Wait 5 seconds, then restart
  setTimeout(() => {
    log('[LOOP] === Restarting server and client after 5s ===');
    
    // Start server
    serverClientLoopEvent.sender.send('start-server', { serial: serial_server, snr });
    
    // Start client
    setTimeout(() => {
      serverClientLoopEvent.sender.send('start-client', { serial: serial_client, mcs });
    }, 500);
  }, 5000);
}

ipcMain.on('start-server-client-loop', (event, { serial_server, snr, serial_client, mcs }) => {
  log('[LOOP] Start periodic server/client loop requested');
  
  // Stop any existing loop
  stopServerClientLoop();
  
  // Store parameters and event for later use
  serverClientLoopEvent = event;
  serverClientLoopParams = { serial_server, snr, serial_client, mcs };
  
  // Start initial server and client
  event.sender.send('start-server', { serial: serial_server, snr });
  setTimeout(() => {
    event.sender.send('start-client', { serial: serial_client, mcs });
  }, 500);
  
  // Set up periodic cycle: every 60 seconds, stop and restart
  serverClientLoopTimer = setInterval(() => {
    executeServerClientLoopCycle();
  }, 120000);
  
  log('[LOOP] Periodic loop started (60-second cycle)');
});

ipcMain.on('stop-server-client-loop', () => {
  log('[LOOP] Stop periodic server/client loop requested');
  stopServerClientLoop();
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
  const snrValue = parseFloat(snr, 10);
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

    const cmd = `dect perf -s --pdc_number=${snrValue}\n`;
    log(`[SERVER] TX: ${cmd.trim()}`);
    serverPort.write(cmd, (err) => {
      if (err) {
        log(`[SERVER] Write failed: ${err.message}`);
        event.sender.send('server-output', `Error: command write failed: ${err.message}`);
      }
    });
    event.sender.send('server-output', `Success: command sent: ${cmd}`);
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
  if (isNaN(mcsValue)|| mcsValue < 0 || mcsValue > 4) {
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

    const cmd = `dect perf -c --c_tx_mcs ${mcsValue} --c_tx_pwr -20 -t 100\n`;
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

let emulationProcess = null;

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

ipcMain.on('start-emulation', (event, { snr, channelType }) => {
  log(`[ANITE] Start emulation requested with SNR=${snr}, Channel=${channelType}`);
  
  if (emulationProcess) {
    log('[ANITE] Emulation already running');
    return;
  }

  const { spawn } = require('child_process');
  emulationProcess = spawn('python', ['anite_connection.py', snr.toString(), channelType]);

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

/* ===================== SNR SWEEP ===================== */

function stopSweep() {
  if (sweepTimer) {
    clearTimeout(sweepTimer);
    sweepTimer = null;
  }
  
  // Kill emulation process if still running
  if (emulationProcess) {
    try {
      emulationProcess.kill();
      emulationProcess = null;
      log('[SWEEP] Emulation process terminated');
    } catch (e) {
      log(`[SWEEP] Error killing emulation process: ${e.message}`);
    }
  }
  
  // Reset all sweep state
  sweepRunning = false;
  sweepCurrentSnr = 0;
  sweepMaxSnr = 0;
  sweepCurrentMcs = 0;
  sweepMaxMcs = 4;
  sweepEvent = null;
  sweepParams = null;
  log('[SWEEP] Sweep stopped and state reset');
}

function updateAniteSNR(snrValue, channelType) {
  if (!emulationProcess) {
    log(`[SWEEP SNR UPDATE] No ANITE process running, cannot update SNR`);
    return Promise.reject('No ANITE process');
  }

  // Send SNR update command to running ANITE process
  // Command format: snr_update:value:channel
  const updateCommand = `snr_update:${snrValue}:${channelType}\n`;
  
  return new Promise((resolve) => {
    emulationProcess.stdin.write(updateCommand, 'utf-8', (err) => {
      if (err) {
        log(`[SWEEP SNR UPDATE] Error sending SNR update: ${err.message}`);
        resolve();
      } else {
        log(`[SWEEP SNR UPDATE] SNR updated to ${snrValue} dB`);
        resolve();
      }
    });
  });
}

function executeSweepCycle() {
  if (!sweepRunning || !sweepEvent || !sweepParams) {
    log('[SWEEP] Sweep parameters missing or stopped');
    stopSweep();
    return;
  }

  const { channelType, serverSerial, clientSerial, snrRanges } = sweepParams;
  const currentRange = snrRanges[sweepCurrentMcs];

  // First cycle: start ANITE emulation
  if (sweepCurrentSnr === currentRange.min && sweepCurrentMcs === 0 && !emulationProcess) {
    log(`[SWEEP] === CYCLE 1: Starting ANITE emulation at SNR=${currentRange.min} dB, MCS=0 ===`);
    log(`[SWEEP] Starting Anite emulation with SNR=${currentRange.min}`);
    const { spawn } = require('child_process');
    emulationProcess = spawn('python', ['anite_connection.py', currentRange.min.toString(), channelType], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    emulationProcess.stdout.on('data', (data) => {
      const output = data.toString();
      log(`[SWEEP ANITE] ${output}`);
      if (win) {
        win.webContents.send('emulation-output', output);
      }
    });

    emulationProcess.stderr.on('data', (data) => {
      const output = data.toString();
      log(`[SWEEP ANITE] ERROR: ${output}`);
    });

    emulationProcess.on('exit', (code, signal) => {
      log(`[SWEEP ANITE] Process exited with code ${code}, signal ${signal}`);
      emulationProcess = null;
    });

    // Wait 10s for ANITE to stabilize before running measurements
    sweepTimer = setTimeout(() => {
      runSweepMeasurement();
    }, 10000);
  } else if (emulationProcess) {
    // Subsequent cycles: update SNR and run measurement
    log(`[SWEEP] === CYCLE MCS=${sweepCurrentMcs}, SNR=${sweepCurrentSnr}/${currentRange.max} dB ===`);
    updateAniteSNR(sweepCurrentSnr, channelType).then(() => {
      // Wait 2 seconds for SNR update to take effect, then run measurement
      sweepTimer = setTimeout(() => {
        runSweepMeasurement();
      }, 2000);
    });
  }

  function runSweepMeasurement() {
    log(`[SWEEP] Starting server and client at SNR=${sweepCurrentSnr}, MCS=${sweepCurrentMcs}`);
    
    // Start server directly (call the start function instead of sending IPC)
    if (!serverResetDone) {
      resetBoard(sweepParams.serverSerial, 'SERVER', () => {
        startServerAfterReset(sweepEvent, sweepParams.serverSerial, sweepCurrentSnr);
        serverResetDone = true;
      });
    } else {
      startServerAfterReset(sweepEvent, sweepParams.serverSerial, sweepCurrentSnr);
    }
    
    // Start client after 500ms with current MCS
    setTimeout(() => {
      if (!clientResetDone) {
        resetBoard(sweepParams.clientSerial, 'CLIENT', () => {
          clientResetDone = true;
          startClientAfterReset(sweepEvent, sweepParams.clientSerial, sweepCurrentMcs);
        });
      } else {
        startClientAfterReset(sweepEvent, sweepParams.clientSerial, sweepCurrentMcs);
      }
    }, 500);

    // Wait for measurement
    sweepTimer = setTimeout(() => {
      log(`[SWEEP] 2-minute measurement complete at SNR=${sweepCurrentSnr}, MCS=${sweepCurrentMcs}, stopping server/client`);
      stopServerInternal();

      // Increment SNR for next cycle
      sweepCurrentSnr += 1;

      if (sweepCurrentSnr <= currentRange.max) {
        // Continue SNR sweep with longer gap (10 seconds) for proper cleanup
        log(`[SWEEP] Waiting 10 seconds before next SNR cycle...`);
        sweepTimer = setTimeout(() => {
          // Clear buffers before next cycle
          serverBuffer = '';
          clientBuffer = '';
          serverLastPdcAt = 0;
          clientLastPdcAt = 0;
          executeSweepCycle();
        }, 10000);
      } else {
        // SNR sweep complete for current MCS, check if we need to move to next MCS
        if (sweepCurrentMcs < sweepMaxMcs) {
          sweepCurrentMcs += 1;
          sweepCurrentSnr = snrRanges[sweepCurrentMcs].min; // Reset SNR to new MCS min
          log(`[SWEEP] === COMPLETED MCS=${sweepCurrentMcs - 1}, Moving to MCS=${sweepCurrentMcs} (SNR ${snrRanges[sweepCurrentMcs].min}-${snrRanges[sweepCurrentMcs].max} dB) ===`);
          log(`[SWEEP] Waiting 10 seconds before starting next MCS sweep...`);
          sweepTimer = setTimeout(() => {
            // Clear buffers before next cycle
            serverBuffer = '';
            clientBuffer = '';
            serverLastPdcAt = 0;
            clientLastPdcAt = 0;
            executeSweepCycle();
          }, 10000);
        } else {
          log('[SWEEP] === SWEEP COMPLETE - All MCS (0-4) completed - Closing ANITE emulation ===');
          
          // Close ANITE process after sweep completes
          if (emulationProcess) {
            try {
              log(`[SWEEP] Sending SIGTERM to Anite process for graceful shutdown`);
              emulationProcess.kill('SIGTERM');
              
              // Wait for process to exit gracefully (up to 2 seconds)
              const exitPromise = new Promise((resolve) => {
                emulationProcess.once('exit', () => {
                  log(`[SWEEP] Anite process exited`);
                  resolve();
                });
                
                // Force kill after 2 seconds if not exited
                setTimeout(() => {
                  if (emulationProcess) {
                    log(`[SWEEP] Force killing Anite process after timeout`);
                    emulationProcess.kill('SIGKILL');
                  }
                  resolve();
                }, 2000);
              });
              
              exitPromise.then(() => {
                emulationProcess = null;
                stopSweep();
              });
            } catch (e) {
              log(`[SWEEP] Error stopping Anite: ${e.message}`);
              stopSweep();
            }
          } else {
            stopSweep();
          }
        }
      }
    }, 120000); // 
  }
}

ipcMain.on('start-sweep', (event, { snrRanges, channelType, serverSerial, clientSerial }) => {
  log(`[SWEEP] Start sweep requested: Channel=${channelType}, MCS 0-4 with custom SNR ranges`);

  if (sweepRunning) {
    log('[SWEEP] Sweep already running');
    return;
  }

  // Validate and normalize snrRanges - should have entries for MCS 0-4
  const normalizedRanges = {};
  for (let mcs = 0; mcs <= 4; mcs++) {
    const range = snrRanges && snrRanges[mcs];
    if (range && range.min !== undefined && range.max !== undefined) {
      normalizedRanges[mcs] = {
        min: parseFloat(range.min),
        max: parseFloat(range.max)
      };
      log(`[SWEEP] MCS=${mcs}: SNR ${normalizedRanges[mcs].min} to ${normalizedRanges[mcs].max} dB`);
    } else {
      log(`[SWEEP] Warning: No SNR range provided for MCS=${mcs}, using defaults 0.5-10 dB`);
      normalizedRanges[mcs] = { min: 0.5, max: 10 };
    }
  }

  sweepEvent = event;
  sweepParams = { channelType, serverSerial, clientSerial, snrRanges: normalizedRanges };
  sweepCurrentSnr = normalizedRanges[0].min;
  sweepMaxSnr = normalizedRanges[0].max;
  sweepCurrentMcs = 0;
  sweepMaxMcs = 4;
  sweepRunning = true;

  executeSweepCycle();
});

ipcMain.on('stop-sweep', () => {
  log('[SWEEP] Stop sweep requested');
  stopSweep();
  stopServerInternal();
  
  if (emulationProcess) {
    try {
      emulationProcess.kill();
      emulationProcess = null;
    } catch (e) {
      log(`[SWEEP] Error stopping Anite: ${e.message}`);
    }
  }
});