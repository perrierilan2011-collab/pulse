require("dotenv").config();

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  ModalBuilder
} = require("discord.js");

const DATA_DIR = path.join(__dirname, "data");
const STORE_PATH = path.join(DATA_DIR, "store.json");
const TRANSCRIPT_DIR = path.join(DATA_DIR, "transcripts");
const DASHBOARD_HTML = path.join(__dirname, "dashboard.html");
const DISCORD_API_BASE = "https://discord.com/api/v10";
const MANAGE_GUILD_PERMISSION = 0x20n;
const ADMINISTRATOR_PERMISSION = 0x8n;
const dashboardSessions = new Map();

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(TRANSCRIPT_DIR, { recursive: true });

const DEFAULT_TEXTS = {
  panel_ticket_title: "Support",
  panel_ticket_description: "Clique sur le bouton pour ouvrir un ticket.",
  panel_ticket_footer: "Systeme de tickets",
  panel_ticket_button: "Ouvrir un ticket",
  panel_application_title: "Candidature",
  panel_application_description: "Clique sur le bouton pour postuler.",
  panel_application_footer: "Systeme de candidatures",
  panel_application_button: "Postuler",
  modal_ticket_title: "Ouvrir un ticket",
  modal_application_title: "Candidature",
  ticket_open_title: "Nouveau ticket",
  application_open_title: "Nouvelle candidature",
  ticket_open_content: "{user} {staff}",
  ticket_open_description: "{user} a ouvert ce salon.\n\n{answers}",
  ticket_status_field: "Statut",
  ticket_status_open: "Ouvert",
  ticket_priority_field: "Priorite",
  ticket_priority_normal: "normal",
  button_claim: "Claim",
  button_claimed: "Pris",
  button_transcript: "Transcript",
  button_close: "Fermer",
  reply_config_saved: "Configuration sauvegardee.",
  reply_panel_sent: "Panneau envoye dans {channel}.",
  reply_panel_replaced: "Ancien panneau remplace, nouveau panneau envoye dans {channel}.",
  reply_ticket_created: "C'est cree: {channel}",
  reply_not_ticket: "Cette commande doit etre utilisee dans un ticket.",
  reply_staff_only: "Commande reservee au staff.",
  reply_no_permission_close: "Tu n'as pas la permission de fermer ce ticket.",
  reply_ticket_unknown: "Ce salon n'est pas un ticket connu.",
  reply_transcript_created: "Transcript cree.",
  reply_close_wait: "Transcript cree. Le salon sera supprime dans 5 secondes.",
  reply_member_added: "{user} ajoute au ticket.",
  reply_member_removed: "{user} retire du ticket.",
  reply_ticket_renamed: "Ticket renomme en {name}.",
  reply_ticket_claimed: "Ticket pris en charge par {user}.",
  reply_ticket_unclaimed: "Ticket libere.",
  reply_priority_changed: "Priorite changee: {priority}.",
  reply_ticket_locked: "Ticket verrouille.",
  reply_ticket_unlocked: "Ticket deverrouille.",
  log_ticket_open_title: "Ticket ouvert",
  log_ticket_open_description: "{user} a ouvert {channel}",
  log_ticket_close_title: "Ticket ferme",
  log_ticket_close_description: "{channel} ferme par {user}\nRaison: {reason}",
  application_accept_title: "Candidature acceptee",
  application_reject_title: "Candidature refusee",
  autoresponder_added: "Auto-reponse ajoutee pour: {trigger}",
  autoresponder_removed: "Auto-reponse supprimee pour: {trigger}",
  autoresponder_empty: "Aucune auto-reponse configuree.",
  config_title: "Configuration",
  config_staff_role: "Role staff",
  config_category: "Categorie",
  config_logs: "Logs",
  config_transcripts: "Transcripts",
  config_language: "Langue",
  config_color: "Couleur",
  config_not_set: "Non configure"
};

const DEFAULT_QUESTIONS = ["Pseudo ?", "Explique ton probleme", "Preuve ?"];
const SELECT_OPTIONS_PER_MENU = 25;
const COMPONENT_ROWS_PER_MESSAGE = 5;

function loadStore() {
  if (!fs.existsSync(STORE_PATH)) {
    return { guilds: {}, tickets: {}, panels: {}, autoresponders: {}, stats: {} };
  }
  const data = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
  data.guilds ||= {};
  data.tickets ||= {};
  data.panels ||= {};
  data.autoresponders ||= {};
  data.stats ||= {};
  return data;
}

const store = loadStore();

function saveStore() {
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

function guildConfig(guildId) {
  if (!store.guilds[guildId]) {
    store.guilds[guildId] = {
      staffRoleId: "",
      categoryId: "",
      logChannelId: "",
      transcriptChannelId: "",
      language: "fr",
      color: "#5865F2",
      counter: 0,
      defaultQuestions: DEFAULT_QUESTIONS,
      texts: {}
    };
    saveStore();
  }
  const config = store.guilds[guildId];
  config.texts ||= {};
  config.defaultQuestions ||= DEFAULT_QUESTIONS;
  return config;
}

function guildStats(guildId) {
  store.stats ||= {};
  if (!store.stats[guildId]) {
    store.stats[guildId] = {
      messages: 0,
      messagesByChannel: {},
      firstTrackedAt: new Date().toISOString(),
      lastMessageAt: ""
    };
  }
  const stats = store.stats[guildId];
  stats.messagesByChannel ||= {};
  stats.messages ||= 0;
  return stats;
}

function recordGuildMessage(message) {
  const stats = guildStats(message.guildId);
  stats.messages += 1;
  stats.messagesByChannel[message.channelId] = (stats.messagesByChannel[message.channelId] || 0) + 1;
  stats.lastMessageAt = new Date().toISOString();
  saveStore();
}

function text(guildId, key, vars = {}) {
  const config = guildConfig(guildId);
  let value = config.texts[key] || DEFAULT_TEXTS[key] || key;
  for (const [name, replacement] of Object.entries(vars)) {
    value = value.replaceAll(`{${name}}`, String(replacement ?? ""));
  }
  return value;
}

function allTexts(guildId) {
  const config = guildConfig(guildId);
  return { ...DEFAULT_TEXTS, ...config.texts };
}

function colorOf(config) {
  return /^#[0-9a-f]{6}$/i.test(config.color) ? config.color : "#5865F2";
}

function parseQuestions(raw, guildId) {
  if (!raw) return guildConfig(guildId).defaultQuestions;
  const questions = raw.split("|").map((item) => item.trim()).filter(Boolean).slice(0, 5);
  return questions.length ? questions : guildConfig(guildId).defaultQuestions;
}

function normalizeEmoji(value) {
  if (!value) return "";
  const trimmed = value.trim();
  if (/^<a?:\w+:\d+>$/.test(trimmed)) return trimmed;
  if (/^[\x00-\x7F]+$/.test(trimmed)) return "";
  return Array.from(trimmed)[0] || "";
}

function parseSelectOptions(raw) {
  if (!raw) return [];
  return raw
    .split(/[|\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item, index) => {
      let emoji = "";
      let label = item;
      const slashMatch = item.match(/^(.+?)\s*\/\s*(\S+)$/);
      const colonMatch = item.match(/^(\S+)\s*:\s*(.+)$/);
      const spaceMatch = item.match(/^(\S+)\s+(.+)$/);

      if (slashMatch) {
        label = slashMatch[1].trim();
        emoji = normalizeEmoji(slashMatch[2]);
      } else if (colonMatch && normalizeEmoji(colonMatch[1])) {
        emoji = normalizeEmoji(colonMatch[1]);
        label = colonMatch[2].trim();
      } else if (spaceMatch && normalizeEmoji(spaceMatch[1])) {
        emoji = normalizeEmoji(spaceMatch[1]);
        label = spaceMatch[2].trim();
      }

      return {
        id: String(index + 1),
        label: (label || `Choix ${index + 1}`).slice(0, 100),
        emoji
      };
    });
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function cleanName(value) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24) || "ticket";
}

