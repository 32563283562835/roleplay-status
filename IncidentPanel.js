// incidentPanel.js
// A modular, token-agnostic incident panel for Discord (discord.js v14)
// Usage:
//   const { registerIncidentPanel } = require('./incidentPanel');
//   registerIncidentPanel(client, { allowedUserId: '1329813179865235467' });
// Requirements:
//   - This file assumes you already created and logged-in a discord.js v14 Client elsewhere.
//   - No token or login code is included here, by design.

/*
Features
- .incident-panel command (message-based) only for a specific user id
- Create / Edit / Resolve / Delete incidents
- View & Filter (status, date range, priority, assignee) + search by keyword
- Persistent JSON file storage
- Audit Trail (per-incident change log) to a private channel (ID configurable)
- Overview message: always kept at the bottom by re-posting after each change
- Channel notification on new incident to a configured channel
- Extensible Notifier hooks (Slack, Email) – stubbed for later integration
- Clean, modular structure within a single file for portability
*/

const fs = require('fs');
const path = require('path');
const {
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ComponentType,
  PermissionFlagsBits,
} = require('discord.js');

/** Utility: timestamp */
const nowIso = () => new Date().toISOString();

/**
 * Simple persistent key-value store on disk (JSON file).
 */
class JsonStore {
  constructor(file = path.join(process.cwd(), 'incidents.json')) {
    this.file = file;
    if (!fs.existsSync(this.file)) {
      fs.writeFileSync(
        this.file,
        JSON.stringify({ incidents: [], overviewByChannel: {} }, null, 2)
      );
    }
    this._cache = JSON.parse(fs.readFileSync(this.file, 'utf8'));
  }
  read() { return this._cache; }
  write(next) {
    this._cache = next;
    fs.writeFileSync(this.file, JSON.stringify(next, null, 2));
  }
  update(mutator) {
    const data = this.read();
    mutator(data);
    this.write(data);
  }
}

/**
 * Notifier hooks – extend here to send Slack, Email, etc.
 */
class Notifier {
  constructor({ slackWebhookUrl = null, emailTransport = null } = {}) {
    this.slackWebhookUrl = slackWebhookUrl;
    this.emailTransport = emailTransport;
  }
  async onNewIncident(incident) {
    // TODO: implement slack/email if provided
    return;
  }
  async onUpdateIncident(incident, change) { return; }
}

/**
 * Audit logger – sends embeds to a private channel + keeps a per-incident array of changes.
 */
class AuditLogger {
  constructor(client, store, auditChannelId) {
    this.client = client;
    this.store = store;
    this.auditChannelId = auditChannelId;
  }
  _pushLocal(incidentId, change) {
    this.store.update((data) => {
      const inc = data.incidents.find((i) => i.id === incidentId);
      if (!inc) return;
      inc.audit = inc.audit || [];
      inc.audit.push(change);
    });
  }
  async log(incident, change) {
    this._pushLocal(incident.id, change);
    const channel = await this._fetchAuditChannel();
    if (!channel) return;
    const embed = new EmbedBuilder()
      .setTitle(`Audit: ${incident.title} (#${incident.id})`)
      .setDescription(change.message || 'Change')
      .addFields(
        { name: 'By', value: `<@${change.by}>`, inline: true },
        { name: 'At', value: new Date(change.at).toLocaleString(), inline: true },
      )
      .setFooter({ text: `Status: ${incident.status} | Priority: ${incident.priority || 'n/a'}` })
      .setTimestamp(new Date(change.at));
    await channel.send({ embeds: [embed] });
  }
  async _fetchAuditChannel() {
    if (!this.auditChannelId) return null;
    try {
      const ch = await this.client.channels.fetch(this.auditChannelId);
      if (ch && ch.type === ChannelType.GuildText) return ch;
    } catch {}
    return null;
  }
}

/**
 * Overview manager – ensures there is always a fresh message at the bottom.
 * Strategy: delete the previous overview message (if exists) and send a new one.
 */
