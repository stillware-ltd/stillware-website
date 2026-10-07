---
title: "Local-First Software Movement: Why It Matters in 2025"
date: 2026-09-19
updated: 2026-10-07
description: "Discover why the local first software movement is reshaping how we own data. Learn what it actually means for privacy and control before you install."
author: "Tejaswi Dhulipala"
pillar: "philosophy"
appCluster: "general"
primaryKeyword: "local first software movement"
wordCount: 1676
qualityScore: 93
tags: ["Anti-SaaS", "Offline-First", "Privacy", "Productivity"]
featured: true
relatedSlugs: ["escape-subscription-trap", "why-we-dont-do-subscriptions", "data-breach-what-happens-to-your-financial-data"]
ogImage: "/blog/images/local-first-software-movement-why-it-matters/og-card.svg"
heroImage: "/blog/images/local-first-software-movement-why-it-matters/hero.webp"
---

## What "Offline Mode" Gets Wrong About the Local-First Software Movement

In 2019, researchers at the Ink & Switch lab (Martin Kleppmann, Adam Wiggins, Peter van Hardenberg and Mark McGranaghan) published a long essay, "Local-first software: You own your data, in spite of the cloud," that quietly reframed how a subset of developers think about data. It also appeared as a 25-page paper at the Onward! 2019 conference. Their central claim was blunt: the web's default architecture — your work lives on someone else's server, and your device holds a temporary copy — is backwards. The local-first software movement is the response to that claim, and it's worth understanding even if you never write a line of code.

The essay laid out seven ideals: no spinners (fast), your work is not trapped on one device (multi-device), the network is optional (offline), seamless collaboration with your colleagues, the long now (longevity), security and privacy by default, and you retain ultimate ownership and control. Read that list twice. In the essay's own comparison, a cloud app like Google Docs fully meets only two of the seven, multi-device access and collaboration. It only partly meets four and fails on privacy. Those are things you give up, usually without noticing, in exchange for the convenience of not managing anything yourself.

This isn't a technical footnote. It's a question about who holds the source of truth for your notes, your highlights, your research, your reading history.

<!-- Image rendering failed: Diagram comparing seven user ownership ideals across cloud and local-first architectures -->

## The Difference Between Offline Mode and Local-First Software

Here's the distinction that trips up most people. An app with "offline mode" is still a cloud app. It caches a copy of your data so you can keep working on a plane, then reconciles when you reconnect. Your device is a client. The server decides what's real.

Local-first software inverts that relationship. Your device holds the authoritative copy. Sync, if it exists at all, is a convenience layer — not the foundation. If the sync server vanished tomorrow, you'd lose nothing.

That inversion is the whole ballgame. It changes what happens when a startup shuts down, when you lose your internet connection for a week, when a company gets acquired and the new owner has different ideas about your data.

> Many note-taking apps keep your highlights in a format you can't fully export. Many cloud services keep your archive behind a login you don't control. Local-first software treats both as bugs, not features.

![Two architectures: cloud-first with a local cache versus local-first with optional sync](/blog/images/local-first-software-movement-why-it-matters/image-02.svg)

The mental model is simple: cloud apps treat your device like a terminal. Local-first apps treat your device like your filing cabinet, and the network like a nice-to-have.

## Seven Ideals, and Why the Reading App Category Fails Most of Them

Reading and note-taking tools are a useful test case because they sit at the intersection of everything the seven ideals care about. You read on multiple devices. You annotate in the moment, sometimes in a basement apartment with bad Wi-Fi, sometimes on a plane, sometimes in a doctor's waiting room. Your highlights compound into something you'd hate to lose.

Walk through the seven ideals against a typical cloud-based read-it-later app and the gaps are stark.

- **Fast**: Cloud apps round-trip every save through a server. Local-first apps write to disk immediately.
- **Multi-device**: A cloud account handles this. Local-first handles it with sync layers you control.
- **Offline-capable**: The cloud version means a degraded cache. The local-first version means the app works, full stop.
- **Collaboration**: This is where cloud apps shine. Local-first apps aim to match it without a central server holding the master copy, but it is the hardest of the seven to get right.
- **Longevity**: Cloud tools die when companies die. Local files survive format shifts.
- **Privacy**: A server that stores your reading history is a server that can be subpoenaed, breached, or sold.
- **User ownership**: The read-it-later space fails this hardest. Your annotations are usually trapped in a proprietary export.

That last point deserves its own section.

## What Most People Get Wrong About Data Ownership Software

A common assumption is that you own your data because you can download a JSON file. That's not ownership. That's an escape hatch.

**Real ownership means the primary copy lives on your hardware, in a format you can read without the app.**

<!-- IMAGE: type=realistic-scenario | layout=full-width | ratio=21:9 | caption=A cluttered home office at night, laptop open to offline notes, no cloud dependency visible on screen | scene=A dimly lit home office at 11pm, a laptop displaying a plain text document with hand-typed notes, a stack of paper notebooks beside it, a cold mug of coffee, warm desk lamp light, no glowing cloud icons or sync indicators, photorealistic, quiet and private atmosphere -->

Three mistakes show up repeatedly when people evaluate productivity apps through a data-ownership lens.

