// Load environment variables
require("dotenv").config();

const BOT_TOKEN = "8013325969:AAGBPz0KzTfODhsnx3rssfwQU_CmKCpKb_I";
const ADMIN_IDS = process.env.ADMIN_IDS
  ? process.env.ADMIN_IDS.split(",").map((id) => Number(id.trim()))
  : [];
const PROJECT_WHITEPAPER = "https://your-project.com/whitepaper.pdf";
const BAD_WORDS = ["spam", "scam", "fake", "fuck", "hack", "pump", "dump"];
const WHITELIST_LINKS = ["t.me", "telegram.org", "your-project.com"];

// Validate required environment variables
if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN is required in environment variables");
  process.exit(1);
}

if (ADMIN_IDS.length === 0) {
  console.warn(
    "⚠️ No admin IDs configured. Bot will work but no admin commands will be available."
  );
}

const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");
const path = require("path");

class ModerationBot {
  constructor() {
    this.bot = new TelegramBot(BOT_TOKEN, { polling: true });
    this.userWarnings = new Map();
    this.userMessages = new Map();
    this.pendingVerifications = new Map();
    this.mutedUsers = new Map();
    this.slowModeUsers = new Map();
    this.userMessageHistory = new Map();

    // Configuration
    this.slowModeInterval = 30; // seconds
    this.maxWarnings = 3;
    this.spamThreshold = 5; // messages per minute
    this.floodThreshold = 10; // same message count
    this.verificationTimeout = 300000; // 5 minutes in milliseconds

    // Load data and setup handlers
    this.loadData();
    this.setupHandlers();

    console.log("🤖 Soul Community Moderation Bot is starting...");
    console.log(`📊 Bot configured with ${ADMIN_IDS.length} admin(s)`);
  }

  // Data persistence
  saveData() {
    try {
      const data = {
        userWarnings: Array.from(this.userWarnings.entries()),
        mutedUsers: Array.from(this.mutedUsers.entries()).map(
          ([key, value]) => [key, value.toISOString()]
        ),
      };

      fs.writeFileSync("bot_data.json", JSON.stringify(data, null, 2));
      console.log("💾 Data saved successfully");
    } catch (error) {
      console.error("❌ Error saving data:", error);
    }
  }

  loadData() {
    try {
      if (fs.existsSync("bot_data.json")) {
        const data = JSON.parse(fs.readFileSync("bot_data.json", "utf8"));
        this.userWarnings = new Map(data.userWarnings || []);
        this.mutedUsers = new Map(
          (data.mutedUsers || []).map(([key, value]) => [key, new Date(value)])
        );
        console.log("📂 Data loaded successfully");
      } else {
        console.log("📝 No existing data file found, starting fresh");
      }
    } catch (error) {
      console.error("❌ Error loading data:", error);
    }
  }

  // Utility functions
  isAdmin(userId) {
    return ADMIN_IDS.includes(userId);
  }

  generateMathQuestion() {
    const a = Math.floor(Math.random() * 10) + 1;
    const b = Math.floor(Math.random() * 10) + 1;
    const operations = ["+", "-", "*"];
    const operation = operations[Math.floor(Math.random() * operations.length)];

    let answer;
    switch (operation) {
      case "+":
        answer = a + b;
        break;
      case "-":
        answer = a - b;
        break;
      case "*":
        answer = a * b;
        break;
    }

    return { question: `${a} ${operation} ${b}`, answer };
  }

  // [Rest of your existing methods remain the same...]
  // Just include all the methods from your original code here

  setupHandlers() {
    // New member handler
    this.bot.on("new_chat_members", (msg) => this.handleNewMembers(msg));

    // Left member handler
    this.bot.on("left_chat_member", (msg) => this.deleteJoinLeaveMessage(msg));

    // Message handler
    this.bot.on("message", (msg) => this.handleMessage(msg));

    // Callback query handler
    this.bot.on("callback_query", (query) => this.handleCallbackQuery(query));

    // Admin commands
    this.bot.onText(/\/kick/, (msg) => this.kickUser(msg));
    this.bot.onText(/\/ban/, (msg) => this.banUser(msg));
    this.bot.onText(/\/mute(?:\s+(\d+))?/, (msg, match) =>
      this.muteUser(msg, match)
    );
    this.bot.onText(/\/unmute/, (msg) => this.unmuteUser(msg));
    this.bot.onText(/\/warn/, (msg) => this.warnUserCommand(msg));
    this.bot.onText(/\/everyone/, (msg) => this.tagEveryone(msg));
    this.bot.onText(/\/whitepaper/, (msg) => this.sendWhitepaper(msg));

    // Error handler
    this.bot.on("polling_error", (error) => {
      console.error("❌ Polling error:", error.code, error.message);
    });

    // Bot started successfully
    this.bot.on("polling_start", () => {
      console.log("✅ Bot polling started successfully");
    });
  }

  handleMessage(msg) {
    // TODO: Implement your message handling logic here
    console.log("Received message:", msg.text);
  }

  // [Include all your other methods here - they remain the same]
  // I'm keeping this shortened for brevity, but you should copy all methods from your original code
}

// Start the bot
const moderationBot = new ModerationBot();

// Health check endpoint (optional, useful for Railway)
const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "Soul Community Bot is running!",
    uptime: process.uptime(),
  });
});

app.listen(PORT, () => {
  console.log(`🌐 Health check server running on port ${PORT}`);
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("🔄 Shutting down bot...");
  moderationBot.saveData();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("🔄 Shutting down bot...");
  moderationBot.saveData();
  process.exit(0);
});

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught Exception:", error);
  moderationBot.saveData();
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
});
