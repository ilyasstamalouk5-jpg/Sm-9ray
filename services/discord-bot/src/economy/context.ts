import type { CurrencyImageService } from "./currency-image.js";
import type { EconomyConfig } from "./economy-config.js";
import type { EconomyService } from "./economy-service.js";
import type { ShopService } from "../shop/shop-service.js";
import type { QuizService } from "./quiz/quiz-service.js";
import type { WeeklyTaskService } from "../weekly/weekly-task-service.js";

export type EconomyContext = {
  config: EconomyConfig;
  service: EconomyService;
  images: CurrencyImageService;
  quiz: QuizService;
  shop: ShopService;
  weekly: WeeklyTaskService;
};

let current: EconomyContext | null = null;

/** Set once at startup. Until then the economy is simply "not enabled". */
export function setEconomyContext(context: EconomyContext | null): void {
  current = context;
}

export function getEconomyContext(): EconomyContext | null {
  return current;
}
