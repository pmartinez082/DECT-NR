const { ipcRenderer } = require('electron');

let masterConnected = false;
let slaveConnected = {}; // { slave1: false, slave2: false }
let beaconScanResults = {}; // { slave1: {...}, slave2: {...}, ... }

const NUM_SLAVES = 2;

// Helper function to limit output size (prevent memory bloat)
function limitOutputSize(element, maxLines = 2000) {
  if (element && element.textContent) {
    const lines = element.textContent.split('\n');
    if (lines.length > maxLines) {
      element.textContent = lines.slice(-maxLines).join('\n');
    }
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  const debugLog = document.getElementById('debugLog');

  // Verify elements exist
  if (!debugLog) {
    console.error('Required UI elements not found!');
    return;
  }

  // Initialize slave states
  for (let i = 1; i <= NUM_SLAVES; i++) {
    slaveConnected[`slave${i}`] = false;
  }

  // Load available ports on startup
  loadPorts();

  // ===== MASTER CONTROLS =====
  
  document.getElementById('master-refresh-ports').onclick = loadPorts;

  document.getElementById('master-connect').onclick = () => {
    const port = document.getElementById('master-port-select').value;
    if (!port) {
      alert('Please select a port');
      return;
    }
    ipcRenderer.send('connect-master', { port });
    masterConnected = true;
    updateMasterUI();
  };

  document.getElementById('master-disconnect').onclick = () => {
    ipcRenderer.send('disconnect-master');
    masterConnected = false;
    updateMasterUI();
  };

  document.getElementById('beacon-start').onclick = () => {
    const channel = parseInt(document.getElementById('beacon-channel').value);
    if (isNaN(channel) || channel < 1640 || channel > 1680) {
      alert('Invalid channel (1640-1680)');
      return;
    }
    ipcRenderer.send('beacon-start', { channel });
  };

  document.getElementById('beacon-stop').onclick = () => {
    ipcRenderer.send('beacon-stop');
  };

document.addEventListener('click', (e) => {
  if (e.target.id.includes('-scan-btn')) {
    const slaveNum = e.target.id.match(/\d+/)[0];
    const prefix = `slave${slaveNum}`;

    const channel = parseInt(document.getElementById(`${prefix}-scan-channel`).value);

    if (isNaN(channel) || channel < 1640 || channel > 1680) {
      alert('Invalid channel (1640-1680)');
      return;
    }

    ipcRenderer.send('beacon-scan', { channel, slaveNum: Number(slaveNum) });
  }
});

  document.getElementById('master-clear-output').onclick = () => {
    const masterOutput = document.getElementById('master-output');
    if (masterOutput) {
      masterOutput.textContent = '';
    }
    ipcRenderer.send('clear-master-output');
  };

  // ===== SLAVE CONTROLS (dynamic for each slave) =====

  for (let slaveNum = 1; slaveNum <= NUM_SLAVES; slaveNum++) {
    const slaveKey = `slave${slaveNum}`;
    const prefix = slaveKey;

    // Refresh ports
    document.getElementById(`${prefix}-refresh-ports`).onclick = loadPorts;

    // Connect
    document.getElementById(`${prefix}-connect`).onclick = () => {
      const port = document.getElementById(`${prefix}-port-select`).value;
      if (!port) {
        alert('Please select a port');
        return;
      }
      ipcRenderer.send('connect-slave', { port, slaveNum });
      slaveConnected[slaveKey] = true;
      updateSlaveUI(slaveNum);
    };

    // Disconnect
    document.getElementById(`${prefix}-disconnect`).onclick = () => {
      ipcRenderer.send('disconnect-slave', { slaveNum });
      slaveConnected[slaveKey] = false;
      updateSlaveUI(slaveNum);
    };

    // Associate
    document.getElementById(`${prefix}-associate-btn`).onclick = () => {
      const slaveKey = `slave${slaveNum}`;
      const masterId = beaconScanResults[slaveKey] ? beaconScanResults[slaveKey].txId : null;
      const mcs = parseInt(document.getElementById(`${prefix}-associate-mcs`).value);

      if (isNaN(masterId) || isNaN(mcs) || mcs < 0 || mcs > 4) {
        alert('Invalid Master ID or MCS (0-4)');
        return;
      }

      ipcRenderer.send('associate', { slaveNum, masterId, mcs });
    };

    // Dissociate
    document.getElementById(`${prefix}-dissociate-btn`).onclick = () => {
      const slaveKey = `slave${slaveNum}`;      
      const masterId = beaconScanResults[slaveKey] ? beaconScanResults[slaveKey].txId : null;
      if (isNaN(masterId)) {
        alert('Invalid Master ID');
        return;
      }
      ipcRenderer.send('dissociate', { slaveNum, masterId });
    };

    // RACH TX Start
    document.getElementById(`${prefix}-rach-start-btn`).onclick = () => {
      const slaveKey = `slave${slaveNum}`;
      const masterId = beaconScanResults[slaveKey] ? beaconScanResults[slaveKey].txId : null;
      const data = document.getElementById(`${prefix}-rach-data`).value;
      const mcs = parseInt(document.getElementById(`${prefix}-rach-mcs`).value);
      const txPower = parseInt(document.getElementById(`${prefix}-rach-tx-power`).value);
      const interval = parseInt(document.getElementById(`${prefix}-rach-interval`).value) || 0;
      const tdmaMultiplier = parseInt(document.getElementById(`${prefix}-rach-tdma-multiplier`).value) || 4;
      const tdmaIterationCount = parseInt(document.getElementById(`${prefix}-rach-tdma-iteration-count`).value) || 40;

      if (!data) {
        alert('Please enter data to send');
        return;
      }

      if (isNaN(masterId) || isNaN(mcs) || isNaN(txPower) || isNaN(tdmaMultiplier)) {
        alert('Invalid parameters');
        return;
      }

      if (mcs < 0 || mcs > 4) {
        alert('MCS must be 0-4');
        return;
      }

      if (txPower < -20 || txPower > 20) {
        alert('TX Power must be -20 to 20 dBm');
        return;
      }

      if (tdmaMultiplier < 1 || tdmaMultiplier > 255) {
        alert('TDMA Iteration Multiplier must be 1-255');
        return;
      }

      if (tdmaIterationCount < 1 || tdmaIterationCount > 255) {
        alert('TDMA Iteration Count must be 1-255');
        return;
      }

      ipcRenderer.send('rach-tx-start', { slaveNum, masterId, data, mcs, txPower, interval, tdmaMultiplier, tdmaIterationCount });
    };

    // RACH TX Stop
    document.getElementById(`${prefix}-rach-stop-btn`).onclick = () => {
      ipcRenderer.send('rach-tx-stop', { slaveNum });
    };

    // Clear Slave Output
    document.getElementById(`${prefix}-clear-output`).onclick = () => {
      const slaveOutput = document.getElementById(`${prefix}-output`);
      if (slaveOutput) {
        slaveOutput.textContent = '';
      }
      ipcRenderer.send('clear-slave-output', { slaveNum });
    };

    // Enable/disable RACH interval based on checkbox
    document.getElementById(`${prefix}-rach-periodic`).addEventListener('change', (e) => {
      document.getElementById(`${prefix}-rach-interval`).disabled = !e.target.checked;
    });
  }

  // ===== IPC LISTENERS =====

  ipcRenderer.on('debug-log', (_, msg) => {
    const timestamp = new Date().toLocaleTimeString();
    debugLog.textContent += `[${timestamp}] ${msg}\n`;
    // Limit debug log size to prevent memory issues
    const lines = debugLog.textContent.split('\n');
    if (lines.length > 1000) {
      debugLog.textContent = lines.slice(-1000).join('\n');
    }
    debugLog.scrollTop = debugLog.scrollHeight;
  });

  // Batched master output listener
  ipcRenderer.on('master-output-batch', (_, dataArray) => {
    const masterOutput = document.getElementById('master-output');
    if (masterOutput && dataArray && dataArray.length > 0) {
      masterOutput.textContent += dataArray.join('\n') + '\n';
      limitOutputSize(masterOutput, 2000);
      masterOutput.scrollTop = masterOutput.scrollHeight;
    }
  });

  // Fallback for individual messages (for compatibility)
  ipcRenderer.on('master-output', (_, data) => {
    const masterOutput = document.getElementById('master-output');
    if (masterOutput && data) {
      masterOutput.textContent += data + '\n';
      limitOutputSize(masterOutput, 2000);
      masterOutput.scrollTop = masterOutput.scrollHeight;
    }
  });


  ipcRenderer.on('beacon-scan-result', (_, result) => {
  if (result && result.txId) {

    const slaveKey = `slave${result.slaveNum}`; // ✅ FIX

    beaconScanResults[slaveKey] = {
      txId: result.txId,
      timestamp: result.timestamp
    };

    // UI update ONLY for that slave
    const field = document.getElementById(`${slaveKey}-associate-master-id`);
    if (field) {
      field.value = result.txId;
      field.style.backgroundColor = '#ffffcc';
    }
  }
});
  // Slave output listeners
  for (let slaveNum = 1; slaveNum <= NUM_SLAVES; slaveNum++) {
    // Batched slave output listener
    ipcRenderer.on(`slave${slaveNum}-output-batch`, (_, dataArray) => {
      const slaveOutput = document.getElementById(`slave${slaveNum}-output`);
      if (slaveOutput && dataArray && dataArray.length > 0) {
        slaveOutput.textContent += dataArray.join('\n') + '\n';
        limitOutputSize(slaveOutput, 2000);
        slaveOutput.scrollTop = slaveOutput.scrollHeight;
      }
    });

    // Fallback for individual messages (for compatibility)
    ipcRenderer.on(`slave${slaveNum}-output`, (_, data) => {
      const slaveOutput = document.getElementById(`slave${slaveNum}-output`);
      if (slaveOutput && data) {
        slaveOutput.textContent += data + '\n';
        limitOutputSize(slaveOutput, 2000);
        slaveOutput.scrollTop = slaveOutput.scrollHeight;
      }
    });

    ipcRenderer.on(`association-info-${slaveNum}`, (_, info) => {
      updateAssociationDisplay(slaveNum, info);
    });

    ipcRenderer.on(`clear-slave${slaveNum}-output`, () => {
      const slaveOutput = document.getElementById(`slave${slaveNum}-output`);
      if (slaveOutput) {
        slaveOutput.textContent = '';
      }
    });
  }

  ipcRenderer.on('status-update', (_, status) => {
    updateStatusDisplay(status);
  });

  // Initial UI update
  updateMasterUI();
  for (let i = 1; i <= NUM_SLAVES; i++) {
    updateSlaveUI(i);
  }
});

