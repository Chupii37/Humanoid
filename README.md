# Humanoid Network Automation Bot 🤖

A robust, multi-account terminal-based automation tool for the **Humanoid Network**. This bot automates daily tasks, model training, and dataset curation to maximize point farming efficiently using a visual TUI (Terminal User Interface).

![Node](https://img.shields.io/badge/node-v18%2B-green)
![Python](https://img.shields.io/badge/python-3.10%2B-blue)
![License](https://img.shields.io/badge/license-MIT-orange)

## 🚀 Features

- **Multi-Account Support**: Run hundreds of wallets simultaneously with isolated states.
- **Proxy Support**: Assigns proxies to individual accounts to prevent IP linking.
- **Automated Workflow**:
  - **Daily Tasks**: Solves social and interaction tasks automatically.
  - **Smart Training**: Automatically fetches **trending** models and datasets from the Hugging Face API (no manual lists needed).
  - **Live Point Sync**: Updates your point balance immediately after every task or training submission.
- **Human-Like Behavior**:
  - **Cycle Jitter**: Randomized sleep times between daily runs.
  - **Smart Delays**: Randomized pauses between actions to mimic human interaction.
  - **Varied Descriptions**: Generates unique, organic descriptions for training submissions.
- **Advanced Security**: Uses a Python bridge (`curl_cffi`) to bypass TLS fingerprinting and Cloudflare protections.
- **Interactive Dashboard**: Real-time stats, logs, and configuration via a `blessed` TUI.

---

## 🛠 Prerequisites

Ensure you have the following installed:

1. **Node.js** (v18 or higher)
2. **Python** (v3.10 or higher) - *Required for the TLS bypass bridge.*
3. **Git**

---

## 📥 Installation

1. **Clone the Repository**
   ```bash
   git clone https://github.com/Chupii37/Humanoid.git
   cd Humanoid
   ```
   
2. **Install dependencies**
    ```bash
    npm install
    ```

3. **Install Python dependencies**
    ```bash
    pip install curl_cffi httpx
    ```

## ⚙️ Configuration
Create the following files in the root directory before running the bot:

1. **Copy environment template**
    ```bash
    cp .env.example .env
    ```

   **Edit .env with your private keys (one per line)**
    ```bash
    nano .env
    ```
    
2. **Proxy Configuration (proxy.txt)**
   **Add HTTP/HTTPS proxies, one per line:**
    ```bash
    nano proxy.txt
    ```

## 🎮 Running the Bot
Start the bot with:
```bash
npm start
```

## ⚠️ Disclaimer
This tool is for educational purposes only. Use it at your own risk. The author is not responsible for any bans or penalties incurred by using this software.

## ⭐ Support
If this project helped you, please consider giving it a star!

## ☕ Fuel the Machine (Treats & Caffeine)
If this code saved your fingers from repetitive clicking, consider buying me a "digital beverage." Here is the menu of acceptable caffeinated transactions:

The "Git Push" Espresso: Short, dark, and strong enough to fix merge conflicts at 3 AM.

The "Panic Kernel" Cold Brew: Iced coffee so potent it halts the CPU.

Latte of Lesser Lag: A smooth blend that reduces ping and increases dopamine.

The "Syntax Sugar" Frappé: Pure sweetness, zero nutritional value, but makes the code look pretty.

Deprecation Decaf: (Please don't buy this, it's just sad water).

[Buy me a coffee☕](https://saweria.co/chupii)
