import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
} from "discord.js";
import { logger } from "../config/logger.js";
import type { EconomyContext } from "../economy/context.js";
import type { EconomyConfig } from "../economy/economy-config.js";
import { formatDh, formatDhWithEmoji, relativeTimestamp } from "../economy/format.js";
import { COUNTRIES, type QuizKind } from "../economy/quiz/quiz-data.js";
import { availableBrands, availableMapCodes, renderLogoImage, renderMapImage } from "../economy/quiz/quiz-images.js";
import type { AnswerResult, QuizRound, QuizService } from "../economy/quiz/quiz-service.js";
import { baseEmbed } from "../economy/render.js";

/** Slash command name -> which quiz it starts. */
export const QUIZ_COMMANDS: Readonly<Record<string, QuizKind>> = {
  guessflag: "flag",
  guessmap: "map",
  guesslogo: "logo",
};

export const QUIZ_BUTTON_PREFIX = "q|";

const IMAGE_FILE = "quiz.png";

const TEXT: Record<QuizKind, { title: string; question: string; description: string }> = {
  flag: { title: "🚩 Guess the Flag", question: "Which country does this flag belong to?", description: "Guess the country from its flag." },
  map: { title: "🗺️ Guess the Country", question: "Which country is highlighted on the map?", description: "Guess the highlighted country on the map." },
  logo: { title: "🏷️ Guess the Logo", question: "Which brand does this logo belong to?", description: "Guess the brand from its logo." },
};

export function buildQuizCommandBuilders(config: EconomyConfig): SlashCommandBuilder[] {
  const range = `${config.quizMinReward}-${config.quizMaxReward} ${config.currencySymbol}`;
  return (Object.keys(QUIZ_COMMANDS) as string[]).map((name) =>
    new SlashCommandBuilder()
      .setName(name)
      .setDescription(`${TEXT[QUIZ_COMMANDS[name] as QuizKind].description} Faster answers pay more (${range}).`),
  );
}

/**
 * Checks which maps and logos can really be drawn with the installed packages.
 * A quiz whose data is missing stays switched off instead of crashing.
 */
export async function prepareQuizPools(quiz: QuizService): Promise<void> {
  try {
    const codes = await availableMapCodes();
    quiz.setPool("map", COUNTRIES.filter((country) => country.numeric !== undefined && codes.has(country.numeric)));
  } catch (error) {
    logger.warn({ err: error }, "The world map data could not be loaded; /guessmap is switched off.");
    quiz.setPool("map", []);
  }
  try {
    quiz.setPool("logo", await availableBrands());
  } catch (error) {
    logger.warn({ err: error }, "The logo icons could not be loaded; /guesslogo is switched off.");
    quiz.setPool("logo", []);
  }
  logger.info(
    { flags: quiz.poolSize("flag"), maps: quiz.poolSize("map"), logos: quiz.poolSize("logo") },
    "Guessing games are ready.",
  );
}

// ------------------------------------------------------------------ images

function flagUrl(round: QuizRound): string | null {
  return round.subject.kind === "flag"
    ? `https://flagcdn.com/w640/${round.subject.country.code.toLowerCase()}.png`
    : null;
}

async function drawPicture(round: QuizRound): Promise<AttachmentBuilder | null> {
  if (round.subject.kind === "map" && round.subject.country.numeric !== undefined) {
    return new AttachmentBuilder(await renderMapImage(round.subject.country.numeric), { name: IMAGE_FILE });
  }
  if (round.subject.kind === "logo") {
    return new AttachmentBuilder(await renderLogoImage(round.subject.brand.icon), { name: IMAGE_FILE });
  }
  return null;
}

// ---------------------------------------------------------------- messages

type Reveal = { chosenIndex: number | null };

function buttons(round: QuizRound, reveal: Reveal | null): ActionRowBuilder<ButtonBuilder>[] {
  const row = new ActionRowBuilder<ButtonBuilder>();
  round.options.forEach((option, index) => {
    const button = new ButtonBuilder()
      .setCustomId(`${QUIZ_BUTTON_PREFIX}${round.id}|${index}`)
      .setLabel(option.slice(0, 80))
      .setStyle(ButtonStyle.Secondary);
    if (reveal) {
      button.setDisabled(true);
      if (index === round.correctIndex) {
        button.setStyle(ButtonStyle.Success);
      } else if (index === reveal.chosenIndex) {
        button.setStyle(ButtonStyle.Danger);
      }
    }
    row.addComponents(button);
  });
  return [row];
}

function withPicture(embed: ReturnType<typeof baseEmbed>, round: QuizRound) {
  const url = flagUrl(round);
  embed.setImage(url ?? `attachment://${IMAGE_FILE}`);
  return embed;
}