1. **Assuming export equals portability.** An export you have to repeatedly re-run is a snapshot, not a library. Your future self wants the living archive, not a frozen copy from three years ago.
2. **Confusing login with identity.** Requiring an account to read your own notes is a design choice, not a technical requirement.
3. **Trusting the encryption story.** "Encrypted at rest" usually means encrypted on their servers with keys they hold, unless the service says it uses end-to-end encryption. If the company can decrypt your data, so can anyone who compromises the company.

The trap isn't malice. It's architecture. Cloud-first design makes these three mistakes almost unavoidable.

At the same time, I should be honest about the trade-offs. Local-first has real costs. Conflict resolution when two devices edit the same document is genuinely hard. Multi-user collaboration is harder. Search across a large archive on-device uses your battery and disk. These aren't small problems — they're why most SaaS products default to a server.

But they're engineering problems, not fundamental limits. The Ink & Switch work, research on CRDTs (conflict-free replicated data types) and libraries such as Automerge exist precisely because the trade-offs are worth solving.

## Reading, Annotating, and the Longevity Question

Reading tools make the longevity ideal concrete. Think about what an annotated article actually contains: your marginalia, the passages that struck you at a particular moment in your life, links between one essay and another you read six months later. A local wiki of your own thinking.

Now think about what happens when the company behind your read-it-later app gets acquired, pivots, or shuts down. The best-case scenario is an export scramble. The worst case is that your decades of marginal thinking sit on dead servers.

**Highlights that outlive the service that hosted them require that the service never really "hosted" anything — you did.**

This is the piece of local-first thinking that resonates with readers who don't care about servers at all. It's not an ideology. It's a bet about time. Files on your drive in a readable format outlast formats, companies, and operating systems. Files in a proprietary vault don't.

For readers who've been thinking about this longer, the [local-first software movement guide](/blog/what-is-local-first-software-movement-guide-2026/) goes deeper into the technical roots — CRDTs, sync engines, the actual algorithms that make offline collaboration possible. It's a good companion if you want the engineering detail behind the ideals.

![Leather-bound notebooks and a laptop glowing on a wooden desk, representing decades of marginal notes preserved offline](/blog/images/local-first-software-movement-why-it-matters/photo-05.webp)

## A Practical Checklist for Choosing Local-First Tools

If the philosophy makes sense to you, here's how to apply it without getting lost in the terminology. I use this list when evaluating anything I plan to rely on for more than a year.

- Does the app work with the network off? Not "in offline mode" — actually, fully, with every feature.
- Where does the primary copy of my data live? Can I point to the file on disk?
- Is the format readable without the app? A plain text or Markdown file, not a proprietary database blob.
- Can I use the app without creating an account? If not, why not?
- If the company shut down tomorrow, what would I lose?
- Can I share data between my own devices without going through their servers?
- What does export actually produce, and how often do I have to re-run it?

A "yes" on five of those seven is a strong signal. A "yes" on all seven is rare, and worth paying attention to when you find it.

If you're interested in the economics behind why this matters so much right now, the [subscription fatigue problem](/blog/escape-subscription-trap/) is worth reading alongside this — the same pressures that push people away from monthly fees are pushing developers toward architectures that don't need recurring revenue to keep your data alive.

![A laptop showing a chart next to a phone, printed financial tables and reading glasses](/blog/images/local-first-software-movement-why-it-matters/photo-06.webp)

## Why the Local-First Software Movement Matters Beyond Developers

The people benefiting most from local-first design aren't developers. They're researchers, writers, lawyers, doctors, students — anyone whose notes and annotations compound over years rather than weeks. They aren't choosing local-first because they read the Ink & Switch essay. They're choosing it because they noticed that the tools they trusted kept changing hands, changing prices, and changing terms.

Full disclosure: Stillware is an independent UK software company that makes pay-once, privacy-first apps, and we build them this way. We believe tools should work offline by default, sync through infrastructure you already own, and treat the on-device copy as the real one — not a cache.

That conviction is visible in what we ship. [Zeroed](/zeroed/), our budgeting app, keeps your data encrypted on your device with no account and no servers, and syncs only through your own Google Drive if you turn sync on. [RankUp Chess](/rankupchess/), our chess app for kids, runs its puzzles and lessons without an internet connection and has no central servers.

**That's not nostalgia for desktop software. It's a design choice about who your tools are built to serve.**

> Local-first isn't a technical feature you bolt on. It's a stance about who your tools answer to when the servers go dark.

The question worth sitting with isn't "which app should I use?" It's "which app will still make sense in 2035?" That's the lens worth carrying into your next download. If you've read this far, you probably already suspect that the "offline mode" checkbox on most productivity apps is doing a lot of hiding. The local-first software movement is the name for the alternative: tools that treat your device as the source of truth, respect your attention, and assume you'll still want your data in ten years. If you want to see what that looks like in practice, try a tool built on these principles, such as [Zeroed](/zeroed/) (free for 34 days, no credit card) — your future self will thank you.

Sources, checked 7 October 2026: Ink & Switch, [Local-first software: You own your data, in spite of the cloud](https://www.inkandswitch.com/essay/local-first/) (2019) and its [PDF version](https://www.inkandswitch.com/essay/local-first/local-first.pdf); [Automerge](https://automerge.org/).