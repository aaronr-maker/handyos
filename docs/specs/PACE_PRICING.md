# Feature Specification: Automated Pace-Based Pricing & Labor Budgeting Engine
(From Aaron, 2026-11-06. Status: planned, not started. See ROADMAP.md.)

## Objective
Build an automated flat-rate pricing engine that uses historical technician task-completion data to set realistic labor budgets, automatically adjusts pricing as productivity changes, and keeps a built-in performance incentive for technicians.

**Core principle:** Always budget more labor time than the historical average completion time, so a technician at or above average can finish under budget and earn performance-based compensation (P4P).

Preserve company profitability, never automatically cut prices just because technicians improve, and keep separate: historical pace, budgeted pace, actual pace, and technician efficiency.

## 1. Historical Task Pace
Track actual combined technician man-hours per task. For every completed task capture: task ID and category; job ID; technician IDs; quantity and unit; actual combined man-hours; actual production rate (quantity ÷ man-hours); completion date; scope characteristics (number of coats, difficulty); whether it is eligible for benchmarking.

Multiple technicians on one task: sum their hours (two technicians x 3 hours = 6 man-hours).

Use a configurable rolling window, initially three months, with a longer fallback when data is thin.
- Historical production rate = total completed quantity ÷ total actual man-hours
- Historical average hours for a new task = estimated quantity ÷ historical production rate
- Use a weighted rate, not an unweighted average of per-job rates.

Exclude or flag inaccurate time records, unusual interruptions, rework, incomplete tasks and scope mismatches. Do not automatically exclude legitimately difficult jobs. Keep separate benchmarks for materially different scopes.

## 2. Labor Budget Allowance
A configurable percentage added to historical average time. **Default 20%.**
- Budgeted labor hours = historical average hours x (1 + allowance %)
- Example: 10 hours x 1.20 = 12 hours. The allowance is an estimating and compensation buffer, not a requirement to work longer.
- Configurable globally, by task category, and eventually by task. Priority: task, then category, then company default.
- Never add the allowance repeatedly when a budget is recalculated.

## 3. Automatic Flat-Rate Pricing
Initial settings: labor selling rate $120 per budgeted man-hour; fully loaded internal labor cost $51 per billable man-hour; protected profit target 20%; standard material markup 30%.
- Labor selling price = budgeted hours x labor selling rate
- Separately compute a minimum profitable price from labor costs, material costs, overhead allocations, bonus reserves, P4P obligations and the protected profit requirement.
- Proposed flat-rate price = the larger of the labor-based price and the minimum profitable price, plus separately priced materials and services.
- Profitability is calculated on the complete job; do not double-count overhead already in fully loaded costs. Do not confuse markup with margin.
- Keep separate: historical actual hours, budgeted hours, actual job hours, internal costs, customer prices, technician performance, technician compensation.

## 4. Protection Against Automatic Price Erosion
Faster technicians must not automatically force lower customer prices.
- **A. Price floor:** never automatically publish below the minimum profitable price.
- **B. Historical pace updates:** recompute from eligible completed tasks; update proposed budgets from current pace plus the allowance.
- **C. Price-change controls (separate settings):** auto-increase; auto-decrease; maximum automatic change per update; minimum time between published changes; manager approval required for reductions. Recommended start: calculate proposals automatically, never auto-publish reductions, flag increases and decreases for review, keep current published prices until approved.
- **D. Market acceptance:** track estimate close rates by task, category and market when data is reliable. Close rates inform pricing and never override the minimum profitable price.

## 5. Technician Pace Performance
**Pace % = budgeted man-hours ÷ actual man-hours x 100.** Example: average 10 h, budget 12 h, actual 10 h: 120%. Above 100% is under budget, 100% on budget, below 100% over budget. Work done at the historical average should have room to exceed 100%. Never use the allowance to inflate actual production-rate statistics; historical pace reflects actual recorded work only.

