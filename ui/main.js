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


const CSV_PATH = path.join(__dirname, 'output', 'server_output.csv');

/* ===================== UTIL ===================== */

function log(msg) {
  console.log(msg);
  if (win) {
    win.webContents.send('debug-log', msg);
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
    const text = stripAnsi(data.toString());
    log(`[${tag}] RX: ${text.trim()}`);
    onData(text);
});

  port.on('error', err => {
    log(`[${tag}] SERIAL ERROR: ${err.message}`);
  });

  port.on('close', () => {
    log(`[${tag}] Serial port closed`);
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

  // Send stop command
  try {
    clientPort.write('dect perf stop\n', err => {
      if (err) log('[CLIENT] Stop command failed: ' + err.message);
    });
  } catch {}

  // DTR reset BEFORE closing port
  try {
    clientPort.set({ dtr: false });
    setTimeout(() => {
      clientPort.set({ dtr: true });

      // Wait a bit, then close port
      setTimeout(() => {
        if (!clientPort) return;
        clientPort.close(() => log('[CLIENT] Closed'));
        clientPort = null;
      }, 200);

    }, 100);
  } catch (e) {
    log('[CLIENT] DTR reset failed: ' + e.message);
    // fallback: just close
    clientPort.close(() => log('[CLIENT] Closed'));
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

  // Send stop command to server
  try {
    serverPort.write('dect perf stop\n', err => {
      if (err) log('[SERVER] Stop command failed: ' + err.message);
    });
  } catch {}

  // DTR reset BEFORE closing
  try {
    serverPort.set({ dtr: false });
    setTimeout(() => {
      serverPort.set({ dtr: true });

      setTimeout(() => {
        if (!serverPort) return;
        serverPort.close(() => log('[SERVER] Closed'));
        serverPort = null;
      }, 200);

    }, 100);
  } catch (e) {
    log('[SERVER] DTR reset failed: ' + e.message);
    serverPort.close(() => log('[SERVER] Closed'));
    serverPort = null;
  }
}



/* ===================== SERVER ===================== */

ipcMain.on('start-server', (event, { serial, snr }) => {
  log('[SERVER] Start requested');

  if (!serverResetDone) {
    resetBoard(serial, 'SERVER', () => {
      serverResetDone = true;
      startServerAfterReset(event, serial, snr);
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
    log('[SERVER] Already running');
    return;
  }

 function stripAnsi(str) {
    return str.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}

serverPort = openSerial(serial, 'SERVER', data => {
    const text = data.toString();
    
    // Clean ANSI before logging
    const cleanText = stripAnsi(text);

    // Log to the app
    if (cleanText.trim()) {
        event.sender.send('server-output', cleanText);
        log(`[SERVER] RX: ${cleanText}`);
    }

    // Append clean text to CSV
    fs.appendFileSync(CSV_PATH, cleanText);
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
    log('[CLIENT] Already running');
    return;
  }

  clientPort = openSerial(serial, 'CLIENT', data => {
    event.sender.send('client-output', data);
  });

  const cmd = `dect perf -c --c_tx_mcs ${mcs} -t 10000\n`;
  log(`[CLIENT] TX: ${cmd.trim()}`);
  clientPort.write(cmd);
}


ipcMain.on('stop-client', () => {
  log('[CLIENT] Stop requested manually');
  stopClientInternal();
});

function stripAnsi(str) {

    return str.replace(
        // matches almost all ANSI escape sequences
        /\x1b\[[0-9;]*[A-Za-z]/g,
        ''
    );
}


  

