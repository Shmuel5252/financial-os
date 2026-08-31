You are starting a brand-new production-grade application called Financial OS.
The full Product & Engineering Master Plan is included below.
Treat that plan as the long-term product source of truth.
The goal is NOT to quickly generate many screens or rush through the roadmap.
The goal is to build a correct, secure, maintainable financial application whose architecture can support the complete product described in the Master Plan.
Use the current workspace directory as the project root.
Do NOT create another nested project folder such as:
financial-os/financial-os
The current directory IS the Financial OS repository.
Before doing anything else:

- Inspect the current workspace.
- Confirm whether it is empty or contains existing files.
- Do not delete unrelated files without a clear reason.
- Initialize the application directly in the current workspace.
  For this project, priorities are:

1. Financial correctness
2. User data isolation
3. Security
4. Data integrity
5. Clear architecture
6. Testability
7. Maintainability
8. Product correctness
9. UX quality
10. Development speed
    Development speed must NEVER come at the cost of financial correctness or security.
    Never use JavaScript floating-point arithmetic as the source of truth for monetary values.
    Before implementing any Financial Engine logic:

- Choose the canonical representation for money.
- Document the decision.
- Explain why it was chosen.
- Define rounding rules.
- Define currency handling.
- Define conversion boundaries if multiple currencies are introduced later.
- Ensure calculations are deterministic.
  Prefer a representation such as integer minor units (for example agorot/cents) unless there is a documented architectural reason to use another representation.
  The chosen rule must be used consistently across:
- database models
- validation
- APIs
- calculations
- tests
- simulations
- financial snapshots
  Do not allow multiple incompatible money representations across the system.
  The deterministic Financial Engine is the source of truth for financial calculations.
  AI must NEVER become the source of truth for:
- balances
- Safe to Spend
- forecasts
- debt calculations
- goal progress
- budget calculations
- purchase safety
- cash flow
  Claude will eventually act as an explanation and reasoning layer over structured financial results produced by the application.
  AI must not invent financial numbers.
  Financial data isolation is a hard security requirement.
  Every user-owned financial entity must be associated with the authenticated user or an explicitly authorized household context.
  Never trust a userId supplied by the client as authorization.
  Authorization must happen server-side.
  Every data-access pattern must be designed so that one user can never retrieve or mutate another user's financial data.
  Do not rely only on UI restrictions.
  Document the authorization model in ARCHITECTURE.md.
  Preserve this general architecture:
  UI
  ↓
  Next.js Server / API
  ↓
  Application Services
  ↓
  Financial Engine
  ↓
  Data Access Layer
  ↓
  MongoDB
  External systems must be accessed through adapters:
- Claude
- Open Banking
- Notifications
- Analytics / Monitoring
  The UI must NEVER access MongoDB directly.
  Financial business logic must not be scattered across React components or API route handlers.
  Keep financial domain logic isolated and testable.
  External providers must not leak provider-specific models throughout the domain layer.
  The Master Plan describes the final product.
  Do NOT implement all future systems during Phase 0.
  However, avoid architectural decisions that would obviously require destructive rewrites later.
  Create clean boundaries for future modules without prematurely implementing them.
  Examples:
  Open Banking should eventually use an adapter abstraction,
  but Phase 0 does not need a working banking provider.
  Claude should eventually use an AI adapter,
  but Phase 0 does not need the Financial Copilot.
  Households will exist later,
  but Phase 0 should not implement the complete household system.
  Design for extension without building speculative complexity.
  Before implementing application features, create:
- MASTER_PLAN.md
- ARCHITECTURE.md
- IMPLEMENTATION_PLAN.md
- PROGRESS.md
- DECISIONS.md
  Also create other documentation files only when they have a clear purpose.
  Do not create documentation for the sake of documentation.
  Save the complete Master Product & Engineering Plan provided below into:
  MASTER_PLAN.md
  Preserve its product intent.
  You may clean formatting errors if necessary, but do not silently remove product requirements.
  If you identify contradictions, unclear requirements, architectural risks, or missing decisions:
- do not silently invent product requirements;
- record the issue in DECISIONS.md;
- choose a safe provisional engineering decision when development can continue without product clarification.
  The Master Plan represents the long-term product direction.
  Before coding, create an initial architecture document covering at minimum:
- application architecture
- server/client boundaries
- domain boundaries
- authentication architecture
- authorization architecture
- user data isolation
- household-aware future authorization considerations
- MongoDB access strategy
- Data Access Layer
- validation strategy
- money representation
- date/time handling
- financial calculation boundaries
- error handling
- environment configuration
- secrets strategy
- auditability
- testing architecture
- external adapter architecture
- Open Banking future boundary
- Claude future boundary
- deployment architecture
  Do not pretend future implementation exists.
  Clearly distinguish between:
