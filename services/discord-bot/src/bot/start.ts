import { Client, Events } from "discord.js";
import {
  ADMIN_COMMAND_NAME,
  handleAdminCommand,
} from "../commands/admin-commands.js";
import {
  handleEconomyCommand,
  handleEconomyComponent,
  registerGuildCommands,
} from "../commands/economy-commands.js";
import { handleVoiceCommand } from "../commands/voice-commands.js";
import { config } from "../config/index.js";
import { logger } from "../config/logger.js";
import { DrizzleMilestoneStore } from "../database/milestone-store.js";
import { DrizzleShopStore } from "../shop/drizzle-shop-store.js";
import { DiscordShopRoleOperations } from "../shop/discord-shop-roles.js";
import { ShopService } from "../shop/shop-service.js";
import { DiscordMilestoneAnnouncer } from "../milestones/milestone-announcer.js";
import { MilestoneManager } from "../milestones/milestone-manager.js";
import { applyMilestoneSettings } from "../milestones/milestone-settings.js";
import {
  DiscordMilestoneRoleOperations,
  MilestoneRoleManager,
} from "../milestones/role-manager.js";
import { RewardManager } from "../rewards/reward-manager.js";
import { setEconomyContext } from "../economy/context.js";
import { WalletCurrencyRewardProvider } from "../economy/currency-provider.js";
import { CurrencyImageService } from "../economy/currency-image.js";
import { validateEconomyConfig } from "../economy/economy-config.js";
import { EconomyService } from "../economy/economy-service.js";
import { WeeklyTaskService } from "../weekly/weekly-task-service.js";
import { DrizzleWeeklyTaskStore } from "../weekly/drizzle-weekly-store.js";
import { QuizService } from "../economy/quiz/quiz-service.js";
import { prepareQuizPools } from "../commands/quiz-commands.js";
import { isTargetGuild } from "../economy/permissions.js";
import { VoiceRewardManager } from "../economy/voice-rewards.js";
import { DrizzleSeasonStore } from "../database/season-store.js";
import { DiscordSeasonRoleOperations } from "../season/discord-season-roles.js";
import { SeasonService } from "../season/season-service.js";