## 6. P4P Compensation Integration
Connect budgeted-labor performance to the existing P4P system. The existing P4P engine stays authoritative for distribution percentages.
- Do not pay all time savings to technicians; apply protected profit, required reserves and P4P rules.
- No P4P on incomplete or unapproved work. Account for quality failures, callbacks and rework under the approved policy.
- Keep P4P amounts earned, held, approved and paid separate.
- Support multiple technicians on one task with auditable labor attribution.
- Never change earned compensation retroactively when benchmarks or prices change.

## 7. Separate Pace From Efficiency
**Pace:** how quickly a task is done compared with its labor budget. **Efficiency % = productive billable man-hours ÷ total clocked man-hours x 100** (initial target 70%). Measure both independently; a technician can have excellent pace and poor efficiency (travel, supply runs, idle time, scheduling gaps).

## 8. Example: Interior Painting
Preliminary benchmark: single-coat painting 97.72 sq ft per man-hour. Second coat labor is 75% of the first (one coat factor 1.00, two coats 1.75).
- Historical hours = painted area x coat factor ÷ 97.72; budgeted hours = historical x 1.20.

For 1,000 sq ft: one coat 10.23 h historical, 12.28 h budgeted, $1,473.60 labor, $1.47/sq ft; two coats 17.91 h historical, 21.49 h budgeted, $2,578.80 labor, $2.58/sq ft. Calculate with unrounded values. Materials, furniture moving, unusual prep and separately charged protection are priced independently. Benchmarks are preliminary; flag room-shape estimates and mixed scopes with data-quality indicators.

## 9. Automatic Recalculation Workflow
When a technician completes a task: (1) save actual labor and quantity; (2) validate time records and scope; (3) compute actual production rate; (4) decide benchmark eligibility; (5) update the historical dataset; (6) recompute proposed average time; (7) apply the allowance; (8) recompute proposed price; (9) enforce profit floors and change controls; (10) publish approved updates for future estimates only. Never alter approved estimates, active job budgets or compensation records. Keep versioned, approved published prices.

## 10. Required Dashboard
For owners and managers: historical production rate by task; average historical time; allowance %; budgeted time; actual time; pace performance; efficiency; current published price; proposed price; price-change history; estimated gross profit and protected-profit compliance; estimate close rate; P4P earned, held and paid. Technicians see their own performance first. Charts, progress bars, clear indicators. Filters: technician, crew, category, task, date range, territory.

## 11. AI Assistant Integration
Expose the data to the in-app assistant through authorized, structured services. It can explain why a price changed, spot production changes, recommend allowance changes, find unusually slow or fast tasks, flag a proposed price that breaks profit rules, analyze whether budgets are consistently beaten or missed, recommend operational improvements, and explain P4P impact. AI recommendations must be clearly distinct from approved policy and can never override protected profit, compensation rules or price approvals.

## 12. Data Integrity and Audit
Store and keep: raw task records; benchmark eligibility decisions; pace calculations; allowance settings; price calculations and versions; published price versions; job budget snapshots; actual completion data; P4P calculation references; manual overrides and approvals. Every proposed price change must be explainable and traceable. Prevent circular calculations where budgeted hours feed back into historical actual rates.

## Acceptance Criteria
1. A new task gets a budget from historical actual production plus a configurable allowance.
2. Work done at the historical average scores above 100% pace.
3. One-coat and two-coat painting get different budgets automatically.
4. Historical production stays based on actual labor, never contaminated by the allowance.
5. Faster performance cannot lower published prices without passing the configured controls.
6. The minimum profitable price is enforced.
7. Approved job budgets and P4P calculations do not change after later price updates.
8. Managers can see why a price changed and approve or reject it.
9. Technicians can see their own pace and efficiency.
10. The AI assistant can explain calculations and recommend improvements without changing policy.

**Build order:** historical pace tracking, configurable allowance, budget snapshots and proposed-price calculation first; P4P integration and market-based pricing after those are validated.