- implemented now
- architectural boundary prepared now
- planned for later
  Convert the Master Plan into an actionable engineering roadmap.
  For every phase define:
- objective
- scope
- dependencies
- major implementation tasks
- data/model implications
- security considerations
- testing requirements
- acceptance criteria
- definition of done
- risks / migration concerns
  Preserve the overall Phase 0 → Phase 20 roadmap unless there is a strong engineering reason to refine the internal milestones.
  You may split large phases into smaller milestones.
  Do not casually reorder product dependencies.
  If you recommend a roadmap change, document why.
  This file is the persistent engineering progress log.
  Keep it updated throughout development.
  For every milestone record:
- what was implemented
- important files created or modified
- tests performed
- build/lint/test status
- decisions made
- unresolved issues
- blockers
- deferred work
- next milestone
  Do not mark something complete unless it is actually implemented and verified.
  Use this as an Architecture / Product Decision Log.
  Record important decisions such as:
- money representation
- MongoDB modeling strategy
- Auth approach
- server authorization model
- validation boundaries
- timestamps/timezone policy
- account ownership strategy
- environment strategy
- test framework
- adapter boundaries
  For each important decision include:
- decision
- reasoning
- alternatives considered when relevant
- consequences
  Do not fill this file with trivial implementation choices.
  The intended stack is:
  Frontend / Full-stack framework:
- Next.js App Router
  Language:
- TypeScript
  Styling:
- Tailwind CSS
  Database:
- MongoDB
  Authentication:
- Auth.js / NextAuth-compatible architecture
  Validation:
- Zod
  AI:
- Anthropic Claude API
  Deployment:
- Vercel
  Secrets:
- Environment variables
  Use current stable versions that are mutually compatible.
  Do not blindly choose the newest dependency if it creates unnecessary instability.
  Avoid unnecessary dependencies.
  Security must be built from the beginning rather than added only during Production Hardening.
  Permanent product language and direction requirement:
- Financial OS is Hebrew-first and RTL-first.
- All Financial OS-controlled user-facing UI defaults to natural Hebrew and right-to-left layout.
- Inherently left-to-right values such as email addresses, URLs, currency codes, technical and account identifiers retain isolated LTR rendering.
- Source code, identifiers, database schemas, API contracts, logs, tests, and engineering documentation remain in English.
- External provider-controlled UI is outside the Financial OS localization boundary.
- User-facing copy must be organized behind a localization boundary so future English or additional locales do not require a major UI rewrite.
- Each phase must add localization and directionality tests for its new user-facing surfaces.
- Localization does not authorize an unrelated visual redesign.
  Phase 0 must establish appropriate foundations for:
- secure environment variable handling
- .env* protection
- server-only secrets
- authenticated server access
- authorization boundaries
- input validation
- safe error responses
- dependency hygiene
- secure cookies/session configuration
- no sensitive data leaking to client bundles
- no credentials committed to Git
  Never place:
- Claude API keys
- MongoDB credentials
- Open Banking tokens
- secrets
  inside client code or committed source files.
  Create .env.example containing placeholders only.
  Verify .gitignore.
  Financial correctness must be test-driven at the domain level.
  Phase 0 should establish the testing foundation required for future:
- unit tests
- integration tests
- E2E tests
  Later Financial Engine tests must include deterministic edge cases such as:
- negative balances
- payments before income
- income after obligations
- multiple credit cards
- uncertain income
- month boundaries
- installments
- duplicate transactions
- missing data
- recurring transactions
- safety margin violations
- future minimum balance
- rounding boundaries
  Do not postpone the ability to test financial logic until the end of the project.
  Do not immediately create every collection listed in the Master Plan.
  Create collections/models when their phase requires them.
  However, define conventions early for:
- IDs
- ownership
- timestamps
- money
- currencies
- soft vs hard deletion where relevant
- auditability
- source metadata
- validation
  Avoid one giant financial document containing the entire user's financial life.
  Avoid tightly coupling unrelated financial domains.
  Financial applications are sensitive to dates.
  Define a consistent policy for:
- timestamps
- user timezone
- transaction dates
- billing dates
- recurring events
- month boundaries
- future projections
  Persist canonical timestamps appropriately and format them according to the user's locale/timezone at presentation boundaries.
  Document the strategy before Timeline Engine implementation.
  Safe to Spend is the core product metric.
  Do not reduce it to:
  current balance - total expenses
  The future engine must evaluate the timeline and determine whether spending money now could cause the projected balance to violate required obligations or the configured Safety Margin at any point in the relevant horizon.
  The exact algorithm belongs to the deterministic Financial Engine and must eventually be thoroughly unit tested.
  Do NOT implement the final Safe to Spend algorithm during Phase 0.
  Preserve the architectural boundary for it.
  Approved Phase 3 Financial Engine policies (2026-08-31):
