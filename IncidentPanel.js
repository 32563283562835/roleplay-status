const { Client, GatewayIntentBits, Partials, EmbedBuilder, PermissionsBitField, SlashCommandBuilder } = require('discord.js');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    partials: [Partials.Channel],
});

const INCIDENT_CHANNEL_ID = '1406381100980371557'; // zet hier jouw incident kanaal ID
let incidents = [];
let incidentMessageId = null;

// ========================
// CREATE / UPDATE BOARD
// ========================
async function createOrMoveIncidentBoard(client) {
    const channel = await client.channels.fetch(INCIDENT_CHANNEL_ID).catch(() => null);
    if (!channel) return;

    // Oude incident board verwijderen
    if (incidentMessageId) {
        const oldMsg = await channel.messages.fetch(incidentMessageId).catch(() => null);
        if (oldMsg) await oldMsg.delete().catch(() => {});
    }

    const embed = new EmbedBuilder()
        .setTitle('🚨 Incidents:')
        .setColor('Red');

    if (incidents.length === 0) {
        embed.setDescription('No active incidents.');
    } else {
        embed.addFields(
            incidents.map(i => ({
                name: i.title || 'Untitled Incident',
                value:
                    (i.description?.trim() || 'No description provided.') +
                    `\n**Estimated Time:** ${i.time || 'N/A'}` +
                    `\n**Status:** ${i.resolved ? '✅ Resolved' : '🚨 Active'}`
            }))
        );
    }

let sentMsg;
if (incidentMessageId) {
    sentMsg = await channel.messages.fetch(incidentMessageId).catch(() => null);
    if (sentMsg) {
        await sentMsg.edit({ embeds: [embed] });
    } else {
        sentMsg = await channel.send({ embeds: [embed] });
        incidentMessageId = sentMsg.id;
    }
} else {
    sentMsg = await channel.send({ embeds: [embed] });
    incidentMessageId = sentMsg.id;
}

}

// ========================
// SLASH COMMANDS
// ========================
client.on('ready', () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    client.application.commands.set([
        new SlashCommandBuilder()
            .setName('incident')
            .setDescription('Manage incidents')
            .addSubcommand(sub =>
                sub.setName('create')
                    .setDescription('Create a new incident')
                    .addStringOption(opt => opt.setName('title').setDescription('Incident title').setRequired(true))
                    .addStringOption(opt => opt.setName('description').setDescription('Incident description').setRequired(false))
                    .addStringOption(opt => opt.setName('time').setDescription('Estimated resolution time').setRequired(false))
            )
            .addSubcommand(sub =>
                sub.setName('resolve')
                    .setDescription('Resolve an existing incident')
                    .addStringOption(opt => opt.setName('title').setDescription('Incident title').setRequired(true))
            )
    ]);
});

// ========================
// INTERACTIONS
// ========================
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'incident') {
        const sub = interaction.options.getSubcommand();

        if (sub === 'create') {
            const title = interaction.options.getString('title');
            const description = interaction.options.getString('description') || 'No description provided.';
            const time = interaction.options.getString('time') || 'N/A';

            // Incident opslaan
            const incident = { title, description, time, resolved: false };
            incidents.push(incident);

            // Los incident bericht
            await interaction.channel.send({
                embeds: [
                    new EmbedBuilder()
                        .setTitle(`🚨 New Incident: ${title}`)
                        .setDescription(description)
                        .addFields(
                            { name: 'Estimated Time', value: time },
                            { name: 'Status', value: '🚨 Active' }
                        )
                        .setColor('Red')
                ]
            });

            // Board updaten
            await createOrMoveIncidentBoard(client);

            await interaction.reply({ content: `Incident **${title}** has been created.`, flags: 64 });
        }

        if (sub === 'resolve') {
            const title = interaction.options.getString('title');
            const incident = incidents.find(i => i.title === title);

            if (!incident) {
                return interaction.reply({ content: `❌ Incident **${title}** not found.`, flags: 64 });
            }

            incident.resolved = true;

            // Board updaten
            await createOrMoveIncidentBoard(client);

            await interaction.reply({ content: `✅ Incident **${title}** has been marked as resolved.`, flags: 64 });
        }
    }
});

client.login(process.env.BOT_TOKEN);