function isStaff(member, config) {
  return Boolean(
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    (config.staffRoleId && member.roles.cache.has(config.staffRoleId))
  );
}

function isTicketStaff(member, config, ticket) {
  return Boolean(
    isStaff(member, config) ||
    (ticket?.staffRoleId && member.roles.cache.has(ticket.staffRoleId))
  );
}

function answerText(answers) {
  if (!answers?.length) return "Aucune reponse.";
  return answers.map((item, index) => `**${index + 1}. ${item.question}**\n${item.answer}`).join("\n\n");
}

function panelButton(guildId, panel) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`panel:${panel.id}`)
      .setStyle(panel.type === "application" ? ButtonStyle.Success : ButtonStyle.Primary)
      .setLabel(panel.buttonLabel)
  );
}

function panelComponents(guildId, panel, page = 0) {
  if (panel.selectOptions?.length) {
    const menuChunks = chunkArray(panel.selectOptions, SELECT_OPTIONS_PER_MENU);
    const firstMenuIndex = page * COMPONENT_ROWS_PER_MESSAGE;
    return menuChunks
      .slice(firstMenuIndex, firstMenuIndex + COMPONENT_ROWS_PER_MESSAGE)
      .map((options, index) => {
        const menuIndex = firstMenuIndex + index;
        const menu = new StringSelectMenuBuilder()
          .setCustomId(`panel_select:${panel.id}:${menuIndex}`)
          .setPlaceholder(panel.buttonLabel || text(guildId, panel.type === "application" ? "panel_application_button" : "panel_ticket_button"))
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(options.map((option) => {
          const built = new StringSelectMenuOptionBuilder()
            .setLabel(option.label)
            .setValue(option.id);
          if (option.emoji) built.setEmoji(option.emoji);
          return built;
        }));
        return new ActionRowBuilder().addComponents(menu);
      });
  }

  return [panelButton(guildId, panel)];
}

function ticketButtons(guildId, ticket) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket:claim")
      .setStyle(ButtonStyle.Secondary)
      .setLabel(ticket.claimedBy ? text(guildId, "button_claimed") : text(guildId, "button_claim"))
      .setDisabled(Boolean(ticket.claimedBy)),
    new ButtonBuilder()
      .setCustomId("ticket:transcript")
      .setStyle(ButtonStyle.Secondary)
      .setLabel(text(guildId, "button_transcript")),
    new ButtonBuilder()
      .setCustomId("ticket:close")
      .setStyle(ButtonStyle.Danger)
      .setLabel(text(guildId, "button_close"))
  );
}

function panelFromOptions(interaction, type) {
  const titleKey = type === "application" ? "panel_application_title" : "panel_ticket_title";
  const descriptionKey = type === "application" ? "panel_application_description" : "panel_ticket_description";
  const footerKey = type === "application" ? "panel_application_footer" : "panel_ticket_footer";
  const buttonKey = type === "application" ? "panel_application_button" : "panel_ticket_button";
  return {
    id: Math.random().toString(36).slice(2, 10),
    guildId: interaction.guildId,
    type,
    channelId: interaction.options.getChannel("salon").id,
    title: interaction.options.getString("titre") || text(interaction.guildId, titleKey),
    description: interaction.options.getString("description") || text(interaction.guildId, descriptionKey),
    footer: text(interaction.guildId, footerKey),
    buttonLabel: text(interaction.guildId, buttonKey),
    questions: parseQuestions(interaction.options.getString("questions"), interaction.guildId),
    selectOptions: parseSelectOptions(interaction.options.getString("choix")),
    categoryId: interaction.options.getChannel("categorie")?.id || "",
    staffRoleId: interaction.options.getRole("role_accepte")?.id || "",
    messageId: ""
  };
}

async function sendOrReplacePanel(guild, channel, panel, replace = true) {
  const config = guildConfig(guild.id);
  const oldPanels = Object.values(store.panels).filter(
    (item) => item.guildId === guild.id && item.channelId === channel.id
  );

  if (replace) {
    const deletedMessageIds = new Set();
    for (const oldPanel of oldPanels) {
      const oldMessageIds = oldPanel.messageIds?.length ? oldPanel.messageIds : [oldPanel.messageId].filter(Boolean);
      for (const messageId of oldMessageIds) {
        const oldMessage = await channel.messages.fetch(messageId).catch(() => null);
        if (oldMessage) {
          await oldMessage.delete().catch(() => {});
          deletedMessageIds.add(oldMessage.id);
        }
      }
      delete store.panels[oldPanel.id];
    }

    const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    if (messages) {
      for (const message of messages.values()) {
        if (deletedMessageIds.has(message.id) || message.author.id !== client.user.id) continue;
        const hasPanelComponent = message.components.some((row) =>
          row.components.some((component) => component.customId?.startsWith("panel:") || component.customId?.startsWith("panel_select:"))
        );
        if (hasPanelComponent) await message.delete().catch(() => {});
      }
    }
  }

  const componentPages = panel.selectOptions?.length
    ? Math.ceil(chunkArray(panel.selectOptions, SELECT_OPTIONS_PER_MENU).length / COMPONENT_ROWS_PER_MESSAGE)
    : 1;
  const sentMessages = [];

  const message = await channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(colorOf(config))
        .setTitle(panel.title)
        .setDescription(panel.description)
        .setFooter({ text: panel.footer })
    ],
    components: panelComponents(guild.id, panel, 0)
  });
  sentMessages.push(message.id);

  for (let page = 1; page < componentPages; page += 1) {
    const extraMessage = await channel.send({
      content: panel.buttonLabel,
      components: panelComponents(guild.id, panel, page)
    });
    sentMessages.push(extraMessage.id);
  }

  panel.messageId = message.id;
  panel.messageIds = sentMessages;
  store.panels[panel.id] = panel;
  saveStore();
  return oldPanels.length > 0;
}

async function cleanPanelMessages(channel, guildId) {
  const messages = await channel.messages.fetch({ limit: 100 });
  let deleted = 0;
  for (const message of messages.values()) {
    if (message.author.id !== client.user.id) continue;
    const hasPanelButton = message.components.some((row) =>
      row.components.some((component) => component.customId?.startsWith("panel:") || component.customId?.startsWith("panel_select:"))
    );
    const looksLikePanel = hasPanelButton || message.embeds.some((embed) =>
      [
        text(guildId, "panel_ticket_title"),
        text(guildId, "panel_application_title"),
        "Support",
        "Candidature"
      ].includes(embed.title || "")
    );
    if (looksLikePanel) {
      await message.delete().catch(() => {});
      deleted += 1;
    }
  }

  for (const panel of Object.values(store.panels)) {
    if (panel.guildId === guildId && panel.channelId === channel.id) delete store.panels[panel.id];
  }
  saveStore();
  return deleted;
}