- The default Safe to Spend evaluation horizon is a rolling 30 calendar days from the explicit evaluation point. Horizon is a typed engine input, not a hard-coded architectural constant.
- Only income with 100% confidence/confirmed certainty may increase core Safe to Spend. Expected or uncertain income remains visible as a separate timeline/result value and never increases the core safety value.
- A percentage Safety Margin is calculated from confirmed income in the applicable calendar month in the user's configured timezone. Uncertain income is excluded. Integer-minor-unit arithmetic and round-half-to-even apply.
- When an obligation and income share a calendar date and no reliable timestamp establishes order, the obligation is processed first. Future reliable timestamps may replace this conservative fallback with actual chronological ordering.
  The application must ultimately be fully useful without Open Banking.
  Manual financial data is a first-class source, not a temporary fake implementation.
  Future Open Banking data should flow through normalization boundaries into the same domain model rather than creating an entirely separate financial system.
  This is important for the architecture.
  Do not integrate Claude during Phase 0 unless a minimal adapter boundary is genuinely required.
  Eventually:
  Financial Data
  → deterministic Financial Engine
  → structured Financial Snapshot
  → Claude explanation/reasoning
  Claude must not receive credentials.
  Claude must not directly modify financial truth.
  Claude responses should eventually distinguish:
  FACT
  INSIGHT
  RECOMMENDATION
  Keep this boundary in mind while designing the architecture.
  Do not:
- use placeholder implementations and call them complete
- hide TypeScript errors
- disable lint rules simply to make checks pass
- use any unnecessarily
- hardcode user IDs
- hardcode financial results
- expose secrets
- bypass authorization
- put core financial logic inside UI components
- silently swallow errors
- duplicate business logic across routes
- make future bank-provider models the core domain model
- create fake implementations merely to satisfy acceptance criteria
  Prefer clear, boring, reliable code over clever abstractions.
  Do NOT attempt to implement all 20 phases in one pass.
  Work phase-by-phase.
  For this FIRST RUN:

1. Inspect the workspace.
2. Read the full Master Plan below.
3. Create the planning/documentation files.
4. Make the foundational architectural decisions required for Phase 0.
5. Implement Phase 0.
6. Add and run appropriate tests.
7. Run lint.
8. Run the production build.
9. Review security-sensitive configuration.
10. Update PROGRESS.md.
11. Update DECISIONS.md.
12. Perform a Phase 0 acceptance review.
    STOP after Phase 0.
    Do NOT begin Phase 1 during this first run.
    I want Phase 0 to be verified before the application begins accumulating product functionality.
    Phase 0 is complete only when the foundation is actually usable and verified.
    Expected Phase 0 outcomes include:

- Next.js application initialized correctly
- TypeScript configured
- Tailwind configured
- clean project structure
- MongoDB connection architecture
- Data Access Layer foundation
- authentication foundation
- server-side authorization pattern established
- Zod validation foundation
- money representation documented
- date/time strategy documented
- environment configuration
- .env.example
- secrets protected
- Git hygiene
- testing foundation
- basic error-handling conventions
- architecture documentation
- implementation roadmap
- successful lint
- successful test run
- successful production build
  If a Phase 0 item cannot be completed because credentials or external configuration are genuinely required, do not fake success.
  Implement everything that can be safely implemented, document the blocker precisely, and explain the exact next action required.
  Do not invent credentials.
  If MongoDB, Google OAuth, Vercel, Anthropic, Open Banking, or another external service requires credentials that are unavailable:
- create the correct configuration boundary
- create placeholder environment variable names
- document setup
- keep secrets out of Git
- continue with everything that does not require those credentials
  Do not replace real authentication with fake authentication and call Phase 0 complete.
  Do not replace real infrastructure with misleading mocks unless the mock is explicitly part of the test architecture.
  If Git is not initialized, initialize it.
  Maintain a clean .gitignore.
  Do not commit secrets.
  Use meaningful commits for coherent milestones rather than one massive final commit where practical.
  Before finishing Phase 0, inspect Git status and ensure unintended files are not being tracked.
  When Phase 0 is finished, provide a concise but complete engineering report containing:
- what was built
- architecture established
- project structure
- money representation decision
- authentication status
- MongoDB status
- testing status
- lint status
- build status
- security checks performed
- environment variables still required
- blockers
- deferred work
- important decisions
- exact next milestone: Phase 1
  Do not claim something was tested if it was not actually tested.
  Everything below this line is the long-term Financial OS Product & Engineering Master Plan.
  Preserve it in MASTER_PLAN.md and use it as the project's product source of truth.

לבנות אפליקציה פיננסית מלאה שעונה למשתמש בכל רגע על 4 שאלות:

1. איפה אני עומד עכשיו?
2. מה צפוי לקרות לכסף שלי בהמשך?
3. כמה באמת בטוח לי להוציא?
4. האם אני מתקדם למטרות הכלכליות שהגדרתי?

