const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    StringSelectMenuBuilder,
    EmbedBuilder
} = require('discord.js');

// Temporary in-memory storage
let incidents = [];

const INCIDENT_CHANNEL_ID = '1406381100980371557';
let incidentMessageId = null;

// ====== Presence callback hook ======
let updatePresenceCallback = null;
function setUpdatePresenceCallback(cb) { updatePresenceCallback = cb; }
function notifyPresence() { if (typeof updatePresenceCallback === 'function') updatePresenceCallback(); }
function getIncidentCount() { return incidents.filter(i => !i.resolved).length; }
// ====================================

function setupIncidentPanel(client) {
    client.on('messageCreate', async (message) => {
        if (message.author.bot) return;

        // Only allow this specific user ID
        if (message.author.id !== '1329813179865235467') return;

        if (message.content === ':incident-panel') {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('addIncident').setLabel('➕ Add Incident').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('updateIncident').setLabel('✏️ Update Incident').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('removeIncident').setLabel('🗑️ Remove Incident').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('resolveIncident').setLabel('✅ Resolve Incident').setStyle(ButtonStyle.Secondary),
            );

            const embed = new EmbedBuilder()
                .setTitle('📋 Incident Management Panel')
                .setDescription('Use the buttons below to manage incidents.')
                .setColor('Blue');

            await message.channel.send({ embeds: [embed], components: [row] });

            // Always recreate the main incident board at the bottom
            await createOrMoveIncidentBoard(client);
        }
    });

    client.on('interactionCreate', async (interaction) => {
        // --- BUTTONS ---
        if (interaction.isButton()) {
            if (interaction.customId === 'addIncident') {
                const modal = new ModalBuilder().setCustomId('modalAddIncident').setTitle('Add Incident');

                const titleInput = new TextInputBuilder().setCustomId('incidentTitle').setLabel('Title').setStyle(TextInputStyle.Short).setRequired(true);
                const descInput = new TextInputBuilder().setCustomId('incidentDesc').setLabel('Description').setStyle(TextInputStyle.Paragraph).setRequired(true);
                const timeInput = new TextInputBuilder().setCustomId('incidentTime').setLabel('Estimated Time').setStyle(TextInputStyle.Short).setRequired(true);

                modal.addComponents(
                    new ActionRowBuilder().addComponents(titleInput),
                    new ActionRowBuilder().addComponents(descInput),
                    new ActionRowBuilder().addComponents(timeInput)
                );

                return interaction.showModal(modal);
            }

            if (interaction.customId === 'updateIncident') {
                if (incidents.length === 0) return interaction.reply({ content: '⚠️ No incidents to update.', flags: 64 });

                const menu = new StringSelectMenuBuilder()
                    .setCustomId('selectIncidentUpdate')
                    .setPlaceholder('Select an incident to update')
                    .addOptions(incidents.map((i, idx) => ({
                        label: i.title + (i.resolved ? ' (Resolved)' : ''),
                        description: i.description.substring(0, 50),
                        value: idx.toString()
                    })));

                return interaction.reply({
                    content: 'Select an incident to update:',
                    components: [new ActionRowBuilder().addComponents(menu)],
                    flags: 64
                });
            }

            if (interaction.customId === 'removeIncident') {
                if (incidents.length === 0) return interaction.reply({ content: '⚠️ No incidents to remove.', flags: 64 });

                const menu = new StringSelectMenuBuilder()
                    .setCustomId('selectIncidentRemove')
                    .setPlaceholder('Select an incident to remove')
                    .addOptions(incidents.map((i, idx) => ({
                        label: i.title + (i.resolved ? ' (Resolved)' : ''),
                        description: i.description.substring(0, 50),
                        value: idx.toString()
                    })));

                return interaction.reply({
                    content: 'Select an incident to remove:',
                    components: [new ActionRowBuilder().addComponents(menu)],
                    flags: 64
                });
            }

            if (interaction.customId === 'resolveIncident') {
                if (incidents.length === 0) return interaction.reply({ content: '⚠️ No incidents to resolve.', flags: 64 });

                const menu = new StringSelectMenuBuilder()
                    .setCustomId('selectIncidentResolve')
                    .setPlaceholder('Select an incident to resolve')
                    .addOptions(incidents.map((i, idx) => ({
                        label: i.title,
                        description: i.description.substring(0, 50),
                        value: idx.toString()
                    })));

                return interaction.reply({
                    content: 'Select an incident to resolve:',
                    components: [new ActionRowBuilder().addComponents(menu)],
                    flags: 64
                });
            }
        }

        // --- MODALS ---
        if (interaction.isModalSubmit()) {
            if (interaction.customId === 'modalAddIncident') {
                const title = interaction.fields.getTextInputValue('incidentTitle');
                const desc = interaction.fields.getTextInputValue('incidentDesc');
                const time = interaction.fields.getTextInputValue('incidentTime');

                const incident = { title, description: desc, time, resolved: false };
                incidents.push(incident);

                await interaction.reply({ content: `✅ Incident **${title}** added.`, flags: 64 });

                notifyPresence();
                await createOrMoveIncidentBoard(client);

                // Also post separate incident message
                const channel = await client.channels.fetch(INCIDENT_CHANNEL_ID).catch(() => null);
                if (channel) {
                    const embed = new EmbedBuilder()
                        .setTitle(`🚨 Incident: ${title}`)
                        .setDescription(`${desc}\n**Estimated Time:** ${time}`)
                        .setColor('Red')
                        .setFooter({ text: 'Status: Active' })
                        .setTimestamp();

                    await channel.send({ embeds: [embed] });
                }
            }

            if (interaction.customId.startsWith('modalUpdateIncident_')) {
                const index = parseInt(interaction.customId.split('_')[1]);
                if (!incidents[index]) return;

                incidents[index].title = interaction.fields.getTextInputValue('incidentTitle');
                incidents[index].description = interaction.fields.getTextInputValue('incidentDesc');
                incidents[index].time = interaction.fields.getTextInputValue('incidentTime');

                await interaction.reply({ content: `✏️ Incident **${incidents[index].title}** updated.`, flags: 64 });
                await createOrMoveIncidentBoard(client);
            }
        }

        // --- SELECT MENUS ---
        if (interaction.isStringSelectMenu()) {
            if (interaction.customId === 'selectIncidentRemove') {
                const index = parseInt(interaction.values[0]);
                const removed = incidents.splice(index, 1);

                await interaction.reply({ content: `🗑️ Incident **${removed[0].title}** removed.`, flags: 64 });

                notifyPresence();
                await createOrMoveIncidentBoard(client);
            }

            if (interaction.customId === 'selectIncidentUpdate') {
                const index = parseInt(interaction.values[0]);
                const incident = incidents[index];

                const modal = new ModalBuilder().setCustomId(`modalUpdateIncident_${index}`).setTitle('Update Incident');

                const titleInput = new TextInputBuilder().setCustomId('incidentTitle').setLabel('Title').setStyle(TextInputStyle.Short).setValue(incident.title);
                const descInput = new TextInputBuilder().setCustomId('incidentDesc').setLabel('Description').setStyle(TextInputStyle.Paragraph).setValue(incident.description);
                const timeInput = new TextInputBuilder().setCustomId('incidentTime').setLabel('Estimated Time').setStyle(TextInputStyle.Short).setValue(incident.time);

                modal.addComponents(
                    new ActionRowBuilder().addComponents(titleInput),
                    new ActionRowBuilder().addComponents(descInput),
                    new ActionRowBuilder().addComponents(timeInput)
                );

                return interaction.showModal(modal);
            }

            if (interaction.customId === 'selectIncidentResolve') {
                const index = parseInt(interaction.values[0]);
                if (!incidents[index]) return;

                incidents[index].resolved = true;

                await interaction.reply({ content: `✅ Incident **${incidents[index].title}** marked as resolved.`, flags: 64 });

                notifyPresence();
                await createOrMoveIncidentBoard(client);

                // Post separate resolved message
                const channel = await client.channels.fetch(INCIDENT_CHANNEL_ID).catch(() => null);
                if (channel) {
                    const embed = new EmbedBuilder()
                        .setTitle(`✅ Incident Resolved: ${incidents[index].title}`)
                        .setDescription(`${incidents[index].description}\n**Estimated Time:** ${incidents[index].time}`)
                        .setColor('Green')
                        .setFooter({ text: 'Status: Resolved' })
                        .setTimestamp();

                    await channel.send({ embeds: [embed] });
                }
            }
        }
    });
}

// Always create/move the board to the bottom
async function createOrMoveIncidentBoard(client) {
    const channel = await client.channels.fetch(INCIDENT_CHANNEL_ID).catch(() => null);
    if (!channel) return;

    // Delete old board
    if (incidentMessageId) {
        const oldMsg = await channel.messages.fetch(incidentMessageId).catch(() => null);
        if (oldMsg) await oldMsg.delete().catch(() => {});
    }

    const embed = new EmbedBuilder()
        .setTitle('🚨 Incidents:')
        .setColor('Red')
        .setDescription(incidents.length > 0 ? '' : 'No active incidents.')
        .addFields(
            incidents.map(i => ({
                name: i.title,
                value: `${i.description}\n**Estimated Time:** ${i.time}\n**Status:** ${i.resolved ? '✅ Resolved' : '🚨 Active'}`
            }))
        );

    const sentMsg = await channel.send({ embeds: [embed] });
    incidentMessageId = sentMsg.id;
}

module.exports = { setupIncidentPanel, getIncidentCount, setUpdatePresenceCallback };
