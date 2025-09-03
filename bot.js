require('./keep_alive');
const { Client, GatewayIntentBits, Collection, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

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


// Initialize commands collection
client.commands = new Collection();

// Load the incident panel module
const incidentPanel = require('./IncidentPanel.js');

// Store the incident panel in commands collection
client.commands.set(incidentPanel.name, incidentPanel);

// Bot ready event
client.once('ready', () => {
    console.log(`✅ Bot is online as ${client.user.tag}!`);
    
    // Setup incident panel
    incidentPanel.setupIncidentPanel(client, {
        AUTHORIZED_USER_ID: '1329813179865235467',    // Vervang met jouw Discord User ID
        INCIDENT_CHANNEL_ID: '1406381100980371557',   // Vervang met het incident kanaal ID
        AUDIT_CHANNEL_ID: '1407310001718038609'       // Vervang met het audit kanaal ID
    });
});

// Message event for commands
client.on('messageCreate', async (message) => {
    // Ignore bot messages
    if (message.author.bot) return;
    
    // Check if message starts with prefix
    const prefix = '!';
    if (!message.content.startsWith(prefix)) return;
    
    // Parse command and arguments
    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();
    
    // Get command from collection
    const command = client.commands.get(commandName);
    
    if (!command) return;
    
    try {
        // Execute the command
        await command.execute(message, args, client);
    } catch (error) {
        console.error(`Error executing command ${commandName}:`, error);
        message.reply('There was an error executing that command!').catch(console.error);
    }
});

// Handle button and modal interactions for incident panel
client.on('interactionCreate', async (interaction) => {
    try {
        if (interaction.isButton() || interaction.isStringSelectMenu()) {
            // Handle button interactions
            await incidentPanel.handleButtonInteraction(interaction, client);
        } else if (interaction.isModalSubmit()) {
            // Handle modal interactions
            await incidentPanel.handleModalInteraction(interaction, client);
        }
    } catch (error) {
        console.error('Error handling interaction:', error);
        
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: 'An error occurred while processing your request.',
                ephemeral: true
            }).catch(console.error);
        }
    }
});

let lastSeenOnline = null;
let lastSeenOffline = null;

client.once('ready', async () => {
    console.log(`✅ Status bot logged in as ${client.user.tag}`);

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
            { name: "Last Update", value: formatDiscordTimestamp(new Date()), inline: false },
            { name: "Status Bot", value: "[View Status Here](https://stats.uptimerobot.com/FwTtNkwNTw)", inline: false }
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










