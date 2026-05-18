const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../crm_data.json');
let userData = {};

// Load CRM dynamically at startup
try {
  if (fs.existsSync(DB_PATH)) {
    userData = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  }
} catch (err) {
  console.log("Memory DB Empty or Corrupted, starting fresh.");
}

function saveDB() {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(userData, null, 2), 'utf-8');
  } catch (err) {
    console.error("Failed to write to CRM Database:", err);
  }
}

// Get user state
function getUser(mobile) {
  if (!userData[mobile]) {
    userData[mobile] = {
      mobile,
      state: "ASK_ROUTE",
      data: {},
      passengerNames: [],
      flights: [],
      messages: [],
      isHumanOverride: false,
      lastActivity: Date.now(),
      lastMessageAt: new Date().toISOString()
    };
    saveDB();
  }
  userData[mobile].lastActivity = Date.now();
  return userData[mobile];
}

// Update user state
function updateUser(mobile, updates) {
  if (userData[mobile]) {
    Object.assign(userData[mobile], updates);
    saveDB();
  }
}

// Reset user state (clears booking data but KEEPS message history)
function resetUser(mobile) {
  if (userData[mobile]) {
    const isOverride = userData[mobile].isHumanOverride || false;
    
    // Archive the full history before resetting
    const CHAT_HISTORY_PATH = path.join(__dirname, '../chat_history.json');
    try {
      let archive = {};
      if (fs.existsSync(CHAT_HISTORY_PATH)) {
        archive = JSON.parse(fs.readFileSync(CHAT_HISTORY_PATH, 'utf-8'));
      }
      if (!archive[mobile]) archive[mobile] = [];
      archive[mobile].push({
        sessionEndedAt: new Date().toISOString(),
        messages: userData[mobile].messages,
        data: userData[mobile].data,
        flights: userData[mobile].flights,
        passengerNames: userData[mobile].passengerNames
      });
      fs.writeFileSync(CHAT_HISTORY_PATH, JSON.stringify(archive, null, 2), 'utf-8');
    } catch (err) {
      console.error("Failed to archive chat history:", err);
    }
    
    // Reset properties on the existing object to preserve references
    userData[mobile].state = "ASK_ROUTE";
    userData[mobile].data = {};
    userData[mobile].passengerNames = [];
    userData[mobile].flights = [];
    userData[mobile].messages = []; // Clear current session messages to prevent massive bloat
    userData[mobile].isHumanOverride = isOverride;
    userData[mobile].lastActivity = Date.now();
    userData[mobile].lastMessageAt = new Date().toISOString();
    
    saveDB();
  }
}

function getAllUsers() {
  return userData;
}

function getArchivedHistory(mobile) {
  const CHAT_HISTORY_PATH = path.join(__dirname, '../chat_history.json');
  try {
    if (fs.existsSync(CHAT_HISTORY_PATH)) {
      const archive = JSON.parse(fs.readFileSync(CHAT_HISTORY_PATH, 'utf-8'));
      return archive[mobile] || [];
    }
  } catch (err) {
    console.error("Failed to read archive:", err);
  }
  return [];
}

let lastAdminTarget = null;

function setLastAdminTarget(mobile) {
  lastAdminTarget = mobile;
}

function getLastAdminTarget() {
  return lastAdminTarget;
}

function findUserByAny(query) {
  if (!query) return null;
  const cleanQuery = query.toLowerCase().trim();
  
  if (userData[cleanQuery]) return userData[cleanQuery];
  if (userData[`91${cleanQuery}`]) return userData[`91${cleanQuery}`];
  
  const allUsers = Object.values(userData);
  const found = allUsers.find(u => 
    u.passengerNames.some(name => name.toLowerCase().includes(cleanQuery))
  );
  return found || null;
}

module.exports = {
  getUser,
  updateUser,
  resetUser,
  getAllUsers,
  getArchivedHistory,
  setLastAdminTarget,
  getLastAdminTarget,
  findUserByAny
};
