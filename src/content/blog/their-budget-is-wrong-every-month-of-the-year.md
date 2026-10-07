---
title: "Their Budget Is Wrong Every Month of the Year"
seoTitle: "How to Budget With Commission Income: A Worked Example"
date: 2026-10-05
description: "A couple budgeted on average commission and were wrong every month. Budgeting the £5,300 base alone ended the argument, and commission went into one envelope."
author: "Stillware Team"
tags: ["Zeroed Shorts", "Budgeting UK", "Irregular income"]
pillar: "shorts"
appCluster: "zeroed"
primaryKeyword: "how to budget with commission income"
wordCount: 756
videoTitle: "Their Budget Is Wrong Every Month of the Year"
heroImage: "/blog/images/their-budget-is-wrong-every-month-of-the-year/hero.webp"
relatedSlugs: []
video: "62K7J7v4FSI"
_id: "20261005-1800-T15-O01-F5"
---


Marcus and Jen's budget is wrong every month of the year, and not because they overspend. Marcus divided last year's £19,700 commission by twelve and built the plan on £1,640 a month that no single month ever pays. The fix was one sentence: budget the base, £5,300, and only the base.

**Marcus and Jen. He is a sales director on a base plus commission; she works part time..** The households in these Shorts are illustrations built from typical UK figures, not real people, and every number below is worked on the household's sheet.

## What happened

Marcus and Jen's budget was wrong twelve months out of twelve, and overspending had nothing to do with it. He is a sales director paid a base salary plus commission; she works part time. Last year his commission came to £19,700, and like most people in that position, Marcus divided it by twelve. That gave £1,640 a month, which went on top of the base and became the plan.

The plan was generous enough to take on a holiday and a second car. In the quarter that paid £8,000 it even felt cautious. Then a quarter paid £2,000. Spread across three months, that is about £667 a month, against a plan that was counting on more than double. Over those three months the household came up £2,919 short, and the argument that followed lasted exactly as long. Jen's view was that Marcus was spending as though every month were a good one. His view was that she was budgeting as though every month were a bad one. Each of them was sure the other had got it wrong.

In fact neither was wrong about the money. What was wrong was the plan's sense of time. Built into it was an average, and no single month ever pays the average. The commission arrives in lumps, big in one quarter and thin in the next, so a budget based on the smoothed-out figure is always either too tight or too loose, and never right. The plan had not been too generous so much as built on a number that never actually turns up. Commission, it turned out, was not really income in the way the base is. It was a delivery.

The fix took one sentence and about a minute to agree: they would budget the base. Between them that is £5,300, the same every month whether the quarter is good or bad. Their fixed costs take £4,100 of it, which leaves £1,200 spare, every month, without exception. The commission no longer gets spread across the months in advance. When it lands, its first job is to cover the gap before the next payout, and it goes into an envelope they simply call Quarter. The holiday and the car wait their turn behind it.

For any household whose pay moves around, the number to plan on is the base: whatever arrives even in the worst quarter, and nothing more. Marcus and Jen's budget now rests on £5,300, and when the last commission payment came in, it sat unassigned until the Quarter envelope had taken its share.

## The working

Every figure the Short says, and where it comes from on the household's sheet.

| The Short says | Figures | Derivation |
|---|---|---|
| nineteen thousand seven hundred | `commission_year` = 19,700 | commission_year = q1 + q2 + q3 + q4 |
| sixteen hundred and forty a month | `round(commission_year / 12`; `-1)` | on the sheet |
| the eight-thousand quarter | `commission_q4` = 8,000 | on the sheet |
| two thousand / six hundred and sixty-seven a month | `commission_q1` = 2,000; `round(commission_q1 / 3)` | on the sheet |
| two thousand nine hundred and nineteen short | `(commission_avg_month - worst_quarter_month) * 3` | on the sheet |
| five thousand three hundred | `base_total` = 5,300 | base_total = marcus_base + jen |
| four thousand one hundred / twelve hundred spare | `fixed` = 4,100; `base_total - fixed` | fixed = mortgage + car1_finance + car2_lease + bills + groceries + kids + other_fixed |

![Bar chart of Marcus & Jen's figures in pounds: Commission, weakest quarter £2,000; Commission, best quarter £8,000; Average commission, a month £1,640; Weakest quarter, a month £667; Short over that quarter £2,919.](/blog/images/their-budget-is-wrong-every-month-of-the-year/numbers.webp "The money figures from the working table above, for Marcus & Jen's household.")

## The turn

The plan was not too generous; it had an average in it, and no month ever pays the average — commission is a delivery, not income.

## The Short

<div class="yt-embed" data-id="62K7J7v4FSI" data-title="Their Budget Is Wrong Every Month of the Year"><a href="https://www.youtube.com/shorts/62K7J7v4FSI">Watch the Short</a></div>

## Monday

1. Your number is the base, what lands in the worst quarter.
2. Budget that and only that.
3. Commission's first job is next quarter's gap.

## In Zeroed

Marcus and Jen's plan is built on five thousand three hundred. The last commission sat in To Be Budgeted until the Quarter envelope took its share.

![Zeroed on a phone, Budget screen: a green To Be Budgeted card showing £3,200.00, Smart Assign and Copy Last Month buttons, an Assign Underfunded: £6,335.00 button, the Home and Cars groups collapsed, and in Plan a Quarter envelope with an orange flag and £0.00 available.](/blog/images/their-budget-is-wrong-every-month-of-the-year/proof.webp "From Zeroed itself: the screen the Short shows, loaded with Marcus & Jen's example budget.")

Zeroed: Offline Budget Planner is the app in the Short — envelope budgeting you buy once. It works offline, with no bank login, no subscription and no data harvesting; the first thirty-four days are free, no card needed. [Try Zeroed](https://www.stillwareltd.com/zeroed/?utm_source=site&utm_medium=article&utm_content=article-1800).

## Related

- [More on irregular income](/blog/tag/irregular-income/)
