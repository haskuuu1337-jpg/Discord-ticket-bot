require("dotenv").config();

const fs = require("fs");
const path = require("path");
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  Collection,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  ModalBuilder,
  PermissionsBitField,
  REST,
  Routes,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");

const ROOT = __dirname;
const CONFIG_PATH = path.join(ROOT, "config.json");
const INVITES_DB_PATH = path.join(ROOT, "db", "invites.json");
const JOINS_DB_PATH = path.join(ROOT, "db", "joins.json");
const PANELS_DB_PATH = path.join(ROOT, "db", "panels.json");
const BOOSTS_DB_PATH = path.join(ROOT, "db", "boosts.json");

function loadJson(filePath, fallback) {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2), "utf8");
      return JSON.parse(JSON.stringify(fallback));
    }

    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.error(`Błąd odczytu ${filePath}:`, error);
    return JSON.parse(JSON.stringify(fallback));
  }
}

function saveJson(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

let config = loadJson(CONFIG_PATH, {
  welcomeChannelId: "1488268659049627698",
  invitesChannelId: "1488268907553886218",
  calculatorChannelId: "1488271189766963241",
  boostChannelId: "1488269280142299246",
  fakeInviteHours: 24,
  defaultBannerUrl: "",
  welcomeMessageTemplate:
    "{member} został zaproszony przez {inviter}, który posiada teraz **{netInvites}** zaproszenie(a)! 🎉",
  boostMessageTemplate:
    "{member} właśnie zboostował serwer! Dziękujemy za wsparcie! 💜",
  currency: {
    buyRateKPer1zl: 7,
    sellRateZlPer100k: 7,
    paymentMethods: {
      "LTC": 0,
      "PSC z paragonem": 15,
      "PSC bez paragonu": 25,
      "BLIK (przelew)": 0,
      "Kod BLIK": 10,
      "PayPal": 10
    }
  }
});

let invitesDb = loadJson(INVITES_DB_PATH, { guilds: {} });
let joinsDb = loadJson(JOINS_DB_PATH, { members: {} });
let panelsDb = loadJson(PANELS_DB_PATH, {
  statsPanelMessageId: "",
  calculatorPanelMessageId: ""
});
let boostsDb = loadJson(BOOSTS_DB_PATH, { guilds: {} });

config.welcomeChannelId ||= "1488268659049627698";
config.invitesChannelId ||= "1488268907553886218";
config.calculatorChannelId ||= "1488271189766963241";
config.boostChannelId ||= "1488269280142299246";
config.fakeInviteHours ??= 24;
config.defaultBannerUrl ??= "";
config.welcomeMessageTemplate ||= "{member} został zaproszony przez {inviter}, który posiada teraz **{netInvites}** zaproszenie(a)! 🎉";
config.boostMessageTemplate ||= "{member} właśnie zboostował serwer! Dziękujemy za wsparcie! 💜";
config.currency ||= {};
config.currency.buyRateKPer1zl ??= 7;
config.currency.sellRateZlPer100k ??= 7;
config.currency.paymentMethods ||= {
  "LTC": 0,
  "PSC z paragonem": 15,
  "PSC bez paragonu": 25,
  "BLIK (przelew)": 0,
  "Kod BLIK": 10,
  "PayPal": 10
};

const tempCalcSessions = new Map();
const inviteCache = new Map();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites
  ]
});

function persistAll() {
  saveJson(CONFIG_PATH, config);
  saveJson(INVITES_DB_PATH, invitesDb);
  saveJson(JOINS_DB_PATH, joinsDb);
  saveJson(PANELS_DB_PATH, panelsDb);
  saveJson(BOOSTS_DB_PATH, boostsDb);
}

function ensureGuildStats(guildId) {
  if (!invitesDb.guilds[guildId]) {
    invitesDb.guilds[guildId] = { users: {} };
  }
  return invitesDb.guilds[guildId];
}

function ensureUserStats(guildId, userId) {
  const guild = ensureGuildStats(guildId);
  if (!guild.users[userId]) {
    guild.users[userId] = {
      joined: 0,
      left: 0,
      fake: 0,
      bonus: 0
    };
  }
  return guild.users[userId];
}

function ensureBoostGuild(guildId) {
  if (!boostsDb.guilds[guildId]) {
    boostsDb.guilds[guildId] = { users: {} };
  }
  return boostsDb.guilds[guildId];
}