async function logEvent(guild, config, embed, files = []) {
  const channelId = config.logChannelId || config.transcriptChannelId;
  if (!channelId) return;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (channel?.isTextBased()) await channel.send({ embeds: [embed], files }).catch(() => {});
}

async function createTicket(interaction, panel, answers = [], selectedOption = null) {
  const config = guildConfig(interaction.guildId);
  const botMember = interaction.guild.members.me || await interaction.guild.members.fetchMe().catch(() => null);
  if (!botMember?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    throw new Error("Le bot n'a pas la permission Manage Channels pour creer le salon du ticket.");
  }

  const parentId = panel.categoryId || config.categoryId || "";
  if (parentId) {
    const parent = await interaction.guild.channels.fetch(parentId).catch(() => null);
    if (!parent || parent.type !== ChannelType.GuildCategory) {
      throw new Error("La categorie configuree pour ce panneau est introuvable ou invalide.");
    }
  }

  config.counter += 1;
  saveStore();

  const member = interaction.member;
  const user = interaction.user;
  const namePrefix = panel.type === "application" ? "candidature" : "ticket";
  const channelName = `${namePrefix}-${String(config.counter).padStart(4, "0")}-${cleanName(user.username)}`;

  const overwrites = [
    { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks
      ]
    },
    {
      id: client.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks
      ]
    }
  ];

  const staffRoleId = panel.staffRoleId || config.staffRoleId;
  if (staffRoleId) {
    overwrites.push({
      id: staffRoleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks
      ]
    });
  }

  const channel = await interaction.guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: parentId || null,
    permissionOverwrites: overwrites,
    topic: `${namePrefix} de ${user.tag} (${user.id})`
  });

  const ticket = {
    guildId: interaction.guildId,
    channelId: channel.id,
    userId: user.id,
    type: panel.type,
    panelTitle: panel.title,
    status: "open",
    priority: text(interaction.guildId, "ticket_priority_normal"),
    claimedBy: "",
    staffRoleId,
    openedAt: new Date().toISOString(),
    selectedOption,
    answers
  };
  store.tickets[channel.id] = ticket;
  saveStore();

  const staffMention = staffRoleId ? `<@&${staffRoleId}>` : "";
  const titleKey = panel.type === "application" ? "application_open_title" : "ticket_open_title";
  const fields = [
    { name: text(interaction.guildId, "ticket_status_field"), value: text(interaction.guildId, "ticket_status_open"), inline: true },
    { name: text(interaction.guildId, "ticket_priority_field"), value: ticket.priority, inline: true }
  ];
  if (selectedOption?.label) fields.unshift({ name: "Choix", value: selectedOption.label.slice(0, 1024), inline: true });

  await channel.send({
    content: text(interaction.guildId, "ticket_open_content", { user, staff: staffMention }).trim(),
    embeds: [
      new EmbedBuilder()
        .setColor(colorOf(config))
        .setTitle(text(interaction.guildId, titleKey))
        .setDescription(text(interaction.guildId, "ticket_open_description", { user, answers: answerText(answers) }))
        .addFields(fields)
        .setTimestamp()
    ],
    components: [ticketButtons(interaction.guildId, ticket)]
  });

  await logEvent(
    interaction.guild,
    config,
    new EmbedBuilder()
      .setColor(colorOf(config))
      .setTitle(text(interaction.guildId, "log_ticket_open_title"))
      .setDescription(text(interaction.guildId, "log_ticket_open_description", { user, channel }))
      .setTimestamp()
  );

  return channel;
}

async function fetchMessages(channel, limit = 1000) {
  const messages = [];
  let before;
  while (messages.length < limit) {
    const batch = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!batch?.size) break;
    messages.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }
  return messages.reverse();
}

async function makeTranscript(channel, ticket) {
  const messages = await fetchMessages(channel);
  const lines = [
    `Transcript: #${channel.name}`,
    `Type: ${ticket?.type || "ticket"}`,
    `Ouvert par: ${ticket?.userId || "inconnu"}`,
    `Date: ${new Date().toISOString()}`,
    ""
  ];

  for (const message of messages) {
    const files = message.attachments.map((attachment) => attachment.url).join(" ");
    lines.push(`[${message.createdAt.toISOString()}] ${message.author.tag}: ${message.content || ""}${files ? ` ${files}` : ""}`);
  }

  const filePath = path.join(TRANSCRIPT_DIR, `${channel.id}-${Date.now()}.txt`);
  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
  return filePath;
}

