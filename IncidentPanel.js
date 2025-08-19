// incidentPanel.js
// A modular, token-agnostic Discord.js v14 module that wires an interactive incident panel.
// Usage:
//   const { setupIncidentPanel } = require('./incidentPanel');
//   setupIncidentPanel(client, {
//     allowedUserId: '1329813179865235467',
//     auditChannelId: '1407310001718038609', // private audit trail channel
//     notificationChannelId: '1406381100980371557', // new-incident notifications
//     overviewChannelId: '1406381100980371557', // where the rolling overview lives (can be different)
//     dataDir: './data' // folder for JSON persistence
//   });
//
// Requirements:
//   - discord.js ^14
//   - Node 18+
//   - The bot must already be logged in elsewhere (this file does not handle tokens)

const fs = require('fs');
const path = require('path');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  SlashCommandBuilder,
  PermissionsBitField,
} = require('discord.js');

/**
 * @typedef {Object} Incident
 * @property {string} id
 * @property {string} title
 * @property {string} reason
 * @property {string} status // open | investigating | monitoring | resolved | closed
 * @property {string} priority // low | medium | high | critical
 * @property {string} createdBy
 * @property {string} assignedTo // userId or ''
 * @property {number} createdAt
 * @property {number} updatedAt
 * @property {string[]} notes // arbitrary notes
 * @property {Array<{at:number, by:string, action:string, diff?:any}>} audit
 */

// ------------------------------
// Configuration defaults
// ------------------------------
const DEFAULTS = {
  allowedUserId: '1329813179865235467',
  auditChannelId: '1407310001718038609',
  notificationChannelId: '1406381100980371557',
  overviewChannelId: '1406381100980371557',
  dataDir: './data',
};

