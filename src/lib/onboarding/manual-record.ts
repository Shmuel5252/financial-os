import { z } from "zod";

import { calendarDateSchema } from "@/lib/domain/time/financial-time";
import {
  moneyInputSchema,
  parseMajorMoney,
} from "@/lib/domain/money/money-input";
import { money, type Money } from "@/lib/domain/money/money";
import { InputValidationError } from "@/lib/errors/application-error";
import { parseUntrusted } from "@/lib/validation/parse-untrusted";

const moneyDomainSchema = z.object({
  amountMinor: z.bigint(),
  currency: z.string().regex(/^[A-Z]{3}$/),
}).transform((value) => money(value.amountMinor, value.currency));

function moneyInputWithMinimum(minimum: bigint) {
  return moneyInputSchema.transform((value, context) => {
    try {
      const parsed = parseMajorMoney(value);

      if (parsed.amountMinor < minimum) {
        context.addIssue({
          code: "custom",
          message:
            minimum === 0n
              ? "Amount cannot be negative."
              : "Amount must be greater than zero.",
        });
        return z.NEVER;
      }

      return parsed;
    } catch (error) {
      context.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "Invalid money amount.",
      });
      return z.NEVER;
    }
  });
}

const anyMoneyInputSchema = moneyInputSchema.transform((value, context) => {
  try {
    return parseMajorMoney(value);
  } catch (error) {
    context.addIssue({
      code: "custom",
      message: error instanceof Error ? error.message : "Invalid money amount.",
    });
    return z.NEVER;
  }
});

const positiveMoneyInputSchema = moneyInputWithMinimum(1n);
const nonNegativeMoneyInputSchema = moneyInputWithMinimum(0n);
const positiveMoneyDomainSchema = moneyDomainSchema.refine(
  (value) => value.amountMinor > 0n,
  "Amount must be greater than zero.",
);
const nonNegativeMoneyDomainSchema = moneyDomainSchema.refine(
  (value) => value.amountMinor >= 0n,
  "Amount cannot be negative.",
);

const namedSchema = {
  name: z.string().trim().min(1).max(100),
};

const incomeShape = {
  ...namedSchema,
  certaintyBps: z.number().int().min(0).max(10_000),
  destination: z.enum(["bank_account", "cash", "savings", "investments"]),
  expectedDate: calendarDateSchema,
  frequency: z.enum([
    "one_time",
    "weekly",
    "biweekly",
    "monthly",
    "quarterly",
    "annual",
    "irregular",
  ]),
};

const accountShape = {
  ...namedSchema,
  type: z.enum(["bank", "cash", "savings", "investments"]),
};

const cardShape = {
  ...namedSchema,
  billingDay: z.number().int().min(1).max(31),
  issuer: z.string().trim().min(1).max(100),
};

const expenseShape = {
  ...namedSchema,
  category: z.enum([
    "housing",
    "utilities",
    "insurance",
    "communications",
    "children",
    "subscriptions",
    "transport",
    "food",
    "debt_payment",
    "other",
  ]),
  frequency: z.enum([
    "weekly",
    "monthly",
    "quarterly",
    "annual",
    "irregular",
  ]),
  nextDueDate: calendarDateSchema,
};

const loanShape = {
  ...namedSchema,
  annualInterestRateBps: z.number().int().min(0).max(100_000),
  endDate: calendarDateSchema.nullable(),
  nextPaymentDate: calendarDateSchema,
};

const goalShape = {
  title: z.string().trim().min(1).max(120),
  priority: z.number().int().min(1).max(5),
  targetDate: calendarDateSchema.nullable(),
  type: z.enum([
    "debt_free",
    "no_overdraft",
    "no_credit_dependency",
    "emergency_fund",
    "savings_target",
    "monthly_spending",
    "custom",
  ]),
};

const incomeInputSchema = z.object({
  ...incomeShape,
  amount: positiveMoneyInputSchema,
});
const incomeDomainSchema = z.object({
  ...incomeShape,
  amount: positiveMoneyDomainSchema,
});

const accountInputSchema = z.object({
  ...accountShape,
  balance: anyMoneyInputSchema,
});
const accountDomainSchema = z.object({
  ...accountShape,
  balance: moneyDomainSchema,
});

const cardInputSchema = z.object({
  ...cardShape,
  limit: nonNegativeMoneyInputSchema,
  used: nonNegativeMoneyInputSchema,
});
const cardDomainSchema = z.object({
  ...cardShape,
  limit: nonNegativeMoneyDomainSchema,
  used: nonNegativeMoneyDomainSchema,
});

const expenseInputSchema = z.object({
  ...expenseShape,
  amount: positiveMoneyInputSchema,
});
const expenseDomainSchema = z.object({
  ...expenseShape,
  amount: positiveMoneyDomainSchema,
});

