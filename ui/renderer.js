const { ipcRenderer } = require('electron');

window.addEventListener('DOMContentLoaded', () => {

  const serverOut = document.getElementById('server-output');
  const clientOut = document.getElementById('client-output');
  const debugLog = document.getElementById('debugLog');


  document.getElementById('start-server').onclick = () => {
    ipcRenderer.send('start-server', {
      serial: document.getElementById('server-serial').value,
      snr: document.getElementById('snr-input').value
    });
  };

  document.getElementById('stop-server').onclick = () => {
    ipcRenderer.send('stop-server');
  };

  

  document.getElementById('start-client').onclick = () => {
    ipcRenderer.send('start-client', {
      serial: document.getElementById('client-serial').value,
      mcs: document.getElementById('mcs-input').value
    });
  };

  document.getElementById('stop-client').onclick = () => {
    ipcRenderer.send('stop-client');
  };
  document.getElementById('create-graph').onclick = () => {
    ipcRenderer.send('create-graph');
  }

  document.getElementById('pdf-select').addEventListener('change', (e) => {
    const selected = e.target.value;
    const embed = document.getElementById('graph-embed');
    embed.src = `output/graphs/${selected}.pdf?cb=${new Date().getTime()}`;
    // Send the selected filename to main process
    ipcRenderer.send('select-filename', { filename: selected });
  });

  document.getElementById('start-emulation').addEventListener('click', () => {
    const snr = document.getElementById('snr-input').value;
    const channelType = document.getElementById('pdf-select').value;
    ipcRenderer.send('start-emulation', { snr, channelType });
  });

  document.getElementById('stop-emulation').addEventListener('click', () => {
    ipcRenderer.send('stop-emulation');
  });

  document.getElementById('start-sweep').addEventListener('click', () => {
    const channelType = document.getElementById('pdf-select').value;
    const serverSerial = document.getElementById('server-serial').value;
    const clientSerial = document.getElementById('client-serial').value;
    
    // Collect SNR ranges for each MCS
    const snrRanges = {};
    for (let mcs = 0; mcs <= 4; mcs++) {
      const minInput = document.querySelector(`.snr-min[data-mcs="${mcs}"]`);
      const maxInput = document.querySelector(`.snr-max[data-mcs="${mcs}"]`);
      
      snrRanges[mcs] = {
        min: parseFloat(minInput.value),
        max: parseFloat(maxInput.value)
      };
    }
    
    ipcRenderer.send('start-sweep', { snrRanges, channelType, serverSerial, clientSerial });
  });

  document.getElementById('stop-sweep').addEventListener('click', () => {
    ipcRenderer.send('stop-sweep');
  });

  ipcRenderer.on('server-output', (_, data) => {
    serverOut.textContent += data;
    serverOut.scrollTop = serverOut.scrollHeight;
  });

  ipcRenderer.on('client-output', (_, data) => {
    clientOut.textContent += data;
    clientOut.scrollTop = clientOut.scrollHeight;
  });

  ipcRenderer.on('debug-log', (_, msg) => {
    debugLog.value += msg + '\n';
    debugLog.scrollTop = debugLog.scrollHeight;
  });

});

ipcRenderer.on('refresh-graph', () => {
  const embed = document.getElementById('graph-embed');
  // Force reload by changing the src (adding cache-busting query)
  embed.src = `output/graphs/TDL-B.pdf?cb=${new Date().getTime()}`;
});