// ------------------------------
// Utilities & Persistence
// ------------------------------
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function saveJSON(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

function shortId() {
  return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

function statusColor(status) {
  switch ((status || '').toLowerCase()) {
    case 'open': return 0x00b5ad; // teal
    case 'investigating': return 0xf2711c; // orange
    case 'monitoring': return 0x6435c9; // violet
    case 'resolved': return 0x21ba45; // green
    case 'closed': return 0x767676; // grey
    default: return 0x2185d0; // blue
  }
}

function priorityEmoji(priority) {
  switch ((priority || '').toLowerCase()) {
    case 'critical': return '🔴';
    case 'high': return '🟠';
    case 'medium': return '🟡';
    case 'low': return '🟢';
    default: return '⚪';
  }
}

function formatTs(ms) {
  return `<t:${Math.floor(ms / 1000)}:f>`; // Discord dynamic timestamp
}

// ------------------------------
// Incident Store (file-based)
// ------------------------------
class IncidentStore {
  constructor(dir) {
    this.dir = dir;
    ensureDir(dir);
    this.file = path.join(dir, 'incidents.json');
    this.state = loadJSON(this.file, { incidents: [], overviewMessageId: null });
  }
  save() { saveJSON(this.file, this.state); }
  /** @returns {Incident[]} */
  list() { return this.state.incidents; }
  get(id) { return this.state.incidents.find(i => i.id === id) || null; }
  add(incident) { this.state.incidents.push(incident); this.save(); return incident; }
  update(id, patch) {
    const idx = this.state.incidents.findIndex(i => i.id === id);
    if (idx === -1) return null;
    this.state.incidents[idx] = { ...this.state.incidents[idx], ...patch, updatedAt: Date.now() };
    this.save();
    return this.state.incidents[idx];
  }
  remove(id) {
    const before = this.state.incidents.length;
    this.state.incidents = this.state.incidents.filter(i => i.id !== id);
    this.save();
    return this.state.incidents.length !== before;
  }
  setOverviewMessageId(id) { this.state.overviewMessageId = id; this.save(); }
  getOverviewMessageId() { return this.state.overviewMessageId || null; }
  setPanelMessageId(id) { this.state.panelMessageId = id; this.save(); }
  getPanelMessageId() { return this.state.panelMessageId || null; }
}

// ------------------------------
// Embeds & UI Builders
// ------------------------------
function incidentEmbed(incident) {
  return new EmbedBuilder()
    .setTitle(`${priorityEmoji(incident.priority)} ${incident.title}`)
    .setColor(statusColor(incident.status))
    .setDescription(incident.reason || '—')
    .addFields(
      { name: 'Status', value: `**${incident.status}**`, inline: true },
      { name: 'Priority', value: incident.priority, inline: true },
      { name: 'Assigned', value: incident.assignedTo ? `<@${incident.assignedTo}>` : '—', inline: true },
      { name: 'Created', value: `${formatTs(incident.createdAt)} by <@${incident.createdBy}>`, inline: true },
      { name: 'Updated', value: `${formatTs(incident.updatedAt)}`, inline: true },
      { name: 'Notes', value: incident.notes.length ? incident.notes.map((n, idx) => `${idx + 1}. ${n}`).join('\n') : '—' }
    )
    .setFooter({ text: `Incident ID: ${incident.id}` });
}

function overviewEmbed(incidents) {
  const active = incidents.filter(i => !['resolved', 'closed'].includes(i.status));
  const desc = active.length
    ? active
      .sort((a,b)=>a.priority.localeCompare(b.priority))
      .map(i => `${priorityEmoji(i.priority)} **${i.title}** — ${i.status} | ID: \`${i.id}\``)
      .join('\n')
    : 'No active incidents ✅';
  return new EmbedBuilder()
    .setTitle('Incident Overview')
    .setDescription(desc)
    .setColor(active.length ? 0xf2711c : 0x21ba45)
    .setFooter({ text: MARK.OVERVIEW })
    .setTimestamp(Date.now());
}

function panelEmbed() {
  return new EmbedBuilder()
    .setTitle('Incident Panel')
    .setDescription('Create, edit, resolve, filter, search and manage incidents.')
    .setColor(0x2185d0)
    .setFooter({ text: MARK.PANEL });
}

// Component custom IDs
const CID = {
  OPEN_PANEL: 'inc:openpanel',
  CREATE: 'inc:create',
  EDIT: 'inc:edit',
  RESOLVE: 'inc:resolve',
  DELETE: 'inc:delete',
  VIEW_FILTER: 'inc:viewfilter',
  REFRESH_OVERVIEW: 'inc:refreshov',
  SELECT_INCIDENT: 'inc:select',
  SELECT_FILTER: 'inc:filter',
  SEARCH: 'inc:search',

  // Modals
  CREATE_MODAL: 'inc:modal:create',
  EDIT_MODAL: 'inc:modal:edit',
  RESOLVE_MODAL: 'inc:modal:resolve',
  DELETE_MODAL: 'inc:modal:delete',
  SEARCH_MODAL: 'inc:modal:search',
};

// Embed footers used to identify and clean up legacy messages
const MARK = {
  PANEL: 'INCIDENT_PANEL_V1',
  OVERVIEW: 'INCIDENT_OVERVIEW_V1',
};

function panelRows() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(CID.CREATE).setLabel('Create').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(CID.EDIT).setLabel('Edit').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(CID.RESOLVE).setLabel('Resolve').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(CID.DELETE).setLabel('Delete').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(CID.SEARCH).setLabel('Search').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(CID.VIEW_FILTER).setLabel('View / Filter').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(CID.REFRESH_OVERVIEW).setLabel('Refresh Overview').setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function filterRow() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(CID.SELECT_FILTER)
      .setPlaceholder('Filter by status / priority / assignee')
      .addOptions(
        { label: 'All', value: 'all' },
        { label: 'Open', value: 'status:open' },
        { label: 'Investigating', value: 'status:investigating' },
        { label: 'Monitoring', value: 'status:monitoring' },
        { label: 'Resolved', value: 'status:resolved' },
        { label: 'Closed', value: 'status:closed' },
        { label: 'Priority: Critical', value: 'priority:critical' },
        { label: 'Priority: High', value: 'priority:high' },
        { label: 'Priority: Medium', value: 'priority:medium' },
        { label: 'Priority: Low', value: 'priority:low' },
        { label: 'Assigned: Anyone', value: 'assigned:any' },
        { label: 'Assigned: Me', value: 'assigned:me' },
      )
  );
}

