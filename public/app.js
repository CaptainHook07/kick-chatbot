// Establish connection with the backend socket server
const socket = io();

// DOM Cache
const systemStatusEl = document.getElementById('system-status');
const btnStartAll = document.getElementById('btn-start-all');
const btnStopAll = document.getElementById('btn-stop-all');

const inputTargetChannel = document.getElementById('input-target-channel');
const toggleCloudMode = document.getElementById('toggle-cloud-mode');
const btnSaveChannel = document.getElementById('btn-save-channel');

const inputNewAccount = document.getElementById('input-new-account');
const btnAddAccount = document.getElementById('btn-add-account');
const accountsListEl = document.getElementById('accounts-list');

const toggleSongAlerts = document.getElementById('toggle-song-alerts');
const inputSongFilepath = document.getElementById('input-song-filepath');
const inputSongTemplate = document.getElementById('input-song-template');
const inputSongCooldown = document.getElementById('input-song-cooldown');
const btnSaveSongSettings = document.getElementById('btn-save-song-settings');
const inputManualSong = document.getElementById('input-manual-song');
const btnTriggerManualSong = document.getElementById('btn-trigger-manual-song');

const inputMessageInterval = document.getElementById('input-message-interval');
const selectMessageMode = document.getElementById('select-message-mode');
const textareaNewMessage = document.getElementById('textarea-new-message');
const btnAddMessage = document.getElementById('btn-add-message');
const messagesListEl = document.getElementById('messages-list');
const btnSaveMessageSettings = document.getElementById('btn-save-message-settings');

const consoleOutputEl = document.getElementById('console-output');
const btnClearConsole = document.getElementById('btn-clear-console');

// Application State
let appConfig = null;
let accountStatuses = {};

// Socket Events
socket.on('connect', () => {
  appendLog('system', 'Connected to server backend.');
});

socket.on('disconnect', () => {
  appendLog('error', 'Disconnected from server backend.');
});

// Initial Load Event
socket.on('init', (data) => {
  appConfig = data.config;
  accountStatuses = data.statuses;
  
  // Populate settings in inputs
  inputTargetChannel.value = appConfig.targetChannel || '';
  toggleCloudMode.checked = appConfig.cloudMode || false;
  
  // Song Settings
  toggleSongAlerts.checked = appConfig.songAlerts.enabled;
  inputSongFilepath.value = appConfig.songAlerts.filePath || '';
  inputSongTemplate.value = appConfig.songAlerts.template || 'Now playing: {song} 🎵';
  inputSongCooldown.value = appConfig.songAlerts.cooldown || 10;
  
  // Message Settings
  inputMessageInterval.value = appConfig.messageInterval || 5;
  selectMessageMode.value = appConfig.messageMode || 'sequential';
  
  // Render lists
  renderAccountsList();
  renderMessagesList();
  updateSystemStatus();
});

// Live Event Logs
socket.on('log', (data) => {
  appendLog(data.type, data.message);
});

// Account Status Updates
socket.on('statusUpdate', (data) => {
  const { accountName, status } = data;
  accountStatuses[accountName] = status;
  
  // Update account UI specifically or re-render
  renderAccountsList();
  updateSystemStatus();
});

// System Status Updates
socket.on('systemStatusUpdate', (data) => {
  const { isRunning } = data;
  if (isRunning) {
    systemStatusEl.className = 'status-badge status-active';
    systemStatusEl.innerText = 'ACTIVE';
  } else {
    systemStatusEl.className = 'status-badge status-idle';
    systemStatusEl.innerText = 'IDLE';
  }
});

// Event Listeners

// Save Channel
btnSaveChannel.addEventListener('click', () => {
  const targetChannel = inputTargetChannel.value.trim();
  const cloudMode = toggleCloudMode.checked;
  socket.emit('saveChannel', { targetChannel, cloudMode });
});

// Add Bot Account
btnAddAccount.addEventListener('click', () => {
  const accountName = inputNewAccount.value.trim();
  if (!accountName) return;
  socket.emit('addAccount', { accountName });
  inputNewAccount.value = '';
});

// Add Rotated Message
btnAddMessage.addEventListener('click', () => {
  const messageText = textareaNewMessage.value.trim();
  if (!messageText) return;
  
  appConfig.streamMessages.push(messageText);
  renderMessagesList();
  textareaNewMessage.value = '';
});

// Save Message Settings
btnSaveMessageSettings.addEventListener('click', () => {
  const interval = parseInt(inputMessageInterval.value, 10);
  const mode = selectMessageMode.value;
  
  socket.emit('saveMessageSettings', {
    messages: appConfig.streamMessages,
    interval,
    mode
  });
});

// Save Song Settings
btnSaveSongSettings.addEventListener('click', () => {
  const enabled = toggleSongAlerts.checked;
  const filePath = inputSongFilepath.value.trim();
  const template = inputSongTemplate.value.trim();
  const cooldown = parseInt(inputSongCooldown.value, 10);
  
  socket.emit('saveSongSettings', {
    enabled,
    filePath,
    template,
    cooldown
  });
});

// Trigger Manual Song Post
btnTriggerManualSong.addEventListener('click', () => {
  const songText = inputManualSong.value.trim();
  if (!songText) return;
  socket.emit('postManualSong', { songText });
  inputManualSong.value = '';
});

// Global controls
btnStartAll.addEventListener('click', () => {
  socket.emit('startAll');
});

btnStopAll.addEventListener('click', () => {
  socket.emit('stopAll');
});

// Clear console
btnClearConsole.addEventListener('click', () => {
  consoleOutputEl.innerHTML = '';
});

// UI Rendering Functions