function questionMessage(ec: EconomyContext, round: QuizRound, imageUrl: string | null) {
  const { config } = ec;
  const text = TEXT[round.kind];
  const embed = withPicture(baseEmbed({ config, imageUrl }, text.title), round).setDescription(
    `${text.question}\nAnswer within **${config.quizTimeLimitSeconds} seconds**. ` +
      `The faster you are, the more you earn: **${formatDh(config.quizMinReward, config)}** up to ` +
      `**${formatDh(config.quizMaxReward, config)}**.`,
  ).addFields({ name: "Time is up", value: relativeTimestamp(new Date(round.deadlineMs)), inline: true });
  return { embeds: [embed], components: buttons(round, null) };
}

function answerName(round: QuizRound): string {
  return round.options[round.correctIndex] as string;
}

function resultMessage(ec: EconomyContext, imageUrl: string | null, result: Extract<AnswerResult, { ok: true }>) {
  const { config } = ec;
  const { round } = result;
  const seconds = (result.elapsedMs / 1000).toFixed(1);
  const embed = withPicture(baseEmbed({ config, imageUrl }, TEXT[round.kind].title), round);
  if (result.outcome === "correct") {
    embed
      .setColor(0x2ecc71)
      .setDescription(`✅ **Correct!** It is **${answerName(round)}**.\nYou answered in **${seconds}s**.`)
      .addFields(
        { name: "Reward", value: `+${formatDh(result.reward, config)}`, inline: true },
        { name: "Balance", value: formatDhWithEmoji(result.balance ?? 0, config), inline: true },
      );
  } else if (result.outcome === "late") {
    embed
      .setColor(0x95a5a6)
      .setDescription(`⏰ **Too slow!** It was **${answerName(round)}**, but the time was up.\nNo reward this time.`);
  } else {
    embed
      .setColor(0xe74c3c)
      .setDescription(`❌ **Wrong.** It was **${answerName(round)}**.`);
  }
  return { embeds: [embed], components: buttons(round, { chosenIndex: result.chosenIndex }) };
}

function timeoutMessage(ec: EconomyContext, imageUrl: string | null, round: QuizRound) {
  const embed = withPicture(baseEmbed({ config: ec.config, imageUrl }, TEXT[round.kind].title), round)
    .setColor(0x95a5a6)
    .setDescription(`⏰ **Time's up!** It was **${answerName(round)}**.\nNo reward this time.`);
  return { embeds: [embed], components: buttons(round, { chosenIndex: null }) };
}

// ----------------------------------------------------------------- handlers

const timers = new Map<string, NodeJS.Timeout>();

/** Handles /guessflag, /guessmap and /guesslogo. */
export async function handleQuizCommand(
  interaction: ChatInputCommandInteraction,
  ec: EconomyContext,
): Promise<void> {
  const kind = QUIZ_COMMANDS[interaction.commandName];
  if (!kind) {
    return;
  }
  const started = ec.quiz.start(interaction.user.id, kind);
  if (!started.ok) {
    await interaction.reply({
      content:
        started.reason === "cooldown"
          ? `You can play this game again ${relativeTimestamp(started.nextAt)}.`
          : "This game is not available right now.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();
  let picture: AttachmentBuilder | null;
  try {
    picture = await drawPicture(started.round);
  } catch (error) {
    ec.quiz.cancel(started.round.id);
    logger.error({ err: error, kind }, "Could not draw the quiz picture.");
    await interaction.deleteReply().catch(() => undefined);
    await interaction.followUp({ content: "Could not prepare that question. Please try again.", ephemeral: true });
    return;
  }

  const round = ec.quiz.restartClock(started.round.id) ?? started.round;
  const imageUrl = await ec.images.getUrl();
  const message = questionMessage(ec, round, imageUrl);
  await interaction.editReply({ ...message, files: picture ? [picture] : [] });

  // When nobody answers, show the solution and switch the buttons off.
  const timer = setTimeout(() => {
    timers.delete(round.id);
    const expired = ec.quiz.expire(round.id);
    if (expired) {
      interaction.editReply(timeoutMessage(ec, imageUrl, expired)).catch(() => undefined);
    }
  }, ec.config.quizTimeLimitSeconds * 1000 + 1_000);
  timers.set(round.id, timer);
}

/** Handles the answer buttons of every guessing game. */
export async function handleQuizComponent(interaction: ButtonInteraction, ec: EconomyContext): Promise<void> {
  const [, roundId, rawIndex] = interaction.customId.split("|");
  if (!roundId) {
    return;
  }
  await interaction.deferUpdate();
  const result = await ec.quiz.answer(roundId, interaction.user.id, Number.parseInt(rawIndex ?? "", 10));
  if (!result.ok) {
    const content =
      result.reason === "not_owner"
        ? "This is not your question. Use one of the guessing commands to play your own."
        : "This round is already over.";
    await interaction.followUp({ content, ephemeral: true });
    return;
  }
  const timer = timers.get(roundId);
  if (timer) {
    clearTimeout(timer);
    timers.delete(roundId);
  }
  await interaction.editReply(resultMessage(ec, await ec.images.getUrl(), result));
}
