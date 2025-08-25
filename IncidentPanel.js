const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder } = require('discord.js');

// Configuration
const CONFIG = {
    AUTHORIZED_USER_ID: '1329813179865235467',
    INCIDENT_CHANNEL_ID: '1406381100980371557',
    AUDIT_CHANNEL_ID: '1407310001718038609',
    COLORS: {
        HIGH: '#FF0000',      // Red
        MEDIUM: '#FFA500',    // Orange
        LOW: '#FFFF00',       // Yellow
        RESOLVED: '#00FF00',  // Green
        INFO: '#0099FF'       // Blue
    },
    STATUS: {
        OPEN: 'Open',
        IN_PROGRESS: 'In Progress',
        RESOLVED: 'Resolved',
        CLOSED: 'Closed'
    },
    PRIORITY: {
        LOW: 'Low',
        MEDIUM: 'Medium',
        HIGH: 'High',
        CRITICAL: 'Critical'
    }
};

// In-memory storage (replace with database in production)
let incidents = new Map();
let incidentCounter = 1;
let overviewMessageId = null;

// Utility Functions
class IncidentUtils {
    static generateId() {
        return `INC-${String(incidentCounter++).padStart(4, '0')}`;
    }

    static createIncident(data) {
        const incident = {
            id: this.generateId(),
            title: data.title,
            description: data.description || '',
            priority: data.priority || CONFIG.PRIORITY.MEDIUM,
            status: CONFIG.STATUS.OPEN,
            assignedTo: data.assignedTo || 'Unassigned',
            createdBy: data.createdBy,
            createdAt: new Date(),
            updatedAt: new Date(),
            resolvedAt: null,
            notes: [],
            history: [{
                action: 'Created',
                user: data.createdBy,
                timestamp: new Date(),
                details: 'Incident created'
            }]
        };
        incidents.set(incident.id, incident);
        return incident;
    }

    static updateIncident(id, updates, userId) {
        const incident = incidents.get(id);
        if (!incident) return null;

        const oldStatus = incident.status;
        Object.assign(incident, updates, { updatedAt: new Date() });

        // Add to history
        incident.history.push({
            action: 'Updated',
            user: userId,
            timestamp: new Date(),
            details: `Updated: ${Object.keys(updates).join(', ')}`
        });

        // If status changed to resolved
        if (updates.status === CONFIG.STATUS.RESOLVED && oldStatus !== CONFIG.STATUS.RESOLVED) {
            incident.resolvedAt = new Date();
            incident.history.push({
                action: 'Resolved',
                user: userId,
                timestamp: new Date(),
                details: 'Incident marked as resolved'
            });
        }

        return incident;
    }

    static deleteIncident(id, userId) {
        const incident = incidents.get(id);
        if (!incident) return false;

        // Log deletion to audit
        this.logAuditAction('DELETE', incident, userId, 'Incident deleted');
        incidents.delete(id);
        return true;
    }

    static getIncidents(filters = {}) {
        let result = Array.from(incidents.values());

        if (filters.status) {
            result = result.filter(inc => inc.status === filters.status);
        }
        if (filters.priority) {
            result = result.filter(inc => inc.priority === filters.priority);
        }
        if (filters.assignedTo) {
            result = result.filter(inc => inc.assignedTo.toLowerCase().includes(filters.assignedTo.toLowerCase()));
        }
        if (filters.search) {
            const searchTerm = filters.search.toLowerCase();
            result = result.filter(inc => 
                inc.title.toLowerCase().includes(searchTerm) ||
                inc.description.toLowerCase().includes(searchTerm) ||
                inc.id.toLowerCase().includes(searchTerm)
            );
        }

        return result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    static getPriorityColor(priority) {
        switch (priority) {
            case CONFIG.PRIORITY.CRITICAL:
            case CONFIG.PRIORITY.HIGH:
                return CONFIG.COLORS.HIGH;
            case CONFIG.PRIORITY.MEDIUM:
                return CONFIG.COLORS.MEDIUM;
            case CONFIG.PRIORITY.LOW:
                return CONFIG.COLORS.LOW;
            default:
                return CONFIG.COLORS.INFO;
        }
    }

    static getStatusColor(status) {
        switch (status) {
            case CONFIG.STATUS.RESOLVED:
            case CONFIG.STATUS.CLOSED:
                return CONFIG.COLORS.RESOLVED;
            case CONFIG.STATUS.IN_PROGRESS:
                return CONFIG.COLORS.MEDIUM;
            case CONFIG.STATUS.OPEN:
                return CONFIG.COLORS.HIGH;
            default:
                return CONFIG.COLORS.INFO;
        }
    }

    static logAuditAction(action, incident, userId, details) {
        const auditLog = {
            action,
            incidentId: incident.id,
            incidentTitle: incident.title,
            userId,
            timestamp: new Date(),
            details
        };
        
        // Store in incident history
        if (incidents.has(incident.id)) {
            incidents.get(incident.id).history.push({
                action,
                user: userId,
                timestamp: new Date(),
                details
            });
        }
        
        return auditLog;
    }
}

// Embed Builders
class EmbedManager {
    static createMainPanel(user) {
        const activeIncidents = IncidentUtils.getIncidents({ status: CONFIG.STATUS.OPEN }).length;
        const inProgressIncidents = IncidentUtils.getIncidents({ status: CONFIG.STATUS.IN_PROGRESS }).length;
        const totalIncidents = incidents.size;

        return new EmbedBuilder()
            .setTitle('🚨 Incident Management Panel')
            .setDescription('Manage and track incidents efficiently')
            .addFields(
                { name: '📊 Statistics', value: `**Active:** ${activeIncidents}\n**In Progress:** ${inProgressIncidents}\n**Total:** ${totalIncidents}`, inline: true },
                { name: '⚡ Quick Actions', value: '• Create new incident\n• View all incidents\n• Search incidents\n• Generate reports', inline: true },
                { name: '🔍 Filters Available', value: '• Status\n• Priority\n• Assigned Person\n• Date Range', inline: true }
            )
            .setColor(CONFIG.COLORS.INFO)
            .setFooter({ text: `Requested by ${user.username}`, iconURL: user.displayAvatarURL() })
            .setTimestamp();
    }