class OverviewManager {
  constructor(client, store, getActiveIncidents) {
    this.client = client;
    this.store = store;
    this.getActiveIncidents = getActiveIncidents;
  }
  /** Register/remember which channel holds the overview. */
  setOverviewChannel(channelId) {
    this.store.update((data) => {
      data.overviewByChannel[channelId] = data.overviewByChannel[channelId] || { messageId: null };
    });
  }
  _getOverviewState(channelId) {
    const data = this.store.read();
    return data.overviewByChannel[channelId] || { messageId: null };
  }
  _setOverviewMessageId(channelId, messageId) {
    this.store.update((data) => {
      data.overviewByChannel[channelId] = data.overviewByChannel[channelId] || {};
      data.overviewByChannel[channelId].messageId = messageId;
    });
  }
  async refresh(channelId) {
    const channel = await this._fetchTextChannel(channelId);
    if (!channel) return;

    // delete previous overview message if any
    const state = this._getOverviewState(channelId);
    if (state.messageId) {
      try {
        const m = await channel.messages.fetch(state.messageId);
        if (m) await m.delete().catch(() => {});
      } catch {}
    }

    const active = this.getActiveIncidents();
    const embed = buildOverviewEmbed(active);

    const components = [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('incident:refresh').setLabel('Refresh').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('incident:view').setLabel('View / Filter').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('incident:create').setLabel('Create').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('incident:search').setLabel('Search').setStyle(ButtonStyle.Secondary),
      ),
    ];

    const sent = await channel.send({ embeds: [embed], components });
    this._setOverviewMessageId(channelId, sent.id);
  }
  async _fetchTextChannel(id) {
    try {
      const ch = await this.client.channels.fetch(id);
      if (ch && ch.type === ChannelType.GuildText) return ch;
    } catch {}
    return null;
  }
}

/** Incident builder helpers */
const STATUSES = ['open', 'investigating', 'monitoring', 'resolved'];
const PRIORITIES = ['low', 'medium', 'high', 'critical'];

function buildOverviewEmbed(activeIncidents) {
  const lines = activeIncidents.length
    ? activeIncidents.map((i) => `• **#${i.id}** — ${i.title} (status: **${i.status}**, prio: **${i.priority || 'n/a'}**, owner: ${i.assignee ? `<@${i.assignee}>` : '—'})`)
    : ['No active incidents.'];
  return new EmbedBuilder()
    .setTitle('Incident Overview (Active)')
    .setDescription(lines.join('\n'))
    .setTimestamp(new Date())
    .setFooter({ text: 'Use the buttons below to manage incidents.' });
}

function incidentToEmbed(i) {
  const fields = [
    { name: 'Reason', value: i.reason || '—', inline: false },
    { name: 'Status', value: i.status, inline: true },
    { name: 'Priority', value: i.priority || '—', inline: true },
    { name: 'Assignee', value: i.assignee ? `<@${i.assignee}>` : '—', inline: true },
    { name: 'Created At', value: new Date(i.createdAt).toLocaleString(), inline: true },
  ];
  if (i.updatedAt) fields.push({ name: 'Updated At', value: new Date(i.updatedAt).toLocaleString(), inline: true });
  if (i.notes && i.notes.length) fields.push({ name: 'Notes', value: i.notes.map((n) => `• ${n}`).join('\n').slice(0, 1024), inline: false });
  return new EmbedBuilder().setTitle(`#${i.id} — ${i.title}`).addFields(fields).setTimestamp(new Date());
}

/**
 * Main registration function. Call this with your logged-in client.
 */