function selectRow(incidents) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(CID.SELECT_INCIDENT)
      .setPlaceholder('Select an incident')
      .addOptions(
        incidents.slice(0, 25).map(i => ({
          label: `${i.title}`.slice(0, 100),
          description: `${i.status} • ${i.priority}`.slice(0, 100),
          value: i.id,
        }))
      )
  );
}

// ------------------------------
// Audit Trail
// ------------------------------
async function sendAudit(client, opts, msg) {
  const ch = await client.channels.fetch(opts.auditChannelId).catch(()=>null);
  if (!ch || !ch.send) return;
  const embed = new EmbedBuilder()
    .setTitle('Incident Audit')
    .setDescription(msg)
    .setColor(0x95a5a6)
    .setTimestamp(Date.now());
  await ch.send({ embeds: [embed] }).catch(()=>{});
}

// ------------------------------
// Overview Message Management
// ------------------------------
async function upsertOverviewMessage(client, store, opts) {
  const channel = await client.channels.fetch(opts.overviewChannelId).catch(()=>null);
  if (!channel || !channel.send) return;
  const embed = overviewEmbed(store.list());
  const existingId = store.getOverviewMessageId();
  if (existingId) {
    try {
      const msg = await channel.messages.fetch(existingId);
      await msg.edit({ embeds: [embed] });
      await pruneLegacyOverviewMessages(client, store, opts);
      return;
    } catch (_) {
      // post new if old one cannot be fetched
    }
  }
  const message = await channel.send({ embeds: [embed] });
  store.setOverviewMessageId(message.id);
  await pruneLegacyOverviewMessages(client, store, opts);
}

// ------------------------------
// Modals
// ------------------------------
function buildCreateModal() {
  const modal = new ModalBuilder().setCustomId(CID.CREATE_MODAL).setTitle('Create Incident');
  const title = new TextInputBuilder().setCustomId('title').setLabel('Title').setStyle(TextInputStyle.Short).setRequired(true);
  const reason = new TextInputBuilder().setCustomId('reason').setLabel('Reason / Summary').setStyle(TextInputStyle.Paragraph).setRequired(true);
  const priority = new TextInputBuilder().setCustomId('priority').setLabel('Priority (low/medium/high/critical)').setStyle(TextInputStyle.Short).setRequired(true);
  const assigned = new TextInputBuilder().setCustomId('assigned').setLabel('Assign to (user ID, optional)').setStyle(TextInputStyle.Short).setRequired(false);
  return modal.addComponents(
    new ActionRowBuilder().addComponents(title),
    new ActionRowBuilder().addComponents(reason),
    new ActionRowBuilder().addComponents(priority),
    new ActionRowBuilder().addComponents(assigned),
  );
}

function buildEditModal(incident) {
  const modal = new ModalBuilder().setCustomId(`${CID.EDIT_MODAL}:${incident.id}`).setTitle(`Edit ${incident.id}`);
  const title = new TextInputBuilder().setCustomId('title').setLabel('Title').setStyle(TextInputStyle.Short).setRequired(false).setValue(incident.title);
  const reason = new TextInputBuilder().setCustomId('reason').setLabel('Reason / Summary').setStyle(TextInputStyle.Paragraph).setRequired(false).setValue(incident.reason);
  const status = new TextInputBuilder().setCustomId('status').setLabel('Status (open/investigating/monitoring/resolved/closed)').setStyle(TextInputStyle.Short).setRequired(false).setValue(incident.status);
  const priority = new TextInputBuilder().setCustomId('priority').setLabel('Priority (low/medium/high/critical)').setStyle(TextInputStyle.Short).setRequired(false).setValue(incident.priority);
  const assigned = new TextInputBuilder().setCustomId('assigned').setLabel('Assign to (user ID)').setStyle(TextInputStyle.Short).setRequired(false).setValue(incident.assignedTo || '');
  return modal.addComponents(
    new ActionRowBuilder().addComponents(title),
    new ActionRowBuilder().addComponents(reason),
    new ActionRowBuilder().addComponents(status),
    new ActionRowBuilder().addComponents(priority),
    new ActionRowBuilder().addComponents(assigned),
  );
}

