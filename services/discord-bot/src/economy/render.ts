import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";
import type { EconomyConfig } from "./economy-config.js";
import type {
  AppleTowerView,
  BlackjackView,
  GameView,
  MinesView,
} from "./economy-service.js";
import { cardLabel } from "./games/blackjack.js";
import { MINES_COLUMNS, MINES_ROWS, MINES_TILES } from "./games/mines.js";
import { formatDh, formatDhWithEmoji } from "./format.js";

export type RenderContext = {
  config: EconomyConfig;
  /** Currency image, or null (everything still works with DH text only). */
  imageUrl: string | null;
};

const GOLD = 0xf1c40f;
const GREEN = 0x2ecc71;
const RED = 0xe74c3c;
const GREY = 0x95a5a6;

export function baseEmbed(ctx: RenderContext, title: string): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(GOLD).setTitle(title);
  if (ctx.imageUrl) {
    embed.setThumbnail(ctx.imageUrl);
  }
  return embed;
}

export type GameMessage = {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
};

function money(ctx: RenderContext, amount: number): string {
  return formatDh(amount, ctx.config);
}

function resultColor(payout: number, wager: number): number {
  return payout > wager ? GREEN : payout === wager ? GREY : RED;
}

function netText(ctx: RenderContext, payout: number, wager: number): string {
  const net = payout - wager;
  return net > 0
    ? `+${money(ctx, net)}`
    : net === 0
      ? `±0 ${ctx.config.currencySymbol}`
      : `-${money(ctx, -net)}`;
}

// ------------------------------------------------------------------- mines

const MINES_OUTCOMES: Record<string, string> = {
  mine: "💥 You hit a mine and lost your wager.",
  cashout: "💰 You cashed out.",
  cleared: "🏆 You cleared every safe tile! Paid out automatically.",
  expired_cashout: "⏱️ The game timed out and your progress was cashed out.",
  expired_refund: "⏱️ The game timed out before your first move. Your wager was refunded.",
};

function renderMines(view: MinesView, ctx: RenderContext): GameMessage {
  const id = view.gameId;
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let row = 0; row < MINES_ROWS; row += 1) {
    const actionRow = new ActionRowBuilder<ButtonBuilder>();
    for (let col = 0; col < MINES_COLUMNS; col += 1) {
      const tile = row * MINES_COLUMNS + col;
      const button = new ButtonBuilder().setCustomId(`g|m|${id}|r|${tile}`);
      const safeRevealed = view.revealed.includes(tile);
      if (view.ended) {
        const isMine = view.mines?.includes(tile) ?? false;
        button
          .setDisabled(true)
          .setStyle(isMine ? ButtonStyle.Danger : safeRevealed ? ButtonStyle.Success : ButtonStyle.Secondary)
          .setEmoji(isMine ? "💣" : "💎");
      } else if (safeRevealed) {
        button.setDisabled(true).setStyle(ButtonStyle.Success).setEmoji("💎");
      } else {
        button.setStyle(ButtonStyle.Secondary).setLabel("?");
      }
      actionRow.addComponents(button);
    }
    rows.push(actionRow);
  }

  const canCashOut = !view.ended && view.revealed.length > 0;
  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`g|m|${id}|c`)
        .setStyle(ButtonStyle.Success)
        .setLabel(canCashOut ? `Cash out ${money(ctx, view.cashoutValue)}` : "Cash out")
        .setDisabled(!canCashOut),
    ),
  );

  const embed = baseEmbed(ctx, "💣 Mines")
    .setDescription(
      view.ended
        ? (MINES_OUTCOMES[view.outcome ?? ""] ?? "The game has ended.")
        : "Reveal tiles. Every safe tile raises your payout. Hit a mine and you lose your wager.",
    )
    .addFields(
      { name: "Wager", value: money(ctx, view.wager), inline: true },
      { name: "Mines", value: `${view.mineCount} of ${MINES_TILES}`, inline: true },
      { name: "Safe tiles", value: String(view.revealed.length), inline: true },
      { name: "Multiplier", value: `${view.multiplier.toFixed(2)}x`, inline: true },
      view.ended
        ? { name: "Result", value: `Paid ${money(ctx, view.payout)} (${netText(ctx, view.payout, view.wager)})`, inline: true }
        : { name: "Cash out now", value: view.revealed.length > 0 ? money(ctx, view.cashoutValue) : "Reveal a tile first", inline: true },
    );
  if (view.ended) {
    embed.setColor(resultColor(view.payout, view.wager));
    if (view.balance !== null) {
      embed.setFooter({ text: `Balance: ${money(ctx, view.balance)}` });
    }
  }
  return { embeds: [embed], components: rows };
}

// ------------------------------------------------------------- apple tower

const TOWER_OUTCOMES: Record<string, string> = {
  wrong_apple: "🐛 Wrong apple! You lost your wager.",
  cashout: "💰 You cashed out.",
  top_reached: "🏆 You reached the top of the tower! Paid out automatically.",
  expired_cashout: "⏱️ The game timed out and your progress was cashed out.",
  expired_refund: "⏱️ The game timed out before your first move. Your wager was refunded.",
};

