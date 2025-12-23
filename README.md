# Zeroed - Stop Renting Your Budget

![Zeroed Logo](public/logo.png)

> **Zero stress. Total control.**
> Own your financial future with **Zeroed**—the privacy-first, zero-based budgeting app you pay for once.

## 📖 Overview

This repository contains the source code for the landing page of **Zeroed**, a cross-platform personal finance application designed for users who want total control over their data and budget without recurring monthly subscriptions.

The landing page highlights the core value propositions of the app: **Privacy**, **Zero-Based Method**, and **Owning Your Data**.

## ✨ Key Features (App Highlights)

The landing page showcases the following features of the Zeroed application:

*   **🔒 Privacy by Design**: Zero trackers, zero data mining. Data is stored locally on the device (AES-256 Encryption) with optional Google Drive Sync.
*   **🎯 Zero-Based Method**: Implements the "Envelope Method" to give every dollar a job.
*   **⚡ Universal Imports**: Supports CSV, PDF, and OCR imports to easily migrate from other tools like Mint or YNAB.
*   **💸 One-Time Payment**: No monthly subscriptions. Pay once, own version 1.x forever.
*   **📱 Cross-Platform**: Available on iOS, Android, macOS, Windows, and Linux.

## 🛠️ Tech Stack (Landing Page)

This landing page is built with a lightweight and modern stack to ensure high performance and easy maintenance:

*   **HTML5**: Semantic markup.
*   **CSS3**: Custom styling with responsive design (Mobile-first approach).
*   **Vanilla JavaScript**: For interactive elements like the savings calculator and navigation.
*   **Vite**: Next Generation Frontend Tooling for fast development and building.
*   **Chart.js**: For rendering the visual savings comparison chart.

## 🚀 Getting Started

To run this project locally, follow these steps:

### Prerequisites

*   Node.js (v18 or higher)
*   npm (v9 or higher)

### Installation

1.  Clone the repository:
    ```bash
    git clone https://github.com/stillware-ltd/stillware-website.git
    cd stillware-website/zeroed_landing_page
    ```
    *(Note: Adjust the path if the project root is different)*

2.  Install dependencies:
    ```bash
    npm install
    ```

### local Development

Start the development server:

```bash
npm run dev
```

The site will be available at `http://localhost:5173` (or the port shown in your terminal).

### Building for Production

To build the project for production deployment:

```bash
npm run build
```

The output will be in the `dist/` directory.

## 📂 Project Structure

```
├── public/              # Static assets (images, icons, robots.txt)
├── src/                 # Source files (if applicable in future expansion)
├── index.html           # Main HTML entry point
├── main.js              # JavaScript entry point
├── style.css            # Global styles
├── package.json         # Project metadata and dependencies
└── vite.config.js       # Vite configuration (if present, else defaults used)
```

## 📄 License & Pricing

This project represents the marketing site for a commercial product.

*   **Zeroed App**: Commercial software with a one-time purchase model.
*   **Landing Page Code**: Proprietary - Stillware Ltd.

---

*Made with ❤️ and Flutter (App) / Vite (Web) by Stillware Ltd.*