    static createIncidentListEmbed(incidents, page = 1, filters = {}) {
        const itemsPerPage = 5;
        const startIndex = (page - 1) * itemsPerPage;
        const endIndex = startIndex + itemsPerPage;
        const paginatedIncidents = incidents.slice(startIndex, endIndex);
        
        const embed = new EmbedBuilder()
            .setTitle('📋 Incident List')
            .setColor(CONFIG.COLORS.INFO);

        if (paginatedIncidents.length === 0) {
            embed.setDescription('No incidents found matching your criteria.');
            return embed;
        }

        let description = '';
        if (Object.keys(filters).length > 0) {
            description += `**Filters Applied:** ${Object.entries(filters).map(([k, v]) => `${k}: ${v}`).join(', ')}\n\n`;
        }

        for (const incident of paginatedIncidents) {
            const statusEmoji = incident.status === CONFIG.STATUS.RESOLVED ? '✅' : 
                              incident.status === CONFIG.STATUS.IN_PROGRESS ? '🔄' : '🔴';
            const priorityEmoji = incident.priority === CONFIG.PRIORITY.CRITICAL ? '🔥' :
                                incident.priority === CONFIG.PRIORITY.HIGH ? '⚠️' :
                                incident.priority === CONFIG.PRIORITY.MEDIUM ? '📋' : '📝';
            
            description += `${statusEmoji} **${incident.id}** - ${incident.title}\n`;
            description += `${priorityEmoji} Priority: ${incident.priority} | Status: ${incident.status}\n`;
            description += `👤 Assigned: ${incident.assignedTo} | 📅 ${incident.createdAt.toLocaleDateString()}\n\n`;
        }

        embed.setDescription(description);
        embed.setFooter({ text: `Page ${page}/${Math.ceil(incidents.length / itemsPerPage)} • Total: ${incidents.length} incidents` });

        return embed;
    }

    static createIncidentDetailEmbed(incident) {
        const embed = new EmbedBuilder()
            .setTitle(`🎫 Incident Details - ${incident.id}`)
            .setDescription(`**${incident.title}**\n\n${incident.description || 'No description provided'}`)
            .addFields(
                { name: '📊 Status', value: incident.status, inline: true },
                { name: '🎯 Priority', value: incident.priority, inline: true },
                { name: '👤 Assigned To', value: incident.assignedTo, inline: true },
                { name: '📅 Created', value: `<t:${Math.floor(incident.createdAt.getTime() / 1000)}:F>`, inline: true },
                { name: '🔄 Last Updated', value: `<t:${Math.floor(incident.updatedAt.getTime() / 1000)}:R>`, inline: true }
            )
            .setColor(IncidentUtils.getStatusColor(incident.status));

        if (incident.resolvedAt) {
            embed.addFields({ name: '✅ Resolved', value: `<t:${Math.floor(incident.resolvedAt.getTime() / 1000)}:F>`, inline: true });
        }

        if (incident.notes.length > 0) {
            const notesText = incident.notes.slice(-3).map(note => 
                `**${note.author}** (<t:${Math.floor(note.timestamp.getTime() / 1000)}:R>):\n${note.content}`
            ).join('\n\n');
            embed.addFields({ name: '📝 Recent Notes', value: notesText });
        }

        return embed;
    }

