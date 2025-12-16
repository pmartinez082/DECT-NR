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