const loanInputSchema = z
  .object({
    ...loanShape,
    monthlyPayment: positiveMoneyInputSchema,
    originalAmount: positiveMoneyInputSchema,
    remainingBalance: nonNegativeMoneyInputSchema,
  })
  .superRefine((value, context) => {
    const currencies = new Set([
      value.monthlyPayment.currency,
      value.originalAmount.currency,
      value.remainingBalance.currency,
    ]);

    if (currencies.size !== 1) {
      context.addIssue({
        code: "custom",
        message: "All loan amounts must use the same currency.",
      });
    }

    if (value.remainingBalance.amountMinor > value.originalAmount.amountMinor) {
      context.addIssue({
        code: "custom",
        message: "Remaining balance cannot exceed the original amount.",
        path: ["remainingBalance"],
      });
    }
  });
const loanDomainSchema = z
  .object({
    ...loanShape,
    monthlyPayment: positiveMoneyDomainSchema,
    originalAmount: positiveMoneyDomainSchema,
    remainingBalance: nonNegativeMoneyDomainSchema,
  })
  .superRefine((value, context) => {
    const currencies = new Set([
      value.monthlyPayment.currency,
      value.originalAmount.currency,
      value.remainingBalance.currency,
    ]);

    if (currencies.size !== 1) {
      context.addIssue({
        code: "custom",
        message: "All loan amounts must use the same currency.",
      });
    }

    if (value.remainingBalance.amountMinor > value.originalAmount.amountMinor) {
      context.addIssue({
        code: "custom",
        message: "Remaining balance cannot exceed the original amount.",
        path: ["remainingBalance"],
      });
    }
  });

const safetyMarginInputSchema = z.discriminatedUnion("kind", [
  z.object({
    amount: nonNegativeMoneyInputSchema,
    kind: z.literal("fixed"),
  }),
  z.object({
    basisPoints: z.number().int().min(0).max(10_000),
    kind: z.literal("income_percentage"),
  }),
]);
const safetyMarginDomainSchema = z.discriminatedUnion("kind", [
  z.object({
    amount: nonNegativeMoneyDomainSchema,
    kind: z.literal("fixed"),
  }),
  z.object({
    basisPoints: z.number().int().min(0).max(10_000),
    kind: z.literal("income_percentage"),
  }),
]);

const goalInputSchema = z.object({
  ...goalShape,
  currentValue: nonNegativeMoneyInputSchema,
  startingValue: nonNegativeMoneyInputSchema,
  targetAmount: positiveMoneyInputSchema,
}).superRefine((value, context) => {
  const currencies = new Set([
    value.currentValue.currency,
    value.startingValue.currency,
    value.targetAmount.currency,
  ]);

  if (currencies.size !== 1) {
    context.addIssue({
      code: "custom",
      message: "All goal amounts must use the same currency.",
    });
  }
});
const goalDomainSchema = z.object({
  ...goalShape,
  currentValue: nonNegativeMoneyDomainSchema,
  startingValue: nonNegativeMoneyDomainSchema,
  targetAmount: positiveMoneyDomainSchema,
}).superRefine((value, context) => {
  const currencies = new Set([
    value.currentValue.currency,
    value.startingValue.currency,
    value.targetAmount.currency,
  ]);

  if (currencies.size !== 1) {
    context.addIssue({
      code: "custom",
      message: "All goal amounts must use the same currency.",
    });
  }
});

const recordIdSchema = z.string().regex(/^[0-9a-f]{24}$/i);
export const transactionCategorySchema = z.enum([
  "housing",
  "utilities",
  "insurance",
  "communications",
  "children",
  "subscriptions",
  "transport",
  "food",
  "debt_payment",
  "salary",
  "benefits",
  "transfer",
  "savings",
  "vehicle",
  "entertainment",
  "shopping",
  "restaurants",
  "other",
]);

const transactionShape = {
  accountId: recordIdSchema,
  category: transactionCategorySchema,
  confidenceBps: z.number().int().min(0).max(10_000),
  date: calendarDateSchema,
  destinationAccountId: recordIdSchema.nullable(),
  merchant: z.string().trim().min(1).max(120).nullable(),
  notes: z.string().trim().max(500).nullable(),
  recurring: z.boolean(),
  refundOfTransactionId: recordIdSchema.nullable().default(null),
  type: z.enum(["income", "expense", "refund", "transfer"]),
};