האפליקציה אינה רק tracker של הוצאות.
היא צריכה להיות:
Financial Data → Financial Engine → Forecast → Safe to Spend → Goals → Decisions → AI Guidance

היתרה בחשבון אינה שווה לכסף הפנוי.
לדוגמה:
יתרה בבנק:
12,000 ₪

אבל קיימים:
- אשראי שירד: 4,500 ₪
- שכירות: 3,000 ₪
- הלוואה: 800 ₪
- כרית ביטחון: 1,500 ₪

לכן:
Safe to Spend ≠ 12,000 ₪

אלא משהו קרוב ל:
2,200 ₪

המספר החשוב ביותר באפליקציה יהיה:
Safe to Spend

אסור לבנות אותה סביב המצב האישי של משתמש מסוים.
כל משתמש מגדיר במהלך ה-Onboarding:
- הכנסות
- חשבונות בנק
- כרטיסי אשראי
- הוצאות קבועות
- הלוואות
- חובות
- חסכונות
- רמת כרית ביטחון רצויה
- יעדים כלכליים
- מבנה משק הבית
- העדפות פיננסיות

כך אותה מערכת יכולה להתאים ל:
- אדם יחיד
- זוג
- משפחה
- אדם עם משכורת קבועה
- עצמאי עם הכנסה משתנה
- משתמש שנמצא במינוס
- משתמש ללא חובות
- משתמש שחוסך לבית
- משתמש שרוצה לצאת ממסגרות אשראי
- משתמש שרוצה לסגור הלוואות
- משתמש שרוצה להגדיל חיסכון

כל הנתונים חייבים להיות מבודדים לפי userId.
Authentication:
- Google Sign-In
- Email/password ניתן להוסיף בהמשך
- Sessions מאובטחים
- Logout
- Delete Account
- Account Recovery

כל Entity פיננסי מקושר למשתמש.
לדוגמה:
User
→ Accounts
→ Transactions
→ Cards
→ Loans
→ Goals
→ Budgets
→ Forecasts
→ AI conversations

אסור בשום מצב שתהיה גישה לנתונים של משתמש אחר.

בכניסה הראשונה המשתמש עובר תהליך מסודר.
- שם
- מטבע ראשי
- מדינה
- סוג משק בית

לדוגמה:
- משכורת
- עסק
- קצבאות
- הכנסה נוספת
- הכנסה משתנה

לכל הכנסה:
- סכום
- תאריך צפוי
- תדירות
- רמת ודאות
- חשבון בנק
- מזומן
- חשבון חיסכון
- חשבון השקעות

בהתחלה ניתן להזין ידנית.
בהמשך Open Banking.

לכל כרטיס:
- חברת אשראי
- מסגרת
- סכום מנוצל
- מועד חיוב
- חיובים עתידיים

לדוגמה:
- שכירות
- משכנתה
- חשמל
- ארנונה
- ביטוחים
- אינטרנט
- טלפון
- גנים
- מנויים
- סכום מקורי
- יתרה
- תשלום חודשי
- ריבית
- תאריך סיום

המשתמש מגדיר כמה כסף הוא רוצה שתמיד יישאר.
לדוגמה:
1,500 ₪
או:
10% מההכנסה.

זה חלק מרכזי במוצר.

המשתמש נשאל:
"מה אתה רוצה לשנות במצב הכלכלי שלך?"

דוגמאות:
- לצאת מהמינוס
- לחיות רק מההכנסה השוטפת
- להפסיק להשתמש במסגרת אשראי
- לסגור הלוואה
- לחסוך 30,000 ₪
- לבנות קרן חירום
- לחסוך לדירה
- להפחית הוצאות חודשיות
- להגיע ל-X ₪ Safe to Spend

ניתן לבחור כמה יעדים.

לכל Goal:
- title
- type
- targetAmount
- targetDate
- startingValue
- currentValue
- priority
- status

ה-Dashboard הראשי צריך לתת תמונת מצב בתוך מספר שניות.
לדוגמה:
2,730 ₪

מתחת:
"זה הסכום שבטוח לך להוציא עד המשכורת הבאה."

- יתרה כוללת
- חיובים עתידיים
- הכנסות צפויות
- התחייבויות
- חובות
- חסכונות

7 / 14 / 30 ימים קדימה.

לדוגמה:
מסגרת אשראי = 0
64% הושלם

לדוגמה:
"בעוד 4 ימים צפוי חיוב גדול."

לדוגמה:
"החודש ההוצאות הקבועות שלך נמוכות ב-8% מהחודש הקודם."

אחד המנועים החשובים במערכת.
המערכת יוצרת ציר זמן עתידי.

לדוגמה:
1 Sep
Balance: 7,200

3 Sep
Rent -3,200
Balance: 4,000

