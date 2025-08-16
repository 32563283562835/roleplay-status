require('./keep_alive');
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');

// Vul hier het ID in van je main bot (niet de status bot)
const mainBotId = '1399496618121892000';

// Zet hier je status channel ID
const statusChannelId = '1400514116413689998';

// Laad IncidentPanel functie
const { setupIncidentPanel } = require('./IncidentPanel');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

let lastSeenOnline = null;
let lastSeenOffline = null;

client.once('ready', async () => {
    console.log(`✅ Status bot logged in as ${client.user.tag}`);

    // Zet presence zodra de bot klaar is
    client.user.setPresence({
        status: 'idle',
        activities: [{ name: 'Updating status...', type: 0 }]
    });

    // Synchroniseer met de klok: update bij elke nieuwe minuut
    const now = new Date();
    const msUntilNextMinute = 60000 - (now.getSeconds() * 1000 + now.getMilliseconds());

    setTimeout(() => {
        startCountdown();
        updateStatus();
        setInterval(() => {
            startCountdown();
            updateStatus();
        }, 60 * 1000);
    }, msUntilNextMinute);
});

// Luister naar het :incident-panel command
client.on('messageCreate', async (message) => {
    if (message.author.bot) return; // negeer bots

    if (message.content === ':incident-panel') {
        setupIncidentPanel(client);
        message.reply("✅ Incident Panel geactiveerd!");
    }
});

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
                        if (!lastSeenOffline || lastSeenOnline > lastSeenOffline) {
                            lastSeenOffline = new Date();
                        }
                        break;
                }
            } else {
                mainBotStatus = "⚫ Offline";
                if (!lastSeenOffline || lastSeenOnline > lastSeenOffline) {
                    lastSeenOffline = new Date();
                }
            }
            break;
        }
    }

    const embed = new EmbedBuilder()
        .setTitle("📊 Bot Status Overview")
        .addFields(
            { name: "Roleplay Bot", value: mainBotStatus, inline: false },
            {
                name: "Last Seen Online",
                value: lastSeenOnline ? formatDiscordTimestamp(lastSeenOnline) : "❓ Unknown",
                inline: true
            },
            {
                name: "Last Seen Offline",
                value: lastSeenOffline ? formatDiscordTimestamp(lastSeenOffline) : "❓ Unknown",
                inline: true
            },
            {
                name: "Offline Duration",
                value: lastSeenOffline && lastSeenOnline
                    ? getDuration(lastSeenOffline, lastSeenOnline)
                    : "❓ Unknown",
                inline: true
            },
            {
                name: "Last Update",
                value: formatDiscordTimestamp(new Date()),
                inline: false
            }
        )
        .setFooter({ text: "Updating every minute..." })
        .setColor("#0080FF");

    const channel = client.channels.cache.get(statusChannelId);
    if (channel) {
        const messages = await channel.messages.fetch({ limit: 1 });
        if (messages.size === 0) {
            channel.send({ embeds: [embed] });
        } else {
            messages.first().edit({ embeds: [embed] });
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

// Countdown functie
function startCountdown() {
    let secondsLeft = 59;
    client.user.setStatus('idle');

    const countdownInterval = setInterval(() => {
        client.user.setActivity(`Updating status in: ${secondsLeft}s`, { type: 0 });
        secondsLeft--;
        if (secondsLeft < 0) clearInterval(countdownInterval);
    }, 1000);
}

client.login(process.env.BOT_TOKEN);