function buildResolveModal(incident) {
  const modal = new ModalBuilder().setCustomId(`${CID.RESOLVE_MODAL}:${incident.id}`).setTitle(`Resolve ${incident.id}`);
  const comment = new TextInputBuilder().setCustomId('comment').setLabel('Resolution comment (optional)').setStyle(TextInputStyle.Paragraph).setRequired(false);
  return modal.addComponents(new ActionRowBuilder().addComponents(comment));
}

function buildDeleteModal(incident) {
  const modal = new ModalBuilder().setCustomId(`${CID.DELETE_MODAL}:${incident.id}`).setTitle(`Delete ${incident.id}`);
  const confirm = new TextInputBuilder().setCustomId('confirm').setLabel(`Type DELETE to confirm`).setStyle(TextInputStyle.Short).setRequired(true);
  return modal.addComponents(new ActionRowBuilder().addComponents(confirm));
}

function buildSearchModal() {
  const modal = new ModalBuilder().setCustomId(CID.SEARCH_MODAL).setTitle('Search Incidents');
  const query = new TextInputBuilder().setCustomId('q').setLabel('Search query (title, reason, notes)').setStyle(TextInputStyle.Short).setRequired(true);
  return modal.addComponents(new ActionRowBuilder().addComponents(query));
}

// ------------------------------
// Legacy cleanup helpers
// ------------------------------
async function pruneLegacyOverviewMessages(client, store, opts) {
  const ch = await client.channels.fetch(opts.overviewChannelId).catch(()=>null);
  if (!ch || !ch.messages) return;
  const keepId = store.getOverviewMessageId();
  const coll = await ch.messages.fetch({ limit: 50 }).catch(()=>null);
  if (!coll) return;
  for (const m of coll.values()) {
    if (m.author?.id !== client.user?.id) continue;
    const marked = m.embeds?.some(e => ((e.footer?.text || '') === MARK.OVERVIEW) || (e.title === 'Incident Overview'));
    if (marked && (!keepId || m.id !== keepId)) {
      await m.delete().catch(()=>{});
    }
  }
}

async function pruneLegacyPanelsInChannel(client, channel, keepId) {
  if (!channel?.messages) return;
  const coll = await channel.messages.fetch({ limit: 50 }).catch(()=>null);
  if (!coll) return;
  for (const m of coll.values()) {
    if (m.author?.id !== client.user?.id) continue;
    const marked = m.embeds?.some(e => ((e.footer?.text || '') === MARK.PANEL) || (e.title === 'Incident Panel'));
    if (marked && m.id !== keepId) {
      await m.delete().catch(()=>{});
    }
  }
}

// ------------------------------
// Notification helpers
// ------------------------------
async function notifyNewIncident(client, opts, incident) {
  const ch = await client.channels.fetch(opts.notificationChannelId).catch(()=>null);
  if (!ch || !ch.send) return;
  await ch.send({ embeds: [incidentEmbed(incident)] }).catch(()=>{});
}