7 Sep
Credit Card -2,100
Balance: 1,900

10 Sep
Salary +8,000
Balance: 9,900

15 Sep
Loan -800
Balance: 9,100

כך ניתן לזהות מראש:
- נקודות מינוס
- עומס אשראי
- ימים מסוכנים
- תקופות בטוחות יותר לרכישה

כל חישוב כספי משמעותי חייב להתרחש בקוד.
לא ב-Claude.

Financial Engine יהיה deterministic.
הוא מחשב:
- Current Balance
- Available Cash
- Future Balance
- Safe to Spend
- Monthly Burn
- Fixed Expenses
- Variable Expenses
- Debt Load
- Credit Utilization
- Safety Margin
- Savings Rate
- Cash Flow
- Goal Progress

קלט:
- יתרות
- הכנסות צפויות
- התחייבויות
- חיובים עתידיים
- חובות
- תקציב
- כרית ביטחון
- טווח זמן

פלט:
safeToSpend

לדוגמה:
currentCash
- expectedIncome
- requiredExpenses
- debtPayments
- creditCharges
- safetyMargin
= SafeToSpend

המנוע צריך לעבוד על Timeline ולא רק על סכום כולל.
כלומר:
אם החשבון צפוי לרדת מתחת ל-Safety Margin ביום מסוים, Safe to Spend צריך לקחת את זה בחשבון.

כל Transaction:
- id
- userId
- accountId
- amount
- type
- category
- merchant
- date
- source
- recurring
- confidence
- metadata

Sources:
- manual
- open_banking
- imported
- generated

המערכת מסווגת עסקאות.
לדוגמה:
Rami Levy
→ Groceries

Netflix
→ Entertainment

Electric Company
→ Utilities

יש לשמור:
AI prediction

בנפרד מ:
Confirmed Category

כדי שהמשתמש יוכל לתקן.

אפשרות ליצור תקציב.
Categories:
- אוכל
- רכב
- בילויים
- ילדים
- חשבונות
- קניות
- מסעדות
- תחבורה
- אחר

לכל Category:
budget
spent
remaining
forecast

אפשרות מתקדמת.
כל הכנסה מקבלת תפקיד.

לדוגמה:
Salary = 10,000
3,500 Housing
1,500 Food
1,000 Debt
1,000 Saving
1,000 Transport
1,000 Flexible
1,000 Safety

Unallocated:
0

Approved Phase 5 budget policy:

- Budget taxonomy is hybrid: Financial OS ships stable system/default category identifiers, while users may create custom categories and customize user-facing labels, visibility, and order without changing referential identities.
- Only confirmed income is allocatable in the real zero-based budget. Expected or uncertain income is excluded from real allocation and may appear only in an explicitly separate scenario/planning layer.
- Over-allocation is allowed and represented exactly as negative unallocated money / a budget deficit. The deterministic engine, never AI, calculates this truth.
- Rollover is configured per category and defaults to `reset`. Reset categories carry neither positive nor negative remaining amounts into the next month, while preserving the completed month's full surplus/deficit history. Rollover categories carry positive and negative amounts under their stored rollover rules.
- Same-period refunds reduce that period's category spending. Later-period refunds belong to their actual received period and should link to the original transaction where possible; they do not rewrite a closed earlier period.
- Category corrections create immutable correction/adjustment/audit evidence. Reports may present corrected classification and totals, but the original fact, change time, actor, and reason remain explainable.
- The core conservative forecast uses confirmed financial truth only. Uncategorized transactions always affect cash truth fully even when they do not yet contribute to a named category budget.
- Scenario/goal forecasts are separate hypothetical calculations supporting forward simulation and target-seeking. Hypothetical or unrealized income, expense changes, and investment gains never contaminate confirmed balances, allocations, or the core forecast. Deterministic engines calculate numerical truth; future AI may only explain or recommend from those outputs.

מסך ייעודי.

כל Card:
- limit
- used
- available
- billingDate
- upcomingCharge
- installmentTransactions

המערכת צריכה להבדיל בין:
Account Balance

לבין:
Committed Money

מסך Debt Center.
לכל Debt:
- originalAmount
- remainingBalance
- interestRate
- monthlyPayment
- nextPayment
- endDate

מדדים:
Debt Free Date
Monthly Debt Load
Progress

ניתן להוסיף בהמשך אסטרטגיות:
Snowball
Avalanche

Savings Goals.
לדוגמה:
Emergency Fund
Target:
30,000
Current:
12,000
Progress:
40%

Goals יהיו חלק עמוק מהמערכת ולא רשימת משימות.

Goal types:
- debt_free
- no_overdraft
- no_credit_dependency
- emergency_fund
- savings_target
- monthly_spending
- custom

Approved Phase 6 Goal Engine policy (2026-08-31):