function ensureBoostUser(guildId, userId) {
  const guild = ensureBoostGuild(guildId);
  if (!guild.users[userId]) {
    guild.users[userId] = {
      boosts: 0
    };
  }
  return guild.users[userId];
}

function getNetInvites(stats) {
  return stats.joined + stats.bonus - stats.left - stats.fake;
}

function getMemberJoinKey(guildId, memberId) {
  return `${guildId}:${memberId}`;
}

function formatInviteStats(userTag, stats) {
  return new EmbedBuilder()
    .setTitle(`📨 Statystyki zaproszeń — ${userTag}`)
    .setDescription("Twoje aktualne statystyki zaproszeń.")
    .addFields(
      { name: "✅ Zaproszeni", value: String(stats.joined), inline: true },
      { name: "🚪 Opuścili serwer", value: String(stats.left), inline: true },
      { name: "⚠️ Fake invite", value: String(stats.fake), inline: true },
      { name: "🎁 Bonusowe", value: String(stats.bonus), inline: true },
      { name: "🏆 Łącznie", value: String(getNetInvites(stats)), inline: true }
    )
    .setTimestamp();
}

function formatBoostStats(userTag, boosts) {
  return new EmbedBuilder()
    .setTitle(`💜 Statystyki boostów — ${userTag}`)
    .setDescription(`Łączna liczba boostów: **${boosts}**`)
    .setTimestamp();
}

function statsPanelComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("stats:self")
        .setLabel("Sprawdź swoje zaproszenia")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("📨"),
      new ButtonBuilder()
        .setCustomId("stats:top")
        .setLabel("Top zaproszeń")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("🏆")
    )
  ];
}

function calculatorPanelComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("calc:buy")
        .setLabel("Za zł → ile waluty")
        .setStyle(ButtonStyle.Success)
        .setEmoji("💰"),
      new ButtonBuilder()
        .setCustomId("calc:sell")
        .setLabel("Za walutę → ile zł")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("💸"),
      new ButtonBuilder()
        .setCustomId("calc:admin")
        .setLabel("Panel administratora")
        .setStyle(ButtonStyle.Danger)
        .setEmoji("🛠️")
    )
  ];
}

function paymentMethodsSelect(customId = "calc:payment_select") {
  const options = Object.entries(config.currency.paymentMethods).map(([name, commission]) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(name)
      .setDescription(`Prowizja ${commission}%`)
      .setValue(name)
  );

  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(customId)
        .setPlaceholder("Wybierz metodę płatności")
        .addOptions(options)
    )
  ];
}

function adminPanelSelect() {
  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("admin:select_setting")
        .setPlaceholder("Wybierz co chcesz zmienić")
        .addOptions(
          new StringSelectMenuOptionBuilder()
            .setLabel("Kurs kupna")
            .setDescription("1 zł = X k")
            .setValue("buyRate"),
          new StringSelectMenuOptionBuilder()
            .setLabel("Kurs sprzedaży")
            .setDescription("100k = X zł")
            .setValue("sellRate"),
          new StringSelectMenuOptionBuilder()
            .setLabel("Prowizje metod")
            .setDescription("Zmień prowizję dla metody")
            .setValue("commissions"),
          new StringSelectMenuOptionBuilder()
            .setLabel("Banner powitania")
            .setDescription("Zmień URL banneru")
            .setValue("banner")
        )
    )
  ];
}

async function syncGuildInvites(guild) {
  try {
    const fetched = await guild.invites.fetch();
    inviteCache.set(
      guild.id,
      new Collection(fetched.map(invite => [invite.code, invite.uses]))
    );
    return fetched;
  } catch (error) {
    console.error(`Nie udało się zsynchronizować invite dla ${guild.name}:`, error);
    return null;
  }
}

function buildWelcomeEmbed(member, inviter, stats) {
  const description = config.welcomeMessageTemplate
    .replaceAll("{member}", `${member}`)
    .replaceAll("{inviter}", `${inviter}`)
    .replaceAll("{netInvites}", `${getNetInvites(stats)}`);

  const embed = new EmbedBuilder()
    .setTitle("🎉 Witaj na serwerze!")
    .setDescription(description)
    .setColor(0x57F287)
    .setTimestamp();

  if (config.defaultBannerUrl && /^https?:\/\//i.test(config.defaultBannerUrl)) {
    embed.setImage(config.defaultBannerUrl);
  }

  return embed;
}

