---
title: "How Zeroed Encrypts Your Data Without a Server"
date: 2026-03-05
description: "A technical look at how Zeroed achieves bank-grade encryption and cross-device sync without ever touching our infrastructure."
author: "Stillware Team"
wordCount: 407
tags: ["Technical", "Privacy", "Offline-First"]
pillar: "technical"
appCluster: "zeroed"
relatedSlugs: ["privacy-first-budgeting-philosophy", "privacy-budgeting-apps-compared", "why-offline-apps-are-better"]
ogImage: "/blog/images/how-zeroed-encrypts-your-data/og-card.svg"
---

## The Problem with Cloud-Based Budgeting Apps

Most budgeting apps store your financial data on their servers. This means:

1. They can see your transactions, balances, and spending habits
2. A server breach exposes your financial life
3. If the company shuts down, your data may be lost
4. They can — and often do — monetize aggregate financial data

We built Zeroed to make all of these impossible.

## Local-First Architecture

Zeroed stores your entire financial database locally on your device in an encrypted SQLite database. The encryption key is derived from your device and never transmitted anywhere.

This means:

- **We cannot read your data** — we don't have the key
- **We cannot lose your data** — we don't have a copy
- **We cannot sell your data** — we literally don't have access to it

## Cross-Device Sync via Google Drive

The obvious question: if there's no server, how do you sync between your phone and laptop?

The answer: your own Google Drive.

When you enable sync, Zeroed creates a folder called `ZeroedData` in your personal Google Drive using the `drive.file` scope. This scope means Zeroed can **only** access files it created — it cannot see your photos, documents, or anything else.

Your encrypted database is uploaded to this folder. Any other device running Zeroed and signed into the same Google account will detect the folder, download the encrypted database, and decrypt it locally.

## The Universal Cloud Key

Your Zeroed license also lives in Google Drive as a secure verification file. When you earn your Founder's License (or purchase one), the key is placed in your `ZeroedData` folder. Any device that connects to that Drive sees the key and unlocks Premium features automatically.

No license servers. No activation limits. No "you've used too many devices" errors.

## AES-256 Encryption

All data synced through Google Drive is encrypted with AES-256 — the same standard used by governments and financial institutions. The encryption happens on your device before the data leaves for Google Drive, and decryption happens on your device after download.

At no point does unencrypted financial data exist outside of your device's memory.

## What This Means for You

- Switch phones freely — sign into Google Drive and you're synced
- Use Zeroed offline — full functionality, sync when you reconnect
- Sleep well — your financial data is mathematically inaccessible to anyone but you

[Try Zeroed free for 34 days](/zeroed)
