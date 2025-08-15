const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const startTime = Date.now();
let lastError = "No errors detected ✅";
const botVersion = "1.0.0";

const mainBotId = "1399496618121892000";
const channelId = "YOUR_CHANNEL_ID";

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildPresences
    ]
});

client.once('ready', () => {
    console.log(`Status bot is online as ${client.user.tag}`);
    client.user.setStatus("online");
    scheduleFirstUpdate();
});

async function updateStatus() {
    const now = new Date();
    const amsterdamTime = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Amsterdam" }));
    const hour = amsterdamTime.getHours();

    // Night mode: 22:00 - 07:00
    if (hour >= 22 || hour < 7) {
        console.log("🌙 Night mode active, sending notice and shutting down bot...");

        try {
            const channel = client.channels.cache.get(channelId);
            if (channel) {
                const nightEmbed = new EmbedBuilder()
                    .setColor(0x5865F2)
                    .setTitle("🌙 Night Mode Active")
                    .setDescription(
                        "The status bot is currently paused to save hosting hours.\n\n" +
                        "**Night mode:** 22:00 – 07:00\n" +
                        "Timezone: Europe/Amsterdam 🇳🇱\n\n" +
                        "Status updates will resume at **07:00**."
                    )
                    .setFooter({ text: `Last check: ${amsterdamTime.toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam" })}` })
                    .setTimestamp();

                await channel.send({ embeds: [nightEmbed] });
            }
        } catch (err) {
            console.error("Error sending night mode embed:", err);
        }

        process.exit(0); // Stop process to save Railway hours
        return;
    }

    try {
        const channel = client.channels.cache.get(channelId);
        if (!channel) {
            console.error("Status channel not found!");
            return;
        }

        let mainBotUser = client.users.cache.get(mainBotId);
        if (!mainBotUser) {
            try {
                mainBotUser = await client.users.fetch(mainBotId);
            } catch (err) {
                console.error("Could not fetch main bot:", err);
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
        console.error("Error while updating status:", err);
        lastError = err.message;
    }
}

function scheduleFirstUpdate() {
    const now = new Date();
    const amsterdamTime = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Amsterdam" }));

    let firstRun = new Date(amsterdamTime);
    firstRun.setHours(12, 0, 0, 0);

    if (firstRun <= amsterdamTime) {
        firstRun.setDate(firstRun.getDate() + 1);
    }

    const delay = firstRun - amsterdamTime;
    console.log(`⏳ First update scheduled for ${firstRun.toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam" })}`);

    setTimeout(() => {
        updateStatus();
        setInterval(updateStatus, 5 * 60 * 1000);
    }, delay);
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