async function loadPorts() {
  try {
    const ports = await ipcRenderer.invoke('list-ports');
    
    const masterSelect = document.getElementById('master-port-select');

    // Clear master
    while (masterSelect.options.length > 1) {
      masterSelect.remove(1);
    }

    // Clear all slaves ONCE
    for (let slaveNum = 1; slaveNum <= NUM_SLAVES; slaveNum++) {
      const slaveSelect = document.getElementById(`slave${slaveNum}-port-select`);
      while (slaveSelect.options.length > 1) {
        slaveSelect.remove(1);
      }
    }

    // Add ports
    ports.forEach(p => {
      const label = `${p.port} (${p.manufacturer || 'Unknown'})`;

      const masterOpt = new Option(label, p.port);
      masterSelect.add(masterOpt);

      for (let slaveNum = 1; slaveNum <= NUM_SLAVES; slaveNum++) {
        const slaveSelect = document.getElementById(`slave${slaveNum}-port-select`);
        const slaveOpt = new Option(label, p.port);
        slaveSelect.add(slaveOpt);
      }
    });

  } catch (err) {
    console.error('Error loading ports:', err);
  }
}


function updateMasterUI() {
  const portSelect = document.getElementById('master-port-select');
  const connectBtn = document.getElementById('master-connect');
  const disconnectBtn = document.getElementById('master-disconnect');
  const controlsDiv = document.getElementById('beacon-controls');

  if (masterConnected) {
    portSelect.disabled = true;
    connectBtn.disabled = true;
    disconnectBtn.disabled = false;
    controlsDiv.style.opacity = '1';
    controlsDiv.style.pointerEvents = 'auto';
  } else {
    portSelect.disabled = false;
    connectBtn.disabled = false;
    disconnectBtn.disabled = true;
    controlsDiv.style.opacity = '0.5';
    controlsDiv.style.pointerEvents = 'none';
  }
}