    static createOverviewEmbed() {
        const allIncidents = Array.from(incidents.values());
        const activeIncidents = allIncidents.filter(inc => inc.status !== CONFIG.STATUS.RESOLVED && inc.status !== CONFIG.STATUS.CLOSED);
        
        const embed = new EmbedBuilder()
            .setTitle('🚨 Incident Overview')
            .setTimestamp();

        if (activeIncidents.length === 0) {
            embed
                .setDescription('✅ **No active incidents**\n\nAll systems operational!')
                .setColor(CONFIG.COLORS.RESOLVED);
        } else {
            const criticalCount = activeIncidents.filter(inc => inc.priority === CONFIG.PRIORITY.CRITICAL).length;
            const highCount = activeIncidents.filter(inc => inc.priority === CONFIG.PRIORITY.HIGH).length;
            const mediumCount = activeIncidents.filter(inc => inc.priority === CONFIG.PRIORITY.MEDIUM).length;
            const lowCount = activeIncidents.filter(inc => inc.priority === CONFIG.PRIORITY.LOW).length;

            let description = `🔴 **${activeIncidents.length} Active Incident${activeIncidents.length > 1 ? 's' : ''}**\n\n`;
            
            if (criticalCount > 0) description += `🔥 Critical: ${criticalCount}\n`;
            if (highCount > 0) description += `⚠️ High: ${highCount}\n`;
            if (mediumCount > 0) description += `📋 Medium: ${mediumCount}\n`;
            if (lowCount > 0) description += `📝 Low: ${lowCount}\n`;

            description += '\n**Recent Active Incidents:**\n';
            
            activeIncidents.slice(0, 5).forEach(inc => {
                const emoji = inc.priority === CONFIG.PRIORITY.CRITICAL ? '🔥' :
                            inc.priority === CONFIG.PRIORITY.HIGH ? '⚠️' :
                            inc.priority === CONFIG.PRIORITY.MEDIUM ? '📋' : '📝';
                description += `${emoji} **${inc.id}** - ${inc.title}\n`;
            });

            embed
                .setDescription(description)
                .setColor(criticalCount > 0 ? CONFIG.COLORS.HIGH : highCount > 0 ? CONFIG.COLORS.MEDIUM : CONFIG.COLORS.INFO);
        }

        return embed;
    }

    static createAuditEmbed(incident, action, user, details) {
        return new EmbedBuilder()
            .setTitle('📋 Incident Audit Log')
            .addFields(
                { name: '🎫 Incident ID', value: incident.id, inline: true },
                { name: '📝 Title', value: incident.title, inline: true },
                { name: '⚡ Action', value: action, inline: true },
                { name: '👤 User', value: `<@${user}>`, inline: true },
                { name: '📅 Timestamp', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
                { name: '📋 Details', value: details, inline: false }
            )
            .setColor(CONFIG.COLORS.INFO)
            .setTimestamp();
    }
}

// Component Builders
class ComponentManager {
    static createMainPanelComponents() {
        const row1 = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('incident_create')
                    .setLabel('Create Incident')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('➕'),
                new ButtonBuilder()
                    .setCustomId('incident_list')
                    .setLabel('View All')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('📋'),
                new ButtonBuilder()
                    .setCustomId('incident_search')
                    .setLabel('Search')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('🔍')
            );

        const row2 = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('incident_filter')
                    .setLabel('Filter')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('🎯'),
                new ButtonBuilder()
                    .setCustomId('incident_refresh')
                    .setLabel('Refresh')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('🔄'),
                new ButtonBuilder()
                    .setCustomId('incident_stats')
                    .setLabel('Statistics')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('📊')
            );

        return [row1, row2];
    }

    static createIncidentListComponents(page, totalPages, filters = {}) {
        const components = [];
        
        // Navigation row
        const navRow = new ActionRowBuilder();
        
        if (page > 1) {
            navRow.addComponents(
                new ButtonBuilder()
                    .setCustomId(`incident_list_page_${page - 1}`)
                    .setLabel('Previous')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('⬅️')
            );
        }

        navRow.addComponents(
            new ButtonBuilder()
                .setCustomId('incident_list_refresh')
                .setLabel(`Page ${page}/${totalPages}`)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true)
        );

        if (page < totalPages) {
            navRow.addComponents(
                new ButtonBuilder()
                    .setCustomId(`incident_list_page_${page + 1}`)
                    .setLabel('Next')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('➡️')
            );
        }

        components.push(navRow);

        // Action row
        const actionRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('incident_create')
                    .setLabel('New')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('➕'),
                new ButtonBuilder()
                    .setCustomId('incident_filter')
                    .setLabel('Filter')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('🎯'),
                new ButtonBuilder()
                    .setCustomId('incident_search')
                    .setLabel('Search')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('🔍'),
                new ButtonBuilder()
                    .setCustomId('incident_panel_main')
                    .setLabel('Back')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('🏠')
            );

        components.push(actionRow);

        return components;
    }

    static createIncidentDetailComponents(incidentId) {
        const incident = incidents.get(incidentId);
        if (!incident) return [];

        const row1 = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`incident_edit_${incidentId}`)
                    .setLabel('Edit')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('✏️'),
                new ButtonBuilder()
                    .setCustomId(`incident_note_${incidentId}`)
                    .setLabel('Add Note')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('📝'),
                new ButtonBuilder()
                    .setCustomId(`incident_history_${incidentId}`)
                    .setLabel('History')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('📚')
            );

        const row2 = new ActionRowBuilder();

        if (incident.status !== CONFIG.STATUS.RESOLVED && incident.status !== CONFIG.STATUS.CLOSED) {
            row2.addComponents(
                new ButtonBuilder()
                    .setCustomId(`incident_resolve_${incidentId}`)
                    .setLabel('Resolve')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅')
            );
        }

        row2.addComponents(
            new ButtonBuilder()
                .setCustomId(`incident_delete_${incidentId}`)
                .setLabel('Delete')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🗑️'),
            new ButtonBuilder()
                .setCustomId('incident_list')
                .setLabel('Back to List')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('📋')
        );

        return [row1, row2];
    }

    static createFilterSelectMenu() {
        return new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('incident_filter_select')
                    .setPlaceholder('Select filter type')
                    .addOptions([
                        {
                            label: 'Status',
                            description: 'Filter by incident status',
                            value: 'status',
                            emoji: '📊'
                        },
                        {
                            label: 'Priority',
                            description: 'Filter by priority level',
                            value: 'priority',
                            emoji: '🎯'
                        },
                        {
                            label: 'Assigned Person',
                            description: 'Filter by assignee',
                            value: 'assignee',
                            emoji: '👤'
                        },
                        {
                            label: 'Clear Filters',
                            description: 'Remove all active filters',
                            value: 'clear',
                            emoji: '🔄'
                        }
                    ])
            );
    }
}