function buildBoostEmbed(member, totalBoosts) {
  const description = config.boostMessageTemplate
    .replaceAll("{member}", `${member}`)
    .replaceAll("{boosts}", `${totalBoosts}`);

  const embed = new EmbedBuilder()
    .setTitle("💜 Nowy boost serwera!")
    .setDescription(`${description}\n\n🚀 Łączna liczba boostów tej osoby: **${totalBoosts}**`)
    .setColor(0xFF73FA)
    .setTimestamp();

  if (config.defaultBannerUrl && /^https?:\/\//i.test(config.defaultBannerUrl)) {
    embed.setImage(config.defaultBannerUrl);
  }

  return embed;
}

function parseFlexibleAmountToK(raw) {
  const normalized = String(raw).trim().toLowerCase().replace(",", ".");
  if (!normalized) return NaN;

  if (/^\d+(\.\d+)?$/.test(normalized)) {
    return Number(normalized);
  }

  const match = normalized.match(/^(\d+(\.\d+)?)(k|kk|m|b)$/);
  if (!match) return NaN;

  const num = Number(match[1]);
  const suffix = match[3];

  if (suffix === "k") return num;
  if (suffix === "kk" || suffix === "m") return num * 1000;
  if (suffix === "b") return num * 1000000;

  return NaN;
}

function formatKAmount(kAmount) {
  if (kAmount >= 1000000) return `${(kAmount / 1000000).toFixed(2).replace(/\.00$/, "")}b`;
  if (kAmount >= 1000) return `${(kAmount / 1000).toFixed(2).replace(/\.00$/, "")}kk`;
  return `${Number(kAmount.toFixed(2)).toString()}k`;
}

function calculateBuy(zl, paymentMethod) {
  const commission = config.currency.paymentMethods[paymentMethod] ?? 0;
  const netZl = zl * (1 - commission / 100);
  const currencyInK = netZl * config.currency.buyRateKPer1zl;

  return {
    commission,
    netZl,
    currencyInK
  };
}

function calculateSell(kAmount) {
  const zl = (kAmount / 100) * config.currency.sellRateZlPer100k;
  return { zl };
}