async function closeTicket(interaction, reason = "Aucune raison indiquee") {
  const ticket = store.tickets[interaction.channelId];
  const config = guildConfig(interaction.guildId);

  if (!ticket) {
    await interaction.reply({ content: text(interaction.guildId, "reply_ticket_unknown"), ephemeral: true });
    return;
  }
  if (interaction.user.id !== ticket.userId && !isTicketStaff(interaction.member, config, ticket)) {
    await interaction.reply({ content: text(interaction.guildId, "reply_no_permission_close"), ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const transcript = await makeTranscript(interaction.channel, ticket);
  const attachment = new AttachmentBuilder(transcript);
  ticket.status = "closed";
  ticket.closedAt = new Date().toISOString();
  ticket.closedBy = interaction.user.id;
  ticket.closeReason = reason;
  saveStore();

  await logEvent(
    interaction.guild,
    config,
    new EmbedBuilder()
      .setColor(colorOf(config))
      .setTitle(text(interaction.guildId, "log_ticket_close_title"))
      .setDescription(text(interaction.guildId, "log_ticket_close_description", { channel: interaction.channel, user: interaction.user, reason }))
      .setTimestamp(),
    [attachment]
  );

  await interaction.editReply(text(interaction.guildId, "reply_close_wait"));
  setTimeout(() => interaction.channel.delete(`Ticket ferme: ${reason}`).catch(() => {}), 5000);
}

function buildCommands() {
  return [
    new SlashCommandBuilder()
      .setName("setup")
      .setDescription("Configure le bot")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addRoleOption((option) => option.setName("role_staff").setDescription("Role staff"))
      .addChannelOption((option) => option.setName("categorie").setDescription("Categorie tickets").addChannelTypes(ChannelType.GuildCategory))
      .addChannelOption((option) => option.setName("salon_logs").setDescription("Salon logs").addChannelTypes(ChannelType.GuildText))
      .addChannelOption((option) => option.setName("salon_transcripts").setDescription("Salon transcripts").addChannelTypes(ChannelType.GuildText))
      .addStringOption((option) => option.setName("couleur").setDescription("Couleur, exemple #5865F2")),

    new SlashCommandBuilder()
      .setName("panel")
      .setDescription("Envoie un panneau ticket/candidature")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand((sub) =>
        sub
          .setName("ticket")
          .setDescription("Panneau ticket")
          .addChannelOption((option) => option.setName("salon").setDescription("Salon du panneau").addChannelTypes(ChannelType.GuildText).setRequired(true))
          .addChannelOption((option) => option.setName("categorie").setDescription("Categorie ou les tickets de ce panneau s'ouvrent").addChannelTypes(ChannelType.GuildCategory))
          .addRoleOption((option) => option.setName("role_accepte").setDescription("Role qui peut voir les tickets de ce panneau"))
          .addStringOption((option) => option.setName("titre").setDescription("Titre"))
          .addStringOption((option) => option.setName("description").setDescription("Description"))
          .addStringOption((option) => option.setName("questions").setDescription("Questions separees par |"))
          .addStringOption((option) => option.setName("choix").setDescription("Menu: Texte / emoji | Texte / emoji"))
          .addBooleanOption((option) => option.setName("remplacer").setDescription("Remplacer l'ancien panneau dans ce salon"))
      )
      .addSubcommand((sub) =>
        sub
          .setName("candidature")
          .setDescription("Panneau candidature")
          .addChannelOption((option) => option.setName("salon").setDescription("Salon du panneau").addChannelTypes(ChannelType.GuildText).setRequired(true))
          .addChannelOption((option) => option.setName("categorie").setDescription("Categorie ou les candidatures de ce panneau s'ouvrent").addChannelTypes(ChannelType.GuildCategory))
          .addRoleOption((option) => option.setName("role_accepte").setDescription("Role qui peut voir les candidatures de ce panneau"))
          .addStringOption((option) => option.setName("titre").setDescription("Titre"))
          .addStringOption((option) => option.setName("description").setDescription("Description"))
          .addStringOption((option) => option.setName("questions").setDescription("Questions separees par |"))
          .addStringOption((option) => option.setName("choix").setDescription("Menu: Texte / emoji | Texte / emoji"))
          .addBooleanOption((option) => option.setName("remplacer").setDescription("Remplacer l'ancien panneau dans ce salon"))
      )
      .addSubcommand((sub) =>
        sub
          .setName("nettoyer")
          .setDescription("Supprime les anciens panneaux du bot dans un salon")
          .addChannelOption((option) => option.setName("salon").setDescription("Salon a nettoyer").addChannelTypes(ChannelType.GuildText).setRequired(true))
      ),

    new SlashCommandBuilder()
      .setName("text")
      .setDescription("Modifie les textes du bot")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand((sub) =>
        sub
          .setName("set")
          .setDescription("Change un texte")
          .addStringOption((option) => option.setName("cle").setDescription("Cle du texte").setRequired(true))
          .addStringOption((option) => option.setName("valeur").setDescription("Nouveau texte").setRequired(true))
      )
      .addSubcommand((sub) =>
        sub
          .setName("reset")
          .setDescription("Remet un texte par defaut")
          .addStringOption((option) => option.setName("cle").setDescription("Cle du texte").setRequired(true))
      )
      .addSubcommand((sub) => sub.setName("list").setDescription("Liste les cles de textes")),

    new SlashCommandBuilder()
      .setName("ticket")
      .setDescription("Gere le ticket actuel")
      .addSubcommand((sub) => sub.setName("close").setDescription("Ferme le ticket").addStringOption((option) => option.setName("raison").setDescription("Raison")))
      .addSubcommand((sub) => sub.setName("add").setDescription("Ajoute un membre").addUserOption((option) => option.setName("membre").setDescription("Membre").setRequired(true)))
      .addSubcommand((sub) => sub.setName("remove").setDescription("Retire un membre").addUserOption((option) => option.setName("membre").setDescription("Membre").setRequired(true)))
      .addSubcommand((sub) => sub.setName("rename").setDescription("Renomme le ticket").addStringOption((option) => option.setName("nom").setDescription("Nom").setRequired(true)))
      .addSubcommand((sub) => sub.setName("claim").setDescription("Prend en charge"))
      .addSubcommand((sub) => sub.setName("unclaim").setDescription("Libere"))
      .addSubcommand((sub) => sub.setName("transcript").setDescription("Cree un transcript"))
      .addSubcommand((sub) => sub.setName("priority").setDescription("Change la priorite").addStringOption((option) => option.setName("niveau").setDescription("Niveau").setRequired(true)))
      .addSubcommand((sub) => sub.setName("lock").setDescription("Verrouille"))
      .addSubcommand((sub) => sub.setName("unlock").setDescription("Deverrouille")),

    new SlashCommandBuilder()
      .setName("application")
      .setDescription("Gere une candidature")
      .addSubcommand((sub) => sub.setName("accept").setDescription("Accepte").addStringOption((option) => option.setName("note").setDescription("Note")))
      .addSubcommand((sub) => sub.setName("reject").setDescription("Refuse").addStringOption((option) => option.setName("note").setDescription("Note"))),

    new SlashCommandBuilder()
      .setName("autoresponder")
      .setDescription("Reponses automatiques")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand((sub) => sub.setName("add").setDescription("Ajoute").addStringOption((option) => option.setName("declencheur").setDescription("Mot").setRequired(true)).addStringOption((option) => option.setName("reponse").setDescription("Reponse").setRequired(true)))
      .addSubcommand((sub) => sub.setName("remove").setDescription("Supprime").addStringOption((option) => option.setName("declencheur").setDescription("Mot").setRequired(true)))
      .addSubcommand((sub) => sub.setName("list").setDescription("Liste")),

    new SlashCommandBuilder()
      .setName("config")
      .setDescription("Affiche la configuration")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  ].map((command) => command.toJSON());
}

async function registerCommands() {
  if (!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID) {
    console.log("DISCORD_TOKEN ou CLIENT_ID manquant dans .env");
    return;
  }

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  const body = buildCommands();

  try {
    if (process.env.GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body });
      console.log("Commandes serveur enregistrees.");
    } else {
      await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body });
      console.log("Commandes globales enregistrees.");
    }
  } catch (error) {
    console.error("Erreur commandes:", error.rawError || error.message);
    console.log("Si tu vois Missing Access: reinvite le bot avec les scopes bot + applications.commands, ou verifie GUILD_ID.");
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once("clientReady", async () => {
  console.log(`Connecte: ${client.user.tag}`);
  await registerCommands();
  startDashboard();
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) await handleCommand(interaction);
    else if (interaction.isButton()) await handleButton(interaction);
    else if (interaction.isStringSelectMenu()) await handleSelectMenu(interaction);
    else if (interaction.isModalSubmit()) await handleModal(interaction);
  } catch (error) {
    console.error(error);
    const response = { content: "Une erreur est arrivee. Regarde la console du bot.", ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.followUp(response).catch(() => {});
    else await interaction.reply(response).catch(() => {});
  }
});

client.on("messageCreate", async (message) => {
  if (!message.guild) return;
  if (!message.author.bot) recordGuildMessage(message);
  if (message.author.bot) return;
  const items = store.autoresponders[message.guildId] || [];
  const lower = message.content.toLowerCase();
  const found = items.find((item) => lower.includes(item.trigger.toLowerCase()));
  if (found) await message.reply(found.response).catch(() => {});
});