- Every goal has a versioned, explicit deterministic canonical metric. AI never decides verified progress or completion.
- Debt freedom measures the remaining balance of an explicit immutable liability scope against zero. Exit-overdraft measures the actual combined balance of an explicit account scope against zero. Adding unrelated liabilities or accounts never silently changes historical meaning.
- Credit independence is a stability metric proved from deterministic Financial Engine evidence that available funds and confirmed income cover the applicable period without increased overdraft, revolving credit, or debt dependence; temporary positive cash is insufficient and the evidence strategy remains extensible for future provider data.
- Emergency-fund and savings goals count only explicitly included verified liquid/savings funds. Emergency-fund targets may be an exact amount or an explicit number of months multiplied deterministically by a verified essential-expense basis. Hypothetical gains are excluded.
- Monthly-spending goals compare actual qualifying spending in the applicable profile-timezone budget/calendar period with a configured ceiling, preserving Phase 5 refund, correction, and category rules.
- Custom financial goals must declare an explicit measurable metric and target. If available Financial OS data cannot verify them, they remain clearly manual/unverified rather than being interpreted by AI.
- A goal receives a provenance-bearing baseline when active tracking begins. Existing Phase 1 starting/current values remain user-reported evidence; an engine-derived verified baseline is stored separately and never silently replaces manual evidence.
- Progress outputs include baseline, current and target values, remaining gap, direction-aware normalized percentage, trend/direction, evaluation time, and evidence provenance. Raw values may exceed targets and regression is never hidden.
- Deterministic 25/50/75/100 percent milestones are immutable historical events. The milestone model permits later goal-specific thresholds without changing the core engine.
- Point-in-time accumulation/reduction goals may complete when the deterministic target is met. Stability goals require an explicit sustained-success duration whose default is 30 calendar days and use a pending-confirmation state until satisfied.
- Completion history is never erased. Later violations append regression/reopen evidence and distinguish historical achievement from current maintenance.
- Presentation-only edits do not change financial meaning. Material changes to target, deadline, metric, scope, target basis, sustained duration, or other success semantics create a new immutable goal version; old evidence remains linked to its original version.
- Progress evidence is append-only and created only for meaningful deterministic evaluations such as relevant engine snapshots, budget closes, milestone/threshold changes, sustained confirmation, completion, regression/reopen, material version changes, or approved periodic evaluation events—not page reads.
- Evidence retains goal/version, evaluation time, source references and metric inputs, including the applicable Financial Engine snapshot and budget period where relevant, so a historical result is explainable without mutable reconstruction.
- Verified progress and projected/what-if outcomes are separate types. Scenario results may later consume verified goal definitions but uncertain income, hypothetical gains, and other projections never change verified progress until they become confirmed financial facts.
- Dependency direction remains: financial truth -> deterministic Financial Engine -> verified Goal Engine -> deterministic scenario/projection layer -> AI explanation. Phase 6 implements only verified goals, current roadmap analytics, and the minimal existing Phase 5 scenario separation needed to preserve this boundary.

כל Goal מקבל:
Baseline
Target
Deadline
Progress
Trend
Recommended Action

Goal:
"לחיות רק ממה שנכנס"

המערכת יכולה למדוד:
Income:
10,000

Monthly Expenses:
11,300

Gap:
-1,300

Goal Progress:
Current:
113% מההכנסה

Target:
≤100%

ולאחר מכן:
103%
101%
98%

Goal Complete.

המשתמש מזין:
Purchase:
3,000 ₪

Date:
Today

Payment:
One-time

המערכת מחשבת מחדש את Timeline.

תוצאה:
SAFE
CAUTION
UNSAFE

לדוגמה:
"ניתן לבצע את הרכישה, אך כרית הביטחון שלך תרד מ-2,500 ₪ ל-700 ₪."

או:
"אם תחכה עד ה-10 לחודש, הרכישה תהיה בטוחה יותר."

בהמשך:
"מה יקרה אם אקח הלוואה?"
"מה יקרה אם אקנה רכב?"
"מה יקרה אם ההכנסה תרד ב-20%?"
"מה יקרה אם אסגור את כרטיס האשראי?"
"מה יקרה אם אחסוך 1,000 ₪ כל חודש?"

Claude הוא שכבת ההסבר והשיחה.
לא מקור האמת המספרי.

Claude מקבל structured financial context.

לדוגמה:
{
  "safeToSpend": 2730,
  "balance": 12000,
  "upcomingExpenses": 7200,
  "income": 5000,
  "safetyMargin": 2000
}

ואז המשתמש יכול לשאול:
"אני יכול לקנות מחשב ב-4,000?"

Claude מבקש מה-Simulation Engine לבצע חישוב.
לא ממציא תשובה.

Claude יכול:
- להסביר מצב
- לסכם חודש
- לזהות דפוסים
- להסביר למה Safe to Spend ירד
- לענות על שאלות
- להציע דרכי פעולה
- לעזור להגדיר יעד
- להסביר עסקאות חריגות
- ליצור Monthly Review

