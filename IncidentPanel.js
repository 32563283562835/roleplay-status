// IncidentPanel.js
const { EmbedBuilder, PermissionsBitField } = require("discord.js");

// Memory storage for incidents
let incidents = [];
let mainEmbedMessage = null; // reference to the "main embed" message

// Channel ID where incidents should be posted
const INCIDENT_CHANNEL_ID = "YOUR_CHANNEL_ID_HERE"; // <--- replace with your channel id

// Setup function to initialize incident system
async function setupIncidentPanel(client) {
    const channel = await client.channels.fetch(INCIDENT_CHANNEL_ID).catch(() => null);
    if (!channel) {
        console.error("❌ Could not find incident channel.");
        return;
    }

    // Always (re)send the main embed at the bottom
    await sendOrMoveMainEmbed(channel);
}

// Create a new incident
async function createIncident(client, description, author) {
    const channel = await client.channels.fetch(INCIDENT_CHANNEL_ID).catch(() => null);
    if (!channel) return console.error("❌ Incident channel not found.");

    const incidentId = incidents.length + 1;
    const newIncident = {
        id: incidentId,
        description,
        status: "Active",
        createdAt: new Date(),
        resolvedAt: null
    };

    incidents.push(newIncident);

    // Send individual incident message
    const embed = new EmbedBuilder()
        .setTitle(`🚨 Incident #${incidentId}`)
        .setDescription(description)
        .addFields(
            { name: "Status", value: "🟢 Active", inline: true },
            { name: "Reported by", value: author, inline: true },
            { name: "Created", value: formatDiscordTimestamp(newIncident.createdAt), inline: false }
        )
        .setColor("Red");

    await channel.send({ embeds: [embed] });

    // Refresh main embed at bottom
    await sendOrMoveMainEmbed(channel);

    return newIncident;
}

// Resolve an incident by ID
async function resolveIncident(client, incidentId) {
    const channel = await client.channels.fetch(INCIDENT_CHANNEL_ID).catch(() => null);
    if (!channel) return;

    const incident = incidents.find(i => i.id === incidentId);
    if (!incident) return console.error("❌ Incident not found.");

    incident.status = "Resolved";
    incident.resolvedAt = new Date();

    // Send update message
    const embed = new EmbedBuilder()
        .setTitle(`✅ Incident #${incident.id} Resolved`)
        .setDescription(incident.description)
        .addFields(
            { name: "Status", value: "✅ Resolved", inline: true },
            { name: "Created", value: formatDiscordTimestamp(incident.createdAt), inline: true },
            { name: "Resolved", value: formatDiscordTimestamp(incident.resolvedAt), inline: true }
        )
        .setColor("Green");

    await channel.send({ embeds: [embed] });

    // Refresh main embed at bottom
    await sendOrMoveMainEmbed(channel);
}

// Send or move the main embed (always last in channel)
async function sendOrMoveMainEmbed(channel) {
    const summaryEmbed = new EmbedBuilder()
        .setTitle("📊 Incident Overview")
        .setColor("Blue")
        .setDescription("Overview of all incidents. Newest incidents are above.")
        .addFields(
            { name: "Total", value: `${incidents.length}`, inline: true },
            { name: "Active", value: `${incidents.filter(i => i.status === "Active").length}`, inline: true },
            { name: "Resolved", value: `${incidents.filter(i => i.status === "Resolved").length}`, inline: true }
        )
        .setFooter({ text: "This message always stays at the bottom." });

    try {
        // If we already have a main embed, delete and resend to move it to bottom
        if (mainEmbedMessage) {
            await mainEmbedMessage.delete().catch(() => {});
        }
        mainEmbedMessage = await channel.send({ embeds: [summaryEmbed] });
    } catch (err) {
        console.error("❌ Could not send main embed:", err);
    }
}

// Get count of active incidents (used by bot.js for status)
function getIncidentCount() {
    return incidents.filter(i => i.status === "Active").length;
}

// Format Discord timestamp (relative)
function formatDiscordTimestamp(date) {
    const unix = Math.floor(date.getTime() / 1000);
    return `<t:${unix}:R>`;
}

module.exports = {
    setupIncidentPanel,
    createIncident,
    resolveIncident,
    getIncidentCount
};