async function handleCommand(interaction) {
  const config = guildConfig(interaction.guildId);

  if (interaction.commandName === "setup") {
    const role = interaction.options.getRole("role_staff");
    const category = interaction.options.getChannel("categorie");
    const logs = interaction.options.getChannel("salon_logs");
    const transcripts = interaction.options.getChannel("salon_transcripts");
    const color = interaction.options.getString("couleur");
    if (role) config.staffRoleId = role.id;
    if (category) config.categoryId = category.id;
    if (logs) config.logChannelId = logs.id;
    if (transcripts) config.transcriptChannelId = transcripts.id;
    if (color) config.color = color;
    saveStore();
    await interaction.reply({ content: text(interaction.guildId, "reply_config_saved"), ephemeral: true });
    return;
  }

  if (interaction.commandName === "panel") {
    const sub = interaction.options.getSubcommand();
    const channel = interaction.options.getChannel("salon");
    if (sub === "nettoyer") {
      const deleted = await cleanPanelMessages(channel, interaction.guildId);
      await interaction.reply({ content: `${deleted} panneau(x) supprime(s) dans ${channel}.`, ephemeral: true });
      return;
    }
    const replace = interaction.options.getBoolean("remplacer") ?? true;
    const panel = panelFromOptions(interaction, sub === "candidature" ? "application" : "ticket");
    const replaced = await sendOrReplacePanel(interaction.guild, channel, panel, replace);
    const key = replaced && replace ? "reply_panel_replaced" : "reply_panel_sent";
    await interaction.reply({ content: text(interaction.guildId, key, { channel }), ephemeral: true });
    return;
  }

  if (interaction.commandName === "text") {
    await handleTextCommand(interaction);
    return;
  }

  if (interaction.commandName === "ticket") {
    await handleTicketCommand(interaction, config);
    return;
  }

  if (interaction.commandName === "application") {
    await handleApplicationCommand(interaction, config);
    return;
  }

  if (interaction.commandName === "autoresponder") {
    await handleAutoresponderCommand(interaction);
    return;
  }

  if (interaction.commandName === "config") {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(colorOf(config))
          .setTitle(text(interaction.guildId, "config_title"))
          .addFields(
            { name: text(interaction.guildId, "config_staff_role"), value: config.staffRoleId ? `<@&${config.staffRoleId}>` : text(interaction.guildId, "config_not_set"), inline: true },
            { name: text(interaction.guildId, "config_category"), value: config.categoryId ? `<#${config.categoryId}>` : text(interaction.guildId, "config_not_set"), inline: true },
            { name: text(interaction.guildId, "config_logs"), value: config.logChannelId ? `<#${config.logChannelId}>` : text(interaction.guildId, "config_not_set"), inline: true },
            { name: text(interaction.guildId, "config_transcripts"), value: config.transcriptChannelId ? `<#${config.transcriptChannelId}>` : text(interaction.guildId, "config_not_set"), inline: true },
            { name: text(interaction.guildId, "config_color"), value: config.color, inline: true }
          )
      ],
      ephemeral: true
    });
  }
}

async function handleTextCommand(interaction) {
  const sub = interaction.options.getSubcommand();
  const config = guildConfig(interaction.guildId);

  if (sub === "set") {
    const key = interaction.options.getString("cle");
    const value = interaction.options.getString("valeur");
    if (!DEFAULT_TEXTS[key]) {
      await interaction.reply({ content: `Cle inconnue. Fais /text list pour voir les cles.`, ephemeral: true });
      return;
    }
    config.texts[key] = value;
    saveStore();
    await interaction.reply({ content: `Texte modifie: ${key}`, ephemeral: true });
    return;
  }

  if (sub === "reset") {
    const key = interaction.options.getString("cle");
    delete config.texts[key];
    saveStore();
    await interaction.reply({ content: `Texte remis par defaut: ${key}`, ephemeral: true });
    return;
  }

  const list = Object.keys(DEFAULT_TEXTS).map((key) => `\`${key}\``).join(", ");
  await interaction.reply({ content: list.slice(0, 1900), ephemeral: true });
}

async function handleTicketCommand(interaction, config) {
  const ticket = store.tickets[interaction.channelId];
  const sub = interaction.options.getSubcommand();
  if (!ticket) {
    await interaction.reply({ content: text(interaction.guildId, "reply_not_ticket"), ephemeral: true });
    return;
  }
  const staffOnly = ["add", "remove", "rename", "claim", "unclaim", "priority", "lock", "unlock"];
  if (staffOnly.includes(sub) && !isTicketStaff(interaction.member, config, ticket)) {
    await interaction.reply({ content: text(interaction.guildId, "reply_staff_only"), ephemeral: true });
    return;
  }

  if (sub === "close") {
    await closeTicket(interaction, interaction.options.getString("raison") || "Aucune raison indiquee");
    return;
  }
  if (sub === "add" || sub === "remove") {
    const user = interaction.options.getUser("membre");
    await interaction.channel.permissionOverwrites.edit(user.id, {
      ViewChannel: sub === "add",
      SendMessages: sub === "add",
      ReadMessageHistory: sub === "add"
    });
    const key = sub === "add" ? "reply_member_added" : "reply_member_removed";
    await interaction.reply({ content: text(interaction.guildId, key, { user }) });
    return;
  }
  if (sub === "rename") {
    const name = cleanName(interaction.options.getString("nom"));
    await interaction.channel.setName(name);
    await interaction.reply({ content: text(interaction.guildId, "reply_ticket_renamed", { name }) });
    return;
  }
  if (sub === "claim") {
    ticket.claimedBy = interaction.user.id;
    saveStore();
    await interaction.reply({ content: text(interaction.guildId, "reply_ticket_claimed", { user: interaction.user }) });
    return;
  }
  if (sub === "unclaim") {
    ticket.claimedBy = "";
    saveStore();
    await interaction.reply({ content: text(interaction.guildId, "reply_ticket_unclaimed") });
    return;
  }
  if (sub === "transcript") {
    await interaction.deferReply({ ephemeral: true });
    const transcript = await makeTranscript(interaction.channel, ticket);
    await interaction.editReply({ content: text(interaction.guildId, "reply_transcript_created"), files: [new AttachmentBuilder(transcript)] });
    return;
  }
  if (sub === "priority") {
    ticket.priority = interaction.options.getString("niveau");
    saveStore();
    await interaction.reply({ content: text(interaction.guildId, "reply_priority_changed", { priority: ticket.priority }) });
    return;
  }
  if (sub === "lock" || sub === "unlock") {
    await interaction.channel.permissionOverwrites.edit(ticket.userId, { SendMessages: sub === "unlock" });
    await interaction.reply({ content: text(interaction.guildId, sub === "lock" ? "reply_ticket_locked" : "reply_ticket_unlocked") });
  }
}

async function handleApplicationCommand(interaction, config) {
  const ticket = store.tickets[interaction.channelId];
  if (!ticket || ticket.type !== "application") {
    await interaction.reply({ content: "Cette commande doit etre utilisee dans une candidature.", ephemeral: true });
    return;
  }
  if (!isTicketStaff(interaction.member, config, ticket)) {
    await interaction.reply({ content: text(interaction.guildId, "reply_staff_only"), ephemeral: true });
    return;
  }
  const sub = interaction.options.getSubcommand();
  const note = interaction.options.getString("note") || "Aucune note.";
  ticket.applicationStatus = sub === "accept" ? "accepted" : "rejected";
  saveStore();
  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(sub === "accept" ? "#2ECC71" : "#E74C3C")
        .setTitle(text(interaction.guildId, sub === "accept" ? "application_accept_title" : "application_reject_title"))
        .setDescription(note)
        .setTimestamp()
    ]
  });
}