async function upsertPanels(guild) {
  const statsChannel = guild.channels.cache.get(config.invitesChannelId);
  const calcChannel = guild.channels.cache.get(config.calculatorChannelId);

  if (!statsChannel || statsChannel.type !== ChannelType.GuildText) {
    throw new Error("Nie znaleziono poprawnego kanału twoje-zaproszenia.");
  }

  if (!calcChannel || calcChannel.type !== ChannelType.GuildText) {
    throw new Error("Nie znaleziono poprawnego kanału oblicz-ile-dostaniesz.");
  }

  const statsEmbed = new EmbedBuilder()
    .setTitle("🎁 Twoje zaproszenia")
    .setDescription("Kliknij przycisk poniżej, aby sprawdzić swoje statystyki lub zobaczyć top zaproszeń.")
    .setTimestamp();

  const calcEmbed = new EmbedBuilder()
    .setTitle("💸 Oblicz ile dostaniesz")
    .setDescription(
      `Aktualne kursy:\n` +
      `• **Kupno:** 1 zł = **${config.currency.buyRateKPer1zl}k**\n` +
      `• **Sprzedaż:** 100k = **${config.currency.sellRateZlPer100k} zł**\n\n` +
      `Wybierz sposób liczenia przyciskiem poniżej.\n` +
      `• Kupno uwzględnia metodę płatności i prowizję.\n` +
      `• Sell liczy bez prowizji.`
    )
    .setTimestamp();

  let statsMessage;
  let calcMessage;

  try {
    if (panelsDb.statsPanelMessageId) {
      statsMessage = await statsChannel.messages.fetch(panelsDb.statsPanelMessageId);
      await statsMessage.edit({ embeds: [statsEmbed], components: statsPanelComponents() });
    } else {
      statsMessage = await statsChannel.send({ embeds: [statsEmbed], components: statsPanelComponents() });
      panelsDb.statsPanelMessageId = statsMessage.id;
    }
  } catch {
    statsMessage = await statsChannel.send({ embeds: [statsEmbed], components: statsPanelComponents() });
    panelsDb.statsPanelMessageId = statsMessage.id;
  }

  try {
    if (panelsDb.calculatorPanelMessageId) {
      calcMessage = await calcChannel.messages.fetch(panelsDb.calculatorPanelMessageId);
      await calcMessage.edit({ embeds: [calcEmbed], components: calculatorPanelComponents() });
    } else {
      calcMessage = await calcChannel.send({ embeds: [calcEmbed], components: calculatorPanelComponents() });
      panelsDb.calculatorPanelMessageId = calcMessage.id;
    }
  } catch {
    calcMessage = await calcChannel.send({ embeds: [calcEmbed], components: calculatorPanelComponents() });
    panelsDb.calculatorPanelMessageId = calcMessage.id;
  }

  persistAll();
}

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("invites")
      .setDescription("Pokaż statystyki zaproszeń")
      .addUserOption(option =>
        option.setName("user").setDescription("Użytkownik do sprawdzenia").setRequired(false)
      ),

    new SlashCommandBuilder()
      .setName("invitetop")
      .setDescription("Pokaż ranking zaproszeń"),

    new SlashCommandBuilder()
      .setName("inviteadd")
      .setDescription("Dodaj bonusowe zaproszenia użytkownikowi")
      .addUserOption(option => option.setName("user").setDescription("Użytkownik").setRequired(true))
      .addIntegerOption(option => option.setName("amount").setDescription("Ilość").setRequired(true))
      .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

    new SlashCommandBuilder()
      .setName("inviteremove")
      .setDescription("Odejmij bonusowe zaproszenia użytkownikowi")
      .addUserOption(option => option.setName("user").setDescription("Użytkownik").setRequired(true))
      .addIntegerOption(option => option.setName("amount").setDescription("Ilość").setRequired(true))
      .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

    new SlashCommandBuilder()
      .setName("invitereset")
      .setDescription("Resetuj statystyki zaproszeń użytkownika")
      .addUserOption(option => option.setName("user").setDescription("Użytkownik").setRequired(true))
      .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

    new SlashCommandBuilder()
      .setName("setup-panels")
      .setDescription("Wstaw lub odśwież panele bota")
      .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

    new SlashCommandBuilder()
      .setName("syncinvites")
      .setDescription("Ręcznie odśwież cache zaproszeń")
      .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

    new SlashCommandBuilder()
      .setName("boosts")
      .setDescription("Pokaż liczbę boostów użytkownika")
      .addUserOption(option =>
        option.setName("user").setDescription("Użytkownik do sprawdzenia").setRequired(false)
      ),

    new SlashCommandBuilder()
      .setName("boosterzytop")
      .setDescription("Pokaż ranking boosterów")
  ].map(cmd => cmd.toJSON());

  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commands }
  );
}

client.once(Events.ClientReady, async () => {
  console.log(`✅ Zalogowano jako ${client.user.tag}`);

  try {
    await registerCommands();
    console.log("✅ Komendy slash zarejestrowane.");
  } catch (error) {
    console.error("Błąd rejestracji komend:", error);
  }

  for (const guild of client.guilds.cache.values()) {
    await syncGuildInvites(guild);
  }
});

client.on(Events.InviteCreate, async invite => {
  if (invite.guild) await syncGuildInvites(invite.guild);
});

client.on(Events.InviteDelete, async invite => {
  if (invite.guild) await syncGuildInvites(invite.guild);
});