function renderTower(view: AppleTowerView, ctx: RenderContext): GameMessage {
  const lines: string[] = [];
  for (let level = view.levels; level >= 1; level -= 1) {
    const cleared = level <= view.levelsCleared;
    const current = !view.ended && level === view.levelsCleared + 1;
    lines.push(
      cleared
        ? `🍏 Level ${level} — cleared`
        : current
          ? `🍎 **Level ${level}** ← pick an apple`
          : `⬛ Level ${level}`,
    );
  }

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  const picks = new ActionRowBuilder<ButtonBuilder>();
  for (let choice = 0; choice < 3; choice += 1) {
    picks.addComponents(
      new ButtonBuilder()
        .setCustomId(`g|a|${view.gameId}|p|${choice}`)
        .setStyle(ButtonStyle.Primary)
        .setLabel(`🍎 ${choice + 1}`)
        .setDisabled(view.ended),
    );
  }
  rows.push(picks);
  const canCashOut = !view.ended && view.levelsCleared > 0;
  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`g|a|${view.gameId}|c`)
        .setStyle(ButtonStyle.Success)
        .setLabel(canCashOut ? `Cash out ${money(ctx, view.cashoutValue)}` : "Cash out")
        .setDisabled(!canCashOut),
    ),
  );

  const embed = baseEmbed(ctx, "🍎 Apple Tower")
    .setDescription(
      [
        view.ended
          ? (TOWER_OUTCOMES[view.outcome ?? ""] ?? "The game has ended.")
          : "Each level hides one safe apple among three. Climb as high as you dare.",
        "",
        ...lines,
      ].join("\n"),
    )
    .addFields(
      { name: "Wager", value: money(ctx, view.wager), inline: true },
      { name: "Level", value: `${Math.min(view.levelsCleared + (view.ended ? 0 : 1), view.levels)} / ${view.levels}`, inline: true },
      { name: "Multiplier", value: `${view.multiplier.toFixed(2)}x`, inline: true },
      view.ended
        ? { name: "Result", value: `Paid ${money(ctx, view.payout)} (${netText(ctx, view.payout, view.wager)})`, inline: true }
        : { name: "Cash out now", value: view.levelsCleared > 0 ? money(ctx, view.cashoutValue) : "Clear a level first", inline: true },
    );
  if (view.ended) {
    embed.setColor(resultColor(view.payout, view.wager));
    if (view.outcome === "wrong_apple" && view.safeApples) {
      const safe = view.safeApples[view.levelsCleared];
      if (safe !== undefined) {
        embed.addFields({ name: "The safe apple was", value: `🍎 ${safe + 1}`, inline: true });
      }
    }
    if (view.balance !== null) {
      embed.setFooter({ text: `Balance: ${money(ctx, view.balance)}` });
    }
  }
  return { embeds: [embed], components: rows };
}

// --------------------------------------------------------------- blackjack

const BLACKJACK_OUTCOMES: Record<string, string> = {
  blackjack: "🃏 **Blackjack!** You win 3:2.",
  win: "✅ You win!",
  push: "🤝 Push. Your wager is returned.",
  lose: "❌ Dealer wins.",
  bust: "💥 Bust! You went over 21.",
  dealer_blackjack: "❌ Dealer has blackjack.",
  expired: "⏱️ The game timed out and was played out automatically.",
};

function renderBlackjack(view: BlackjackView, ctx: RenderContext): GameMessage {
  const playerCards = view.player.map(cardLabel).join("  ");
  const dealerCards = view.dealerHidden
    ? `${cardLabel(view.dealer[0] as number)}  🂠`
    : view.dealer.map(cardLabel).join("  ");
  const rawOutcome = view.outcome ?? "";
  const outcomeKey = rawOutcome.startsWith("expired_") ? rawOutcome.slice(8) : rawOutcome;

  const embed = baseEmbed(ctx, "🃏 Blackjack")
    .setDescription(
      view.ended
        ? (BLACKJACK_OUTCOMES[outcomeKey] ?? "The hand has ended.")
        : "Hit to draw a card, or stand to let the dealer play. Dealer stands on 17.",
    )
    .addFields(
      { name: `Your hand (${view.playerTotal})`, value: playerCards, inline: true },
      {
        name: view.ended ? `Dealer (${view.dealerTotal})` : "Dealer",
        value: dealerCards,
        inline: true,
      },
      { name: "Wager", value: money(ctx, view.wager), inline: false },
    );
  if (view.ended) {
    embed.setColor(resultColor(view.payout, view.wager));
    embed.addFields({
      name: "Result",
      value: `Paid ${money(ctx, view.payout)} (${netText(ctx, view.payout, view.wager)})`,
    });
    if (view.balance !== null) {
      embed.setFooter({ text: `Balance: ${money(ctx, view.balance)}` });
    }
  }

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`g|b|${view.gameId}|h`)
      .setStyle(ButtonStyle.Primary)
      .setLabel("Hit")
      .setDisabled(view.ended),
    new ButtonBuilder()
      .setCustomId(`g|b|${view.gameId}|s`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel("Stand")
      .setDisabled(view.ended),
  );
  return { embeds: [embed], components: view.ended ? [] : [row] };
}

export function renderGame(view: GameView, ctx: RenderContext): GameMessage {
  switch (view.type) {
    case "mines":
      return renderMines(view, ctx);
    case "appletower":
      return renderTower(view, ctx);
    case "blackjack":
      return renderBlackjack(view, ctx);
  }
}

// ---------------------------------------------------------- simple embeds

export function balanceEmbed(
  ctx: RenderContext,
  name: string,
  balance: number,
): EmbedBuilder {
  return baseEmbed(ctx, `${name}'s wallet`).addFields({
    name: ctx.config.currencyName + " balance",
    value: formatDhWithEmoji(balance, ctx.config),
  });
}