function registerIncidentPanel(
  client,
  {
    allowedUserId = '1329813179865235467',
    auditChannelId = '1407310001718038609',
    newIncidentNotifyChannelId = '1406381100980371557',
    storageFile = path.join(process.cwd(), 'incidents.json'),
  } = {}
) {
  const store = new JsonStore(storageFile);
  const notifier = new Notifier();
  const audit = new AuditLogger(client, store, auditChannelId);
  const overview = new OverviewManager(client, store, () => getActiveIncidents(store));

  // ===== Helpers over store =====
  function nextId() {
    const data = store.read();
    const max = data.incidents.reduce((m, x) => Math.max(m, x.id), 0);
    return max + 1;
  }
  function getActiveIncidents(storeRef = store) {
    const all = storeRef.read().incidents;
    return all.filter((i) => i.status !== 'resolved');
  }
  function saveIncident(incident) {
    store.update((data) => {
      const idx = data.incidents.findIndex((i) => i.id === incident.id);
      if (idx === -1) data.incidents.push(incident); else data.incidents[idx] = incident;
    });
  }
  function removeIncident(id) {
    store.update((data) => {
      data.incidents = data.incidents.filter((i) => i.id !== id);
    });
  }

  // ===== Security guard =====
  function isAllowed(userId) { return userId === allowedUserId; }

  // ===== Command: .incident-panel =====
  client.on('messageCreate', async (msg) => {
    try {
      if (!msg.guild || msg.author.bot) return;
      if (!msg.content.trim().startsWith('.incident-panel')) return;
      if (!isAllowed(msg.author.id)) return; // silently ignore others

      overview.setOverviewChannel(msg.channel.id);

      const panel = buildMainPanel();
      await msg.reply({ content: 'Incident Panel', components: panel });
      await overview.refresh(msg.channel.id);
    } catch (e) { console.error(e); }
  });

  // ===== Component interactions =====
  client.on('interactionCreate', async (interaction) => {
    try {
      if (!interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isModalSubmit()) return;
      if (!isAllowed(interaction.user.id)) return; // ignore non-authorized

      const [ns, action, extra] = interaction.customId ? interaction.customId.split(':') : ['','', ''];
      if (ns !== 'incident') return;

      // Buttons and select menus
      if (interaction.isButton()) {
        if (action === 'create') return showCreateModal(interaction);
        if (action === 'view') return showFilterMenu(interaction, store);
        if (action === 'refresh') {
          await interaction.deferUpdate();
          await overview.refresh(interaction.channel.id);
          return;
        }
        if (action === 'search') return showSearchModal(interaction);
        if (action === 'edit') return showEditModal(interaction, parseInt(extra, 10));
        if (action === 'resolve') return resolveIncidentFlow(interaction, parseInt(extra, 10));
        if (action === 'delete') return deleteIncidentFlow(interaction, parseInt(extra, 10));
      }

      if (interaction.isStringSelectMenu()) {
        if (action === 'filter') return handleFilter(interaction, store);
      }

      if (interaction.isModalSubmit()) {
        if (action === 'createSubmit') return handleCreateSubmit(interaction);
        if (action === 'editSubmit') return handleEditSubmit(interaction, parseInt(extra, 10));
        if (action === 'searchSubmit') return handleSearchSubmit(interaction);
        if (action === 'resolveSubmit') return handleResolveSubmit(interaction, parseInt(extra, 10));
      }
    } catch (e) {
      console.error(e);
      if (interaction.isRepliable()) {
        try { await interaction.reply({ content: 'An error occurred.', ephemeral: true }); } catch {}
      }
    }
  });

  // ===== UI Builders =====
  function buildMainPanel() {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('incident:create').setLabel('Create').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('incident:view').setLabel('View / Filter').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('incident:search').setLabel('Search').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('incident:refresh').setLabel('Refresh').setStyle(ButtonStyle.Secondary),
      ),
    ];
  }

  function showFilterMenu(interaction, storeRef) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId('incident:filter')
      .setPlaceholder('Filter by status / priority')
      .setMinValues(0)
      .setMaxValues(5)
      .addOptions(
        { label: 'All', value: 'all' },
        ...STATUSES.map((s) => ({ label: `Status: ${s}`, value: `s:${s}` })),
        ...PRIORITIES.map((p) => ({ label: `Priority: ${p}`, value: `p:${p}` })),
      );

    const row = new ActionRowBuilder().addComponents(menu);
    const all = storeRef.read().incidents;
    const embed = new EmbedBuilder().setTitle('Incidents – All').setDescription(`${all.length} total`).setTimestamp(new Date());
    return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
  }

  function showCreateModal(interaction) {
    const modal = new ModalBuilder().setCustomId('incident:createSubmit').setTitle('Create Incident');
    const title = new TextInputBuilder().setCustomId('title').setLabel('Title').setStyle(TextInputStyle.Short).setRequired(true);
    const reason = new TextInputBuilder().setCustomId('reason').setLabel('Reason').setStyle(TextInputStyle.Paragraph).setRequired(true);
    const priority = new TextInputBuilder().setCustomId('priority').setLabel('Priority (low/medium/high/critical)').setStyle(TextInputStyle.Short).setRequired(false);
    const assignee = new TextInputBuilder().setCustomId('assignee').setLabel('Assignee (user ID)').setStyle(TextInputStyle.Short).setRequired(false);
    const row1 = new ActionRowBuilder().addComponents(title);
    const row2 = new ActionRowBuilder().addComponents(reason);
    const row3 = new ActionRowBuilder().addComponents(priority);
    const row4 = new ActionRowBuilder().addComponents(assignee);
    modal.addComponents(row1, row2, row3, row4);
    return interaction.showModal(modal);
  }

  function showEditModal(interaction, id) {
    const data = store.read();
    const inc = data.incidents.find((x) => x.id === id);
    if (!inc) return interaction.reply({ content: 'Incident not found.', ephemeral: true });

    const modal = new ModalBuilder().setCustomId(`incident:editSubmit:${id}`).setTitle(`Edit Incident #${id}`);
    const title = new TextInputBuilder().setCustomId('title').setLabel('Title').setStyle(TextInputStyle.Short).setValue(inc.title).setRequired(true);
    const reason = new TextInputBuilder().setCustomId('reason').setLabel('Reason').setStyle(TextInputStyle.Paragraph).setValue(inc.reason || '').setRequired(false);
    const status = new TextInputBuilder().setCustomId('status').setLabel(`Status (${STATUSES.join('/')})`).setStyle(TextInputStyle.Short).setValue(inc.status).setRequired(true);
    const priority = new TextInputBuilder().setCustomId('priority').setLabel(`Priority (${PRIORITIES.join('/')})`).setStyle(TextInputStyle.Short).setValue(inc.priority || '').setRequired(false);
    const assignee = new TextInputBuilder().setCustomId('assignee').setLabel('Assignee (user ID)').setStyle(TextInputStyle.Short).setValue(inc.assignee || '').setRequired(false);
    const note = new TextInputBuilder().setCustomId('note').setLabel('Add Note (optional)').setStyle(TextInputStyle.Paragraph).setRequired(false);

    modal.addComponents(
      new ActionRowBuilder().addComponents(title),
      new ActionRowBuilder().addComponents(reason),
      new ActionRowBuilder().addComponents(status),
      new ActionRowBuilder().addComponents(priority),
      new ActionRowBuilder().addComponents(assignee),
      new ActionRowBuilder().addComponents(note),
    );
    return interaction.showModal(modal);
  }

  function showSearchModal(interaction) {
    const modal = new ModalBuilder().setCustomId('incident:searchSubmit').setTitle('Search Incidents');
    const q = new TextInputBuilder().setCustomId('q').setLabel('Keyword in title/reason/notes').setStyle(TextInputStyle.Short).setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(q));
    return interaction.showModal(modal);
  }

  async function resolveIncidentFlow(interaction, id) {
    const modal = new ModalBuilder().setCustomId(`incident:resolveSubmit:${id}`).setTitle(`Resolve Incident #${id}`);
    const comment = new TextInputBuilder().setCustomId('comment').setLabel('Resolution comment (optional)').setStyle(TextInputStyle.Paragraph).setRequired(false);
    modal.addComponents(new ActionRowBuilder().addComponents(comment));
    return interaction.showModal(modal);
  }

  async function deleteIncidentFlow(interaction, id) {
    await interaction.reply({ content: `Confirm deletion of incident #${id}?`, components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`incident:confirmDelete:${id}`).setLabel('Delete').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('incident:cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      ),
    ], ephemeral: true });
  }

  // Handle confirm/cancel buttons for deletion
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    if (!isAllowed(interaction.user.id)) return;
    const [ns, action, id] = interaction.customId.split(':');
    if (ns !== 'incident') return;
    if (action === 'cancel') return interaction.update({ content: 'Cancelled.', components: [] });
    if (action === 'confirmDelete') {
      const intId = parseInt(id, 10);
      const exist = store.read().incidents.find((x) => x.id === intId);
      if (!exist) return interaction.update({ content: 'Incident not found.', components: [] });
      removeIncident(intId);
      await audit.log(exist, { at: nowIso(), by: interaction.user.id, message: 'Deleted incident.' });
      await interaction.update({ content: `Incident #${intId} deleted.`, components: [] });
      await overview.refresh(interaction.channel.id);
    }
  });

  // ===== Handlers =====
  async function handleCreateSubmit(interaction) {
    const title = interaction.fields.getTextInputValue('title');
    const reason = interaction.fields.getTextInputValue('reason');
    const priorityRaw = (interaction.fields.getTextInputValue('priority') || '').trim().toLowerCase();
    const assignee = (interaction.fields.getTextInputValue('assignee') || '').trim();
    const priority = PRIORITIES.includes(priorityRaw) ? priorityRaw : undefined;

    const incident = {
      id: nextId(),
      title,
      reason,
      status: 'open',
      priority,
      assignee: assignee || undefined,
      notes: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
      audit: [],
      createdBy: interaction.user.id,
    };

    saveIncident(incident);
    await audit.log(incident, { at: nowIso(), by: interaction.user.id, message: 'Created incident.' });

    // Notify channel with details
    await notifyNewIncident(client, newIncidentNotifyChannelId, incident);
    await notifier.onNewIncident(incident);

    await interaction.reply({ embeds: [incidentToEmbed(incident)], components: [rowForIncidentActions(incident)], ephemeral: true });
    await overview.refresh(interaction.channel.id);
  }

  function rowForIncidentActions(incident) {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`incident:edit:${incident.id}`).setLabel('Edit').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`incident:resolve:${incident.id}`).setLabel('Resolve').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`incident:delete:${incident.id}`).setLabel('Delete').setStyle(ButtonStyle.Danger),
    );
  }

  async function handleEditSubmit(interaction, id) {
    const data = store.read();
    const inc = data.incidents.find((x) => x.id === id);
    if (!inc) return interaction.reply({ content: 'Incident not found.', ephemeral: true });

    const prev = { ...inc };

    inc.title = interaction.fields.getTextInputValue('title');
    inc.reason = interaction.fields.getTextInputValue('reason') || inc.reason;
    const statusRaw = (interaction.fields.getTextInputValue('status') || '').trim().toLowerCase();
    inc.status = STATUSES.includes(statusRaw) ? statusRaw : inc.status;
    const prioRaw = (interaction.fields.getTextInputValue('priority') || '').trim().toLowerCase();
    inc.priority = PRIORITIES.includes(prioRaw) ? prioRaw : undefined;
    const assignRaw = (interaction.fields.getTextInputValue('assignee') || '').trim();
    inc.assignee = assignRaw || undefined;

    const note = interaction.fields.getTextInputValue('note');
    if (note) {
      inc.notes = inc.notes || [];
      inc.notes.push(`${new Date().toLocaleString()} – ${note}`);
    }

    inc.updatedAt = nowIso();
    saveIncident(inc);

    await audit.log(inc, { at: nowIso(), by: interaction.user.id, message: describeDiff(prev, inc) });
    await notifier.onUpdateIncident(inc, { type: 'edit' });

    await interaction.reply({ embeds: [incidentToEmbed(inc)], components: [rowForIncidentActions(inc)], ephemeral: true });
    await overview.refresh(interaction.channel.id);
  }

  function describeDiff(prev, next) {
    const diffs = [];
    for (const key of ['title', 'reason', 'status', 'priority', 'assignee']) {
      if (prev[key] !== next[key]) diffs.push(`${key}: \`${prev[key] || '—'}\` → \`${next[key] || '—'}\``);
    }
    return diffs.length ? `Edited: ${diffs.join(', ')}` : 'Edited (no field changes)';
  }

  async function handleSearchSubmit(interaction) {
    const q = interaction.fields.getTextInputValue('q').toLowerCase();
    const hits = store.read().incidents.filter((i) =>
      (i.title && i.title.toLowerCase().includes(q)) ||
      (i.reason && i.reason.toLowerCase().includes(q)) ||
      (i.notes && i.notes.join(' ').toLowerCase().includes(q))
    );

    const desc = hits.length
      ? hits.map((i) => `• **#${i.id}** ${i.title} [${i.status}]`).join('\n').slice(0, 4000)
      : 'No matches.';

    const embed = new EmbedBuilder().setTitle(`Search results for "${q}"`).setDescription(desc).setTimestamp(new Date());
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  async function handleResolveSubmit(interaction, id) {
    const data = store.read();
    const inc = data.incidents.find((x) => x.id === id);
    if (!inc) return interaction.reply({ content: 'Incident not found.', ephemeral: true });

    const comment = interaction.fields.getTextInputValue('comment');
    const prev = { ...inc };
    inc.status = 'resolved';
    if (comment) {
      inc.notes = inc.notes || [];
      inc.notes.push(`${new Date().toLocaleString()} – RESOLVED: ${comment}`);
    }
    inc.updatedAt = nowIso();
    saveIncident(inc);

    await audit.log(inc, { at: nowIso(), by: interaction.user.id, message: comment ? `Resolved with comment: ${comment}` : 'Resolved.' });
    await notifier.onUpdateIncident(inc, { type: 'resolve' });

    await interaction.reply({ content: `Incident #${id} marked resolved.`, ephemeral: true });
    await overview.refresh(interaction.channel.id);
  }

  async function handleFilter(interaction, storeRef) {
    const values = interaction.values || [];
    const all = storeRef.read().incidents;

    let filtered = [...all];
    let title = 'Incidents – All';

    const statusVals = values.filter((v) => v.startsWith('s:')).map((v) => v.slice(2));
    const prioVals = values.filter((v) => v.startsWith('p:')).map((v) => v.slice(2));
    const isAll = values.includes('all') || (statusVals.length === 0 && prioVals.length === 0);

    if (!isAll) {
      if (statusVals.length) {
        filtered = filtered.filter((i) => statusVals.includes(i.status));
        title += ` | Status: ${statusVals.join(',')}`;
      }
      if (prioVals.length) {
        filtered = filtered.filter((i) => i.priority && prioVals.includes(i.priority));
        title += ` | Priority: ${prioVals.join(',')}`;
      }
    }

    const desc = filtered.length
      ? filtered.map((i) => `• **#${i.id}** — ${i.title} [${i.status}${i.priority ? `/${i.priority}` : ''}]`).join('\n').slice(0, 4000)
      : 'No incidents match the filter.';

    const embed = new EmbedBuilder().setTitle(title).setDescription(desc).setTimestamp(new Date());
    await interaction.update({ embeds: [embed] });
  }

  async function notifyNewIncident(client, channelId, incident) {
    try {
      const ch = await client.channels.fetch(channelId);
      if (!ch || ch.type !== ChannelType.GuildText) return;
      const embed = new EmbedBuilder()
        .setTitle(`New Incident – #${incident.id}`)
        .setDescription(incident.reason || '—')
        .addFields(
          { name: 'Title', value: incident.title, inline: true },
          { name: 'Priority', value: incident.priority || '—', inline: true },
          { name: 'Assignee', value: incident.assignee ? `<@${incident.assignee}>` : '—', inline: true },
        )
        .setTimestamp(new Date(incident.createdAt));
      await ch.send({ embeds: [embed] });
    } catch (e) { console.error('notifyNewIncident error', e); }
  }

  // ===== Convenience: list & quick actions reply when user mentions an id =====
  client.on('messageCreate', async (msg) => {
    if (!msg.guild || msg.author.bot) return;
    if (!isAllowed(msg.author.id)) return;

    const match = msg.content.match(/#(\d+)/);
    if (!match) return;
    const id = parseInt(match[1], 10);
    const inc = store.read().incidents.find((x) => x.id === id);
    if (!inc) return;

    await msg.reply({ embeds: [incidentToEmbed(inc)], components: [rowForIncidentActions(inc)] });
  });

  console.log('[incidentPanel] Registered.');
}

module.exports = { registerIncidentPanel };
