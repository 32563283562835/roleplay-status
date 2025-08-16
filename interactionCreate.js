const {
  Events,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder
} = require('discord.js');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    // 🔘 Button interaction
    if (interaction.isButton() && interaction.customId === 'open_incident_modal') {
      const modal = new ModalBuilder()
        .setCustomId('incident_modal')
        .setTitle('Incident Report Form');

      const typeInput = new TextInputBuilder()
        .setCustomId('incident_type')
        .setLabel('Incident Type (e.g. Technical, Safety)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const titleInput = new TextInputBuilder()
        .setCustomId('incident_title')
        .setLabel('Incident Title')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const descriptionInput = new TextInputBuilder()
        .setCustomId('incident_description')
        .setLabel('Incident Description')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

      const row1 = new ActionRowBuilder().addComponents(typeInput);
      const row2 = new ActionRowBuilder().addComponents(titleInput);
      const row3 = new ActionRowBuilder().addComponents(descriptionInput);

      modal.addComponents(row1, row2, row3);

      await interaction.showModal(modal);
    }

    // 📋 Modal submission
    if (interaction.isModalSubmit() && interaction.customId === 'incident_modal') {
      const type = interaction.fields.getTextInputValue('incident_type');
      const title = interaction.fields.getTextInputValue('incident_title');
      const description = interaction.fields.getTextInputValue('incident_description');

      const incidentId = Math.floor(100000 + Math.random() * 900000);
      const timestamp = new Date().toLocaleString();

      const embed = new EmbedBuilder()
        .setTitle(`🚨 ${title}`)
        .setDescription(description)
        .addFields({ name: 'Type', value: type })
        .setColor('Red')
        .setFooter({ text: `Incident ID: #${incidentId} | Reported by ${interaction.user.tag}` })
        .setTimestamp();

      const channel = interaction.client.channels.cache.get('1400514116413689998');
      if (channel) {
        await channel.send({ embeds: [embed] });
        await interaction.reply({ content: 'Incident successfully reported!', ephemeral: true });
      } else {
        await interaction.reply({ content: 'Error: Incident channel not found.', ephemeral: true });
      }
    }
  }
};