client.on(Events.GuildMemberAdd, async member => {
  const guild = member.guild;
  const welcomeChannel = guild.channels.cache.get(config.welcomeChannelId);

  const oldInvites = inviteCache.get(guild.id) || new Collection();
  const fetchedInvites = await guild.invites.fetch().catch(() => null);

  if (!fetchedInvites) {
    if (welcomeChannel?.isTextBased()) {
      await welcomeChannel.send({
        content: `${member}`,
        embeds: [
          new EmbedBuilder()
            .setTitle("⚠️ Nie udało się sprawdzić zaproszenia")
            .setDescription(
              `${member} dołączył(a), ale bot nie mógł odczytać aktywnych zaproszeń. Sprawdź uprawnienie **Zarządzanie serwerem / Manage Guild** dla bota.`
            )
            .setTimestamp()
        ]
      }).catch(() => {});
    }
    return;
  }

  const newInvites = new Collection(fetchedInvites.map(invite => [invite.code, invite.uses]));
  inviteCache.set(guild.id, newInvites);

  let usedInvite = fetchedInvites.find(invite => {
    const oldUses = oldInvites.get(invite.code) ?? 0;
    return invite.uses > oldUses;
  });

  if (!usedInvite && fetchedInvites.size === 1) {
    usedInvite = fetchedInvites.first();
  }

  if (!usedInvite) {
    const sorted = [...fetchedInvites.values()].sort((a, b) => (b.uses ?? 0) - (a.uses ?? 0));
    usedInvite = sorted[0] ?? null;
  }

  if (!usedInvite || !usedInvite.inviter) {
    if (welcomeChannel?.isTextBased()) {
      await welcomeChannel.send({
        content: `${member}`,
        embeds: [
          new EmbedBuilder()
            .setTitle("🎉 Witaj na serwerze!")
            .setDescription(`${member} dołączył(a), ale nie udało się ustalić kto go/ją zaprosił.`)
            .setTimestamp()
        ]
      }).catch(() => {});
    }
    return;
  }

  const inviter = usedInvite.inviter;
  const inviterStats = ensureUserStats(guild.id, inviter.id);
  inviterStats.joined += 1;

  joinsDb.members[getMemberJoinKey(guild.id, member.id)] = {
    inviterId: inviter.id,
    joinedAt: Date.now(),
    inviteCode: usedInvite.code ?? null
  };

  persistAll();

  if (welcomeChannel?.isTextBased()) {
    await welcomeChannel.send({
      content: `${member} ${inviter}`,
      embeds: [buildWelcomeEmbed(member, inviter, inviterStats)]
    }).catch(() => {});
  }
});

