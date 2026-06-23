const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const open = require('open');

const PORT = process.env.PORT || 3000;
const CONFIG_PATH = path.join(__dirname, 'config.json');
const PROFILES_DIR = path.join(__dirname, 'profiles');

// Ensure profiles directory exists
if (!fs.existsSync(PROFILES_DIR)) {
  fs.mkdirSync(PROFILES_DIR, { recursive: true });
}

// Load configuration
let config = {
  targetChannel: "",
  cloudMode: false,
  accounts: [],
  streamMessages: [],
  messageInterval: 5,
  messageMode: "sequential",
  songAlerts: {
    enabled: false,
    filePath: "",
    template: "Now playing: {song} 🎵",
    cooldown: 10
  }
};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = fs.readFileSync(CONFIG_PATH, 'utf8');
      config = JSON.parse(data);
    } else {
      saveConfig();
    }
  } catch (err) {
    console.error('Error loading config:', err);
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving config:', err);
  }
}

loadConfig();

// Express & Socket.io Setup
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Keep track of active bot browser and page instances
// Structure: { [accountName]: { browser, page, status } }
const activeBots = {};

// Helper to get initial status dictionary for all accounts
function getAccountStatuses() {
  const statuses = {};
  config.accounts.forEach(acc => {
    if (activeBots[acc.name]) {
      statuses[acc.name] = activeBots[acc.name].status;
    } else {
      statuses[acc.name] = 'ready'; // Accounts are ready by default since profile exists
    }
  });
  return statuses;
}

// Log utility to send logs to the dashboard console
function dashboardLog(type, message) {
  console.log(`[${type.toUpperCase()}] ${message}`);
  io.emit('log', { type, message });
}

// Socket communication
io.on('connection', (socket) => {
  dashboardLog('info', 'Dashboard user interface connected.');
  
  // Send initial data
  socket.emit('init', {
    config,
    statuses: getAccountStatuses()
  });

  // Save Target Channel & Cloud Mode
  socket.on('saveChannel', (data) => {
    config.targetChannel = data.targetChannel;
    config.cloudMode = !!data.cloudMode;
    saveConfig();
    dashboardLog('success', `Settings updated. Target: kick.com/${config.targetChannel} | Cloud Mode: ${config.cloudMode}`);
    io.emit('init', { config, statuses: getAccountStatuses() });
  });

  // Save Cookies
  socket.on('saveCookies', (data) => {
    const { accountName, cookiesText } = data;
    try {
      const cookies = JSON.parse(cookiesText);
      if (!Array.isArray(cookies)) {
        throw new Error("Cookies must be a JSON array.");
      }
      
      const accountDir = path.join(PROFILES_DIR, accountName);
      if (!fs.existsSync(accountDir)) {
        fs.mkdirSync(accountDir, { recursive: true });
      }
      
      fs.writeFileSync(path.join(accountDir, 'cookies.json'), JSON.stringify(cookies, null, 2), 'utf8');
      dashboardLog('success', `[${accountName}] Successfully saved imported login cookies.`);
      io.emit('statusUpdate', { accountName, status: 'ready' });
    } catch (err) {
      dashboardLog('error', `[${accountName}] Failed to import cookies: ${err.message}`);
    }
  });

  // Add Account
  socket.on('addAccount', (data) => {
    const { accountName } = data;
    if (config.accounts.some(acc => acc.name.toLowerCase() === accountName.toLowerCase())) {
      dashboardLog('warning', `Account '${accountName}' already exists.`);
      return;
    }
    config.accounts.push({ name: accountName });
    saveConfig();
    dashboardLog('success', `Added bot account: ${accountName}`);
    io.emit('init', { config, statuses: getAccountStatuses() });
  });

  // Delete Account
  socket.on('deleteAccount', async (data) => {
    const { accountName } = data;
    
    // Stop the bot if running
    if (activeBots[accountName]) {
      await stopBotInstance(accountName);
    }
    
    config.accounts = config.accounts.filter(acc => acc.name !== accountName);
    saveConfig();
    dashboardLog('success', `Deleted bot account: ${accountName}`);
    io.emit('init', { config, statuses: getAccountStatuses() });
  });

  // Save Message Settings
  socket.on('saveMessageSettings', (data) => {
    config.streamMessages = data.messages;
    config.messageInterval = data.interval;
    config.messageMode = data.mode;
    saveConfig();
    restartPromoTimer();
    dashboardLog('success', `Message rotation settings saved. Interval: ${config.messageInterval} min, Mode: ${config.messageMode}`);
    io.emit('init', { config, statuses: getAccountStatuses() });
  });

  // Save Song Settings
  socket.on('saveSongSettings', (data) => {
    config.songAlerts.enabled = data.enabled;
    config.songAlerts.filePath = data.filePath;
    config.songAlerts.template = data.template;
    config.songAlerts.cooldown = data.cooldown;
    saveConfig();
    dashboardLog('success', `Song alert settings saved. Enabled: ${config.songAlerts.enabled}`);
    io.emit('init', { config, statuses: getAccountStatuses() });
  });

  // Manual Song Post
  socket.on('postManualSong', async (data) => {
    const { songText } = data;
    await postSongAnnouncement(songText, 'manual');
  });

  // Open Headful Login Window
  socket.on('loginAccount', async (data) => {
    const { accountName } = data;
    await openLoginBrowser(accountName);
  });

  // Start Individual Bot
  socket.on('startBot', async (data) => {
    const { accountName } = data;
    await startBotInstance(accountName);
  });

  // Stop Individual Bot
  socket.on('stopBot', async (data) => {
    const { accountName } = data;
    await stopBotInstance(accountName);
  });

  // Global Start All Bots
  socket.on('startAll', async () => {
    dashboardLog('info', 'Triggered: Start All Bots');
    const idleBots = config.accounts.filter(acc => !activeBots[acc.name] || activeBots[acc.name].status === 'ready');
    if (idleBots.length === 0) {
      dashboardLog('warning', 'No idle bot accounts to start.');
      return;
    }
    for (const acc of idleBots) {
      await startBotInstance(acc.name);
      // Stagger startups slightly
      await new Promise(r => setTimeout(r, 2000));
    }
  });

  // Global Stop All Bots
  socket.on('stopAll', async () => {
    dashboardLog('info', 'Triggered: Stop All Bots');
    const runningAccounts = Object.keys(activeBots);
    if (runningAccounts.length === 0) {
      dashboardLog('warning', 'No running bots to stop.');
      return;
    }
    for (const name of runningAccounts) {
      await stopBotInstance(name);
    }
  });

  socket.on('checkSystemStatus', (data) => {
    io.emit('systemStatusUpdate', { isRunning: data.running });
  });
});

