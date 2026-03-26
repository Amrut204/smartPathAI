import fs from "node:fs/promises";
import path from "node:path";
import "dotenv/config";

const OUTPUT_DIR = path.resolve(process.cwd(), "storage_reports", "aws-budgets");

function ensureString(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function getMonthStartIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0)).toISOString().replace(".000", "");
}

async function main() {
  const accountId = ensureString(process.env.AWS_ACCOUNT_ID, "<AWS_ACCOUNT_ID>");
  const alertEmail = ensureString(process.env.BILLING_ALERT_EMAIL, "<billing-alert@example.com>");
  const monthlyCostUsd = ensureString(process.env.AWS_S3_BUDGET_LIMIT_USD, "1");

  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const budget = {
    Budget: {
      BudgetName: "smartpathai-s3-guardrail-monthly",
      BudgetLimit: {
        Amount: monthlyCostUsd,
        Unit: "USD",
      },
      TimeUnit: "MONTHLY",
      BudgetType: "COST",
      CostFilters: {
        Service: ["Amazon Simple Storage Service"],
      },
      TimePeriod: {
        Start: getMonthStartIso(),
      },
      CostTypes: {
        IncludeCredit: false,
        IncludeDiscount: true,
        IncludeOtherSubscription: true,
        IncludeRecurring: true,
        IncludeRefund: false,
        IncludeSubscription: true,
        IncludeSupport: true,
        IncludeTax: true,
        IncludeUpfront: true,
        UseAmortized: false,
        UseBlended: false,
      },
    },
  };

  const notifications = {
    NotificationsWithSubscribers: [
      {
        Notification: {
          NotificationType: "ACTUAL",
          ComparisonOperator: "GREATER_THAN",
          Threshold: 50,
          ThresholdType: "PERCENTAGE",
        },
        Subscribers: [
          {
            SubscriptionType: "EMAIL",
            Address: alertEmail,
          },
        ],
      },
      {
        Notification: {
          NotificationType: "ACTUAL",
          ComparisonOperator: "GREATER_THAN",
          Threshold: 80,
          ThresholdType: "PERCENTAGE",
        },
        Subscribers: [
          {
            SubscriptionType: "EMAIL",
            Address: alertEmail,
          },
        ],
      },
      {
        Notification: {
          NotificationType: "ACTUAL",
          ComparisonOperator: "GREATER_THAN",
          Threshold: 100,
          ThresholdType: "PERCENTAGE",
        },
        Subscribers: [
          {
            SubscriptionType: "EMAIL",
            Address: alertEmail,
          },
        ],
      },
    ],
  };

  const command = [
    "aws budgets create-budget",
    `  --account-id ${accountId}`,
    "  --budget file://storage_reports/aws-budgets/s3-budget.json",
    "  --notifications-with-subscribers file://storage_reports/aws-budgets/s3-budget-notifications.json",
  ].join(" \\\n");

  await Promise.all([
    fs.writeFile(path.join(OUTPUT_DIR, "s3-budget.json"), `${JSON.stringify(budget, null, 2)}\n`, "utf8"),
    fs.writeFile(path.join(OUTPUT_DIR, "s3-budget-notifications.json"), `${JSON.stringify(notifications, null, 2)}\n`, "utf8"),
    fs.writeFile(path.join(OUTPUT_DIR, "create-budget-command.txt"), `${command}\n`, "utf8"),
  ]);

  console.log(JSON.stringify({
    outputDir: OUTPUT_DIR,
    files: [
      "s3-budget.json",
      "s3-budget-notifications.json",
      "create-budget-command.txt",
    ],
    accountId,
    alertEmail,
    monthlyCostUsd,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