client.on(Events.GuildMemberRemove, member => {
  const key = getMemberJoinKey(member.guild.id, member.id);
  const joinInfo = joinsDb.members[key];
  if (!joinInfo) return;

  const inviterStats = ensureUserStats(member.guild.id, joinInfo.inviterId);
  const maxMs = config.fakeInviteHours * 60 * 60 * 1000;
  const elapsed = Date.now() - joinInfo.joinedAt;

  if (elapsed < maxMs) {
    inviterStats.fake += 1;
  } else {
    inviterStats.left += 1;
  }

  delete joinsDb.members[key];
  persistAll();
});

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  try {
    const hadBoost = !!oldMember.premiumSince;
    const hasBoost = !!newMember.premiumSince;

    if (!hadBoost && hasBoost) {
      const boostChannel = newMember.guild.channels.cache.get(config.boostChannelId);
      const boostStats = ensureBoostUser(newMember.guild.id, newMember.id);
      boostStats.boosts += 1;
      persistAll();

      if (boostChannel?.isTextBased()) {
        await boostChannel.send({
          content: `${newMember}`,
          embeds: [buildBoostEmbed(newMember, boostStats.boosts)]
        }).catch(() => {});
      }
    }
  } catch (error) {
    console.error("Błąd wykrywania boosta:", error);
  }
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "invites") {
        const user = interaction.options.getUser("user") || interaction.user;
        const stats = ensureUserStats(interaction.guild.id, user.id);
        return await interaction.reply({
          embeds: [formatInviteStats(user.tag, stats)],
          ephemeral: true
        });
      }

      if (interaction.commandName === "invitetop") {
        const guildStats = ensureGuildStats(interaction.guild.id);
        const ranking = Object.entries(guildStats.users)
          .map(([userId, stats]) => ({ userId, total: getNetInvites(stats) }))
          .sort((a, b) => b.total - a.total)
          .slice(0, 10);

        const lines = await Promise.all(
          ranking.map(async (entry, index) => {
            try {
              const user = await client.users.fetch(entry.userId);
              return `**${index + 1}.** ${user} — **${entry.total}**`;
            } catch {
              return `**${index + 1}.** <@${entry.userId}> — **${entry.total}**`;
            }
          })
        );

        const embed = new EmbedBuilder()
          .setTitle("🏆 Top zaproszeń")
          .setDescription(lines.length ? lines.join("\n") : "Brak danych.")
          .setTimestamp();

        return await interaction.reply({ embeds: [embed], ephemeral: true });
      }

      if (interaction.commandName === "inviteadd") {
        const user = interaction.options.getUser("user");
        const amount = interaction.options.getInteger("amount");
        const stats = ensureUserStats(interaction.guild.id, user.id);
        stats.bonus += amount;
        persistAll();

        return await interaction.reply({
          content: `✅ Dodano **${amount}** bonusowych zaproszeń dla ${user}.`,
          ephemeral: true
        });
      }

      if (interaction.commandName === "inviteremove") {
        const user = interaction.options.getUser("user");
        const amount = interaction.options.getInteger("amount");
        const stats = ensureUserStats(interaction.guild.id, user.id);
        stats.bonus -= amount;
        persistAll();

        return await interaction.reply({
          content: `✅ Odjęto **${amount}** bonusowych zaproszeń dla ${user}.`,
          ephemeral: true
        });
      }

      if (interaction.commandName === "invitereset") {
        const user = interaction.options.getUser("user");
        const guild = ensureGuildStats(interaction.guild.id);
        guild.users[user.id] = { joined: 0, left: 0, fake: 0, bonus: 0 };
        persistAll();

        return await interaction.reply({
          content: `✅ Zresetowano statystyki ${user}.`,
          ephemeral: true
        });
      }

      if (interaction.commandName === "setup-panels") {
        await interaction.deferReply({ ephemeral: true });
        await upsertPanels(interaction.guild);
        return await interaction.editReply("✅ Panele zostały wstawione lub odświeżone.");
      }

      if (interaction.commandName === "syncinvites") {
        await interaction.deferReply({ ephemeral: true });
        await syncGuildInvites(interaction.guild);
        return await interaction.editReply("✅ Cache invite został odświeżony.");
      }

      if (interaction.commandName === "boosts") {
        const user = interaction.options.getUser("user") || interaction.user;
        const guildBoosts = ensureBoostGuild(interaction.guild.id);
        const boosts = guildBoosts.users[user.id]?.boosts ?? 0;

        return await interaction.reply({
          embeds: [formatBoostStats(user.tag, boosts)],
          ephemeral: true
        });
      }

      if (interaction.commandName === "boosterzytop") {
        const guildBoosts = ensureBoostGuild(interaction.guild.id);
        const ranking = Object.entries(guildBoosts.users)
          .map(([userId, data]) => ({ userId, boosts: data.boosts || 0 }))
          .sort((a, b) => b.boosts - a.boosts)
          .slice(0, 10);

        const lines = await Promise.all(
          ranking.map(async (entry, index) => {
            try {
              const user = await client.users.fetch(entry.userId);
              return `**${index + 1}.** ${user} — **${entry.boosts}**`;
            } catch {
              return `**${index + 1}.** <@${entry.userId}> — **${entry.boosts}**`;
            }
          })
        );

        const embed = new EmbedBuilder()
          .setTitle("💜 Top boosterów")
          .setDescription(lines.length ? lines.join("\n") : "Brak danych.")
          .setTimestamp();

        return await interaction.reply({ embeds: [embed], ephemeral: true });
      }
    }

    if (interaction.isButton()) {
      if (interaction.customId === "stats:self") {
        const stats = ensureUserStats(interaction.guild.id, interaction.user.id);
        return await interaction.reply({
          embeds: [formatInviteStats(interaction.user.tag, stats)],
          ephemeral: true
        });
      }

      if (interaction.customId === "stats:top") {
        const guildStats = ensureGuildStats(interaction.guild.id);
        const ranking = Object.entries(guildStats.users)
          .map(([userId, stats]) => ({ userId, total: getNetInvites(stats) }))
          .sort((a, b) => b.total - a.total)
          .slice(0, 10);

        const lines = await Promise.all(
          ranking.map(async (entry, index) => {
            try {
              const user = await client.users.fetch(entry.userId);
              return `**${index + 1}.** ${user} — **${entry.total}**`;
            } catch {
              return `**${index + 1}.** <@${entry.userId}> — **${entry.total}**`;
            }
          })
        );

        return await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle("🏆 Top zaproszeń")
              .setDescription(lines.length ? lines.join("\n") : "Brak danych.")
              .setTimestamp()
          ],
          ephemeral: true
        });
      }

      if (interaction.customId === "calc:buy" || interaction.customId === "calc:sell") {
        const mode = interaction.customId.split(":")[1];

        const modal = new ModalBuilder()
          .setCustomId(`modal:${mode}`)
          .setTitle(mode === "buy" ? "Za zł → ile waluty" : "Za walutę → ile zł");

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("amount")
              .setLabel(mode === "buy" ? "Podaj kwotę w zł" : "Podaj ilość waluty (np. 100k, 1kk)")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          )
        );

        return await interaction.showModal(modal);
      }

      if (interaction.customId === "calc:admin") {
        if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
          return await interaction.reply({
            content: "❌ Tylko administrator może otworzyć ten panel.",
            ephemeral: true
          });
        }

        return await interaction.reply({
          content:
            `🛠️ **Panel administratora**\n` +
            `Aktualne ustawienia:\n` +
            `• Kupno: 1 zł = **${config.currency.buyRateKPer1zl}k**\n` +
            `• Sprzedaż: 100k = **${config.currency.sellRateZlPer100k} zł**\n` +
            `• Banner: ${config.defaultBannerUrl || "brak"}\n\n` +
            `Wybierz, co chcesz zmienić:`,
          components: adminPanelSelect(),
          ephemeral: true
        });
      }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId === "modal:buy") {
        const amountRaw = interaction.fields.getTextInputValue("amount");
        tempCalcSessions.set(interaction.user.id, { mode: "buy", amountRaw });

        return await interaction.reply({
          content: "Wybierz metodę płatności:",
          components: paymentMethodsSelect(),
          ephemeral: true
        });
      }

      if (interaction.customId === "modal:sell") {
        const amountRaw = interaction.fields.getTextInputValue("amount");
        const kAmount = parseFlexibleAmountToK(amountRaw);

        if (!Number.isFinite(kAmount) || kAmount <= 0) {
          return await interaction.reply({
            content: "❌ Podano niepoprawną ilość waluty.",
            ephemeral: true
          });
        }

        const result = calculateSell(kAmount);

        return await interaction.reply({
          content:
            `💸 **Za walutę → ile zł**\n` +
            `• Ilość waluty: **${formatKAmount(kAmount)}**\n` +
            `• Kurs sprzedaży: **100k = ${config.currency.sellRateZlPer100k} zł**\n` +
            `• Dostaniesz: **${result.zl.toFixed(2)} zł**`,
          ephemeral: true
        });
      }

      if (interaction.customId === "admin:set_buyRate") {
        const value = Number(interaction.fields.getTextInputValue("value").replace(",", "."));
        if (!Number.isFinite(value) || value <= 0) {
          return await interaction.reply({ content: "❌ Podaj poprawną liczbę.", ephemeral: true });
        }
        config.currency.buyRateKPer1zl = value;
        persistAll();
        return await interaction.reply({
          content: `✅ Ustawiono kurs kupna: 1 zł = ${value}k`,
          ephemeral: true
        });
      }

      if (interaction.customId === "admin:set_sellRate") {
        const value = Number(interaction.fields.getTextInputValue("value").replace(",", "."));
        if (!Number.isFinite(value) || value <= 0) {
          return await interaction.reply({ content: "❌ Podaj poprawną liczbę.", ephemeral: true });
        }
        config.currency.sellRateZlPer100k = value;
        persistAll();
        return await interaction.reply({
          content: `✅ Ustawiono kurs sprzedaży: 100k = ${value} zł`,
          ephemeral: true
        });
      }

      if (interaction.customId === "admin:set_banner") {
        const value = interaction.fields.getTextInputValue("value").trim();
        config.defaultBannerUrl = value;
        persistAll();
        return await interaction.reply({
          content: "✅ Zmieniono banner powitania.",
          ephemeral: true
        });
      }

      if (interaction.customId.startsWith("admin:set_commission:")) {
        const paymentMethod = interaction.customId.replace("admin:set_commission:", "");
        const value = Number(interaction.fields.getTextInputValue("value").replace(",", "."));

        if (!Number.isFinite(value) || value < 0) {
          return await interaction.reply({
            content: "❌ Podaj poprawny procent prowizji.",
            ephemeral: true
          });
        }

        config.currency.paymentMethods[paymentMethod] = value;
        persistAll();

        return await interaction.reply({
          content: `✅ Ustawiono prowizję dla **${paymentMethod}** na **${value}%**.`,
          ephemeral: true
        });
      }
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === "calc:payment_select") {
        const session = tempCalcSessions.get(interaction.user.id);
        if (!session) {
          return await interaction.update({
            content: "❌ Sesja wygasła. Kliknij przycisk jeszcze raz.",
            components: []
          });
        }

        const method = interaction.values[0];
        const amountRaw = session.amountRaw;

        if (session.mode === "buy") {
          const zl = Number(amountRaw.replace(",", "."));
          if (!Number.isFinite(zl) || zl <= 0) {
            tempCalcSessions.delete(interaction.user.id);
            return await interaction.update({
              content: "❌ Podano niepoprawną kwotę w zł.",
              components: []
            });
          }

          const result = calculateBuy(zl, method);
          tempCalcSessions.delete(interaction.user.id);

          return await interaction.update({
            content:
              `💰 **Za zł → ile waluty**\n` +
              `• Kwota wejściowa: **${zl.toFixed(2)} zł**\n` +
              `• Metoda płatności: **${method}**\n` +
              `• Prowizja: **${result.commission}%**\n` +
              `• Kwota po prowizji: **${result.netZl.toFixed(2)} zł**\n` +
              `• Otrzymasz: **${formatKAmount(result.currencyInK)}**`,
            components: []
          });
        }
      }

      if (interaction.customId === "admin:select_setting") {
        if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
          return await interaction.update({
            content: "❌ Tylko administrator może używać tego panelu.",
            components: []
          });
        }

        const value = interaction.values[0];

        if (value === "buyRate") {
          const modal = new ModalBuilder()
            .setCustomId("admin:set_buyRate")
            .setTitle("Zmień kurs kupna")
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("value")
                  .setLabel("1 zł = ile k?")
                  .setStyle(TextInputStyle.Short)
                  .setPlaceholder("np. 7")
                  .setRequired(true)
              )
            );
          return await interaction.showModal(modal);
        }

        if (value === "sellRate") {
          const modal = new ModalBuilder()
            .setCustomId("admin:set_sellRate")
            .setTitle("Zmień kurs sprzedaży")
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("value")
                  .setLabel("100k = ile zł?")
                  .setStyle(TextInputStyle.Short)
                  .setPlaceholder("np. 7")
                  .setRequired(true)
              )
            );
          return await interaction.showModal(modal);
        }

        if (value === "banner") {
          const modal = new ModalBuilder()
            .setCustomId("admin:set_banner")
            .setTitle("Zmień banner powitania")
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId("value")
                  .setLabel("Bezpośredni URL do obrazka")
                  .setStyle(TextInputStyle.Short)
                  .setPlaceholder("https://...")
                  .setRequired(true)
              )
            );
          return await interaction.showModal(modal);
        }

        if (value === "commissions") {
          const options = Object.entries(config.currency.paymentMethods).map(([method, commission]) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(method)
              .setDescription(`Aktualnie ${commission}%`)
              .setValue(method)
          );

          return await interaction.update({
            content: "Wybierz metodę płatności do edycji prowizji:",
            components: [
              new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                  .setCustomId("admin:select_commission_method")
                  .setPlaceholder("Wybierz metodę")
                  .addOptions(options)
              )
            ]
          });
        }
      }

      if (interaction.customId === "admin:select_commission_method") {
        if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
          return await interaction.update({
            content: "❌ Tylko administrator może używać tego panelu.",
            components: []
          });
        }

        const method = interaction.values[0];
        const modal = new ModalBuilder()
          .setCustomId(`admin:set_commission:${method}`)
          .setTitle(`Prowizja — ${method}`)
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("value")
                .setLabel("Podaj prowizję w %")
                .setStyle(TextInputStyle.Short)
                .setPlaceholder(`Aktualnie: ${config.currency.paymentMethods[method]}`)
                .setRequired(true)
            )
          );

        return await interaction.showModal(modal);
      }
    }
  } catch (error) {
    console.error("Błąd InteractionCreate:", error);

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({
        content: "❌ Wystąpił błąd podczas obsługi akcji.",
        ephemeral: true
      }).catch(() => {});
    } else {
      await interaction.reply({
        content: "❌ Wystąpił błąd podczas obsługi akcji.",
        ephemeral: true
      }).catch(() => {});
    }
  }
});

console.log("TOKEN START:", process.env.TOKEN?.slice(0, 10));
console.log("TOKEN LEN:", process.env.TOKEN?.length);

client.login(process.env.TOKEN);