// Puppeteer Controller Functions

// Opens a headful browser to log in to Kick.com and saves the session
async function openLoginBrowser(accountName) {
  if (activeBots[accountName]) {
    dashboardLog('warning', `Account '${accountName}' is already active. Stop it before opening login window.`);
    return;
  }

  dashboardLog('info', `Opening login window for '${accountName}'...`);
  io.emit('statusUpdate', { accountName, status: 'logging' });
  
  try {
    const userProfileDir = path.join(PROFILES_DIR, accountName);
    const browser = await puppeteer.launch({
      headless: false,
      userDataDir: userProfileDir,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--window-size=800,800'
      ],
      defaultViewport: null
    });

    const [page] = await browser.pages();
    
    // Listen for manual browser close
    browser.on('disconnected', () => {
      dashboardLog('info', `Login window closed for '${accountName}'. Profile saved.`);
      delete activeBots[accountName];
      io.emit('statusUpdate', { accountName, status: 'ready' });
    });

    activeBots[accountName] = {
      browser,
      page,
      status: 'logging'
    };

    await page.goto('https://kick.com', { waitUntil: 'domcontentloaded' });
    dashboardLog('info', `Navigate to Kick.com in the login window. Log in manually, complete any CAPTCHAs, and close the window when finished.`);
    
  } catch (err) {
    dashboardLog('error', `Error opening login window for '${accountName}': ${err.message}`);
    io.emit('statusUpdate', { accountName, status: 'ready' });
  }
}

