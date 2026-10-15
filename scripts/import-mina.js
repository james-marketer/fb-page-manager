// One-off: pulls the existing Mina Messenger bot's token and FAQ content
// (../messenger-bot) into this multi-page system as its first connected
// page, so the FAQ config you already tuned isn't retyped by hand.
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const db = require("../src/db");
const { encrypt } = require("../src/crypto");
const facebook = require("../src/facebook");

const OLD_BOT_DIR = path.join(__dirname, "..", "..", "messenger-bot");

// Ported by hand from messenger-bot/faq.js -- question text for ice
// breakers/buttons (TOPIC_QUESTIONS) and the keyword table (TOPIC_KEYWORDS),
// since faq.js only exports the parts the old bot needs at runtime.
const TOPIC_QUESTIONS = {
  HOURS: "What are your hours?",
  LOCATION: "Where are you located?",
  PRICE: "How much does it cost?",
  GAMES: "What games do you have?",
  BOOKING: "How do I book a seat?",
  WIFI: "Do you have WiFi / snacks?",
  STAFF: "Is there staff on-site?",
  HUMAN: "I need to talk to a person",
};

const TOPIC_KEYWORDS = {
  HOURS: ["hour", "open", "close", "time"],
  LOCATION: ["location", "address", "where"],
  PRICE: ["price", "cost", "fee", "rate", "how much", "hm"],
  GAMES: ["game", "play", "console"],
  BOOKING: ["book", "reserve", "seat", "table", "slot"],
  WIFI: ["wifi", "outlet", "plug", "food", "snack"],
  STAFF: ["staff", "safe", "security", "cctv", "guard"],
  HUMAN: ["human", "agent", "help", "support", "real person"],
};

async function main() {
  const envPath = path.join(OLD_BOT_DIR, ".env");
  if (!fs.existsSync(envPath)) {
    console.error(`Can't find ${envPath} -- is the old bot still at ../messenger-bot?`);
    process.exit(1);
  }
  const oldEnv = dotenv.parse(fs.readFileSync(envPath));
  if (!oldEnv.PAGE_ACCESS_TOKEN) {
    console.error("messenger-bot/.env has no PAGE_ACCESS_TOKEN.");
    process.exit(1);
  }

  const { GREETING, ANSWERS } = require(path.join(OLD_BOT_DIR, "faq.js"));

  console.log("Verifying token with Facebook...");
  const info = await facebook.getPageInfo(oldEnv.PAGE_ACCESS_TOKEN);

  if (db.getPage(info.id)) {
    console.log(`"${info.name}" is already connected in this system. Nothing to do.`);
    return;
  }

  const topics = Object.entries(ANSWERS).map(([key, answer]) => ({
    key,
    question: TOPIC_QUESTIONS[key] || key,
    keywords: TOPIC_KEYWORDS[key] || [],
    answer,
  }));

  db.addPage({
    id: info.id,
    name: info.name,
    accessTokenEnc: encrypt(oldEnv.PAGE_ACCESS_TOKEN),
    enabled: true,
    setupPushedAt: null,
    createdAt: new Date().toISOString(),
    faq: { greeting: GREETING, sessionGapMinutes: 30, topics },
    booking: db.defaultBooking(),
  });

  console.log(`Imported "${info.name}" (${info.id}) with ${topics.length} FAQ topics.`);
  console.log("Review it at /pages/" + info.id + ", then push setup to Facebook when ready.");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
