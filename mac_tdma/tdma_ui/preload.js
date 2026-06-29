// Preload script for Electron
// This runs in the context of the renderer process but with access to Node APIs
// Currently nodeIntegration is enabled, so this is optional but good practice

const { ipcRenderer } = require('electron');

window.api = {
  // IPC send methods
  connectMaster: (port) => ipcRenderer.send('connect-master', { port }),
  connectSlave: (port, slaveNum) => ipcRenderer.send('connect-slave', { port, slaveNum }),
  disconnectMaster: () => ipcRenderer.send('disconnect-master'),
  disconnectSlave: (slaveNum) => ipcRenderer.send('disconnect-slave', { slaveNum }),
  
  // Beacon commands
  beaconStart: (channel) => ipcRenderer.send('beacon-start', { channel }),
  beaconStop: () => ipcRenderer.send('beacon-stop'),
  beaconScan: (channel) => ipcRenderer.send('beacon-scan', { channel }),
  
  // Association commands
  associate: (slaveNum, masterId, mcs) => ipcRenderer.send('associate', { slaveNum, masterId, mcs }),
  dissociate: (slaveNum, masterId) => ipcRenderer.send('dissociate', { slaveNum, masterId }),
  
  // RACH commands
  rachTxStart: (slaveNum, masterId, data, mcs, txPower, interval, tdmaMultiplier, tdmaIterationCount) => 
    ipcRenderer.send('rach-tx-start', { slaveNum, masterId, data, mcs, txPower, interval, tdmaMultiplier, tdmaIterationCount }),
  rachTxStop: (slaveNum) => ipcRenderer.send('rach-tx-stop', { slaveNum }),
  
  // IPC invoke methods
  listPorts: () => ipcRenderer.invoke('list-ports'),
  getBeaconScanResult: () => ipcRenderer.invoke('get-beacon-scan-result'),
  
  // IPC listeners
  onMasterOutput: (callback) => ipcRenderer.on('master-output', (_, data) => callback(data)),
  onSlaveOutput: (slaveNum, callback) => ipcRenderer.on(`slave${slaveNum}-output`, (_, data) => callback(data)),
  onDebugLog: (callback) => ipcRenderer.on('debug-log', (_, msg) => callback(msg)),
  onStatusUpdate: (callback) => ipcRenderer.on('status-update', (_, status) => callback(status)),
  onBeaconScanResult: (callback) => ipcRenderer.on('beacon-scan-result', (_, result) => callback(result)),
  onAssociationInfo: (slaveNum, callback) => ipcRenderer.on(`association-info-${slaveNum}`, (_, info) => callback(info)),
  onClearMasterOutput: (callback) => ipcRenderer.on('clear-master-output', callback),
  onClearSlaveOutput: (slaveNum, callback) => ipcRenderer.on(`clear-slave${slaveNum}-output`, callback)
};

console.log('Preload script loaded');
