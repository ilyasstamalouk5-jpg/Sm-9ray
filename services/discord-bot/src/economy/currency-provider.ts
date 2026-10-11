import type {
  CurrencyRewardEvent,
  CurrencyRewardProvider,
  CurrencyRewardResult,
} from "../rewards/currency-reward-provider.js";
import type { EconomyStore } from "./store.js";

/**
 * Plugs the wallet into the existing milestone reward system. The wallet
 * ledger enforces one payout per member per milestone with a unique key, so
 * even if the milestone code retries, the Dirhams are paid only once.
 */
export class WalletCurrencyRewardProvider implements CurrencyRewardProvider {
  readonly available = true;

  constructor(private readonly store: EconomyStore) {}

  async awardCurrency(event: CurrencyRewardEvent): Promise<CurrencyRewardResult> {
    await this.store.credit({
      userId: event.discordUserId,
      amount: event.amount,
      kind: "milestone_reward",
      idempotencyKey: `milestone:${event.idempotencyKey}`,
      note: `Milestone ${event.milestoneId}`,
    });
    return { status: "issued" };
  }
}