// Modal Builders
class ModalManager {
    static createIncidentModal(incidentId = null) {
        const incident = incidentId ? incidents.get(incidentId) : null;
        const isEdit = !!incident;

        const modal = new ModalBuilder()
            .setCustomId(isEdit ? `incident_edit_modal_${incidentId}` : 'incident_create_modal')
            .setTitle(isEdit ? `Edit Incident - ${incidentId}` : 'Create New Incident');

        const titleInput = new TextInputBuilder()
            .setCustomId('incident_title')
            .setLabel('Incident Title')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Brief description of the incident')
            .setRequired(true)
            .setMaxLength(100);

        const descriptionInput = new TextInputBuilder()
            .setCustomId('incident_description')
            .setLabel('Detailed Description')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Detailed description of the incident...')
            .setRequired(false)
            .setMaxLength(1000);

        const priorityInput = new TextInputBuilder()
            .setCustomId('incident_priority')
            .setLabel('Priority (Low/Medium/High/Critical)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Medium')
            .setRequired(false)
            .setMaxLength(10);

        const assigneeInput = new TextInputBuilder()
            .setCustomId('incident_assignee')
            .setLabel('Assign To')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Username or team name')
            .setRequired(false)
            .setMaxLength(50);

        if (isEdit) {
            titleInput.setValue(incident.title);
            descriptionInput.setValue(incident.description);
            priorityInput.setValue(incident.priority);
            assigneeInput.setValue(incident.assignedTo);

            const statusInput = new TextInputBuilder()
                .setCustomId('incident_status')
                .setLabel('Status (Open/In Progress/Resolved/Closed)')
                .setStyle(TextInputStyle.Short)
                .setValue(incident.status)
                .setRequired(true)
                .setMaxLength(20);

            modal.addComponents(
                new ActionRowBuilder().addComponents(titleInput),
                new ActionRowBuilder().addComponents(descriptionInput),
                new ActionRowBuilder().addComponents(priorityInput),
                new ActionRowBuilder().addComponents(statusInput),
                new ActionRowBuilder().addComponents(assigneeInput)
            );
        } else {
            modal.addComponents(
                new ActionRowBuilder().addComponents(titleInput),
                new ActionRowBuilder().addComponents(descriptionInput),
                new ActionRowBuilder().addComponents(priorityInput),
                new ActionRowBuilder().addComponents(assigneeInput)
            );
        }

        return modal;
    }

    static createSearchModal() {
        return new ModalBuilder()
            .setCustomId('incident_search_modal')
            .setTitle('Search Incidents')
            .addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('search_query')
                        .setLabel('Search Query')
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('Enter incident ID, title, or description...')
                        .setRequired(true)
                        .setMaxLength(100)
                )
            );
    }

    static createNoteModal(incidentId) {
        return new ModalBuilder()
            .setCustomId(`incident_note_modal_${incidentId}`)
            .setTitle(`Add Note - ${incidentId}`)
            .addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('note_content')
                        .setLabel('Note Content')
                        .setStyle(TextInputStyle.Paragraph)
                        .setPlaceholder('Enter your note here...')
                        .setRequired(true)
                        .setMaxLength(500)
                )
            );
    }

    static createResolveModal(incidentId) {
        return new ModalBuilder()
            .setCustomId(`incident_resolve_modal_${incidentId}`)
            .setTitle(`Resolve Incident - ${incidentId}`)
            .addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('resolve_comment')
                        .setLabel('Resolution Comment')
                        .setStyle(TextInputStyle.Paragraph)
                        .setPlaceholder('Describe how the incident was resolved...')
                        .setRequired(false)
                        .setMaxLength(500)
                )
            );
    }
}

// Bot status update function
async function updateBotStatus(client) {
    const activeIncidents = IncidentUtils.getIncidents()
        .filter(inc => inc.status !== CONFIG.STATUS.RESOLVED && inc.status !== CONFIG.STATUS.CLOSED);
    
    if (activeIncidents.length === 0) {
        await client.user.setPresence({
            status: 'online',
            activities: [{
                name: 'No incidents found...',
                type: 'WATCHING'
            }]
        });
    } else {
        const incidentTitles = activeIncidents.map(inc => inc.title).join(', ');
        await client.user.setPresence({
            status: 'dnd',
            activities: [{
                name: incidentTitles.length > 50 ? incidentTitles.substring(0, 47) + '...' : incidentTitles,
                type: 'WATCHING'
            }]
        });
    }
}

