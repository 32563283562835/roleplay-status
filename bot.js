require('./keep_alive');
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');

// Vul hier het ID in van je main bot (niet de status bot)
const mainBotId = '1399496618121892000';

// Zet hier je status channel ID
const statusChannelId = '1400514116413689998';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// === Incident Panel koppelen ===
const { registerIncidentPanel } = require('./IncidentPanel');
registerIncidentPanel(client, {
    allowedUserId: '1329813179865235467',
    auditChannelId: '1407310001718038609',
    newIncidentNotifyChannelId: '1406381100980371557',
    // storageFile: './incidents.json' // optioneel
});

let lastSeenOnline = null;
let lastSeenOffline = null;

client.once('ready', async () => {
    console.log(`✅ Status bot logged in as ${client.user.tag}`registerIncidentPanel(client, {
    allowedUserId: '1329813179865235467', // jouw user id
    auditChannelId: '1407310001718038609', // audit channel
    newIncidentNotifyChannelId: '1406381100980371557', // notificatie channel
    storageFile: './incidents.json', // locatie van opslag
        );

    // Eerste set
    await updatePresence();
    await updateStatus();

    // Embed elke minuut verversen
    setInterval(async () => {
        await updatePresence();
        await updateStatus();
    }, 60 * 1000);
});

async function updatePresence() {
    try {
        const incidentCount = getIncidentCount();
        client.user.setPresence({
            status: incidentCount > 0 ? 'dnd' : 'online',
            activities: [{
                name: incidentCount > 0 ? `${incidentCount} incidents` : "Monitoring",
                type: 3
            }]
        });
    } catch (err) {
        console.error("❌ Failed to set presence:", err);
    }
}

async function updateStatus() {
    let mainBotStatus = "❓ Unknown";

    for (const guild of client.guilds.cache.values()) {
        await guild.members.fetch({ user: mainBotId, force: true }).catch(() => {});
        const member = guild.members.cache.get(mainBotId);

        if (member) {
            const presence = member.presence;
            if (presence) {
                switch (presence.status) {
                    case "online":
                        mainBotStatus = "🟢 Online";
                        lastSeenOnline = new Date();
                        break;
                    case "idle":
                        mainBotStatus = "🟡 Idle";
                        lastSeenOnline = new Date();
                        break;
                    case "dnd":
                        mainBotStatus = "🔴 Do Not Disturb";
                        lastSeenOnline = new Date();
                        break;
                    default:
                        mainBotStatus = "⚫ Offline";
                        if (!lastSeenOffline || (lastSeenOnline && lastSeenOnline > lastSeenOffline)) {
                            lastSeenOffline = new Date();
                        }
                        break;
                }
            } else {
                mainBotStatus = "⚫ Offline";
                if (!lastSeenOffline || (lastSeenOnline && lastSeenOnline > lastSeenOffline)) {
                    lastSeenOffline = new Date();
                }
            }
            break;
        }
    }

    const incidentCount = getIncidentCount();

    const embed = new EmbedBuilder()
        .setTitle("📊 Bot Status Overview")
        .addFields(
            { name: "Roleplay Bot", value: mainBotStatus, inline: true },
            { name: "Active Incidents", value: `${incidentCount}`, inline: false },
            { name: "Last Seen Online", value: lastSeenOnline ? formatDiscordTimestamp(lastSeenOnline) : "❓ Unknown", inline: true },
            { name: "Last Seen Offline", value: lastSeenOffline ? formatDiscordTimestamp(lastSeenOffline) : "❓ Unknown", inline: true },
            { name: "Offline Duration", value: lastSeenOffline && lastSeenOnline ? getDuration(lastSeenOffline, lastSeenOnline) : "❓ Unknown", inline: true },
            { name: "Last Update", value: formatDiscordTimestamp(new Date()), inline: false }
        )
        .setFooter({ text: "Updating every minute..." })
        .setColor(incidentCount > 0 ? 0xED4245 : 0x0080FF);

    const channel = client.channels.cache.get(statusChannelId);
    if (channel) {
        const messages = await channel.messages.fetch({ limit: 1 }).catch(() => null);
        if (!messages || messages.size === 0) {
            channel.send({ embeds: [embed] }).catch(() => {});
        } else {
            messages.first().edit({ embeds: [embed] }).catch(() => {});
        }
    }
}

// Discord timestamp formatter (relative)
function formatDiscordTimestamp(date) {
    const unix = Math.floor(date.getTime() / 1000);
    return `<t:${unix}:R>`;
}

// Format uptime as readable string
function formatUptime(ms) {
    const sec = Math.floor(ms / 1000) % 60;
    const min = Math.floor(ms / (1000 * 60)) % 60;
    const hrs = Math.floor(ms / (1000 * 60 * 60)) % 24;
    const days = Math.floor(ms / (1000 * 60 * 60 * 24));
    return `${days}d ${hrs}h ${min}m ${sec}s`;
}

// Duration between two dates
function getDuration(from, to) {
    const ms = to - from;
    if (ms < 0) return ":x: Currently Offline...";
    return formatUptime(ms);
}

// Temporary dummy until incident-panel storage is linked
function getIncidentCount() {
    return 0;
}

client.login(process.env.BOT_TOKEN);

