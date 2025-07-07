// Load environment variables
require("dotenv").config();

const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
const fs = require("fs");
const path = require("path");

const BOT_TOKEN = "8013325969:AAGBPz0KzTfODhsnx3rssfwQU_CmKCpKb_I";
const ADMIN_IDS = [6934570829];
const PROJECT_WHITEPAPER = "https://your-project.com/whitepaper.pdf";
const BAD_WORDS = ["spam", "scam", "fake", "fuck", "hack", "pump", "dump"];
const WHITELIST_LINKS = ["t.me", "telegram.org", "your-project.com"];

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN is required in environment variables");
  process.exit(1);
}

class ModerationBot {
  constructor() {
    this.bot = new TelegramBot(BOT_TOKEN, { polling: true });
    this.userWarnings = new Map();
    this.mutedUsers = new Map();

    this.maxWarnings = 3;

    this.loadData();
    this.setupHandlers();

    console.log("🤖 Soul Community Moderation Bot is starting...");
    console.log(`📊 Bot configured with ${ADMIN_IDS.length} admin(s)`);
  }

  isAdmin(userId) {
    return ADMIN_IDS.includes(userId);
  }

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

  muteUser(msg, match) {
    if (!this.isAdmin(msg.from.id)) {
      this.bot.sendMessage(msg.chat.id, "❌ Only admins can use this command.");
      return;
    }

    if (msg.chat.type !== "supergroup") {
      this.bot.sendMessage(
        msg.chat.id,
        "❌ This command only works in supergroups."
      );
      return;
    }

    const duration = match[1] ? parseInt(match[1], 10) : 10;
    if (isNaN(duration) || duration <= 0) {
      this.bot.sendMessage(
        msg.chat.id,
        "❌ Please specify a valid mute duration in minutes."
      );
      return;
    }

    if (!msg.reply_to_message) {
      this.bot.sendMessage(
        msg.chat.id,
        "❌ Please reply to the user's message you want to mute."
      );
      return;
    }

    const userId = msg.reply_to_message.from.id;
    const untilDate = Math.floor(Date.now() / 1000) + duration * 60;

    this.bot
      .restrictChatMember(msg.chat.id, userId, {
        can_send_messages: false,
        until_date: untilDate,
      })
      .then(() => {
        this.bot.sendMessage(
          msg.chat.id,
          `🔇 User muted for ${duration} minute(s).`
        );
      })
      .catch((err) => {
        this.bot.sendMessage(msg.chat.id, "❌ Failed to mute user.");
        console.error(err);
      });
  }

  sendWhitepaper(msg) {
    this.bot.sendMessage(
      msg.chat.id,
      `📄 Project Whitepaper: ${PROJECT_WHITEPAPER}`
    );
  }

  handleMessage(msg) {
    if (!msg.text) return;
    const text = msg.text.toLowerCase();
    for (let word of BAD_WORDS) {
      if (text.includes(word)) {
        this.bot.deleteMessage(msg.chat.id, msg.message_id);
        this.bot.sendMessage(
          msg.chat.id,
          `🚫 Watch your language, @${msg.from.username || msg.from.first_name}`
        );
        break;
      }
    }
  }

  setupHandlers() {
    this.bot.onText(/\/mute(?:\s+(\d+))?/, (msg, match) =>
      this.muteUser(msg, match)
    );
    this.bot.onText(/\/whitepaper/, (msg) => this.sendWhitepaper(msg));
    this.bot.on("message", (msg) => this.handleMessage(msg));
    this.bot.on("polling_error", (error) => {
      console.error("❌ Polling error:", error.code, error.message);
    });
    this.bot.on("polling_start", () => {
      console.log("✅ Bot polling started successfully");
    });
  }
}

const moderationBot = new ModerationBot();

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

process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught Exception:", error);
  moderationBot.saveData();
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
});