// Main command handler
// Vervang je hele module.exports aan het einde van je bestand met dit:
module.exports = {
    name: 'incident-panel',
    description: 'Opens the incident management panel',
    
    // VOEG HIER DE EXECUTE FUNCTIE TOE
    execute(message, args, client) {
        // Check if user is authorized
        if (message.author.id !== CONFIG.AUTHORIZED_USER_ID) {
            return; // Silently ignore unauthorized users
        }

        const embed = EmbedManager.createMainPanel(message.author);
        const components = ComponentManager.createMainPanelComponents();

        message.reply({
            embeds: [embed],
            components: components
        });
    },
    
    setupIncidentPanel(client, config = {}) {
        // ... rest van je code

setupIncidentPanel(client, config = {}) {
    console.log('🚨 Setting up Incident Management Panel...');
    
    // Override config if provided
    if (config.AUTHORIZED_USER_ID) CONFIG.AUTHORIZED_USER_ID = config.AUTHORIZED_USER_ID;
    if (config.INCIDENT_CHANNEL_ID) CONFIG.INCIDENT_CHANNEL_ID = config.INCIDENT_CHANNEL_ID;
    if (config.AUDIT_CHANNEL_ID) CONFIG.AUDIT_CHANNEL_ID = config.AUDIT_CHANNEL_ID;

    // Bewaar een referentie naar de module exports
    const moduleExports = module.exports;

    // Wait for client to be ready before doing anything
    if (client.isReady()) {
        // Client is already ready, initialize immediately
        moduleExports.initializeIncidentPanel(client);
    } else {
        // Wait for client to be ready
        client.once('ready', () => {
            moduleExports.initializeIncidentPanel(client);
        });
    }

    console.log('✅ Incident Management Panel setup complete!');
},

// Vervang alleen deze initializeIncidentPanel functie in je module.exports:

async initializeIncidentPanel(client) {
    try {
        // Initialize bot status
        await updateBotStatus(client);
        
        // Update overview message on startup
        setTimeout(async () => {
            try {
                await module.exports.updateOverviewMessage(client);
            } catch (error) {
                console.error('Error updating overview message:', error);
            }
        }, 2000);

        // Start interval for bot status updates
        setInterval(async () => {
            try {
                await updateBotStatus(client);
            } catch (error) {
                console.error('Error updating bot status:', error);
            }
        }, 5 * 60 * 1000); // Every 5 minutes

        console.log('🎯 Incident panel initialized successfully!');
    } catch (error) {
        console.error('❌ Error initializing incident panel:', error);
    }
},

    // Button interaction handler
    async handleButtonInteraction(interaction, client) {
        if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;
        if (interaction.user.id !== CONFIG.AUTHORIZED_USER_ID) {
            return interaction.reply({ content: 'You are not authorized to use this panel.', ephemeral: true });
        }

        const customId = interaction.customId;

        try {
            if (customId === 'incident_panel_main') {
                const embed = EmbedManager.createMainPanel(interaction.user);
                const components = ComponentManager.createMainPanelComponents();
                
                await interaction.update({
                    embeds: [embed],
                    components: components
                });

            } else if (customId === 'incident_create') {
                const modal = ModalManager.createIncidentModal();
                await interaction.showModal(modal);

            } else if (customId === 'incident_list' || customId.startsWith('incident_list_page_')) {
                const page = customId.startsWith('incident_list_page_') ? 
                    parseInt(customId.split('_')[3]) : 1;
                
                const allIncidents = IncidentUtils.getIncidents();
                const embed = EmbedManager.createIncidentListEmbed(allIncidents, page);
                const totalPages = Math.ceil(allIncidents.length / 5);
                const components = ComponentManager.createIncidentListComponents(page, totalPages);

                await interaction.update({
                    embeds: [embed],
                    components: components
                });

            } else if (customId === 'incident_search') {
                const modal = ModalManager.createSearchModal();
                await interaction.showModal(modal);

            } else if (customId === 'incident_filter') {
                const components = [ComponentManager.createFilterSelectMenu()];
                
                await interaction.reply({
                    content: 'Select a filter type:',
                    components: components,
                    ephemeral: true
                });

            } else if (customId === 'incident_refresh' || customId === 'incident_list_refresh') {
                const embed = EmbedManager.createMainPanel(interaction.user);
                const components = ComponentManager.createMainPanelComponents();
                
                await interaction.update({
                    embeds: [embed],
                    components: components
                });

            } else if (customId.startsWith('incident_edit_')) {
                const incidentId = customId.replace('incident_edit_', '');
                const modal = ModalManager.createIncidentModal(incidentId);
                await interaction.showModal(modal);

            } else if (customId.startsWith('incident_note_')) {
                const incidentId = customId.replace('incident_note_', '');
                const modal = ModalManager.createNoteModal(incidentId);
                await interaction.showModal(modal);

            } else if (customId.startsWith('incident_resolve_')) {
                const incidentId = customId.replace('incident_resolve_', '');
                const modal = ModalManager.createResolveModal(incidentId);
                await interaction.showModal(modal);

            } else if (customId.startsWith('incident_delete_')) {
                const incidentId = customId.replace('incident_delete_', '');
                const incident = incidents.get(incidentId);
                
                if (!incident) {
                    return interaction.reply({ content: 'Incident not found!', ephemeral: true });
                }

                const confirmRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`confirm_delete_${incidentId}`)
                            .setLabel('Confirm Delete')
                            .setStyle(ButtonStyle.Danger)
                            .setEmoji('✅'),
                        new ButtonBuilder()
                            .setCustomId('cancel_delete')
                            .setLabel('Cancel')
                            .setStyle(ButtonStyle.Secondary)
                            .setEmoji('❌')
                    );

                await interaction.reply({
                    content: `⚠️ **Are you sure you want to delete incident ${incidentId}?**\n\n**Title:** ${incident.title}\n\nThis action cannot be undone.`,
                    components: [confirmRow],
                    ephemeral: true
                });

            } else if (customId.startsWith('confirm_delete_')) {
                const incidentId = customId.replace('confirm_delete_', '');
                const incident = incidents.get(incidentId);
                
                if (IncidentUtils.deleteIncident(incidentId, interaction.user.id)) {
                    // Send audit log
                    const auditChannel = client.channels.cache.get(CONFIG.AUDIT_CHANNEL_ID);
                    if (auditChannel) {
                        const auditEmbed = EmbedManager.createAuditEmbed(incident, 'DELETE', interaction.user.id, 'Incident deleted by user');
                        await auditChannel.send({ embeds: [auditEmbed] });
                    }

                    // Update overview message
                    await updateOverviewMessage(client);
                    
                    // Update bot status
                    await updateBotStatus(client);

                    await interaction.update({
                        content: `✅ Incident **${incidentId}** has been deleted successfully.`,
                        components: [],
                        ephemeral: true
                    });
                } else {
                    await interaction.update({
                        content: '❌ Failed to delete incident. It may not exist.',
                        components: [],
                        ephemeral: true
                    });
                }

            } else if (customId === 'cancel_delete') {
                await interaction.update({
                    content: '❌ Deletion cancelled.',
                    components: [],
                    ephemeral: true
                });

            } else if (customId.startsWith('incident_history_')) {
                const incidentId = customId.replace('incident_history_', '');
                const incident = incidents.get(incidentId);
                
                if (!incident) {
                    return interaction.reply({ content: 'Incident not found!', ephemeral: true });
                }

                const historyEmbed = new EmbedBuilder()
                    .setTitle(`📚 History - ${incidentId}`)
                    .setDescription(`**${incident.title}**`)
                    .setColor(CONFIG.COLORS.INFO);

                const historyText = incident.history.slice(-10).map(entry => 
                    `**${entry.action}** by <@${entry.user}>\n<t:${Math.floor(entry.timestamp.getTime() / 1000)}:f> - ${entry.details}`
                ).join('\n\n');

                historyEmbed.addFields({ name: 'Recent Activity', value: historyText || 'No history available' });

                const backButton = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`incident_detail_${incidentId}`)
                            .setLabel('Back to Details')
                            .setStyle(ButtonStyle.Secondary)
                            .setEmoji('⬅️')
                    );

                await interaction.reply({
                    embeds: [historyEmbed],
                    components: [backButton],
                    ephemeral: true
                });

            } else if (customId.startsWith('incident_detail_')) {
                const incidentId = customId.replace('incident_detail_', '');
                const incident = incidents.get(incidentId);
                
                if (!incident) {
                    return interaction.reply({ content: 'Incident not found!', ephemeral: true });
                }

                const embed = EmbedManager.createIncidentDetailEmbed(incident);
                const components = ComponentManager.createIncidentDetailComponents(incidentId);

                await interaction.update({
                    embeds: [embed],
                    components: components
                });

            } else if (customId === 'incident_filter_select') {
                const filterType = interaction.values[0];
                
                if (filterType === 'clear') {
                    const allIncidents = IncidentUtils.getIncidents();
                    const embed = EmbedManager.createIncidentListEmbed(allIncidents, 1);
                    const components = ComponentManager.createIncidentListComponents(1, Math.ceil(allIncidents.length / 5));

                    await interaction.update({
                        embeds: [embed],
                        components: components
                    });
                } else {
                    // Handle specific filter types
                    let options = [];
                    
                    if (filterType === 'status') {
                        options = Object.values(CONFIG.STATUS).map(status => ({
                            label: status,
                            value: `filter_status_${status}`,
                            emoji: status === CONFIG.STATUS.RESOLVED ? '✅' : 
                                  status === CONFIG.STATUS.IN_PROGRESS ? '🔄' : '🔴'
                        }));
                    } else if (filterType === 'priority') {
                        options = Object.values(CONFIG.PRIORITY).map(priority => ({
                            label: priority,
                            value: `filter_priority_${priority}`,
                            emoji: priority === CONFIG.PRIORITY.CRITICAL ? '🔥' :
                                  priority === CONFIG.PRIORITY.HIGH ? '⚠️' :
                                  priority === CONFIG.PRIORITY.MEDIUM ? '📋' : '📝'
                        }));
                    }

                    const selectMenu = new ActionRowBuilder()
                        .addComponents(
                            new StringSelectMenuBuilder()
                                .setCustomId('incident_apply_filter')
                                .setPlaceholder(`Select ${filterType}`)
                                .addOptions(options)
                        );

                    await interaction.update({
                        content: `Select ${filterType} to filter by:`,
                        components: [selectMenu]
                    });
                }

            } else if (customId === 'incident_apply_filter') {
                const filterValue = interaction.values[0];
                const [, filterType, value] = filterValue.split('_');
                
                const filters = { [filterType]: value };
                const filteredIncidents = IncidentUtils.getIncidents(filters);
                const embed = EmbedManager.createIncidentListEmbed(filteredIncidents, 1, filters);
                const components = ComponentManager.createIncidentListComponents(1, Math.ceil(filteredIncidents.length / 5), filters);

                await interaction.update({
                    embeds: [embed],
                    components: components
                });

            } else if (customId === 'incident_stats') {
                const allIncidents = Array.from(incidents.values());
                const statsEmbed = new EmbedBuilder()
                    .setTitle('📊 Incident Statistics')
                    .setColor(CONFIG.COLORS.INFO)
                    .addFields(
                        { name: '📈 Total Incidents', value: allIncidents.length.toString(), inline: true },
                        { name: '🔴 Open', value: allIncidents.filter(i => i.status === CONFIG.STATUS.OPEN).length.toString(), inline: true },
                        { name: '🔄 In Progress', value: allIncidents.filter(i => i.status === CONFIG.STATUS.IN_PROGRESS).length.toString(), inline: true },
                        { name: '✅ Resolved', value: allIncidents.filter(i => i.status === CONFIG.STATUS.RESOLVED).length.toString(), inline: true },
                        { name: '🔒 Closed', value: allIncidents.filter(i => i.status === CONFIG.STATUS.CLOSED).length.toString(), inline: true },
                        { name: '🔥 Critical', value: allIncidents.filter(i => i.priority === CONFIG.PRIORITY.CRITICAL).length.toString(), inline: true }
                    )
                    .setTimestamp();

                await interaction.reply({
                    embeds: [statsEmbed],
                    ephemeral: true
                });
            }

        } catch (error) {
            console.error('Error handling button interaction:', error);
            await interaction.reply({ 
                content: 'An error occurred while processing your request.', 
                ephemeral: true 
            }).catch(console.error);
        }
    },

    // Modal interaction handler
    async handleModalInteraction(interaction, client) {
        if (!interaction.isModalSubmit()) return;
        if (interaction.user.id !== CONFIG.AUTHORIZED_USER_ID) {
            return interaction.reply({ content: 'You are not authorized to use this panel.', ephemeral: true });
        }

        const customId = interaction.customId;

        try {
            if (customId === 'incident_create_modal') {
                const title = interaction.fields.getTextInputValue('incident_title');
                const description = interaction.fields.getTextInputValue('incident_description');
                const priority = interaction.fields.getTextInputValue('incident_priority') || CONFIG.PRIORITY.MEDIUM;
                const assignee = interaction.fields.getTextInputValue('incident_assignee') || 'Unassigned';

                // Validate priority
                const validPriorities = Object.values(CONFIG.PRIORITY).map(p => p.toLowerCase());
                const normalizedPriority = validPriorities.includes(priority.toLowerCase()) 
                    ? Object.values(CONFIG.PRIORITY).find(p => p.toLowerCase() === priority.toLowerCase())
                    : CONFIG.PRIORITY.MEDIUM;

                const incident = IncidentUtils.createIncident({
                    title,
                    description,
                    priority: normalizedPriority,
                    assignedTo: assignee,
                    createdBy: interaction.user.id
                });

                // Send to incident channel
                const incidentChannel = client.channels.cache.get(CONFIG.INCIDENT_CHANNEL_ID);
                if (incidentChannel) {
                    const embed = EmbedManager.createIncidentDetailEmbed(incident);
                    await incidentChannel.send({ embeds: [embed] });
                }

                // Send audit log
                const auditChannel = client.channels.cache.get(CONFIG.AUDIT_CHANNEL_ID);
                if (auditChannel) {
                    const auditEmbed = EmbedManager.createAuditEmbed(incident, 'CREATE', interaction.user.id, 'New incident created');
                    await auditChannel.send({ embeds: [auditEmbed] });
                }

                // Update overview message
                await updateOverviewMessage(client);
                
                // Update bot status
                await updateBotStatus(client);

                await interaction.reply({
                    content: `✅ Incident **${incident.id}** created successfully!\n**Title:** ${incident.title}`,
                    ephemeral: true
                });

            } else if (customId.startsWith('incident_edit_modal_')) {
                const incidentId = customId.replace('incident_edit_modal_', '');
                const title = interaction.fields.getTextInputValue('incident_title');
                const description = interaction.fields.getTextInputValue('incident_description');
                const priority = interaction.fields.getTextInputValue('incident_priority');
                const status = interaction.fields.getTextInputValue('incident_status');
                const assignee = interaction.fields.getTextInputValue('incident_assignee');

                // Validate inputs
                const validPriorities = Object.values(CONFIG.PRIORITY).map(p => p.toLowerCase());
                const validStatuses = Object.values(CONFIG.STATUS).map(s => s.toLowerCase());
                
                const normalizedPriority = validPriorities.includes(priority.toLowerCase()) 
                    ? Object.values(CONFIG.PRIORITY).find(p => p.toLowerCase() === priority.toLowerCase())
                    : CONFIG.PRIORITY.MEDIUM;

                const normalizedStatus = validStatuses.includes(status.toLowerCase())
                    ? Object.values(CONFIG.STATUS).find(s => s.toLowerCase() === status.toLowerCase())
                    : CONFIG.STATUS.OPEN;

                const updates = {
                    title,
                    description,
                    priority: normalizedPriority,
                    status: normalizedStatus,
                    assignedTo: assignee
                };

                const updatedIncident = IncidentUtils.updateIncident(incidentId, updates, interaction.user.id);

                if (updatedIncident) {
                    // Send audit log
                    const auditChannel = client.channels.cache.get(CONFIG.AUDIT_CHANNEL_ID);
                    if (auditChannel) {
                        const auditEmbed = EmbedManager.createAuditEmbed(updatedIncident, 'UPDATE', interaction.user.id, 'Incident updated');
                        await auditChannel.send({ embeds: [auditEmbed] });
                    }

                    // Update overview message
                    await updateOverviewMessage(client);
                    
                    // Update bot status
                    await updateBotStatus(client);

                    await interaction.reply({
                        content: `✅ Incident **${incidentId}** updated successfully!`,
                        ephemeral: true
                    });
                } else {
                    await interaction.reply({
                        content: '❌ Failed to update incident. It may not exist.',
                        ephemeral: true
                    });
                }

            } else if (customId === 'incident_search_modal') {
                const query = interaction.fields.getTextInputValue('search_query');
                const searchResults = IncidentUtils.getIncidents({ search: query });
                
                const embed = EmbedManager.createIncidentListEmbed(searchResults, 1, { search: query });
                const components = ComponentManager.createIncidentListComponents(1, Math.ceil(searchResults.length / 5), { search: query });

                await interaction.reply({
                    embeds: [embed],
                    components: components,
                    ephemeral: true
                });

            } else if (customId.startsWith('incident_note_modal_')) {
                const incidentId = customId.replace('incident_note_modal_', '');
                const noteContent = interaction.fields.getTextInputValue('note_content');
                const incident = incidents.get(incidentId);

                if (incident) {
                    const note = {
                        content: noteContent,
                        author: interaction.user.username,
                        timestamp: new Date()
                    };

                    incident.notes.push(note);
                    incident.history.push({
                        action: 'Note Added',
                        user: interaction.user.id,
                        timestamp: new Date(),
                        details: `Added note: ${noteContent.substring(0, 50)}${noteContent.length > 50 ? '...' : ''}`
                    });

                    // Send audit log
                    const auditChannel = client.channels.cache.get(CONFIG.AUDIT_CHANNEL_ID);
                    if (auditChannel) {
                        const auditEmbed = EmbedManager.createAuditEmbed(incident, 'NOTE_ADDED', interaction.user.id, `Note added: ${noteContent}`);
                        await auditChannel.send({ embeds: [auditEmbed] });
                    }

                    await interaction.reply({
                        content: `✅ Note added to incident **${incidentId}**`,
                        ephemeral: true
                    });
                } else {
                    await interaction.reply({
                        content: '❌ Incident not found!',
                        ephemeral: true
                    });
                }

            } else if (customId.startsWith('incident_resolve_modal_')) {
                const incidentId = customId.replace('incident_resolve_modal_', '');
                const resolveComment = interaction.fields.getTextInputValue('resolve_comment');
                
                const updates = { 
                    status: CONFIG.STATUS.RESOLVED,
                    resolvedAt: new Date()
                };

                const resolvedIncident = IncidentUtils.updateIncident(incidentId, updates, interaction.user.id);

                if (resolvedIncident) {
                    if (resolveComment) {
                        const note = {
                            content: `Resolution: ${resolveComment}`,
                            author: interaction.user.username,
                            timestamp: new Date()
                        };
                        resolvedIncident.notes.push(note);
                    }

                    // Send audit log
                    const auditChannel = client.channels.cache.get(CONFIG.AUDIT_CHANNEL_ID);
                    if (auditChannel) {
                        const auditEmbed = EmbedManager.createAuditEmbed(resolvedIncident, 'RESOLVE', interaction.user.id, `Incident resolved: ${resolveComment || 'No comment provided'}`);
                        await auditChannel.send({ embeds: [auditEmbed] });
                    }

                    // Update overview message
                    await updateOverviewMessage(client);
                    
                    // Update bot status
                    await updateBotStatus(client);

                    await interaction.reply({
                        content: `✅ Incident **${incidentId}** has been resolved!`,
                        ephemeral: true
                    });
                } else {
                    await interaction.reply({
                        content: '❌ Failed to resolve incident. It may not exist.',
                        ephemeral: true
                    });
                }
            }

        } catch (error) {
            console.error('Error handling modal interaction:', error);
            await interaction.reply({ 
                content: 'An error occurred while processing your request.', 
                ephemeral: true 
            }).catch(console.error);
        }
    },

    // Update overview message
    async updateOverviewMessage(client) {
        const overviewChannel = client.channels.cache.get(CONFIG.INCIDENT_CHANNEL_ID);
        if (!overviewChannel) return;

        const embed = EmbedManager.createOverviewEmbed();
        
        if (overviewMessageId) {
            try {
                const message = await overviewChannel.messages.fetch(overviewMessageId);
                await message.edit({ embeds: [embed] });
            } catch (error) {
                // Message might not exist, create a new one
                const newMessage = await overviewChannel.send({ embeds: [embed] });
                overviewMessageId = newMessage.id;
            }
        } else {
            const newMessage = await overviewChannel.send({ embeds: [embed] });
            overviewMessageId = newMessage.id;
        }
    }
};
