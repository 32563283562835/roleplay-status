const express = require("express");
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');

// === Keep-alive server for Replit ===
const app = express();
app.get("/", (req, res) => res.send("Bot is running ✅"));
app.listen(3000, () => console.log("🌐 Keep-alive webserver started on port 3000"));

// === Status Bot ===
const startTime = Date.now();
let lastError = "No errors detected ✅";
const botVersion = "1.0.0";

const mainBotId = "1399496618121892000";
const channelId = "1400514116413689998";

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildPresences
    ]
});

client.once('ready', () => {
    console.log(`✅ Status bot is online as ${client.user.tag}`);
    client.user.setStatus("online");

    updateStatus(); // direct
    setInterval(updateStatus, 5 * 60 * 1000); // elke 5 min
});

async function updateStatus() {
    const now = new Date();
    const amsterdamTime = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Amsterdam" }));

    try {
        const channel = client.channels.cache.get(channelId);
        if (!channel) {
            console.error("❌ Status channel not found!");
            return;
        }

        let mainBotUser = client.users.cache.get(mainBotId);
        if (!mainBotUser) {
            try {
                mainBotUser = await client.users.fetch(mainBotId);
            } catch (err) {
                console.error("❌ Could not fetch main bot:", err);
            }
        }

        let mainBotStatus = "❓ Unknown";
        let mainBotServerCount = "❓";

        const presence = mainBotUser?.presence;
        if (presence) {
            mainBotStatus =
                presence.status === "online" ? "🟢 Online" :
                presence.status === "idle" ? "🟡 Idle" :
                presence.status === "dnd" ? "🔴 Do Not Disturb" : "⚫ Offline";

            mainBotServerCount = client.guilds.cache.filter(g => g.members.cache.has(mainBotId)).size;
        }

        const embed = new EmbedBuilder()
            .setColor(mainBotStatus.includes("🟢") ? 0x00FF00 : 0xFF0000)
            .setTitle("📊 Bot Status Overview")
            .addFields(
                { name: "Main Bot", value: `${mainBotStatus}`, inline: true },
                { name: "Main Bot Servers", value: `${mainBotServerCount}`, inline: true },
                { name: "Status Bot", value: "🟢 Online", inline: true },
                { name: "Status Bot Uptime", value: formatUptime(Date.now() - startTime), inline: true },
                { name: "Ping", value: `${client.ws.ping}ms`, inline: true },
                { name: "Bot Version", value: botVersion, inline: true },
                { name: "Last Error", value: lastError, inline: false }
            )
            .setFooter({ text: `Last update (${amsterdamTime.toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam" })})` })
            .setTimestamp();

        const messages = await channel.messages.fetch({ limit: 1 });
        if (messages.size === 0) {
            await channel.send({ embeds: [embed] });
        } else {
            const message = messages.first();
            await message.edit({ embeds: [embed] });
        }

        console.log("✅ Status message updated");

    } catch (err) {
        console.error("❌ Error while updating status:", err);
        lastError = err.message;
    }
}

process.on('unhandledRejection', err => {
    console.error("Unhandled error:", err);
    lastError = err.message;
});

process.on('uncaughtException', err => {
    console.error("Unexpected error:", err);
    lastError = err.message;
});

function formatUptime(ms) {
    const sec = Math.floor(ms / 1000) % 60;
    const min = Math.floor(ms / (1000 * 60)) % 60;
    const hrs = Math.floor(ms / (1000 * 60 * 60)) % 24;
    const days = Math.floor(ms / (1000 * 60 * 60 * 24));
    return `${days}d ${hrs}h ${min}m ${sec}s`;
}

client.login(process.env.DISCORD_TOKEN);