function validateTransactionRelationships(
  value: Readonly<{
    accountId: string;
    destinationAccountId: string | null;
    refundOfTransactionId: string | null;
    type: "income" | "expense" | "refund" | "transfer";
  }>,
  context: z.RefinementCtx,
) {
  if (value.type === "transfer") {
    if (value.destinationAccountId === null) {
      context.addIssue({
        code: "custom",
        message: "A transfer requires a destination account.",
        path: ["destinationAccountId"],
      });
    } else if (value.destinationAccountId === value.accountId) {
      context.addIssue({
        code: "custom",
        message: "Transfer accounts must be different.",
        path: ["destinationAccountId"],
      });
    }
  } else if (value.destinationAccountId !== null) {
    context.addIssue({
      code: "custom",
      message: "Only transfers may include a destination account.",
      path: ["destinationAccountId"],
    });
  }

  if (value.type === "refund") {
    if (value.refundOfTransactionId === null) {
      context.addIssue({
        code: "custom",
        message: "A refund requires the original expense transaction.",
        path: ["refundOfTransactionId"],
      });
    }
  } else if (value.refundOfTransactionId !== null) {
    context.addIssue({
      code: "custom",
      message: "Only refunds may reference an original transaction.",
      path: ["refundOfTransactionId"],
    });
  }
}

const transactionInputSchema = z
  .object({
    ...transactionShape,
    amount: positiveMoneyInputSchema,
  })
  .superRefine(validateTransactionRelationships);
const transactionDomainSchema = z
  .object({
    ...transactionShape,
    amount: positiveMoneyDomainSchema,
  })
  .superRefine(validateTransactionRelationships);

const recurringTransactionShape = {
  accountId: recordIdSchema,
  active: z.boolean(),
  category: transactionCategorySchema,
  endDate: calendarDateSchema.nullable(),
  frequency: z.enum([
    "weekly",
    "biweekly",
    "monthly",
    "quarterly",
    "annual",
  ]),
  interval: z.number().int().min(1).max(365),
  merchant: z.string().trim().min(1).max(120).nullable(),
  name: z.string().trim().min(1).max(100),
  nextOccurrenceDate: calendarDateSchema,
  startDate: calendarDateSchema,
  type: z.enum(["income", "expense"]),
};

function validateRecurringDates(
  value: Readonly<{
    endDate: string | null;
    nextOccurrenceDate: string;
    startDate: string;
  }>,
  context: z.RefinementCtx,
) {
  if (value.endDate !== null && value.endDate < value.startDate) {
    context.addIssue({
      code: "custom",
      message: "The recurrence end date cannot precede its start date.",
      path: ["endDate"],
    });
  }

  if (value.nextOccurrenceDate < value.startDate) {
    context.addIssue({
      code: "custom",
      message: "The next occurrence cannot precede the recurrence start date.",
      path: ["nextOccurrenceDate"],
    });
  }

  if (
    value.endDate !== null &&
    value.nextOccurrenceDate > value.endDate
  ) {
    context.addIssue({
      code: "custom",
      message: "The next occurrence cannot follow the recurrence end date.",
      path: ["nextOccurrenceDate"],
    });
  }
}

const recurringTransactionInputSchema = z
  .object({
    ...recurringTransactionShape,
    amount: positiveMoneyInputSchema,
  })
  .superRefine(validateRecurringDates);
const recurringTransactionDomainSchema = z
  .object({
    ...recurringTransactionShape,
    amount: positiveMoneyDomainSchema,
  })
  .superRefine(validateRecurringDates);

const savingsShape = {
  accountIdentifierLast4: z.string().regex(/^\d{4}$/).nullable(),
  availability: z.enum(["liquid", "fixed_term", "other"]),
  institution: z.string().trim().min(1).max(100).nullable(),
  maturityDate: calendarDateSchema.nullable(),
  name: z.string().trim().min(1).max(100),
};

function validateSavingsMaturity(
  value: Readonly<{
    availability: "liquid" | "fixed_term" | "other";
    maturityDate: string | null;
  }>,
  context: z.RefinementCtx,
) {
  if (value.availability === "fixed_term" && value.maturityDate === null) {
    context.addIssue({
      code: "custom",
      message: "A fixed-term saving requires a maturity date.",
      path: ["maturityDate"],
    });
  }

  if (value.availability !== "fixed_term" && value.maturityDate !== null) {
    context.addIssue({
      code: "custom",
      message: "Only fixed-term savings may include a maturity date.",
      path: ["maturityDate"],
    });
  }
}

const savingsInputSchema = z
  .object({
    ...savingsShape,
    balance: nonNegativeMoneyInputSchema,
  })
  .superRefine(validateSavingsMaturity);
const savingsDomainSchema = z
  .object({
    ...savingsShape,
    balance: nonNegativeMoneyDomainSchema,
  })
  .superRefine(validateSavingsMaturity);

export const onboardingSectionSchema = z.enum([
  "income",
  "accounts",
  "cards",
  "expenses",
  "loans",
  "safety_margin",
  "goals",
]);

export const manualSectionSchema = z.enum([
  ...onboardingSectionSchema.options,
  "transactions",
  "recurring_transactions",
  "savings",
]);

