// IncidentPanel.js

let incidents = [];
let updatePresenceCallback = null;

function setUpdatePresenceCallback(callback) {
    updatePresenceCallback = callback;
}

function getIncidentCount() {
    return incidents.length;
}

function notifyUpdate() {
    if (updatePresenceCallback) updatePresenceCallback();
}

// Voeg een incident toe
function addIncident(title, description) {
    incidents.push({ title, description, createdAt: new Date() });
    notifyUpdate();
}

// Verwijder incident
function removeIncident(index) {
    if (index >= 0 && index < incidents.length) {
        incidents.splice(index, 1);
        notifyUpdate();
    }
}

// Setup functie voor het incident panel
function setupIncidentPanel(client) {
    console.log("🛠️ IncidentPanel is klaar voor gebruik.");
    // Hier zou je knoppen/menu’s kunnen koppelen aan Discord (bijv. via commands)
}

module.exports = { 
    setupIncidentPanel, 
    getIncidentCount, 
    setUpdatePresenceCallback, 
    addIncident, 
    removeIncident 
};
