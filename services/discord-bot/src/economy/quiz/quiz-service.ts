import { randomUUID } from "node:crypto";
import type { EconomyConfig } from "../economy-config.js";
import { secureRandomInt, shuffle, type RandomInt } from "../rng.js";
import type { EconomyStore } from "../store.js";
import {
  BRANDS,
  COUNTRIES,
  type Brand,
  type Country,
  type QuizKind,
} from "./quiz-data.js";

/** An answer that arrives this long after the time limit still counts as late. */
const NETWORK_GRACE_MS = 1_000;
const OPTION_COUNT = 4;

/** What a round shows. The picture itself is drawn by the caller. */
export type QuizSubject =
  | { kind: "flag"; country: Country }
  | { kind: "map"; country: Country }
  | { kind: "logo"; brand: Brand };

export type QuizRound = {
  id: string;
  userId: string;
  kind: QuizKind;
  subject: QuizSubject;
  /** The answer buttons, in order. */
  options: string[];
  correctIndex: number;
  startedAtMs: number;
  /** After this moment the round is over and pays nothing. */
  deadlineMs: number;
};

export type QuizPools = {
  flag: readonly Country[];
  map: readonly Country[];
  logo: readonly Brand[];
};

export type StartResult =
  | { ok: true; round: QuizRound }
  | { ok: false; reason: "cooldown"; nextAt: Date }
  | { ok: false; reason: "unavailable" };

export type AnswerResult =
  | {
      ok: true;
      outcome: "correct" | "wrong" | "late";
      reward: number;
      elapsedMs: number;
      round: QuizRound;
      chosenIndex: number;
      /** The wallet after the reward, or null when nothing was paid. */
      balance: number | null;
    }
  | { ok: false; reason: "not_found" | "not_owner" | "invalid_choice" };

/**
 * DH for a correct answer: the maximum for an instant answer, falling in a
 * straight line to the minimum at the last second. Nothing after the limit.
 */
export function quizReward(
  elapsedMs: number,
  config: Pick<EconomyConfig, "quizMinReward" | "quizMaxReward" | "quizTimeLimitSeconds">,
): number {
  const limitMs = config.quizTimeLimitSeconds * 1000;
  if (!Number.isFinite(elapsedMs) || elapsedMs > limitMs + NETWORK_GRACE_MS) {
    return 0;
  }
  const fraction = Math.min(1, Math.max(0, elapsedMs / limitMs));
  const span = config.quizMaxReward - config.quizMinReward;
  return Math.round(config.quizMaxReward - span * fraction);
}

function subjectName(subject: QuizSubject): string {
  return subject.kind === "logo" ? subject.brand.name : subject.country.name;
}

type QuizServiceDeps = {
  store: EconomyStore;
  config: EconomyConfig;
  pools?: Partial<QuizPools>;
  clock?: () => number;
  rand?: RandomInt;
  newId?: () => string;
};

export class QuizService {
  private readonly store: EconomyStore;
  private readonly config: EconomyConfig;
  private readonly clock: () => number;
  private readonly rand: RandomInt;
  private readonly newId: () => string;
  private pools: QuizPools;
  private readonly rounds = new Map<string, QuizRound>();
  private readonly cooldowns = new Map<string, number>();

  constructor(deps: QuizServiceDeps) {
    this.store = deps.store;
    this.config = deps.config;
    this.clock = deps.clock ?? Date.now;
    this.rand = deps.rand ?? secureRandomInt;
    this.newId = deps.newId ?? (() => randomUUID().slice(0, 8));
    this.pools = {
      flag: deps.pools?.flag ?? COUNTRIES,
      map: deps.pools?.map ?? COUNTRIES.filter((country) => country.numeric !== undefined),
      logo: deps.pools?.logo ?? BRANDS,
    };
  }

  /**
   * Starts the clock when the question is actually on screen, so the time spent
   * drawing the picture is never held against the player.
   */
  restartClock(roundId: string): QuizRound | null {
    const round = this.rounds.get(roundId);
    if (!round) {
      return null;
    }
    const now = this.clock();
    round.startedAtMs = now;
    round.deadlineMs = now + this.config.quizTimeLimitSeconds * 1000;
    return round;
  }