Claude לא צריך:
- לחשב יתרות
- לקבוע Financial Truth
- לבצע פעולה בנקאית
- לקבל credentials

כל תשובת AI פיננסית משמעותית צריכה להסתמך על Data Snapshot.

יש להפריד:
FACT
INSIGHT
RECOMMENDATION

לדוגמה:
Fact:
ההוצאות החודשיות שלך הן 8,400 ₪.

Insight:
זה 12% יותר מהממוצע שלך.

Recommendation:
אפשר לבדוק את קטגוריית המסעדות.

שלב מתקדם מרכזי.
Flow:
Bank
→ Licensed Open Banking Provider
→ Financial OS Backend
→ Normalization Layer
→ Transactions DB
→ Financial Engine

לעולם לא לשמור:
Bank username
Bank password

המשתמש נותן הרשאה דרך ספק הבנקאות הפתוחה.

Sync כולל:
- accounts
- balances
- transactions
- credit
- cards
- timestamps
- sync status

יש לטפל ב:
- expired consent
- duplicate transaction
- pending transaction
- modified transaction
- sync failure
- provider downtime

האפליקציה חייבת לעבוד גם בלי בנק.

המשתמש יכול:
- להזין יתרה
- להוסיף עסקה
- להוסיף כרטיס
- להוסיף הלוואה
- להוסיף הכנסה

כך הפיתוח אינו תלוי ב-Open Banking.

User יכול ליצור Household.

Household:
- owner
- members
- shared accounts
- private accounts
- shared goals

Permissions:
Owner
Member
Viewer

ניתן ליצור UX פשוט יותר.
לדוגמה:
"אפשר לקנות עכשיו ב-500 ₪?"

האפליקציה:
Safe
או
Wait

עם הסבר קצר.

התראות:
- חיוב גדול מתקרב
- Safe to Spend נמוך
- חשבון צפוי להיכנס למינוס
- חריגה מתקציב
- יעד הושג
- משכורת נכנסה
- בנק לא הסתנכרן
- הרשאת Open Banking עומדת לפוג

בסוף חודש:
Income
Expenses
Savings
Debt Change
Safe to Spend Trend
Budget Performance
Goal Progress
AI Summary

לא להפוך כסף למשחק ילדותי.
Gamification עדין.

לדוגמה:
7 Days Under Budget
3 Months Without Overdraft
Debt Reduced by 10%
Emergency Fund 50%
Goal Streak

Global Search.
אפשר לחפש:
Merchant
Transaction
Category
Account
Goal

Reports:
Cash Flow
Spending by Category
Income vs Expenses
Debt Progress
Savings
Net Worth
Budget
Goal Progress

Assets:
Cash
Savings
Investments
Other assets

Minus:
Loans
Credit
Debts

=
Net Worth

זיהוי:
Salary
Rent
Subscriptions
Loans
Insurance
Utilities

המערכת יכולה לחזות תשלומים עתידיים.

זיהוי:
Duplicate charge
Unusual amount
Subscription increase
Unexpected merchant
Large transaction

Subscriptions:
Netflix
Spotify
Cloud
Phone
Insurance
וכו'.

Monthly Cost
Annual Cost

מומלץ:
Frontend:
Next.js App Router

Language:
TypeScript

Styling:
Tailwind CSS

Database:
MongoDB

Authentication:
Auth.js / NextAuth compatible architecture

Validation:
Zod

AI:
Anthropic Claude API

Deployment:
Vercel

Secrets:
Environment Variables

Analytics / Monitoring:
להוסיף בשלב Production Hardening.

UI
↓
Next.js Server/API
↓
Application Services
↓
Financial Engine
↓
Data Access Layer
↓
MongoDB

External adapters:
Open Banking
Claude
Notifications

אסור שה-UI ייגש ישירות ל-DB.

lib/
auth/
db/
users/
accounts/
transactions/
income/
expenses/
cards/
debts/
goals/
budgets/
timeline/
safe-to-spend/
forecast/
simulator/
banking/
ai/
notifications/
households/
analytics/

users
profiles
accounts
transactions
incomeSources
recurringTransactions
creditCards
loans
debts
budgets
goals
goalProgress
households
householdMembers
bankConnections
bankSyncRuns
financialSnapshots
forecasts
simulations
aiConversations
notifications
auditLogs

חשוב ליצור snapshot.
לדוגמה:
userId
date
balance
safeToSpend
debt
savings
income
expenses
netWorth

כך ניתן לייצר היסטוריה וגרפים.

כל פעולה פיננסית משמעותית:
מי
מתי
מה השתנה
מקור
נשמר Audit Log.

חשוב במיוחד אם יש Household.

