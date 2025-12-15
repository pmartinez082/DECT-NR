const { app, BrowserWindow, ipcMain } = require('electron');
const { SerialPort } = require('serialport');
const path = require('path');
const fs = require('fs');

let win;
let serverPort = null;
let clientPort = null;

const CSV_PATH = path.join(__dirname, 'output', 'server_output.csv');

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
  createWindow();
});

/* ===================== UART HELPERS ===================== */

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
    const text = data.toString();
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

/* ===================== SERVER ===================== */

ipcMain.on('start-server', (event, { serial, snr }) => {
  log('[SERVER] Start requested');

  if (serverPort) {
    log('[SERVER] Already running');
    return;
  }

  serverPort = openSerial(serial, 'SERVER', data => {
    event.sender.send('server-output', data);
    fs.appendFileSync(CSV_PATH, data);
  });

  setTimeout(() => {
    const cmd = `dect perf -s -p ${snr}\n`;
    log(`[SERVER] TX: ${cmd.trim()}`);
    serverPort.write(cmd);
  }, 500);
});

ipcMain.on('stop-server', () => {
  log('[SERVER] Stop requested');

  if (!serverPort) {
    log('[SERVER] Not running');
    return;
  }

  serverPort.write('dect perf stop\n');
  serverPort.close();
  serverPort = null;
});

/* ===================== CLIENT ===================== */

ipcMain.on('start-client', (event, { serial, mcs }) => {
  log('[CLIENT] Start requested');

  if (clientPort) {
    log('[CLIENT] Already running');
    return;
  }

  clientPort = openSerial(serial, 'CLIENT', data => {
    event.sender.send('client-output', data);
  });

  setTimeout(() => {
    const cmd = `dect perf -c --c_tx_mcs ${mcs}\n`;
    log(`[CLIENT] TX: ${cmd.trim()}`);
    clientPort.write(cmd);
  }, 500);
});

ipcMain.on('stop-client', () => {
  log('[CLIENT] Stop requested');

  if (!clientPort) {
    log('[CLIENT] Not running');
    return;
  }

  clientPort.write('dect perf stop\n');
  clientPort.close();
  clientPort = null;
});
