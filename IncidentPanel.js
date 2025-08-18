// IncidentPanel.js
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
require("dotenv").config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Message, Partials.Channel],
});

const PREFIX = ".";
let incidentCounter = 1;
let incidents = [];

// Helper: update the incident panel embed
async function updateIncidentPanel(panelMessage) {
  const embed = new EmbedBuilder()
    .setTitle("🚨 Incident Panel")
    .setDescription(
      incidents.length === 0
        ? "There are no incidents at the moment."
        : incidents
            .map(
              (i) =>
                `**#${i.id}** - ${i.title} (${i.status === "resolved" ? "✅ Resolved" : "⚠️ Active"})`
            )
            .join("\n")
    )
    .setColor(0xff0000)
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("new_incident").setLabel("➕ New Incident").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("resolve_incident").setLabel("✅ Resolve Incident").setStyle(ButtonStyle.Success)
  );

  await panelMessage.edit({ embeds: [embed], components: [row] });
}

// Handle prefix command
client.on("messageCreate", async (message) => {
  if (!message.content.startsWith(PREFIX) || message.author.bot) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  if (command === "incident-panel") {
    const embed = new EmbedBuilder()
      .setTitle("🚨 Incident Panel")
      .setDescription("There are no incidents at the moment.")
      .setColor(0xff0000)
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("new_incident").setLabel("➕ New Incident").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("resolve_incident").setLabel("✅ Resolve Incident").setStyle(ButtonStyle.Success)
    );

    const panelMessage = await message.channel.send({ embeds: [embed], components: [row] });

    // Save this panel so it can be updated later
    client.panelMessage = panelMessage;
  }
});

// Handle button interactions
client.on("interactionCreate", async (interaction) => {
  if (interaction.isButton()) {
    if (interaction.customId === "new_incident") {
      const modal = new ModalBuilder()
        .setCustomId("modal_new_incident")
        .setTitle("New Incident");

      const titleInput = new TextInputBuilder()
        .setCustomId("incident_title")
        .setLabel("Incident Title")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const descInput = new TextInputBuilder()
        .setCustomId("incident_desc")
        .setLabel("Incident Description")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

      const row1 = new ActionRowBuilder().addComponents(titleInput);
      const row2 = new ActionRowBuilder().addComponents(descInput);

      modal.addComponents(row1, row2);
      await interaction.showModal(modal);
    }

    if (interaction.customId === "resolve_incident") {
      const modal = new ModalBuilder()
        .setCustomId("modal_resolve_incident")
        .setTitle("Resolve Incident");

      const idInput = new TextInputBuilder()
        .setCustomId("incident_id")
        .setLabel("Incident ID")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const row1 = new ActionRowBuilder().addComponents(idInput);
      modal.addComponents(row1);
      await interaction.showModal(modal);
    }
  }

  // Handle modal submissions
  if (interaction.isModalSubmit()) {
    if (interaction.customId === "modal_new_incident") {
      const title = interaction.fields.getTextInputValue("incident_title");
      const desc = interaction.fields.getTextInputValue("incident_desc");

      const newIncident = {
        id: incidentCounter++,
        title,
        description: desc,
        status: "active",
      };
      incidents.push(newIncident);

      // Create a separate message for this incident
      const embed = new EmbedBuilder()
        .setTitle(`🚨 Incident #${newIncident.id}: ${title}`)
        .setDescription(desc)
        .setColor(0xff0000)
        .setTimestamp();

      await interaction.channel.send({ embeds: [embed] });
      await interaction.reply({ content: `Incident #${newIncident.id} has been created!`, ephemeral: true });

      // Update the panel
      if (client.panelMessage) {
        await updateIncidentPanel(client.panelMessage);
      }
    }

    if (interaction.customId === "modal_resolve_incident") {
      const id = parseInt(interaction.fields.getTextInputValue("incident_id"));
      const incident = incidents.find((i) => i.id === id);

      if (!incident) {
        return interaction.reply({ content: `❌ No incident found with ID ${id}.`, ephemeral: true });
      }

      incident.status = "resolved";
      await interaction.reply({ content: `✅ Incident #${id} has been marked as resolved.`, ephemeral: true });

      // Update the panel
      if (client.panelMessage) {
        await updateIncidentPanel(client.panelMessage);
      }
    }
  }
});

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.login(process.env.BOT_TOKEN);
