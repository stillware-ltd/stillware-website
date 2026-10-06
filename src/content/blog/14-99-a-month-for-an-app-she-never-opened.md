---
title: "£14.99 a Month for an App She Never Opened"
date: 2026-10-05
description: "A civil servant found £14.99 a month going to an app she never opened, then £420 a year across three lines she could not name."
author: "Stillware Team"
tags: ["Zeroed Shorts", "Budgeting UK", "The quiet leak"]
pillar: "shorts"
appCluster: "zeroed"
primaryKeyword: "find forgotten subscriptions on bank statement"
wordCount: 719
videoTitle: "£14.99 a Month for an App She Never Opened"
relatedSlugs: []
video: "a3Hr716yUgY"
_id: "20261005-0600-T07-O01-F12"
---


On Leah's bank statement: a fitness app she has never opened, taking £14.99 a month since January. It was not alone. Three lines she could not name came to £35 a month, £420 a year. Four minutes with two statements found them, and the money now has a name.

**Leah, thirty-one, a civil servant.** The households in these Shorts are illustrations built from typical UK figures, not real people, and every number below is worked on the household's sheet.

## What happened

The line had been there since January: £14.99 a month to a fitness app Leah had never once opened. She is thirty-one and works in the civil service, and she only noticed it by accident, scrolling past it on her bank statement. The discovery itself was annoying enough, but the question behind it was worse. If that one had slipped through for months, what else was sitting there unnoticed?

Looking properly turned up more. There was £7.99 a month for cloud storage, which her phone contract already included, so she had been paying twice for the same space. There was £11.99 a month for a streaming service she had stopped watching the previous autumn; left running for a year, that came to £144 for nothing at all. Taken together, the fitness app, the storage and the streaming service were three lines she could not have named if asked, and they cost around £35 a month between them. Over a year, that is £420.

The natural assumption would be that the problem was the size of the bill, that she was simply paying for too many subscriptions. That turned out not to be it. She had six in all, costing £74 a month, and the other three she recognised immediately. Those came to £39, and she would happily pay for every one of them again. The total was never the issue. The issue was the half she had never looked at, the lines that had carried on quietly because nobody had asked what they were for.

Finding them was not a big project. It took four minutes and two statements. Anything that appeared on both was a subscription. Anything on that list she could not put a name to, she looked up, and then she cancelled it. The three she valued stayed exactly where they were.

The £35 a month did not disappear back into her everyday spending, either. It now goes into an envelope she keeps for surprises, so the same money that used to leak away under three blank names now has a name and a job. For anyone wanting to try the same, the method is the one she used: two statements, the lines that show up on both, and a name for each. Add up the lines that cannot be named, multiply by twelve, and that is the number worth knowing.

## The working

Every figure the Short says, and where it comes from on the household's sheet.

| The Short says | Figures | Derivation |
|---|---|---|
| fourteen ninety-nine a month since January | `blank_fitness` = 14.99 | on the sheet |
| seven ninety-nine for cloud storage her phone contract already includes | `blank_cloud` = 7.99 | on the sheet |
| eleven ninety-nine / one hundred and forty-four pounds | `forgotten_sub` = 11.99; `forgotten_sub_year` = 144 | forgotten_sub_year = round(forgotten_sub * 12) |
| three lines / thirty-five pounds a month / four hundred and twenty pounds a year | `subs_count - subs_named`; `blanks_total_rounded` = 35; `blanks_year` = 420 | blanks_total_rounded = round(forgotten_sub + blank_cloud + blank_fitness); blanks_year = round((forgotten_sub + blank_cloud + blank_fitness) * 12) |
| the other three, thirty-nine pounds | `subs_named` = 3; `named_total_rounded` = 39 | named_total_rounded = round(subs - (forgotten_sub + blank_cloud + blank_fitness)) |
| thirty-five pounds a month now goes to her Surprises envelope | `blanks_total_rounded` = 35 | blanks_total_rounded = round(forgotten_sub + blank_cloud + blank_fitness) |

## The turn

It was never the total; the three she could name were choices she would make again, and the three she could not had never been looked at.

## The Short

<div class="yt-embed" data-id="a3Hr716yUgY" data-title="£14.99 a Month for an App She Never Opened"><a href="https://www.youtube.com/shorts/a3Hr716yUgY">Watch the Short</a></div>

## Monday

1. Two statements, the lines on both, a name for each.
2. Add up the ones you cannot name and multiply by twelve.

## In Zeroed

Leah's Surprises envelope shows the thirty-five pounds a month that used to be three unnamed lines.

Zeroed: Offline Budget Planner is the app in the Short — envelope budgeting you buy once. It works offline, with no bank login, no subscription and no data harvesting; the first thirty-four days are free, no card needed. [Try Zeroed](https://www.stillwareltd.com/zeroed/?utm_source=site&utm_medium=article&utm_content=article-0600).

## Related

- [More on the quiet leak](/blog/tag/the-quiet-leak/)
