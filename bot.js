require('./keep_alive');
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const fs = require('fs');

// Vul hier het ID in van je main bot (niet de status bot)
const mainBotId = '1399496618121892000';

// Zet hier je status channel ID
const statusChannelId = '1400514116413689998';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMembers
    ]
});

let lastSeenOnline = null;
let lastSeenOffline = null;

client.once('ready', async () => {
    console.log(`✅ Status bot logged in as ${client.user.tag}`);
    updateStatus();
    setInterval(updateStatus, 60 * 1000); // elke minuut verversen
});

async function updateStatus() {
    let mainBotStatus = "❓ Unknown";
    let mainBotServerCount = "❓";

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

            mainBotServerCount = client.guilds.cache.filter(g => g.members.cache.has(mainBotId)).size;
            break;
        }
    }

    const ping = Math.round(client.ws.ping);
    const uptime = formatUptime(client.uptime);

    const embed = new EmbedBuilder()
        .setTitle("📊 Bot Status Overview")
        .addFields(
            { name: "Main Bot", value: mainBotStatus, inline: false },
            { name: "Last Seen Online", value: lastSeenOnline ? lastSeenOnline.toLocaleString() : "❓ Unknown", inline: true },
            { name: "Last Seen Offline", value: lastSeenOffline ? lastSeenOffline.toLocaleString() : "❓ Unknown", inline: true },
            {
                name: "Offline Duration",
                value: lastSeenOffline && lastSeenOnline
                    ? getDuration(lastSeenOffline, lastSeenOnline)
                    : "❓ Unknown",
                inline: true
            },
            { name: "Status Bot", value: "🟢 Online", inline: false },
            { name: "Status Bot Uptime", value: uptime, inline: true },
            { name: "Last Error", value: "No errors detected ✅", inline: true }
        )
        .setFooter({ text: `Last update (${new Date().toLocaleString()})` })
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

function formatUptime(ms) {
    const sec = Math.floor(ms / 1000) % 60;
    const min = Math.floor(ms / (1000 * 60)) % 60;
    const hrs = Math.floor(ms / (1000 * 60 * 60)) % 24;
    const days = Math.floor(ms / (1000 * 60 * 60 * 24));
    return `${days}d ${hrs}h ${min}m ${sec}s`;
}

function getDuration(from, to) {
    const ms = to - from;
    if (ms < 0) return "⏳ Calculating...";
    return formatUptime(ms);
}

client.login(process.env.BOT_TOKEN);