function updateSlaveUI(slaveNum) {
  const slaveKey = `slave${slaveNum}`;
  const portSelect = document.getElementById(`${slaveKey}-port-select`);
  const connectBtn = document.getElementById(`${slaveKey}-connect`);
  const disconnectBtn = document.getElementById(`${slaveKey}-disconnect`);
  const controlsDiv = document.getElementById(`${slaveKey}-controls`);
  const rachControlsDiv = document.getElementById(`${slaveKey}-rach-controls`);

  if (slaveConnected[slaveKey]) {
    portSelect.disabled = true;
    connectBtn.disabled = true;
    disconnectBtn.disabled = false;
    controlsDiv.style.opacity = '1';
    controlsDiv.style.pointerEvents = 'auto';
    rachControlsDiv.style.opacity = '1';
    rachControlsDiv.style.pointerEvents = 'auto';
  } else {
    portSelect.disabled = false;
    connectBtn.disabled = false;
    disconnectBtn.disabled = true;
    controlsDiv.style.opacity = '0.5';
    controlsDiv.style.pointerEvents = 'none';
    rachControlsDiv.style.opacity = '0.5';
    rachControlsDiv.style.pointerEvents = 'none';
  }
}

function updateStatusDisplay(status) {
  // Update master status
  const masterBadge = document.getElementById('master-status-badge');
  if (masterBadge) {
    masterBadge.className = `status-badge ${status.masterStatus || 'disconnected'}`;
    masterBadge.textContent = (status.masterStatus || 'disconnected').toUpperCase().replace('_', ' ');
  }

  // Update each slave status
  for (let i = 1; i <= NUM_SLAVES; i++) {
    const slaveKey = `slave${i}`;
    const slaveBadge = document.getElementById(`${slaveKey}-status-badge`);
    if (slaveBadge && status.slaveStatuses && status.slaveStatuses[slaveKey]) {
      slaveBadge.className = `status-badge ${status.slaveStatuses[slaveKey]}`;
      slaveBadge.textContent = status.slaveStatuses[slaveKey].toUpperCase().replace('_', ' ');
    }
  }
}

function updateAssociationDisplay(slaveNum, info) {
  const infoDiv = document.getElementById(`slave${slaveNum}-association-info`);
  if (!infoDiv) return;

  if (info && info.txId) {
    document.getElementById(`slave${slaveNum}-info-master-id`).textContent = info.masterId || '-';
    document.getElementById(`slave${slaveNum}-info-tx-id`).textContent = info.txId || '-';
    document.getElementById(`slave${slaveNum}-info-mcs`).textContent = info.mcs || '-';
    
    // Also auto-populate the RACH Master ID field
    const rachMasterId = document.getElementById(`slave${slaveNum}-rach-master-id`);
    if (rachMasterId && info.txId) {
      rachMasterId.value = info.txId;
    }

    infoDiv.style.display = 'block';
  } else {
    infoDiv.style.display = 'none';
  }
}