async function handleAutoresponderCommand(interaction) {
  const sub = interaction.options.getSubcommand();
  const list = store.autoresponders[interaction.guildId] || [];

  if (sub === "add") {
    const trigger = interaction.options.getString("declencheur");
    const response = interaction.options.getString("reponse");
    store.autoresponders[interaction.guildId] = list.filter((item) => item.trigger.toLowerCase() !== trigger.toLowerCase());
    store.autoresponders[interaction.guildId].push({ trigger, response });
    saveStore();
    await interaction.reply({ content: text(interaction.guildId, "autoresponder_added", { trigger }), ephemeral: true });
    return;
  }
  if (sub === "remove") {
    const trigger = interaction.options.getString("declencheur");
    store.autoresponders[interaction.guildId] = list.filter((item) => item.trigger.toLowerCase() !== trigger.toLowerCase());
    saveStore();
    await interaction.reply({ content: text(interaction.guildId, "autoresponder_removed", { trigger }), ephemeral: true });
    return;
  }
  await interaction.reply({
    content: list.length ? list.map((item) => `- ${item.trigger} -> ${item.response}`).join("\n") : text(interaction.guildId, "autoresponder_empty"),
    ephemeral: true
  });
}

function selectedPanelOption(panel, optionId) {
  if (!optionId) return null;
  return panel.selectOptions?.find((option) => option.id === optionId) || null;
}

async function openPanel(interaction, panel, optionId = "") {
  const questions = (panel.questions || []).slice(0, 5);
  if (!questions.length) {
    await interaction.deferReply({ ephemeral: true });
    try {
      const channel = await createTicket(interaction, panel, [], selectedPanelOption(panel, optionId));
      await interaction.editReply(text(interaction.guildId, "reply_ticket_created", { channel }));
    } catch (error) {
      await interaction.editReply(`Impossible de creer le ticket: ${error.message}`);
    }
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`modal:${panel.id}:${optionId}`)
    .setTitle(text(interaction.guildId, panel.type === "application" ? "modal_application_title" : "modal_ticket_title").slice(0, 45));

  questions.forEach((question, index) => {
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(`q${index}`)
          .setLabel(question.slice(0, 45))
          .setStyle(index === 0 ? TextInputStyle.Paragraph : TextInputStyle.Short)
          .setRequired(true)
      )
    );
  });
  await interaction.showModal(modal);
}

async function handleButton(interaction) {
  if (interaction.customId.startsWith("panel:")) {
    const panel = store.panels[interaction.customId.split(":")[1]];
    if (!panel) {
      await interaction.reply({ content: "Ce panneau n'existe plus.", ephemeral: true });
      return;
    }

    await openPanel(interaction, panel);
    return;
  }

  const ticket = store.tickets[interaction.channelId];
  const config = guildConfig(interaction.guildId);
  if (!ticket) {
    await interaction.reply({ content: text(interaction.guildId, "reply_ticket_unknown"), ephemeral: true });
    return;
  }
  if (interaction.customId === "ticket:claim") {
    if (!isTicketStaff(interaction.member, config, ticket)) {
      await interaction.reply({ content: text(interaction.guildId, "reply_staff_only"), ephemeral: true });
      return;
    }
    ticket.claimedBy = interaction.user.id;
    saveStore();
    await interaction.reply({ content: text(interaction.guildId, "reply_ticket_claimed", { user: interaction.user }) });
    return;
  }
  if (interaction.customId === "ticket:transcript") {
    await interaction.deferReply({ ephemeral: true });
    const transcript = await makeTranscript(interaction.channel, ticket);
    await interaction.editReply({ content: text(interaction.guildId, "reply_transcript_created"), files: [new AttachmentBuilder(transcript)] });
    return;
  }
  if (interaction.customId === "ticket:close") {
    await closeTicket(interaction, "Ferme via bouton");
  }
}

async function handleSelectMenu(interaction) {
  if (!interaction.customId.startsWith("panel_select:")) return;
  const panel = store.panels[interaction.customId.split(":")[1]];
  if (!panel) {
    await interaction.reply({ content: "Ce panneau n'existe plus.", ephemeral: true });
    return;
  }
  await openPanel(interaction, panel, interaction.values[0]);
}

async function handleModal(interaction) {
  const [, panelId, optionId = ""] = interaction.customId.split(":");
  const panel = store.panels[panelId];
  if (!panel) {
    await interaction.reply({ content: "Ce formulaire n'existe plus.", ephemeral: true });
    return;
  }
  const questions = (panel.questions || []).slice(0, 5);
  const answers = questions.map((question, index) => ({
    question,
    answer: interaction.fields.getTextInputValue(`q${index}`)
  }));
  await interaction.deferReply({ ephemeral: true });
  try {
    const channel = await createTicket(interaction, panel, answers, selectedPanelOption(panel, optionId));
    await interaction.editReply(text(interaction.guildId, "reply_ticket_created", { channel }));
  } catch (error) {
    await interaction.editReply(`Impossible de creer le ticket: ${error.message}`);
  }
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const index = item.indexOf("=");
        return index === -1 ? [item, ""] : [item.slice(0, index), decodeURIComponent(item.slice(index + 1))];
      })
  );
}

function dashboardRedirectUri(req) {
  return process.env.DASHBOARD_REDIRECT_URI || `${req.protocol}://${req.get("host")}/auth/callback`;
}

function canManageGuild(guild) {
  const permissions = BigInt(guild.permissions || "0");
  return Boolean((permissions & ADMINISTRATOR_PERMISSION) || (permissions & MANAGE_GUILD_PERMISSION));
}

function allowedOAuthGuilds(guilds) {
  const botGuildIds = new Set(client.guilds.cache.map((guild) => guild.id));
  return guilds
    .filter((guild) => botGuildIds.has(guild.id) && canManageGuild(guild))
    .map((guild) => ({ id: guild.id, name: guild.name, icon: guild.icon || "" }));
}

function dashboardInviteUrl() {
  if (!process.env.CLIENT_ID) return "";
  const params = new URLSearchParams({
    client_id: process.env.CLIENT_ID,
    scope: "bot applications.commands",
    permissions: String(
      PermissionFlagsBits.ManageChannels |
      PermissionFlagsBits.ManageMessages |
      PermissionFlagsBits.SendMessages |
      PermissionFlagsBits.ViewChannel |
      PermissionFlagsBits.ReadMessageHistory |
      PermissionFlagsBits.AttachFiles |
      PermissionFlagsBits.EmbedLinks
    )
  });
  return `https://discord.com/oauth2/authorize?${params}`;
}

function createDashboardSession(user, guilds) {
  const id = crypto.randomBytes(32).toString("hex");
  dashboardSessions.set(id, {
    user: {
      id: user.id,
      username: user.username,
      globalName: user.global_name || user.username,
      avatar: user.avatar || ""
    },
    guilds,
    createdAt: Date.now()
  });
  return id;
}

function dashboardAuth(req) {
  const expected = process.env.DASHBOARD_PASSWORD || "change-moi";
  const received = req.headers["x-dashboard-password"];
  if (received && received === expected) return { type: "password" };

  const sessionId = parseCookies(req).dashboard_session;
  const session = sessionId ? dashboardSessions.get(sessionId) : null;
  if (session) return { type: "discord", sessionId, session };
  return null;
}

function canAccessDashboardGuild(req, guildId) {
  if (req.dashboardAuth?.type === "password") return true;
  return Boolean(req.dashboardAuth?.session?.guilds?.some((guild) => guild.id === guildId));
}