function renderAccountsList() {
  accountsListEl.innerHTML = '';
  
  const accounts = appConfig ? appConfig.accounts : [];
  if (accounts.length === 0) {
    accountsListEl.innerHTML = '<li class="empty-list-msg">No bot accounts added. Add one above!</li>';
    return;
  }
  
  accounts.forEach(acc => {
    const li = document.createElement('li');
    
    // Status text and class mapping
    const status = accountStatuses[acc.name] || 'offline';
    let statusText = 'Offline';
    let dotClass = 'status-dot-offline';
    
    if (status === 'logging') {
      statusText = 'Logging in...';
      dotClass = 'status-dot-logging';
    } else if (status === 'ready') {
      statusText = 'Logged In / Idle';
      dotClass = 'status-dot-ready';
    } else if (status === 'running') {
      statusText = 'Bot Running';
      dotClass = 'status-dot-running';
    }
    
    // Action buttons depending on state
    let actionButtons = '';
    
    if (status === 'offline') {
      actionButtons += `<button class="btn btn-sm btn-secondary btn-login" data-name="${acc.name}">Open Login</button>`;
    } else {
      actionButtons += `<button class="btn btn-sm btn-secondary btn-login" data-name="${acc.name}">Re-Login</button>`;
    }
    
    if (status === 'ready') {
      actionButtons += `<button class="btn btn-sm btn-success btn-start" data-name="${acc.name}">Start Bot</button>`;
    } else if (status === 'running') {
      actionButtons += `<button class="btn btn-sm btn-danger btn-stop" data-name="${acc.name}">Stop Bot</button>`;
    }
    
    actionButtons += `<button class="btn btn-sm btn-danger btn-delete" data-name="${acc.name}">Delete</button>`;
    
    li.innerHTML = `
      <div class="account-row" style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
        <div class="account-info">
          <span class="account-name">${acc.name}</span>
          <span class="account-status">
            <span class="status-dot ${dotClass}"></span>
            ${statusText}
          </span>
        </div>
        <div class="account-actions">
          ${actionButtons}
          <button class="btn btn-sm btn-secondary btn-toggle-cookies" data-name="${acc.name}" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;">🍪 Cookies</button>
        </div>
      </div>
      <div class="cookies-panel" style="display: none; width: 100%; margin-top: 0.75rem; border-top: 1px dashed var(--border-color); padding-top: 0.75rem;">
        <label style="font-size: 0.75rem; margin-bottom: 0.25rem;">Paste Cookie JSON Array:</label>
        <textarea class="textarea-cookies" placeholder='[{"name": "__cf_bm", "value": "..."}, ...]' rows="3" style="font-size: 0.75rem; padding: 0.4rem; font-family: monospace;"></textarea>
        <button class="btn btn-sm btn-primary btn-save-cookies" data-name="${acc.name}" style="margin-top: 0.5rem; width: 100%; font-size: 0.75rem; padding: 0.3rem;">Save Cookies</button>
      </div>
    `;
    
    // Bind actions
    li.querySelector('.btn-login').addEventListener('click', (e) => {
      const name = e.target.getAttribute('data-name');
      socket.emit('loginAccount', { accountName: name });
    });
    
    const startBtn = li.querySelector('.btn-start');
    if (startBtn) {
      startBtn.addEventListener('click', (e) => {
        const name = e.target.getAttribute('data-name');
        socket.emit('startBot', { accountName: name });
      });
    }
    
    const stopBtn = li.querySelector('.btn-stop');
    if (stopBtn) {
      stopBtn.addEventListener('click', (e) => {
        const name = e.target.getAttribute('data-name');
        socket.emit('stopBot', { accountName: name });
      });
    }
    
    li.querySelector('.btn-delete').addEventListener('click', (e) => {
      const name = e.target.getAttribute('data-name');
      if (confirm(`Are you sure you want to delete account: ${name}?`)) {
        socket.emit('deleteAccount', { accountName: name });
      }
    });

    li.querySelector('.btn-toggle-cookies').addEventListener('click', () => {
      const panel = li.querySelector('.cookies-panel');
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });

    li.querySelector('.btn-save-cookies').addEventListener('click', (e) => {
      const name = e.target.getAttribute('data-name');
      const textarea = li.querySelector('.textarea-cookies');
      const cookiesText = textarea.value.trim();
      if (!cookiesText) return;
      socket.emit('saveCookies', { accountName: name, cookiesText });
      li.querySelector('.cookies-panel').style.display = 'none';
      textarea.value = '';
    });
    
    accountsListEl.appendChild(li);
  });
}

function renderMessagesList() {
  messagesListEl.innerHTML = '';
  
  const messages = appConfig ? appConfig.streamMessages : [];
  if (messages.length === 0) {
    messagesListEl.innerHTML = '<li class="empty-list-msg">No messages in queue. Add one above!</li>';
    return;
  }
  
  messages.forEach((msg, idx) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="message-text">${msg}</span>
      <button class="btn-delete-msg" data-index="${idx}">Delete</button>
    `;
    
    li.querySelector('.btn-delete-msg').addEventListener('click', (e) => {
      const index = parseInt(e.target.getAttribute('data-index'), 10);
      appConfig.streamMessages.splice(index, 1);
      renderMessagesList();
    });
    
    messagesListEl.appendChild(li);
  });
}

function updateSystemStatus() {
  // Check if any bot is running
  const running = Object.values(accountStatuses).some(status => status === 'running');
  socket.emit('checkSystemStatus', { running });
}

// Log utility
function appendLog(type, message) {
  const line = document.createElement('div');
  line.className = `log-line log-${type}`;
  
  const timestamp = new Date().toLocaleTimeString();
  line.innerHTML = `[${timestamp}] ${message}`;
  
  consoleOutputEl.appendChild(line);
  consoleOutputEl.scrollTop = consoleOutputEl.scrollHeight;
}