חובה:
HTTPS
secure cookies
server-side authorization
data isolation
input validation
rate limiting
secret management
audit logging
encryption where required
no bank credentials stored
Claude API key server-side only
Open Banking tokens server-side only

משתמש יכול:
Export Data
Delete Data
Disconnect Bank
Delete Account
Revoke Household Access

Unit Tests:
Financial calculations
Safe to Spend
Timeline
Goals
Debt
Simulation

Integration Tests:
DB
Auth
Bank Adapter
Claude Adapter

E2E:
Onboarding
Dashboard
Transaction
Goal
Purchase Simulation
Bank Sync

Financial Engine חייב לקבל הרבה edge cases.

לדוגמה:
negative balance
income arriving after payment
multiple cards
income uncertainty
month boundary
installments
duplicate transactions
missing bank data
expired consent

Production צריך:
Error tracking
API logging
Bank sync logging
AI failures
Financial calculation errors
Performance metrics

Admin Console בסיסי.
לא להצגת מידע פיננסי פרטי ללא צורך.

Admin יכול לראות:
Users count
Sync failures
API errors
System health
Feature flags

לדוגמה:
AI Copilot
Open Banking
Household
Advanced Forecast

כדי לשחרר פיצ'רים בהדרגה.

מטרה:
להקים בסיס נקי.

Deliverables:
Next.js
TypeScript
Tailwind
MongoDB
Auth
Data Access Layer
Validation
Environment configuration
Deployment pipeline

לבנות:
Authentication
User profile
Initial onboarding
Income
Expenses
Accounts
Cards
Loans
Safety Margin
Goals

בסיום:
כל משתמש יכול ליצור Financial Profile מלא ידנית.

לבנות:
Accounts
Transactions
Recurring transactions
Income
Expenses
Credit Cards
Loans
Debts
Savings
Financial snapshots

לבנות ולבדוק לעומק:
Cash Flow Engine
Timeline Engine
Safe to Spend
Safety Margin
Monthly calculations
Future Balance

Dashboard אמיתי עם:
Safe to Spend
Balance
Upcoming payments
Income
Goals
Timeline
Alerts
Category system
Budgets
Zero-Based Budget
Monthly planning

Goal creation
Target date
Progress
Milestones
Goal analytics
Goal dashboard

Purchase impact
Timeline recalculation
SAFE / CAUTION / UNSAFE
Alternative date suggestions

Claude API
Structured Context
Chat
Explain Safe to Spend
Ask about purchase
Monthly analysis
Goal guidance
Guardrails

Provider abstraction
OAuth / consent
Account sync
Balance sync
Transaction sync
Normalization
Deduplication
Error handling
Consent expiry

AI categorization
Recurring detection
Merchant normalization
Subscriptions
Anomalies

Households
Members
Permissions
Shared Accounts
Shared Goals
Partner UX

30 / 60 / 90 day forecast
Scenario simulation
Income uncertainty
Expense estimation
Trend detection
Debt payoff projections
Debt Free Date
Snowball
Avalanche
Debt simulation

Savings goals
Emergency fund
Net worth
Historical charts

Push/email notifications.
Large charge
Low Safe to Spend
Goal reached
Budget exceeded
Bank disconnected
Future overdraft

Monthly review
Yearly review
Cash flow
Categories
Net worth
Debt
Goals
AI summary

Streaks
Milestones
Achievements
Progress journeys

Security audit
Performance
Rate limiting
Error handling
Observability
Backups
Privacy controls
Accessibility
Mobile UX
RTL/LTR
Complete E2E tests.

New user
Existing user
Single
Couple
Debt user
No-debt user
Variable income user
Open Banking user
Manual user

Production database
Domain
Vercel
Monitoring
Backups
Legal pages
Privacy
Terms
Support
Analytics

האפליקציה אינה נחשבת Complete רק כי כל המסכים קיימים.

Complete פירושו:
משתמש חדש יכול להירשם.
לעבור Onboarding.
להגדיר מצב פיננסי.
לחבר בנק או לעבוד ידנית.
לראות Safe to Spend.
לראות Timeline.
להגדיר Goal.
לראות Progress.
להוסיף Purchase Simulation.
לקבל הסבר מ-Claude.
לראות תקציב.
לראות חובות.
לראות חסכונות.
לקבל תחזית.
לקבל התראות.
להשתמש יחד עם בן/בת זוג.
והמידע נשמר בצורה מאובטחת.

המוצר צריך לגרום למשתמש לעבור מ:
"יש לי 8,000 ₪ בבנק."

ל:
"אני יודע שמתוך ה-8,000 ₪ שלי רק 2,400 ₪ באמת פנויים, אני יודע למה, אני יודע מה יקרה בחודש הקרוב, ואני יודע שאני מתקדם ב-63% ליעד הכלכלי שהצבתי."

זה ה-Financial OS.
