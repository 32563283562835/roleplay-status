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

// Temporary in-memory incident storage
let incidents = [];

const INCIDENT_CHANNEL_ID = '1406381100980371557';
let incidentMessageId = null;

// ====== Presence callback koppelstuk ======
let updatePresenceCallback = null;
function setUpdatePresenceCallback(cb) { updatePresenceCallback = cb; }
function notifyPresence() { if (typeof updatePresenceCallback === 'function') updatePresenceCallback(); }
function getIncidentCount() { return incidents.length; }
// =========================================

function setupIncidentPanel(client) {
    client.on('messageCreate', async (message) => {
        if (message.author.bot) return;

        // Only allow this specific user ID
        if (message.author.id !== '1329813179865235467') return;

        if (message.content === ':incident-panel') {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('addIncident').setLabel('➕ Add Incident').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('updateIncident').setLabel('✏️ Update Incident').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('removeIncident').setLabel('🗑️ Remove Incident').setStyle(ButtonStyle.Danger)
            );

            const embed = new EmbedBuilder()
                .setTitle('📋 Incident Management Panel')
                .setDescription('Use the buttons below to manage incidents.')
                .setColor('Blue');

            await message.channel.send({ embeds: [embed], components: [row] });

            // Send initial message to incident channel if not already sent
            const channel = await client.channels.fetch(INCIDENT_CHANNEL_ID).catch(() => null);
            if (channel && !incidentMessageId) {
                const incidentEmbed = new EmbedBuilder()
                    .setTitle('🚨 Incidents:')
                    .setDescription('All active incidents will be listed here.')
                    .setColor('Red');

                const sentMsg = await channel.send({ embeds: [incidentEmbed] });
                incidentMessageId = sentMsg.id;
            }
        }
    });

    // Handle button interactions
    client.on('interactionCreate', async (interaction) => {
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

                await interaction.showModal(modal);
            }

            if (interaction.customId === 'updateIncident') {
                if (incidents.length === 0) return interaction.reply({ content: '⚠️ No incidents to update.', ephemeral: true });

                const menu = new StringSelectMenuBuilder()
                    .setCustomId('selectIncidentUpdate')
                    .setPlaceholder('Select an incident to update')
                    .addOptions(incidents.map((i, idx) => ({
                        label: i.title,
                        description: i.description.substring(0, 50),
                        value: idx.toString()
                    })));


                await interaction.reply({
                    content: 'Select an incident to update:',
                    components: [new ActionRowBuilder().addComponents(menu)],
                    ephemeral: true
                });
            }

            if (interaction.customId === 'removeIncident') {
                if (incidents.length === 0) return interaction.reply({ content: '⚠️ No incidents to remove.', ephemeral: true });

                const menu = new StringSelectMenuBuilder()
                    .setCustomId('selectIncidentRemove')
                    .setPlaceholder('Select an incident to remove')
                    .addOptions(incidents.map((i, idx) => ({
                        label: i.title,
                        description: i.description.substring(0, 50),
                        value: idx.toString()
                    })));

                await interaction.reply({
                    content: 'Select an incident to remove:',
                    components: [new ActionRowBuilder().addComponents(menu)],
                    ephemeral: true
                });
            }
        }

        // Handle modal submissions
        if (interaction.isModalSubmit()) {
            if (interaction.customId === 'modalAddIncident') {
                const title = interaction.fields.getTextInputValue('incidentTitle');
                const desc = interaction.fields.getTextInputValue('incidentDesc');
                const time = interaction.fields.getTextInputValue('incidentTime');

                incidents.push({ title, description: desc, time });

                await interaction.reply({ content: `✅ Incident **${title}** added.`, ephemeral: true });

                // Presence direct updaten
                notifyPresence();

                // Update the main incident message
                const channel = await client.channels.fetch(INCIDENT_CHANNEL_ID).catch(() => null);
                if (channel && incidentMessageId) {
                    const msg = await channel.messages.fetch(incidentMessageId).catch(() => null);
                    if (msg) {
                        const embed = new EmbedBuilder()
                            .setTitle('🚨 Incidents:')
                            .setColor('Red')
                            .setDescription(incidents.length > 0 ? '' : 'No active incidents.')
                            .addFields(incidents.map(i => ({
                                name: i.title,
                                value: `${i.description}\n**Estimated Time:** ${i.time}`
                            })));

                        msg.edit({ embeds: [embed] });
                    }
                }
            }
        }

        // Handle select menu for update/remove
        if (interaction.isStringSelectMenu()) {
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

                await interaction.showModal(modal);
            }

            if (interaction.customId === 'selectIncidentRemove') {
                const index = parseInt(interaction.values[0]);
                const removed = incidents.splice(index, 1);

                await interaction.reply({ content: `🗑️ Incident **${removed[0].title}** removed.`, ephemeral: true });

                // Presence direct updaten
                notifyPresence();

                // Update main incident message
                const channel = await client.channels.fetch(INCIDENT_CHANNEL_ID).catch(() => null);
                if (channel && incidentMessageId) {
                    const msg = await channel.messages.fetch(incidentMessageId).catch(() => null);
                    if (msg) {
                        const embed = new EmbedBuilder()
                            .setTitle('🚨 Incidents:')
                            .setColor('Red')
                            .setDescription(incidents.length > 0 ? '' : 'No active incidents.')
                            .addFields(incidents.map(i => ({
                                name: i.title,
                                value: `${i.description}\n**Estimated Time:** ${i.time}`
                            })));

                        msg.edit({ embeds: [embed] });
                    }
                }
            }
        }

        // Handle update modal submission
        if (interaction.isModalSubmit() && interaction.customId.startsWith('modalUpdateIncident_')) {
            const index = parseInt(interaction.customId.split('_')[1]);

            incidents[index] = {
                title: interaction.fields.getTextInputValue('incidentTitle'),
                description: interaction.fields.getTextInputValue('incidentDesc'),
                time: interaction.fields.getTextInputValue('incidentTime')
            };

            await interaction.reply({ content: `✏️ Incident **${incidents[index].title}** updated.`, ephemeral: true });

            // (Optioneel) Presence updaten — aantal blijft gelijk, dus niet per se nodig
            // notifyPresence();

            // Update main incident message
            const channel = await client.channels.fetch(INCIDENT_CHANNEL_ID).catch(() => null);
            if (channel && incidentMessageId) {
                const msg = await channel.messages.fetch(incidentMessageId).catch(() => null);
                if (msg) {
                    const embed = new EmbedBuilder()
                        .setTitle('🚨 Incidents:')
                        .setColor('Red')
                        .setDescription(incidents.length > 0 ? '' : 'No active incidents.')
                        .addFields(incidents.map(i => ({
                            name: i.title,
                            value: `${i.description}\n**Estimated Time:** ${i.time}`
                        })));

                    msg.edit({ embeds: [embed] });
                }
            }
        }
    });
}

module.exports = { setupIncidentPanel, getIncidentCount, setUpdatePresenceCallback };