function requireDashboardGuildAccess(req, res, next) {
  if (!canAccessDashboardGuild(req, req.params.guildId)) {
    res.status(403).json({ error: "Ton compte Discord n'a pas acces a ce serveur dans le dashboard." });
    return;
  }
  next();
}

function requireDashboardPassword(req, res, next) {
  const auth = dashboardAuth(req);
  if (auth) {
    req.dashboardAuth = auth;
    next();
    return;
  }

  res.status(401).json({
    error: "Connecte-toi avec Discord ou utilise le mot de passe dashboard.",
    loginUrl: "/auth/login"
  });
}

async function fetchDiscordOAuth(pathname, token) {
  const response = await fetch(`${DISCORD_API_BASE}${pathname}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error(`Erreur Discord API ${response.status}`);
  return response.json();
}

async function exchangeDiscordCode(req, code) {
  const params = new URLSearchParams({
    client_id: process.env.CLIENT_ID || "",
    client_secret: process.env.CLIENT_SECRET || "",
    grant_type: "authorization_code",
    code,
    redirect_uri: dashboardRedirectUri(req)
  });

  const response = await fetch(`${DISCORD_API_BASE}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error_description || data.error || "Connexion Discord refusee.");
  return data;
}

function publicConfig(guildId) {
  const config = guildConfig(guildId);
  return {
    ...config,
    texts: allTexts(guildId)
  };
}