  /** Throws a round away without a trace (used when the picture cannot be drawn). */
  cancel(roundId: string): void {
    const round = this.rounds.get(roundId);
    if (round) {
      this.rounds.delete(roundId);
      this.cooldowns.delete(`${round.userId}:${round.kind}`);
    }
  }

  /** Replaces a pool, for example after checking which maps and logos can be drawn. */
  setPool<K extends QuizKind>(kind: K, items: QuizPools[K]): void {
    this.pools = { ...this.pools, [kind]: items };
  }

  poolSize(kind: QuizKind): number {
    return this.pools[kind].length;
  }

  private pickSubject(kind: QuizKind): QuizSubject | null {
    const pool = this.pools[kind];
    if (pool.length < OPTION_COUNT) {
      return null;
    }
    const index = this.rand(pool.length);
    if (kind === "logo") {
      return { kind, brand: pool[index] as Brand };
    }
    return { kind, country: pool[index] as Country };
  }

  private prune(now: number): void {
    for (const [id, round] of this.rounds) {
      if (round.deadlineMs + 60_000 < now) {
        this.rounds.delete(id);
      }
    }
    for (const [key, until] of this.cooldowns) {
      if (until < now) {
        this.cooldowns.delete(key);
      }
    }
  }

  start(userId: string, kind: QuizKind): StartResult {
    const now = this.clock();
    this.prune(now);
    const cooldownKey = `${userId}:${kind}`;
    const until = this.cooldowns.get(cooldownKey);
    if (until !== undefined && until > now) {
      return { ok: false, reason: "cooldown", nextAt: new Date(until) };
    }
    const subject = this.pickSubject(kind);
    if (!subject) {
      return { ok: false, reason: "unavailable" };
    }
    const correct = subjectName(subject);
    const pool = this.pools[kind] as ReadonlyArray<Country | Brand>;
    const others = shuffle(
      pool
        .map((item) => item.name)
        .filter((name) => name !== correct),
      this.rand,
    ).slice(0, OPTION_COUNT - 1);
    const options = shuffle([correct, ...others], this.rand);
    const limitMs = this.config.quizTimeLimitSeconds * 1000;
    const round: QuizRound = {
      id: this.newId(),
      userId,
      kind,
      subject,
      options,
      correctIndex: options.indexOf(correct),
      startedAtMs: now,
      deadlineMs: now + limitMs,
    };
    this.rounds.set(round.id, round);
    this.cooldowns.set(cooldownKey, now + this.config.quizCooldownSeconds * 1000);
    return { ok: true, round };
  }

  /** One answer per round: the round is closed before anything is paid. */
  async answer(roundId: string, userId: string, chosenIndex: number): Promise<AnswerResult> {
    const round = this.rounds.get(roundId);
    if (!round) {
      return { ok: false, reason: "not_found" };
    }
    if (round.userId !== userId) {
      return { ok: false, reason: "not_owner" };
    }
    if (!Number.isInteger(chosenIndex) || chosenIndex < 0 || chosenIndex >= round.options.length) {
      return { ok: false, reason: "invalid_choice" };
    }
    this.rounds.delete(roundId);

    const elapsedMs = Math.max(0, this.clock() - round.startedAtMs);
    const correct = chosenIndex === round.correctIndex;
    const reward = correct ? quizReward(elapsedMs, this.config) : 0;
    if (!correct) {
      return { ok: true, outcome: "wrong", reward: 0, elapsedMs, round, chosenIndex, balance: null };
    }
    if (reward <= 0) {
      return { ok: true, outcome: "late", reward: 0, elapsedMs, round, chosenIndex, balance: null };
    }
    const credit = await this.store.credit({
      userId,
      amount: reward,
      kind: `quiz_${round.kind}`,
      idempotencyKey: `quiz:${round.kind}:${round.id}:${userId}`,
      note: subjectName(round.subject),
    });
    return {
      ok: true,
      outcome: "correct",
      reward,
      elapsedMs,
      round,
      chosenIndex,
      balance: credit.balance,
    };
  }

  /**
   * Called when the time is up. Returns the round when it was still open (so
   * the message can be updated), or null when it was already answered.
   */
  expire(roundId: string): QuizRound | null {
    const round = this.rounds.get(roundId);
    if (!round) {
      return null;
    }
    this.rounds.delete(roundId);
    return round;
  }
}
