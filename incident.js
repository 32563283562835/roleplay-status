const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('new-incident')
    .setDescription('Report a new incident'),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setTitle('Report an Incident')
      .setDescription('Click the button below to fill out the incident form.')
      .setColor('Red');

    const button = new ButtonBuilder()
      .setCustomId('open_incident_modal')
      .setLabel('Report Incident 🚨')
      .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder().addComponents(button);

    await interaction.reply({
      embeds: [embed],
      components: [row],
      ephemeral: true
    });
  }
};