export const createManualRecordCommandSchema = z.object({
  fields: z.unknown(),
  idempotencyKey: z.string().uuid(),
});

export const updateManualRecordCommandSchema = z.object({
  expectedVersion: z.number().int().positive(),
  fields: z.unknown(),
  id: z.string().regex(/^[0-9a-f]{24}$/i),
});

export const deleteManualRecordCommandSchema = z.object({
  expectedVersion: z.number().int().positive(),
  id: z.string().regex(/^[0-9a-f]{24}$/i),
});

export const manualRecordPageQuerySchema = z.object({
  cursor: recordIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type ManualSection = z.infer<typeof manualSectionSchema>;
export type OnboardingSection = z.infer<typeof onboardingSectionSchema>;

export const manualSectionInputSchemas = {
  accounts: accountInputSchema,
  cards: cardInputSchema,
  expenses: expenseInputSchema,
  goals: goalInputSchema,
  income: incomeInputSchema,
  loans: loanInputSchema,
  recurring_transactions: recurringTransactionInputSchema,
  safety_margin: safetyMarginInputSchema,
  savings: savingsInputSchema,
  transactions: transactionInputSchema,
} as const;

export const manualSectionDomainSchemas = {
  accounts: accountDomainSchema,
  cards: cardDomainSchema,
  expenses: expenseDomainSchema,
  goals: goalDomainSchema,
  income: incomeDomainSchema,
  loans: loanDomainSchema,
  recurring_transactions: recurringTransactionDomainSchema,
  safety_margin: safetyMarginDomainSchema,
  savings: savingsDomainSchema,
  transactions: transactionDomainSchema,
} as const;

export type ManualFields = z.output<
  (typeof manualSectionInputSchemas)[ManualSection]
>;

export type ManualRecord = Readonly<{
  createdAt: Date;
  fields: ManualFields;
  id: string;
  section: ManualSection;
  source: Readonly<{ kind: "manual" }>;
  updatedAt: Date;
  version: number;
}>;

export type SerializedDomainValue =
  | bigint
  | boolean
  | null
  | number
  | string
  | readonly SerializedDomainValue[]
  | Readonly<{ [key: string]: SerializedDomainValue }>;

export type ManualRecordView = Readonly<{
  createdAt: string;
  fields: SerializedDomainValue;
  id: string;
  section: ManualSection;
  source: Readonly<{ kind: "manual" }>;
  updatedAt: string;
  version: number;
}>;

export function parseManualSection(value: unknown): ManualSection {
  return parseUntrusted(manualSectionSchema, value);
}

export function parseOnboardingSection(value: unknown): OnboardingSection {
  return parseUntrusted(onboardingSectionSchema, value);
}

export function parseManualFields(
  section: ManualSection,
  input: unknown,
): ManualFields {
  const result = manualSectionInputSchemas[section].safeParse(input);

  if (!result.success) {
    throw new InputValidationError(
      result.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    );
  }

  return result.data as ManualFields;
}

export function validateManualFields(
  section: ManualSection,
  input: unknown,
): ManualFields {
  const result = manualSectionDomainSchemas[section].safeParse(input);

  if (!result.success) {
    throw new InputValidationError(
      result.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    );
  }

  return result.data as ManualFields;
}

export function collectMoneyValues(value: unknown, result: Money[] = []): Money[] {
  if (
    typeof value === "object" &&
    value !== null &&
    "amountMinor" in value &&
    "currency" in value &&
    typeof value.amountMinor === "bigint" &&
    typeof value.currency === "string"
  ) {
    result.push(money(value.amountMinor, value.currency));
    return result;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectMoneyValues(item, result));
    return result;
  }

  if (typeof value === "object" && value !== null) {
    Object.values(value).forEach((item) => collectMoneyValues(item, result));
  }

  return result;
}

function serializeDomainValue(value: unknown): SerializedDomainValue {
  if (
    typeof value === "object" &&
    value !== null &&
    "amountMinor" in value &&
    "currency" in value &&
    typeof value.amountMinor === "bigint" &&
    typeof value.currency === "string"
  ) {
    return {
      amountMinor: value.amountMinor.toString(),
      currency: value.currency,
    };
  }

  if (Array.isArray(value)) {
    return value.map(serializeDomainValue);
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        serializeDomainValue(item),
      ]),
    );
  }

  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }

  throw new RangeError("Unsupported manual record value.");
}

export function toManualRecordView(record: ManualRecord): ManualRecordView {
  return {
    createdAt: record.createdAt.toISOString(),
    fields: serializeDomainValue(record.fields),
    id: record.id,
    section: record.section,
    source: record.source,
    updatedAt: record.updatedAt.toISOString(),
    version: record.version,
  };
}
