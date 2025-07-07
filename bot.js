// Replace with your actual bot token
require('dotenv').config();

const BOT_TOKEN = process.env.BOT_TOKEN;

// Replace with actual admin user IDs (comma-separated in .env, e.g. ADMIN_IDS=12345,67890)
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(id => Number(id.trim())) : [];

// Update with your project's whitepaper URL
const PROJECT_WHITEPAPER = "https://your-project.com/whitepaper.pdf";

// Customize bad words (add your own)
const BAD_WORDS = ["spam", "scam", "fake", "hack", "pump", "dump"];

// Customize allowed links
const WHITELIST_LINKS = ["t.me", "telegram.org", "your-project.com"];

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
  }

  // Data persistence
  saveData() {
    const data = {
      userWarnings: Array.from(this.userWarnings.entries()),
      mutedUsers: Array.from(this.mutedUsers.entries()).map(([key, value]) => [
        key,
        value.toISOString(),
      ]),
    };

    fs.writeFileSync("bot_data.json", JSON.stringify(data, null, 2));
  }

  loadData() {
    try {
      if (fs.existsSync("bot_data.json")) {
        const data = JSON.parse(fs.readFileSync("bot_data.json", "utf8"));
        this.userWarnings = new Map(data.userWarnings || []);
        this.mutedUsers = new Map(
          (data.mutedUsers || []).map(([key, value]) => [key, new Date(value)])
        );
      }
    } catch (error) {
      console.error("Error loading data:", error);
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

  // Setup event handlers
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
      console.error("Polling error:", error);
    });
  }

  // New member handling
  async handleNewMembers(msg) {
    const chatId = msg.chat.id;

    for (const member of msg.new_chat_members) {
      // Check if it's a bot
      if (member.is_bot) {
        try {
          await this.bot.kickChatMember(chatId, member.id);
          await this.bot.sendMessage(
            chatId,
            `🤖 Bot @${
              member.username || member.first_name
            } was automatically removed.`
          );
        } catch (error) {
          console.error("Failed to kick bot:", error);
        }
        continue;
      }

      // Check profile photo
      try {
        const photos = await this.bot.getUserProfilePhotos(member.id, {
          limit: 1,
        });
        if (photos.total_count === 0) {
          await this.bot.restrictChatMember(chatId, member.id, {
            permissions: {
              can_send_messages: false,
              can_send_media_messages: false,
              can_send_other_messages: false,
              can_add_web_page_previews: false,
            },
          });

          await this.bot.sendMessage(
            chatId,
            `⚠️ <a href="tg://user?id=${member.id}">${member.first_name}</a> has been restricted. Please add a profile photo and verify yourself.`,
            { parse_mode: "HTML" }
          );
        }
      } catch (error) {
        console.error("Failed to check profile photo:", error);
      }

      // Generate verification question
      const { question, answer } = this.generateMathQuestion();
      this.pendingVerifications.set(member.id, {
        answer,
        timestamp: Date.now(),
        chatId,
      });

      // Send welcome message with verification
      const welcomeMessage = `🎉 Welcome to Soul Community, <a href="tg://user?id=${member.id}">${member.first_name}</a>!

Please verify that you're human by solving this simple math problem:
<b>${question} = ?</b>

Click the button below and answer the question.`;

      const keyboard = {
        inline_keyboard: [
          [{ text: "✅ Verify", callback_data: `verify_${member.id}` }],
        ],
      };

      await this.bot.sendMessage(chatId, welcomeMessage, {
        parse_mode: "HTML",
        reply_markup: keyboard,
      });

      // Set timeout to remove unverified user
      setTimeout(() => {
        this.removeUnverifiedUser(member.id, chatId);
      }, this.verificationTimeout);
    }

    // Delete the system message
    await this.deleteJoinLeaveMessage(msg);
  }

  async removeUnverifiedUser(userId, chatId) {
    if (this.pendingVerifications.has(userId)) {
      try {
        await this.bot.kickChatMember(chatId, userId);
        await this.bot.sendMessage(
          chatId,
          "⏰ User was removed for not completing verification in time."
        );
        this.pendingVerifications.delete(userId);
      } catch (error) {
        console.error("Failed to remove unverified user:", error);
      }
    }
  }

  // Callback query handler
  async handleCallbackQuery(query) {
    const { data, from, message } = query;

    if (data.startsWith("verify_")) {
      const userId = parseInt(data.split("_")[1]);

      if (from.id !== userId) {
        await this.bot.answerCallbackQuery(query.id, {
          text: "❌ You can only verify yourself!",
        });
        return;
      }

      if (!this.pendingVerifications.has(userId)) {
        await this.bot.editMessageText("✅ You are already verified!", {
          chat_id: message.chat.id,
          message_id: message.message_id,
        });
        return;
      }

      const verification = this.pendingVerifications.get(userId);
      await this.bot.editMessageText(
        `Please type your answer in the chat.\nQuestion: <b>${verification.answer} = ?</b>\nYou have 5 minutes to answer.`,
        {
          chat_id: message.chat.id,
          message_id: message.message_id,
          parse_mode: "HTML",
        }
      );

      await this.bot.answerCallbackQuery(query.id);
    }
  }

  // Message handling
  async handleMessage(msg) {
    const { chat, from, text, message_id } = msg;

    // Skip if no text or is a command
    if (!text || text.startsWith("/")) return;

    // Skip if user is muted
    if (this.mutedUsers.has(from.id)) {
      const muteEnd = this.mutedUsers.get(from.id);
      if (Date.now() > muteEnd.getTime()) {
        this.mutedUsers.delete(from.id);
        this.saveData();
      } else {
        await this.bot.deleteMessage(chat.id, message_id);
        return;
      }
    }

    // Handle verification answer
    if (this.pendingVerifications.has(from.id)) {
      await this.handleVerificationAnswer(msg);
      return;
    }

    // Apply moderation filters
    if (await this.checkSlowMode(msg)) return;
    if (await this.checkSpamFlood(msg)) return;
    if (await this.checkBadWords(msg)) return;
    if (await this.checkLinks(msg)) return;

    // Handle whitepaper requests
    if (this.isWhitepaperRequest(text)) {
      await this.sendWhitepaper(msg);
    }
  }

  async handleVerificationAnswer(msg) {
    const { from, text, chat, message_id } = msg;
    const userAnswer = parseInt(text.trim());

    if (isNaN(userAnswer)) {
      await this.bot.sendMessage(chat.id, "❌ Please enter a valid number.");
      await this.bot.deleteMessage(chat.id, message_id);
      return;
    }

    const verification = this.pendingVerifications.get(from.id);

    if (userAnswer === verification.answer) {
      // Correct answer
      await this.bot.restrictChatMember(chat.id, from.id, {
        permissions: {
          can_send_messages: true,
          can_send_media_messages: true,
          can_send_other_messages: true,
          can_add_web_page_previews: true,
        },
      });

      await this.bot.sendMessage(
        chat.id,
        `✅ Correct! Welcome to Soul Community, <a href="tg://user?id=${from.id}">${from.first_name}</a>!`,
        { parse_mode: "HTML" }
      );

      this.pendingVerifications.delete(from.id);
    } else {
      await this.bot.sendMessage(
        chat.id,
        "❌ Incorrect answer. Please try again."
      );
    }

    await this.bot.deleteMessage(chat.id, message_id);
  }

  // Moderation filters
  async checkSlowMode(msg) {
    const { from, chat, message_id } = msg;
    const now = Date.now();

    if (this.slowModeUsers.has(from.id)) {
      const lastMessage = this.slowModeUsers.get(from.id);
      const timeDiff = (now - lastMessage) / 1000;

      if (timeDiff < this.slowModeInterval) {
        await this.bot.deleteMessage(chat.id, message_id);
        const remaining = Math.ceil(this.slowModeInterval - timeDiff);
        await this.bot.sendMessage(
          chat.id,
          `⏳ Please wait ${remaining} seconds before sending another message.`
        );
        return true;
      }
    }

    this.slowModeUsers.set(from.id, now);
    return false;
  }

  async checkSpamFlood(msg) {
    const { from, text, chat, message_id } = msg;
    const now = Date.now();

    // Initialize user data
    if (!this.userMessages.has(from.id)) {
      this.userMessages.set(from.id, []);
    }
    if (!this.userMessageHistory.has(from.id)) {
      this.userMessageHistory.set(from.id, []);
    }

    // Check spam (message rate)
    const userMessages = this.userMessages.get(from.id);
    const recentMessages = userMessages.filter((time) => now - time < 60000); // Last minute
    recentMessages.push(now);
    this.userMessages.set(from.id, recentMessages);

    if (recentMessages.length > this.spamThreshold) {
      await this.warnUser(msg, "Spam detected");
      await this.bot.deleteMessage(chat.id, message_id);
      return true;
    }

    // Check flood (repeated messages)
    const messageHistory = this.userMessageHistory.get(from.id);
    messageHistory.push(text);
    if (messageHistory.length > this.floodThreshold) {
      messageHistory.shift();
    }

    const recentTexts = messageHistory.slice(-5);
    if (recentTexts.length >= 3 && new Set(recentTexts).size === 1) {
      await this.warnUser(msg, "Flood detected");
      await this.bot.deleteMessage(chat.id, message_id);
      return true;
    }

    return false;
  }

  async checkBadWords(msg) {
    const { text, chat, message_id, from } = msg;
    const lowerText = text.toLowerCase();

    for (const badWord of BAD_WORDS) {
      if (lowerText.includes(badWord)) {
        await this.bot.deleteMessage(chat.id, message_id);
        await this.bot.sendMessage(
          chat.id,
          `🚫 <a href="tg://user?id=${from.id}">${from.first_name}</a>, inappropriate language is not allowed.`,
          { parse_mode: "HTML" }
        );
        return true;
      }
    }

    return false;
  }

  async checkLinks(msg) {
    const { text, chat, message_id, from } = msg;
    const urlRegex = /https?:\/\/[^\s]+/g;
    const urls = text.match(urlRegex) || [];

    for (const url of urls) {
      if (!WHITELIST_LINKS.some((whitelist) => url.includes(whitelist))) {
        await this.bot.deleteMessage(chat.id, message_id);
        await this.bot.sendMessage(
          chat.id,
          `🚫 <a href="tg://user?id=${from.id}">${from.first_name}</a>, external links are not allowed.`,
          { parse_mode: "HTML" }
        );
        return true;
      }
    }

    return false;
  }

  // Warning system
  async warnUser(msg, reason = "") {
    const { from, chat } = msg;
    const userId = from.id;

    const currentWarnings = this.userWarnings.get(userId) || 0;
    const newWarnings = currentWarnings + 1;
    this.userWarnings.set(userId, newWarnings);

    if (newWarnings >= this.maxWarnings) {
      try {
        await this.bot.kickChatMember(chat.id, userId);
        await this.bot.sendMessage(
          chat.id,
          `🚫 <a href="tg://user?id=${userId}">${from.first_name}</a> has been kicked for reaching ${this.maxWarnings} warnings.`,
          { parse_mode: "HTML" }
        );
        this.userWarnings.delete(userId);
      } catch (error) {
        console.error("Failed to kick user:", error);
      }
    } else {
      await this.bot.sendMessage(
        chat.id,
        `⚠️ <a href="tg://user?id=${userId}">${from.first_name}</a> has been warned (${newWarnings}/${this.maxWarnings}). Reason: ${reason}`,
        { parse_mode: "HTML" }
      );
    }

    this.saveData();
  }

  // Admin commands
  async kickUser(msg) {
    if (!this.isAdmin(msg.from.id)) {
      await this.bot.sendMessage(
        msg.chat.id,
        "❌ Only admins can use this command."
      );
      return;
    }

    if (!msg.reply_to_message) {
      await this.bot.sendMessage(
        msg.chat.id,
        "❌ Please reply to a message to kick the user."
      );
      return;
    }

    const userToKick = msg.reply_to_message.from;

    try {
      await this.bot.kickChatMember(msg.chat.id, userToKick.id);
      await this.bot.sendMessage(
        msg.chat.id,
        `🚫 <a href="tg://user?id=${userToKick.id}">${userToKick.first_name}</a> has been kicked.`,
        { parse_mode: "HTML" }
      );
    } catch (error) {
      await this.bot.sendMessage(
        msg.chat.id,
        `❌ Failed to kick user: ${error.message}`
      );
    }
  }

  async banUser(msg) {
    if (!this.isAdmin(msg.from.id)) {
      await this.bot.sendMessage(
        msg.chat.id,
        "❌ Only admins can use this command."
      );
      return;
    }

    if (!msg.reply_to_message) {
      await this.bot.sendMessage(
        msg.chat.id,
        "❌ Please reply to a message to ban the user."
      );
      return;
    }

    const userToBan = msg.reply_to_message.from;

    try {
      await this.bot.banChatMember(msg.chat.id, userToBan.id);
      await this.bot.sendMessage(
        msg.chat.id,
        `🚫 <a href="tg://user?id=${userToBan.id}">${userToBan.first_name}</a> has been banned.`,
        { parse_mode: "HTML" }
      );
    } catch (error) {
      await this.bot.sendMessage(
        msg.chat.id,
        `❌ Failed to ban user: ${error.message}`
      );
    }
  }

  async muteUser(msg, match) {
    if (!this.isAdmin(msg.from.id)) {
      await this.bot.sendMessage(
        msg.chat.id,
        "❌ Only admins can use this command."
      );
      return;
    }

    if (!msg.reply_to_message) {
      await this.bot.sendMessage(
        msg.chat.id,
        "❌ Please reply to a message to mute the user."
      );
      return;
    }

    const userToMute = msg.reply_to_message.from;
    const duration = match[1] ? parseInt(match[1]) : 60; // Default 60 minutes

    try {
      const until = new Date(Date.now() + duration * 60000);

      await this.bot.restrictChatMember(msg.chat.id, userToMute.id, {
        permissions: {
          can_send_messages: false,
          can_send_media_messages: false,
          can_send_other_messages: false,
          can_add_web_page_previews: false,
        },
        until_date: Math.floor(until.getTime() / 1000),
      });

      this.mutedUsers.set(userToMute.id, until);
      await this.bot.sendMessage(
        msg.chat.id,
        `🤫 <a href="tg://user?id=${userToMute.id}">${userToMute.first_name}</a> has been muted for ${duration} minutes.`,
        { parse_mode: "HTML" }
      );
      this.saveData();
    } catch (error) {
      await this.bot.sendMessage(
        msg.chat.id,
        `❌ Failed to mute user: ${error.message}`
      );
    }
  }

  async unmuteUser(msg) {
    if (!this.isAdmin(msg.from.id)) {
      await this.bot.sendMessage(
        msg.chat.id,
        "❌ Only admins can use this command."
      );
      return;
    }

    if (!msg.reply_to_message) {
      await this.bot.sendMessage(
        msg.chat.id,
        "❌ Please reply to a message to unmute the user."
      );
      return;
    }

    const userToUnmute = msg.reply_to_message.from;

    try {
      await this.bot.restrictChatMember(msg.chat.id, userToUnmute.id, {
        permissions: {
          can_send_messages: true,
          can_send_media_messages: true,
          can_send_other_messages: true,
          can_add_web_page_previews: true,
        },
      });

      this.mutedUsers.delete(userToUnmute.id);
      await this.bot.sendMessage(
        msg.chat.id,
        `🔊 <a href="tg://user?id=${userToUnmute.id}">${userToUnmute.first_name}</a> has been unmuted.`,
        { parse_mode: "HTML" }
      );
      this.saveData();
    } catch (error) {
      await this.bot.sendMessage(
        msg.chat.id,
        `❌ Failed to unmute user: ${error.message}`
      );
    }
  }

  async warnUserCommand(msg) {
    if (!this.isAdmin(msg.from.id)) {
      await this.bot.sendMessage(
        msg.chat.id,
        "❌ Only admins can use this command."
      );
      return;
    }

    if (!msg.reply_to_message) {
      await this.bot.sendMessage(
        msg.chat.id,
        "❌ Please reply to a message to warn the user."
      );
      return;
    }

    await this.warnUser(msg.reply_to_message, "Manual warning by admin");
  }

  async tagEveryone(msg) {
    if (!this.isAdmin(msg.from.id)) {
      await this.bot.sendMessage(
        msg.chat.id,
        "❌ Only admins can use this command."
      );
      return;
    }

    await this.bot.sendMessage(
      msg.chat.id,
      "📢 @everyone - Important announcement!"
    );
  }

  // Whitepaper handling
  isWhitepaperRequest(text) {
    const keywords = ["whitepaper", "white paper", "wp", "paper"];
    return keywords.some((keyword) => text.toLowerCase().includes(keyword));
  }

  async sendWhitepaper(msg) {
    const whitepaperMessage = `📄 <b>Soul Community Whitepaper</b>

Here's our project whitepaper: ${PROJECT_WHITEPAPER}

<b>Key Features:</b>
• Decentralized community governance
• Innovative tokenomics
• Cross-chain compatibility
• Community-driven development

For more questions, feel free to ask!`;

    await this.bot.sendMessage(msg.chat.id, whitepaperMessage, {
      parse_mode: "HTML",
    });
  }

  // Utility functions
  async deleteJoinLeaveMessage(msg) {
    try {
      await this.bot.deleteMessage(msg.chat.id, msg.message_id);
    } catch (error) {
      // Silently ignore if message is already deleted
    }
  }
}

// Start the bot
const moderationBot = new ModerationBot();

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("Shutting down bot...");
  moderationBot.saveData();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("Shutting down bot...");
  moderationBot.saveData();
  process.exit(0);
});
