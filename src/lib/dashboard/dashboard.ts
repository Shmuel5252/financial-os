import type { SerializedMoney } from "@/lib/domain/money/money";

export type DashboardFreshnessReason =
  | "manifest_unavailable"
  | "new_calendar_day"
  | "profile_changed"
  | "source_changed";

export type DashboardAlertCode =
  | "high_credit_utilization"
  | "no_safe_to_spend"
  | "projected_shortfall"
  | "uncertain_income";

export type DashboardEventView = Readonly<{
  amount: SerializedMoney;
  calendarDate: string;
  confirmedBalance: SerializedMoney;
  eventId: string;
  expectedBalance: SerializedMoney;
  kind: "confirmed_income" | "obligation" | "uncertain_income";
  safeCapacity: SerializedMoney;
  safetyMargin: SerializedMoney;
  source:
    | "credit_card"
    | "income_source"
    | "loan"
    | "recurring_expense"
    | "recurring_transaction";
}>;

export type DashboardLimitingPointView = Readonly<{
  calendarDate: string;
  kind:
    | "confirmed_income"
    | "current_liquidity"
    | "margin_boundary"
    | "obligation"
    | "uncertain_income";
  safeCapacity: SerializedMoney;
  source:
    | "credit_card"
    | "income_source"
    | "loan"
    | "policy"
    | "recurring_expense"
    | "recurring_transaction";
}>;

export type DashboardGoalView = Readonly<{
  currentValue: SerializedMoney;
  id: string;
  priority: number;
  targetAmount: SerializedMoney;
  targetDate: string | null;
  title: string;
  type:
    | "custom"
    | "debt_free"
    | "emergency_fund"
    | "monthly_spending"
    | "no_credit_dependency"
    | "no_overdraft"
    | "savings_target";
}>;

export type DashboardTimelineWindowView = Readonly<{
  events: readonly DashboardEventView[];
  truncated: boolean;
}>;

export type DashboardEmptyView = Readonly<{
  goals: readonly DashboardGoalView[];
  goalsTruncated: boolean;
  kind: "empty";
}>;

export type DashboardReadyView = Readonly<{
  alerts: readonly DashboardAlertCode[];
  calculatedAt: string;
  change: Readonly<{
    amount: SerializedMoney;
    direction: "down" | "same" | "up";
  }> | null;
  credit: Readonly<{
    limit: SerializedMoney;
    used: SerializedMoney;
    utilizationBasisPoints: string | null;
  }>;
  evaluationDate: string;
  freshnessReasons: readonly DashboardFreshnessReason[];
  goals: readonly DashboardGoalView[];
  goalsTruncated: boolean;
  horizonDays: number;
  horizonEndDate: string;
  kind: "ready";
  limitingPoint: DashboardLimitingPointView;
  monthly: Readonly<{
    actualExpenses: SerializedMoney;
    actualIncome: SerializedMoney;
    actualNetCashFlow: SerializedMoney;
    calendarMonth: string;
    confirmedForecastIncome: SerializedMoney;
    scheduledObligations: SerializedMoney;
    uncertainForecastIncome: SerializedMoney;
  }>;
  safeToSpend: SerializedMoney;
  safetyMargin: SerializedMoney;
  snapshotId: string;
  stale: boolean;
  summary: Readonly<{
    accountBalance: SerializedMoney;
    availableCash: SerializedMoney;
    debtBalance: SerializedMoney;
    futureConfirmedBalance: SerializedMoney;
    futureExpectedBalance: SerializedMoney;
    savingsBalance: SerializedMoney;
    shortfall: SerializedMoney;
  }>;
  timeZone: string;
  timeline: Readonly<{
    fourteenDays: DashboardTimelineWindowView;
    sevenDays: DashboardTimelineWindowView;
    thirtyDays: DashboardTimelineWindowView;
  }>;
}>;

export type DashboardView = DashboardEmptyView | DashboardReadyView;
