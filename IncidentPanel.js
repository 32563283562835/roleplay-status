// IncidentPanel.js
const {
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags
} = require("discord.js");

const fs = require("fs");
const path = require("path");
const INCIDENT_FILE = path.join(__dirname, "incidents.json");

const PREFIX = ".";
let incidentCounter = 1;
let incidents = [];
let panelMessage = null;
let updatePresenceCallback = null;

// Load incidents from file
function loadIncidents() {
  if (fs.existsSync(INCIDENT_FILE)) {
    try {
      const data = fs.readFileSync(INCIDENT_FILE);
      incidents = JSON.parse(data);
      incidentCounter = incidents.reduce((max, i) => Math.max(max, i.id), 0) + 1;
    } catch (err) {
      console.error("❌ Failed to load incidents:", err);
      incidents = [];
    }
  }
}

// Save incidents to file
function saveIncidents() {
  fs.writeFileSync(INCIDENT_FILE, JSON.stringify(incidents, null, 2));
}

// Helper: update the incident panel embed
async function updateIncidentPanel(client) {
  const incidentChannel = client.channels.cache.get("1406381100980371557");
  if (!incidentChannel) return;

  const embed = new EmbedBuilder()
    .setTitle("📋 Incident Overview")
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

  // Verwijder oud panel als het bestaat
  if (panelMessage) {
    await panelMessage.delete().catch(() => {});
  }

  // Post nieuw panel en sla op
  panelMessage = await incidentChannel.send({ embeds: [embed] });
}

// Setup function to register handlers
function setupIncidentPanel(client) {
  loadIncidents();

  client.on("messageCreate", async (message) => {
    if (!message.content.startsWith(PREFIX) || message.author.bot) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === "incident-panel") {
      await updateIncidentPanel(client);
    }
  });

  client.on("interactionCreate", async (interaction) => {
    if (interaction.isButton()) {
      if (interaction.customId === "new_incident") {
        const modal = new ModalBuilder().setCustomId("modal_new_incident").setTitle("New Incident");

        const titleInput = new TextInputBuilder()
          .setCustomId("incident_title")
          .setLabel("Title")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const reasonInput = new TextInputBuilder()
          .setCustomId("incident_reason")
          .setLabel("Reason")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true);

        const affectedInput = new TextInputBuilder()
          .setCustomId("incident_affected")
          .setLabel("Affected (what doesn't work)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const timeInput = new TextInputBuilder()
          .setCustomId("incident_time")
          .setLabel("Time (when it started or expected)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        modal.addComponents(
          new ActionRowBuilder().addComponents(titleInput),
          new ActionRowBuilder().addComponents(reasonInput),
          new ActionRowBuilder().addComponents(affectedInput),
          new ActionRowBuilder().addComponents(timeInput)
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
        const reason = interaction.fields.getTextInputValue("incident_reason");
        const affected = interaction.fields.getTextInputValue("incident_affected");
        const time = interaction.fields.getTextInputValue("incident_time");

        const newIncident = {
          id: incidentCounter++,
          title,
          reason,
          affected,
          time,
          status: "active",
        };
        incidents.push(newIncident);
        saveIncidents();

        const incidentChannel = interaction.client.channels.cache.get("1406381100980371557");
        if (incidentChannel) {
          const embed = new EmbedBuilder()
            .setTitle(`🚨 Incident #${newIncident.id}: ${title}`)
            .addFields(
              { name: "Reason", value: reason },
              { name: "Affected", value: affected },
              { name: "Time", value: time }
            )
            .setColor(0xff0000)
            .setTimestamp();

          await incidentChannel.send({ embeds: [embed] });
        }

        await interaction.reply({
          content: `Incident #${newIncident.id} has been created!`,
          flags: MessageFlags.Ephemeral
        });

        await updateIncidentPanel(interaction.client);
        if (updatePresenceCallback) updatePresenceCallback();
      }

      if (interaction.customId === "modal_resolve_incident") {
        const id = parseInt(interaction.fields.getTextInputValue("incident_id"));
        const incident = incidents.find((i) => i.id === id);

        if (!incident) {
          return interaction.reply({
            content: `❌ No incident found with ID ${id}.`,
            flags: MessageFlags.Ephemeral
          });
        }

        incident.status = "resolved";
        saveIncidents();

        await interaction.reply({
          content: `✅ Incident #${id} has been marked as resolved.`,
          flags: MessageFlags.Ephemeral
        });

        await updateIncidentPanel(interaction.client);
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
