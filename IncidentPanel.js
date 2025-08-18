// IncidentPanel.js
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

const PREFIX = ".";
let incidentCounter = 1;
let incidents = [];
let panelMessage = null;
let updatePresenceCallback = null;

// Helper: update the incident panel embed
async function updateIncidentPanel() {
  if (!panelMessage) return;

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

// Setup function to register handlers
function setupIncidentPanel(client) {
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

      panelMessage = await message.channel.send({ embeds: [embed], components: [row] });
    }
  });

  client.on("interactionCreate", async (interaction) => {
    if (interaction.isButton()) {
      if (interaction.customId === "new_incident") {
        const modal = new ModalBuilder().setCustomId("modal_new_incident").setTitle("New Incident");

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

        modal.addComponents(
          new ActionRowBuilder().addComponents(titleInput),
          new ActionRowBuilder().addComponents(descInput)
        );

        await interaction.showModal(modal);
      }

      if (interaction.customId === "resolve_incident") {
        const modal = new ModalBuilder().setCustomId("modal_resolve_incident").setTitle("Resolve Incident");

        const idInput = new TextInputBuilder()
          .setCustomId("incident_id")
          .setLabel("Incident ID")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(idInput));
        await interaction.showModal(modal);
      }
    }

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

        const embed = new EmbedBuilder()
          .setTitle(`🚨 Incident #${newIncident.id}: ${title}`)
          .setDescription(desc)
          .setColor(0xff0000)
          .setTimestamp();

        await interaction.channel.send({ embeds: [embed] });
        await interaction.reply({ content: `Incident #${newIncident.id} has been created!`, ephemeral: true });

        await updateIncidentPanel();
        if (updatePresenceCallback) updatePresenceCallback();
      }

      if (interaction.customId === "modal_resolve_incident") {
        const id = parseInt(interaction.fields.getTextInputValue("incident_id"));
        const incident = incidents.find((i) => i.id === id);

        if (!incident) {
          return interaction.reply({ content: `❌ No incident found with ID ${id}.`, ephemeral: true });
        }

        incident.status = "resolved";
        await interaction.reply({ content: `✅ Incident #${id} has been marked as resolved.`, ephemeral: true });

        await updateIncidentPanel();
        if (updatePresenceCallback) updatePresenceCallback();
      }
    }
  });
}

// Exported functions
function getIncidentCount() {
  return incidents.filter((i) => i.status === "active").length;
}

function setUpdatePresenceCallback(callback) {
  updatePresenceCallback = callback;
}

module.exports = {
  setupIncidentPanel,
  getIncidentCount,
  setUpdatePresenceCallback
};