function addProcessHandlers(
  client: Client,
  stopMilestones: () => Promise<void>,
  stopVoiceTracking: () => Promise<void>,
  closeDatabase: () => Promise<void>,
  stopEconomy: () => Promise<void> = async () => undefined,
): void {
  let cleanupPromise: Promise<void> | null = null;
  const cleanup = (): Promise<void> => {
    cleanupPromise ??= (async () => {
      client.destroy();
      await stopEconomy();
      await stopMilestones();
      await stopVoiceTracking();
      await closeDatabase();
    })();
    return cleanupPromise;
  };

  const shutdown = (signal: "SIGINT" | "SIGTERM"): void => {
    logger.info({ signal }, "Shutting down Discord client.");
    void cleanup()
      .then(() => {
        process.exitCode = 0;
      })
      .catch((error) => {
        logger.error({ err: error }, "Graceful bot shutdown did not complete cleanly.");
        process.exitCode = 1;
      });
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("unhandledRejection", () => {
    logger.fatal("Unhandled promise rejection. Shutting down.");
    void cleanup().finally(() => process.exit(1));
  });
  process.once("uncaughtException", () => {
    logger.fatal("Unexpected uncaught exception. Shutting down.");
    void cleanup().finally(() => process.exit(1));
  });
}

export async function startBot(): Promise<void> {
  const token = config.discord.token;

  if (!token) {
    logger.fatal(
      "DISCORD_TOKEN is missing. Add it to your host's environment variables, then restart the bot.",
    );
    process.exitCode = 1;
    return;
  }

  const economyProblems = validateEconomyConfig(config.economy);
  if (economyProblems.length > 0) {
    for (const problem of economyProblems) {
      logger.fatal(problem);
    }
    logger.fatal(
      "The economy settings are invalid. Fix them in your host's environment variables, then restart the bot.",
    );
    process.exitCode = 1;
    return;
  }

  let database: typeof import("../database/index.js");
  try {
    database = await import("../database/index.js");
    await database.applyMigrations();
    await database.initializeDatabase();
  } catch (error) {
    logger.fatal(
      { err: error },
      "Database initialization failed. Verify DATABASE_URL (it must be set and reachable).",
    );
    process.exitCode = 1;
    return;
  }

  // Apply milestone hours / roles that admins changed from Discord.
  try {
    const savedSettings = await database.getMilestoneSettings();
    if (savedSettings.length > 0) {
      const result = applyMilestoneSettings(
        config.milestones.definitions,
        savedSettings,
      );
      if (result.applied) {
        logger.info(
          { edited: result.count },
          "Applied saved milestone settings.",
        );
      } else {
        logger.error(
          { reason: result.reason },
          "Saved milestone settings were ignored because they are invalid; using the defaults.",
        );
      }
    }
  } catch (error) {
    logger.error(
      { err: error },
      "Could not load saved milestone settings; using the defaults.",
    );
  }

  const client = new Client({
    intents: [...config.discord.intents],
  });
  const { VoiceSessionTracker } = await import("../voice/voice-tracker.js");
  const voiceTracker = new VoiceSessionTracker(client, database);
  voiceTracker.attach();

  const milestoneStore = new DrizzleMilestoneStore();
  const milestoneRoleManager = new MilestoneRoleManager(
    new DiscordMilestoneRoleOperations(client, config.milestones.guildId),
    config.milestones.definitions,
  );
  const economyStore = new DrizzleShopStore(config.economy.startingBalance);
  const economyService = new EconomyService({
    store: economyStore,
    config: config.economy,
  });
  const quizService = new QuizService({
    store: economyStore,
    config: config.economy,
  });
  const currencyImages = new CurrencyImageService(
    economyStore,
    config.economy.currencyImageUrl,
  );
  const shopService = new ShopService({
    store: economyStore,
    roles: new DiscordShopRoleOperations(client, config.economy.guildId ?? ""),
    money: config.economy,
    // Milestone roles and the admin role can never be sold.
    reservedRoleIds: () =>
      [
        ...config.milestones.definitions.map((definition) => definition.roleId),
        config.economy.adminRoleId,
      ].filter((id): id is string => Boolean(id)),
  });
  const weeklyService = new WeeklyTaskService({
    store: new DrizzleWeeklyTaskStore(),
    economy: economyStore,
    config: config.economy,
    voiceSeconds: (userId, since, until) => database.getVoiceSecondsSince(userId, since, until),
  });
  setEconomyContext({
    config: config.economy,
    service: economyService,
    images: currencyImages,
    quiz: quizService,
    shop: shopService,
    weekly: weeklyService,
  });
  await prepareQuizPools(quizService);
  const voiceRewards = new VoiceRewardManager(
    milestoneStore,
    economyStore,
    config.economy,
    () => new Date(),
    logger,
    () => seasonService.currentSeason,
  );
  let gameSweepTimer: ReturnType<typeof setInterval> | null = null;
  // Milestone payouts are keyed by season, so a reset lets students earn them
  // again. `seasonService` is created below and only read once things run.
  const rewardManager = new RewardManager(
    milestoneStore,
    new WalletCurrencyRewardProvider(economyStore),
    undefined,
    () => seasonService.currentSeason,
  );
  const milestoneManager = new MilestoneManager(
    milestoneStore,
    milestoneRoleManager,
    rewardManager,
    config.milestones.definitions,
    config.milestones.checkIntervalMs,
    undefined,
    config.economy.milestoneAnnounceChannelId && config.economy.guildId
      ? new DiscordMilestoneAnnouncer(client, {
          guildId: config.economy.guildId,
          channelId: config.economy.milestoneAnnounceChannelId,
          bullet: config.economy.milestoneBullet,
          currencySymbol: config.economy.currencySymbol,
          definitions: config.milestones.definitions,
          currencyImageUrl: () => currencyImages.getUrl(),
        })
      : undefined,
  );

  const seasonService = new SeasonService({
    store: new DrizzleSeasonStore(),
    roles: new DiscordSeasonRoleOperations(
      client,
      config.milestones.guildId ?? config.economy.guildId,
    ),
    // Both read voice totals, so both stand still while a reset runs.
    pausables: [milestoneManager, voiceRewards],
    milestoneRoleIds: () =>
      config.milestones.definitions.map((definition) => definition.roleId),
    // Color roles from the shop (past and present) and the admin role are
    // never removed by a reset.
    protectedRoleIds: async () =>
      [
        ...(await economyStore.listAllShopRoleIds()),
        config.economy.adminRoleId,
      ].filter((id): id is string => Boolean(id)),
  });
  try {
    await seasonService.load();
  } catch (error) {
    logger.fatal(
      { err: error },
      "Could not read the current season from the database.",
    );
    process.exitCode = 1;
    return;
  }

  client.once(Events.ClientReady, () => {
    logger.info("Discord bot connected successfully.");
    void (async () => {
      await voiceTracker.waitForRecovery();
      try {
        const names = await registerGuildCommands(client, config.economy);
        logger.info({ commands: names }, "Slash commands registered in the target server.");
      } catch (error) {
        logger.error(
          { err: error },
          "Slash commands could not be registered in the target server.",
        );
      }
      voiceRewards.start();
      const sweep = () =>
        void economyService
          .resolveExpiredGames()
          .catch((error: unknown) =>
            logger.error({ err: error }, "Could not settle timed-out games."),
          );
      sweep();
      gameSweepTimer = setInterval(sweep, 60_000);
      gameSweepTimer.unref?.();
      await milestoneManager.start();
    })().catch((error) => {
      logger.error(
        { err: error },
        "Voice-time milestone checks could not be started.",
      );
    });
  });

  client.on(Events.Error, (error) => {
    logger.error({ err: error }, "Discord client connection error.");
  });

  client.on(Events.ShardError, (error) => {
    logger.error({ err: error }, "Discord gateway connection error.");
  });

  client.on(Events.InteractionCreate, (interaction) => {
    if (!interaction.isChatInputCommand()) {
      void handleEconomyComponent(interaction);
      return;
    }
    // This bot serves one server only; ignore commands from anywhere else.
    if (!isTargetGuild(interaction.guildId, config.economy)) {
      void interaction
        .reply({
          content: "This bot only works in its own server.",
          ephemeral: true,
        })
        .catch(() => undefined);
      return;
    }
    if (interaction.commandName === ADMIN_COMMAND_NAME) {
      void handleAdminCommand(interaction, {
        definitions: config.milestones.definitions,
        adjustUserVoiceTime: database.adjustUserVoiceTime,
        saveMilestoneSetting: database.saveMilestoneSetting,
        recheckMilestones: () => milestoneManager.checkAllUsers(),
        season: {
          preview: () => seasonService.preview(),
          reset: (startedBy) => seasonService.reset(startedBy),
        },
      });
      return;
    }
    void handleEconomyCommand(interaction).then((handled) => {
      if (!handled) {
        return handleVoiceCommand(interaction);
      }
      return undefined;
    }).catch((error: unknown) => {
      logger.error({ err: error }, "Unexpected slash command error.");
    });
  });

  addProcessHandlers(
    client,
    () => milestoneManager.stop(),
    () => voiceTracker.stop(),
    database.closeDatabase,
    async () => {
      if (gameSweepTimer) {
        clearInterval(gameSweepTimer);
        gameSweepTimer = null;
      }
      await voiceRewards.stop();
    },
  );

  try {
    await client.login(token);
  } catch (error) {
    logger.fatal(
      { err: error },
      "Discord login failed. Check that DISCORD_TOKEN is set correctly in your host's environment variables.",
    );
    client.destroy();
    await voiceRewards.stop();
    await milestoneManager.stop();
    await voiceTracker.stop();
    await database.closeDatabase();
    process.exitCode = 1;
  }
}