// Starts the bot browser instance to load Kick chat popout
async function startBotInstance(accountName) {
  if (activeBots[accountName] && activeBots[accountName].status === 'running') {
    dashboardLog('warning', `Bot '${accountName}' is already running.`);
    return;
  }

  if (!config.targetChannel) {
    dashboardLog('error', 'Cannot start bot: No target channel configured.');
    return;
  }

  dashboardLog('info', `Starting bot '${accountName}'...`);
  io.emit('statusUpdate', { accountName, status: 'logging' });

  try {
    const userProfileDir = path.join(PROFILES_DIR, accountName);
    
    const isCloudMode = !!config.cloudMode;
    const browser = await puppeteer.launch({
      headless: isCloudMode,
      userDataDir: userProfileDir,
      args: isCloudMode ? [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1280,800'
      ] : [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--window-size=500,600'
      ],
      defaultViewport: null
    });

    const [page] = await browser.pages();

    // Listen for unexpected browser disconnect
    browser.on('disconnected', () => {
      if (activeBots[accountName]) {
        dashboardLog('warning', `Browser window for '${accountName}' was closed.`);
        delete activeBots[accountName];
        io.emit('statusUpdate', { accountName, status: 'ready' });
      }
    });

    activeBots[accountName] = {
      browser,
      page,
      status: 'logging'
    };

    // Load cookies if running in Cloud mode (or if cookies exist anyway)
    try {
      const cookiePath = path.join(userProfileDir, 'cookies.json');
      if (fs.existsSync(cookiePath)) {
        const cookiesStr = fs.readFileSync(cookiePath, 'utf8');
        const cookies = JSON.parse(cookiesStr);
        if (cookies && cookies.length > 0) {
          dashboardLog('info', `[${accountName}] Loading imported session cookies...`);
          // Navigate to kick.com first to set context for cookie injection
          await page.goto('https://kick.com', { waitUntil: 'domcontentloaded' });
          await page.setCookie(...cookies);
        }
      }
    } catch (cookieErr) {
      dashboardLog('warning', `[${accountName}] Error loading cookies: ${cookieErr.message}`);
    }

    const targetUrl = `https://kick.com/popout/${config.targetChannel}/chat`;
    dashboardLog('info', `Connecting '${accountName}' to: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

    // Wait a brief period for page scripts to load
    await new Promise(r => setTimeout(r, 5000));

    // Check if the chat input textarea is present (confirms logged-in status)
    const chatInputExists = await page.$('textarea');
    if (!chatInputExists) {
      dashboardLog('error', `Bot '${accountName}' failed to find chat input. Ensure you are logged in by clicking 'Open Login' first.`);
      await browser.close();
      delete activeBots[accountName];
      io.emit('statusUpdate', { accountName, status: 'ready' });
      return;
    }

    activeBots[accountName].status = 'running';
    io.emit('statusUpdate', { accountName, status: 'running' });
    dashboardLog('success', `Bot '${accountName}' successfully joined Kick chat!`);

  } catch (err) {
    dashboardLog('error', `Error starting bot '${accountName}': ${err.message}`);
    if (activeBots[accountName] && activeBots[accountName].browser) {
      try {
        await activeBots[accountName].browser.close();
      } catch (e) {}
    }
    delete activeBots[accountName];
    io.emit('statusUpdate', { accountName, status: 'ready' });
  }
}

// Stops the bot browser instance
async function stopBotInstance(accountName) {
  if (!activeBots[accountName]) return;

  dashboardLog('info', `Stopping bot '${accountName}'...`);
  try {
    const instance = activeBots[accountName];
    delete activeBots[accountName]; // prevent trigger of disconnect warning
    
    if (instance.browser) {
      await instance.browser.close();
    }
    dashboardLog('success', `Bot '${accountName}' stopped.`);
  } catch (err) {
    dashboardLog('error', `Error stopping bot '${accountName}': ${err.message}`);
  }
  io.emit('statusUpdate', { accountName, status: 'ready' });
}

// Sends a message using a specific bot account's Puppeteer session
async function sendMessage(accountName, messageText) {
  const instance = activeBots[accountName];
  if (!instance || instance.status !== 'running') {
    return false;
  }

  try {
    const page = instance.page;
    
    // Check if textarea exists and is interactable
    const textarea = await page.$('textarea');
    if (!textarea) {
      dashboardLog('error', `[${accountName}] Chat input textarea is missing from the page.`);
      return false;
    }

    // Focus on the input
    await page.focus('textarea');

    // Clear any leftover content (Ctrl+A followed by Backspace)
    await page.keyboard.down('Control');
    await page.keyboard.press('A');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');

    // Type the message
    await page.type('textarea', messageText);

    // Send the message
    await page.keyboard.press('Enter');
    
    dashboardLog('success', `[${accountName}] Sent message: "${messageText}"`);
    return true;
  } catch (err) {
    dashboardLog('error', `[${accountName}] Failed to send message: ${err.message}`);
    return false;
  }
}

// Message Rotation Scheduler (Promo stream content)
let promoTimer = null;
let currentMessageIndex = 0;
let currentAccountIndex = 0;

function restartPromoTimer() {
  if (promoTimer) {
    clearInterval(promoTimer);
    promoTimer = null;
  }

  if (config.streamMessages.length === 0 || config.messageInterval <= 0) {
    return;
  }

  const intervalMs = config.messageInterval * 60 * 1000;
  
  promoTimer = setInterval(async () => {
    // Get list of running accounts
    const runningAccounts = Object.keys(activeBots).filter(name => activeBots[name].status === 'running');
    if (runningAccounts.length === 0) {
      return; // No bots active to send message
    }

    // Select account
    if (currentAccountIndex >= runningAccounts.length) {
      currentAccountIndex = 0;
    }
    const senderAccount = runningAccounts[currentAccountIndex];
    currentAccountIndex = (currentAccountIndex + 1) % runningAccounts.length;

    // Select message
    let messageToSend = "";
    if (config.messageMode === 'random') {
      const randIdx = Math.floor(Math.random() * config.streamMessages.length);
      messageToSend = config.streamMessages[randIdx];
    } else {
      if (currentMessageIndex >= config.streamMessages.length) {
        currentMessageIndex = 0;
      }
      messageToSend = config.streamMessages[currentMessageIndex];
      currentMessageIndex = (currentMessageIndex + 1) % config.streamMessages.length;
    }

    if (messageToSend) {
      await sendMessage(senderAccount, messageToSend);
    }

  }, intervalMs);
}

// Start timer initially
restartPromoTimer();

// Song Tracking and Watcher System
let lastSongText = "";
let songAlertCooldownActive = false;

// Simple file watcher polling (every 3 seconds)
setInterval(async () => {
  if (!config.songAlerts.enabled || !config.songAlerts.filePath) {
    return;
  }

  try {
    const filePath = config.songAlerts.filePath;
    
    if (!fs.existsSync(filePath)) {
      return;
    }

    const content = fs.readFileSync(filePath, 'utf8').trim();
    if (!content || content === lastSongText) {
      return;
    }

    // Song changed!
    lastSongText = content;
    
    if (songAlertCooldownActive) {
      dashboardLog('info', `Song changed to "${content}" but skipped due to cooldown.`);
      return;
    }

    await postSongAnnouncement(content, 'auto');

    // Trigger cooldown
    if (config.songAlerts.cooldown > 0) {
      songAlertCooldownActive = true;
      setTimeout(() => {
        songAlertCooldownActive = false;
      }, config.songAlerts.cooldown * 1000);
    }

  } catch (err) {
    // Suppress spammy log, but print if critical
    console.error('Error reading song file:', err.message);
  }
}, 3000);

// Posts a song update to chat
async function postSongAnnouncement(songText, source = 'auto') {
  const runningAccounts = Object.keys(activeBots).filter(name => activeBots[name].status === 'running');
  if (runningAccounts.length === 0) {
    dashboardLog('warning', `[Song Alert] Song changed to "${songText}", but no bot accounts are currently running to post it.`);
    return;
  }

  // Format message using template
  const template = config.songAlerts.template || "Now playing: {song} 🎵";
  const messageText = template.replace('{song}', songText);

  // Pick first running bot to send the message
  const senderAccount = runningAccounts[0];
  
  if (source === 'manual') {
    dashboardLog('info', `Manually posting song: "${songText}"...`);
  } else {
    dashboardLog('info', `Song file update detected: "${songText}"...`);
  }

  await sendMessage(senderAccount, messageText);
}

// Start Server and Open Dashboard
server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Server is running at ${url}`);
  
  // Wait 1.5 seconds then open the dashboard in browser
  setTimeout(() => {
    open(url).catch(err => {
      console.error('Failed to open dashboard URL in browser:', err);
    });
  }, 1500);
});