function startDashboard() {
  const app = express();
  const port = Number(process.env.PORT || process.env.DASHBOARD_PORT || 3000);
  app.set("trust proxy", true);
  app.use(express.json({ limit: "1mb" }));

  app.get("/", (req, res) => res.sendFile(DASHBOARD_HTML));

  app.get("/auth/login", (req, res) => {
    if (!process.env.CLIENT_ID) {
      res.status(500).send("CLIENT_ID manque dans le fichier .env.");
      return;
    }
    if (!process.env.CLIENT_SECRET) {
      res.status(500).send("CLIENT_SECRET manque dans le fichier .env. Ajoute le secret OAuth2 du bot Discord puis redemarre.");
      return;
    }
    const params = new URLSearchParams({
      client_id: process.env.CLIENT_ID || "",
      redirect_uri: dashboardRedirectUri(req),
      response_type: "code",
      scope: "identify guilds",
      prompt: "consent"
    });
    res.redirect(`https://discord.com/oauth2/authorize?${params}`);
  });

  app.get("/auth/invite", (req, res) => {
    const inviteUrl = dashboardInviteUrl();
    if (!inviteUrl) {
      res.status(500).send("CLIENT_ID manque dans le fichier .env.");
      return;
    }
    res.redirect(inviteUrl);
  });

  app.get("/auth/callback", async (req, res) => {
    try {
      if (!req.query.code) {
        res.redirect("/auth/login");
        return;
      }
      const token = await exchangeDiscordCode(req, String(req.query.code));
      const [user, guilds] = await Promise.all([
        fetchDiscordOAuth("/users/@me", token.access_token),
        fetchDiscordOAuth("/users/@me/guilds", token.access_token)
      ]);
      const allowedGuilds = allowedOAuthGuilds(guilds);
      const sessionId = createDashboardSession(user, allowedGuilds);
      res.cookie("dashboard_session", sessionId, {
        httpOnly: true,
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000
      });
      res.redirect("/");
    } catch (error) {
      res.status(500).send(`Connexion Discord impossible: ${error.message}`);
    }
  });

  app.get("/auth/logout", (req, res) => {
    const sessionId = parseCookies(req).dashboard_session;
    if (sessionId) dashboardSessions.delete(sessionId);
    res.clearCookie("dashboard_session");
    res.redirect("/");
  });

  app.get("/api/me", (req, res) => {
    const auth = dashboardAuth(req);
    if (!auth) {
      res.json({
        authenticated: false,
        discordLoginAvailable: Boolean(process.env.CLIENT_SECRET),
        oauthConfigured: Boolean(process.env.CLIENT_ID && process.env.CLIENT_SECRET),
        clientIdConfigured: Boolean(process.env.CLIENT_ID),
        clientSecretConfigured: Boolean(process.env.CLIENT_SECRET),
        botGuildCount: client.guilds.cache.size,
        inviteUrl: dashboardInviteUrl(),
        loginUrl: "/auth/login"
      });
      return;
    }
    res.json({
      authenticated: true,
      type: auth.type,
      user: auth.session?.user || null,
      guilds: auth.type === "discord" ? auth.session.guilds : client.guilds.cache.map((guild) => ({ id: guild.id, name: guild.name })),
      inviteUrl: dashboardInviteUrl()
    });
  });

  app.get("/api/guilds", requireDashboardPassword, (req, res) => {
    if (req.dashboardAuth.type === "discord") {
      res.json({ guilds: req.dashboardAuth.session.guilds });
      return;
    }
    res.json({ guilds: client.guilds.cache.map((guild) => ({ id: guild.id, name: guild.name })) });
  });

  app.get("/api/config/:guildId", requireDashboardPassword, requireDashboardGuildAccess, (req, res) => {
    res.json({ config: publicConfig(req.params.guildId) });
  });

  app.get("/api/options/:guildId", requireDashboardPassword, requireDashboardGuildAccess, async (req, res) => {
    const guild = await client.guilds.fetch(req.params.guildId).catch(() => null);
    if (!guild) return res.status(404).json({ error: "Serveur introuvable." });
    const channels = await guild.channels.fetch().catch(() => null);
    const roles = await guild.roles.fetch().catch(() => null);
    if (!channels || !roles) return res.status(500).json({ error: "Impossible de charger les salons ou les roles." });

    const item = (value) => ({ id: value.id, name: value.name });
    res.json({
      textChannels: channels
        .filter((channel) => channel?.type === ChannelType.GuildText)
        .map(item)
        .sort((a, b) => a.name.localeCompare(b.name)),
      categories: channels
        .filter((channel) => channel?.type === ChannelType.GuildCategory)
        .map(item)
        .sort((a, b) => a.name.localeCompare(b.name)),
      roles: roles
        .filter((role) => role.name !== "@everyone")
        .map(item)
        .sort((a, b) => a.name.localeCompare(b.name))
    });
  });

  app.get("/api/stats/:guildId", requireDashboardPassword, requireDashboardGuildAccess, async (req, res) => {
    const guild = await client.guilds.fetch(req.params.guildId).catch(() => null);
    if (!guild) return res.status(404).json({ error: "Serveur introuvable." });

    const [channels, roles] = await Promise.all([
      guild.channels.fetch().catch(() => null),
      guild.roles.fetch().catch(() => null)
    ]);
    if (!channels || !roles) return res.status(500).json({ error: "Impossible de charger les statistiques." });

    const stats = guildStats(guild.id);
    const guildTickets = Object.values(store.tickets).filter((ticket) => ticket.guildId === guild.id);
    const openTickets = guildTickets.filter((ticket) => ticket.status !== "closed");
    const closedTickets = guildTickets.filter((ticket) => ticket.status === "closed");
    const guildPanels = Object.values(store.panels).filter((panel) => panel.guildId === guild.id);
    const textChannels = channels.filter((channel) => channel?.type === ChannelType.GuildText);
    const categories = channels.filter((channel) => channel?.type === ChannelType.GuildCategory);
    const voiceChannels = channels.filter((channel) => channel?.type === ChannelType.GuildVoice);
    const announcementChannels = channels.filter((channel) => channel?.type === ChannelType.GuildAnnouncement);
    const forumChannels = channels.filter((channel) => channel?.type === ChannelType.GuildForum);
    const channelName = (id) => channels.get(id)?.name || "salon supprime";
    const topChannels = Object.entries(stats.messagesByChannel || {})
      .map(([id, count]) => ({ id, name: channelName(id), messages: count }))
      .sort((a, b) => b.messages - a.messages)
      .slice(0, 5);
    const lastTickets = guildTickets
      .slice()
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
      .slice(0, 5)
      .map((ticket) => ({
        channelId: ticket.channelId,
        channelName: channelName(ticket.channelId),
        type: ticket.type || "ticket",
        status: ticket.status || "open",
        createdAt: ticket.createdAt || "",
        closedAt: ticket.closedAt || ""
      }));

    res.json({
      guild: {
        id: guild.id,
        name: guild.name,
        memberCount: guild.memberCount || 0,
        ownerId: guild.ownerId || "",
        createdAt: guild.createdAt?.toISOString?.() || ""
      },
      messages: {
        tracked: stats.messages || 0,
        firstTrackedAt: stats.firstTrackedAt || "",
        lastMessageAt: stats.lastMessageAt || "",
        topChannels
      },
      tickets: {
        total: guildTickets.length,
        open: openTickets.length,
        closed: closedTickets.length,
        last: lastTickets
      },
      channels: {
        total: channels.size,
        text: textChannels.size,
        categories: categories.size,
        voice: voiceChannels.size,
        announcements: announcementChannels.size,
        forums: forumChannels.size
      },
      roles: {
        total: roles.filter((role) => role.name !== "@everyone").size
      },
      panels: {
        active: guildPanels.length,
        ticket: guildPanels.filter((panel) => panel.type !== "application").length,
        application: guildPanels.filter((panel) => panel.type === "application").length
      },
      automations: {
        autoresponders: (store.autoresponders[guild.id] || []).length
      }
    });
  });

  app.post("/api/config/:guildId", requireDashboardPassword, requireDashboardGuildAccess, (req, res) => {
    const config = guildConfig(req.params.guildId);
    for (const key of ["staffRoleId", "categoryId", "logChannelId", "transcriptChannelId", "color"]) {
      if (typeof req.body[key] === "string") config[key] = req.body[key].trim();
    }
    if (typeof req.body.defaultQuestions === "string") {
      config.defaultQuestions = parseQuestions(req.body.defaultQuestions, req.params.guildId);
    }
    saveStore();
    res.json({ ok: true, config: publicConfig(req.params.guildId) });
  });

  app.post("/api/texts/:guildId", requireDashboardPassword, requireDashboardGuildAccess, (req, res) => {
    const config = guildConfig(req.params.guildId);
    for (const [key, value] of Object.entries(req.body.texts || {})) {
      if (DEFAULT_TEXTS[key] && typeof value === "string") config.texts[key] = value;
    }
    saveStore();
    res.json({ ok: true, config: publicConfig(req.params.guildId) });
  });

  app.post("/api/texts/:guildId/reset", requireDashboardPassword, requireDashboardGuildAccess, (req, res) => {
    guildConfig(req.params.guildId).texts = {};
    saveStore();
    res.json({ ok: true, config: publicConfig(req.params.guildId) });
  });

  app.post("/api/panel/:guildId", requireDashboardPassword, requireDashboardGuildAccess, async (req, res) => {
    const guild = await client.guilds.fetch(req.params.guildId).catch(() => null);
    if (!guild) return res.status(404).json({ error: "Serveur introuvable." });
    const channel = await guild.channels.fetch(req.body.channelId).catch(() => null);
    if (!channel?.isTextBased()) return res.status(404).json({ error: "Salon introuvable." });

    const type = req.body.type === "application" ? "application" : "ticket";
    const titleKey = type === "application" ? "panel_application_title" : "panel_ticket_title";
    const descriptionKey = type === "application" ? "panel_application_description" : "panel_ticket_description";
    const footerKey = type === "application" ? "panel_application_footer" : "panel_ticket_footer";
    const buttonKey = type === "application" ? "panel_application_button" : "panel_ticket_button";
    const panel = {
      id: Math.random().toString(36).slice(2, 10),
      guildId: guild.id,
      channelId: channel.id,
      type,
      title: req.body.title || text(guild.id, titleKey),
      description: req.body.description || text(guild.id, descriptionKey),
      footer: req.body.footer || text(guild.id, footerKey),
      buttonLabel: req.body.buttonLabel || text(guild.id, buttonKey),
      questions: parseQuestions(req.body.questions || "", guild.id),
      selectOptions: parseSelectOptions(req.body.choices || ""),
      categoryId: typeof req.body.categoryId === "string" ? req.body.categoryId.trim() : "",
      staffRoleId: typeof req.body.staffRoleId === "string" ? req.body.staffRoleId.trim() : "",
      messageId: ""
    };

    const replaced = await sendOrReplacePanel(guild, channel, panel, req.body.replace !== false);
    res.json({ ok: true, replaced });
  });

  app.post("/api/panel/:guildId/clean", requireDashboardPassword, requireDashboardGuildAccess, async (req, res) => {
    const guild = await client.guilds.fetch(req.params.guildId).catch(() => null);
    if (!guild) return res.status(404).json({ error: "Serveur introuvable." });
    const channel = await guild.channels.fetch(req.body.channelId).catch(() => null);
    if (!channel?.isTextBased()) return res.status(404).json({ error: "Salon introuvable." });
    const deleted = await cleanPanelMessages(channel, guild.id);
    res.json({ ok: true, deleted });
  });

  app.get("/api/autoresponders/:guildId", requireDashboardPassword, requireDashboardGuildAccess, (req, res) => {
    res.json({ items: store.autoresponders[req.params.guildId] || [] });
  });

  app.post("/api/autoresponders/:guildId", requireDashboardPassword, requireDashboardGuildAccess, (req, res) => {
    const trigger = String(req.body.trigger || "").trim();
    const response = String(req.body.response || "").trim();
    if (!trigger || !response) return res.status(400).json({ error: "Declencheur et reponse obligatoires." });
    const list = store.autoresponders[req.params.guildId] || [];
    store.autoresponders[req.params.guildId] = list.filter((item) => item.trigger.toLowerCase() !== trigger.toLowerCase());
    store.autoresponders[req.params.guildId].push({ trigger, response });
    saveStore();
    res.json({ ok: true, items: store.autoresponders[req.params.guildId] });
  });

  app.post("/api/autoresponders/:guildId/remove", requireDashboardPassword, requireDashboardGuildAccess, (req, res) => {
    const trigger = String(req.body.trigger || "").trim();
    const list = store.autoresponders[req.params.guildId] || [];
    store.autoresponders[req.params.guildId] = list.filter((item) => item.trigger.toLowerCase() !== trigger.toLowerCase());
    saveStore();
    res.json({ ok: true, items: store.autoresponders[req.params.guildId] });
  });

  app.listen(port, () => {
    console.log(`Dashboard: http://localhost:${port}`);
    console.log(`Mot de passe dashboard: ${process.env.DASHBOARD_PASSWORD || "change-moi"}`);
  });
}

client.login(process.env.DISCORD_TOKEN);