// ------------------------------
// Entry: setup function
// ------------------------------
function setupIncidentPanel(client, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const store = new IncidentStore(opts.dataDir);

  // Message command trigger: .incident-panel (only for allowedUserId)
  client.on('messageCreate', async (msg) => {
    if (!msg.guild || msg.author.bot) return;
    if (!msg.content || !msg.content.trim().toLowerCase().startsWith('.incident-panel')) return;
    if (msg.author.id !== String(opts.allowedUserId)) return; // ignore others silently

    const embed = panelEmbed();
    // Remove previous panel if we have it stored
    const prevPanelId = store.getPanelMessageId();
    if (prevPanelId) {
      const prev = await msg.channel.messages.fetch(prevPanelId).catch(()=>null);
      if (prev) await prev.delete().catch(()=>{});
    }

    const sent = await msg.reply({ embeds: [embed], components: panelRows() });
    store.setPanelMessageId(sent.id);
    // Clean up any other legacy panels in this channel (based on embed footer marker)
    await pruneLegacyPanelsInChannel(client, msg.channel, sent.id);
  });

  // Interaction handling
  client.on('interactionCreate', async (interaction) => {
    try {
      if (!interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isModalSubmit()) return;

      // Enforce access for panel actions
      const userId = interaction.user?.id;
      const allowed = String(userId) === String(opts.allowedUserId);
      if (!allowed) return; // do nothing for unauthorized users

      // Buttons
      if (interaction.isButton()) {
        const id = interaction.customId;
        if (id === CID.CREATE) {
          return void interaction.showModal(buildCreateModal());
        }
        if (id === CID.EDIT) {
          const incidents = store.list();
          if (!incidents.length) return void interaction.reply({ content: 'No incidents to edit.', ephemeral: true });
          return void interaction.reply({ content: 'Select an incident to edit:', components: [selectRow(incidents)], ephemeral: true });
        }
        if (id === CID.RESOLVE) {
          const open = store.list().filter(i => !['resolved', 'closed'].includes(i.status));
          if (!open.length) return void interaction.reply({ content: 'No open incidents to resolve.', ephemeral: true });
          return void interaction.reply({ content: 'Select an incident to resolve:', components: [selectRow(open)], ephemeral: true });
        }
        if (id === CID.DELETE) {
          const incidents = store.list();
          if (!incidents.length) return void interaction.reply({ content: 'No incidents to delete.', ephemeral: true });
          return void interaction.reply({ content: 'Select an incident to delete:', components: [selectRow(incidents)], ephemeral: true });
        }
        if (id === CID.VIEW_FILTER) {
          const embed = overviewEmbed(store.list());
          return void interaction.reply({ embeds: [embed], components: [filterRow()], ephemeral: true });
        }
        if (id === CID.REFRESH_OVERVIEW) {
          await upsertOverviewMessage(interaction.client, store, opts);
          return void interaction.reply({ content: 'Overview updated.', ephemeral: true });
        }
        if (id === CID.SEARCH) {
          return void interaction.showModal(buildSearchModal());
        }
      }

      // Select menus
      if (interaction.isStringSelectMenu()) {
        const id = interaction.customId;
        if (id === CID.SELECT_INCIDENT) {
          const incidentId = interaction.values?.[0];
          const incident = store.get(incidentId);
          if (!incident) return void interaction.update({ content: 'Incident not found.', components: [] });

          // Decide which modal: if this select was prompted from Edit/Resolve/Delete flows, infer by last button? We embed the next step as buttons.
          const rows = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`inc:edit:${incident.id}`).setLabel('Edit Fields').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`inc:resolve:${incident.id}`).setLabel('Resolve').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`inc:delete:${incident.id}`).setLabel('Delete').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`inc:view:${incident.id}`).setLabel('View').setStyle(ButtonStyle.Success),
          );
          return void interaction.update({ content: `Selected **${incident.title}** (${incident.id})`, embeds: [incidentEmbed(incident)], components: [rows] });
        }
        if (id === CID.SELECT_FILTER) {
          const [type, value] = interaction.values[0].split(':');
          const me = interaction.user.id;
          let list = store.list();
          if (type === 'status' && value) list = list.filter(i => i.status === value);
          if (type === 'priority' && value) list = list.filter(i => i.priority === value);
          if (type === 'assigned') {
            if (value === 'me') list = list.filter(i => i.assignedTo === me);
            else if (value === 'any') list = list.filter(i => !!i.assignedTo);
          }
          const embed = overviewEmbed(list);
          return void interaction.update({ embeds: [embed] });
        }
      }

      // Dynamic button namespace actions (after selecting an incident)
      if (interaction.isButton() && interaction.customId.startsWith('inc:edit:')) {
        const id = interaction.customId.split(':')[2];
        const inc = store.get(id);
        if (!inc) return void interaction.reply({ content: 'Incident not found.', ephemeral: true });
        return void interaction.showModal(buildEditModal(inc));
      }
      if (interaction.isButton() && interaction.customId.startsWith('inc:resolve:')) {
        const id = interaction.customId.split(':')[2];
        const inc = store.get(id);
        if (!inc) return void interaction.reply({ content: 'Incident not found.', ephemeral: true });
        return void interaction.showModal(buildResolveModal(inc));
      }
      if (interaction.isButton() && interaction.customId.startsWith('inc:delete:')) {
        const id = interaction.customId.split(':')[2];
        const inc = store.get(id);
        if (!inc) return void interaction.reply({ content: 'Incident not found.', ephemeral: true });
        return void interaction.showModal(buildDeleteModal(inc));
      }
      if (interaction.isButton() && interaction.customId.startsWith('inc:view:')) {
        const id = interaction.customId.split(':')[2];
        const inc = store.get(id);
        if (!inc) return void interaction.reply({ content: 'Incident not found.', ephemeral: true });
        return void interaction.reply({ embeds: [incidentEmbed(inc)], ephemeral: true });
      }

      // Modal submit handlers
      if (interaction.isModalSubmit()) {
        const cid = interaction.customId;
        // CREATE
        if (cid === CID.CREATE_MODAL) {
          const title = interaction.fields.getTextInputValue('title').trim();
          const reason = interaction.fields.getTextInputValue('reason').trim();
          const priority = interaction.fields.getTextInputValue('priority').toLowerCase().trim();
          const assigned = (interaction.fields.getTextInputValue('assigned') || '').trim();
          const now = Date.now();
          const incident = /** @type {Incident} */ ({
            id: shortId(),
            title,
            reason,
            status: 'open',
            priority: ['low','medium','high','critical'].includes(priority) ? priority : 'medium',
            createdBy: interaction.user.id,
            assignedTo: assigned || '',
            createdAt: now,
            updatedAt: now,
            notes: [],
            audit: [{ at: now, by: interaction.user.id, action: 'create', diff: { title, reason, priority, assigned } }],
          });
          store.add(incident);
          await notifyNewIncident(interaction.client, opts, incident);
          await sendAudit(interaction.client, opts, `Create ${incident.id} by <@${interaction.user.id}>`);
          await upsertOverviewMessage(interaction.client, store, opts);
          return void interaction.reply({ content: `Incident **${incident.title}** created (ID: ${incident.id}).`, embeds: [incidentEmbed(incident)], ephemeral: true });
        }

        // EDIT
        if (cid.startsWith(`${CID.EDIT_MODAL}:`)) {
          const id = cid.split(':')[2];
          const inc = store.get(id);
          if (!inc) return void interaction.reply({ content: 'Incident not found.', ephemeral: true });
          const patch = {};
          const title = interaction.fields.getTextInputValue('title'); if (title) patch.title = title;
          const reason = interaction.fields.getTextInputValue('reason'); if (reason) patch.reason = reason;
          const status = interaction.fields.getTextInputValue('status'); if (status) patch.status = status.toLowerCase();
          const priority = interaction.fields.getTextInputValue('priority'); if (priority) patch.priority = priority.toLowerCase();
          const assigned = interaction.fields.getTextInputValue('assigned'); if (assigned !== undefined) patch.assignedTo = assigned || '';

          const next = store.update(id, patch);
          if (!next) return void interaction.reply({ content: 'Failed to update incident.', ephemeral: true });
          next.audit.push({ at: Date.now(), by: interaction.user.id, action: 'edit', diff: patch });
          store.save();

          await sendAudit(interaction.client, opts, `Edit ${id} by <@${interaction.user.id}>: ${Object.keys(patch).join(', ')}`);
          await upsertOverviewMessage(interaction.client, store, opts);
          return void interaction.reply({ content: `Incident **${next.title}** updated.`, embeds: [incidentEmbed(next)], ephemeral: true });
        }

        // RESOLVE
        if (cid.startsWith(`${CID.RESOLVE_MODAL}:`)) {
          const id = cid.split(':')[2];
          const inc = store.get(id);
          if (!inc) return void interaction.reply({ content: 'Incident not found.', ephemeral: true });
          const comment = interaction.fields.getTextInputValue('comment');
          const next = store.update(id, { status: 'resolved' });
          if (!next) return void interaction.reply({ content: 'Failed to resolve incident.', ephemeral: true });
          if (comment) next.notes.push(`Resolution: ${comment}`);
          next.audit.push({ at: Date.now(), by: interaction.user.id, action: 'resolve', diff: { comment } });
          store.save();

          await sendAudit(interaction.client, opts, `Resolve ${id} by <@${interaction.user.id}>`);
          await upsertOverviewMessage(interaction.client, store, opts);
          return void interaction.reply({ content: `Incident **${next.title}** marked as resolved.`, embeds: [incidentEmbed(next)], ephemeral: true });
        }

        // DELETE
        if (cid.startsWith(`${CID.DELETE_MODAL}:`)) {
          const id = cid.split(':')[2];
          const inc = store.get(id);
          if (!inc) return void interaction.reply({ content: 'Incident not found.', ephemeral: true });
          const confirm = interaction.fields.getTextInputValue('confirm');
          if (confirm !== 'DELETE') return void interaction.reply({ content: 'Deletion cancelled (confirmation mismatch).', ephemeral: true });
          const ok = store.remove(id);
          if (!ok) return void interaction.reply({ content: 'Failed to delete.', ephemeral: true });
          await sendAudit(interaction.client, opts, `Delete ${id} by <@${interaction.user.id}>`);
          await upsertOverviewMessage(interaction.client, store, opts);
          return void interaction.reply({ content: `Incident ${id} deleted.`, ephemeral: true });
        }

        // SEARCH
        if (cid === CID.SEARCH_MODAL) {
          const q = interaction.fields.getTextInputValue('q').toLowerCase();
          const hits = store.list().filter(i =>
            i.id.toLowerCase().includes(q) ||
            (i.title || '').toLowerCase().includes(q) ||
            (i.reason || '').toLowerCase().includes(q) ||
            i.notes.some(n => n.toLowerCase().includes(q))
          ).slice(0, 10);
          if (!hits.length) return void interaction.reply({ content: 'No results.', ephemeral: true });
          const embed = new EmbedBuilder()
            .setTitle(`Search results for "${q}"`)
            .setDescription(hits.map(i => `${priorityEmoji(i.priority)} **${i.title}** — ${i.status} | ID: \`${i.id}\``).join('\n'))
            .setColor(0x3498db);
          return void interaction.reply({ embeds: [embed], components: [selectRow(hits)], ephemeral: true });
        }
      }

    } catch (err) {
      console.error('[incident-panel] interaction error', err);
      if (interaction.isRepliable()) {
        await interaction.reply({ content: 'An error occurred while handling that action.', ephemeral: true }).catch(()=>{});
      }
    }
  });

  // Post an overview message at startup (optional)
  client.once('ready', async () => {
    try {
      await upsertOverviewMessage(client, store, opts);
      console.log('[incident-panel] ready');
    } catch (e) {
      console.warn('[incident-panel] overview post failed', e.message);
    }
  });

  return {
    store, // exposed for optional integrations
    refreshOverview: () => upsertOverviewMessage(client, store, opts),
  };
}

module.exports = { setupIncidentPanel };
