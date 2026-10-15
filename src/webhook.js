const crypto = require("crypto");
const db = require("./db");
const { decrypt } = require("./crypto");
const { sendMessage } = require("./facebook");
const ai = require("./ai");

const { VERIFY_TOKEN, APP_SECRET } = process.env;

// Tracks each (page, sender) pair's last message time so the greeting
// re-fires after a gap instead of only ever once. In-memory only: resets on
// restart, same tradeoff the original single-page bot made.
const lastSeen = new Map();

function verifyWebhook(req, res) {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
}

function verifySignature(req) {
  const signature = req.get("x-hub-signature-256");
  if (!signature || !req.rawBody) return false;

  const expected =
    "sha256=" + crypto.createHmac("sha256", APP_SECRET).update(req.rawBody).digest("hex");

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function receiveWebhook(req, res) {
  if (!verifySignature(req)) {
    return res.sendStatus(401);
  }

  // Ack immediately; Meta expects a fast response and retries on timeout.
  res.sendStatus(200);

  const body = req.body;
  if (body.object !== "page") return;

  for (const entry of body.entry || []) {
    const page = db.getPage(entry.id);
    if (!page || !page.enabled) continue;

    for (const event of entry.messaging || []) {
      handleEvent(page, event).catch((err) =>
        console.error(`Error handling event for page ${page.id}:`, err)
      );
    }
  }
}

async function handleEvent(page, event) {
  const senderId = event.sender && event.sender.id;
  if (!senderId) return;

  if (event.postback) {
    await handlePostback(page, senderId, event.postback.payload);
    return;
  }

  if (event.message && !event.message.is_echo) {
    await handleMessage(page, senderId, event.message);
  }
}

async function handleMessage(page, senderId, message) {
  const sessionKey = `${page.id}:${senderId}`;
  const now = Date.now();
  const previous = lastSeen.get(sessionKey);
  lastSeen.set(sessionKey, now);

  const gapMs = (page.faq.sessionGapMinutes || 30) * 60 * 1000;
  const isNewSession = !previous || now - previous >= gapMs;
  if (isNewSession) {
    await sendGreeting(page, senderId);
    return;
  }

  if (page.booking && page.booking.enabled) {
    await ai.handleMessage(page, senderId, message.text || "");
    return;
  }

  const topic = matchKeyword(page.faq.topics, message.text || "");
  if (topic) {
    await sendText(page, senderId, topic.answer);
    await sendMoreTopics(page, senderId, topic.key);
  }
}

async function handlePostback(page, senderId, payload) {
  if (payload === "GET_STARTED") {
    lastSeen.set(`${page.id}:${senderId}`, Date.now());
    await sendGreeting(page, senderId);
    return;
  }

  const topic = page.faq.topics.find((t) => t.key === payload);
  if (!topic) return;

  if (page.booking && page.booking.enabled) {
    await ai.handleMessage(page, senderId, topic.question);
    return;
  }

  await sendText(page, senderId, topic.answer);
  await sendMoreTopics(page, senderId, topic.key);
}

function matchKeyword(topics, text) {
  const lower = text.toLowerCase();
  return topics.find((t) => t.keywords.some((w) => lower.includes(w.toLowerCase())));
}

async function sendGreeting(page, senderId) {
  await sendText(page, senderId, page.faq.greeting);

  const mainTopics = page.faq.topics.slice(0, 3);
  if (mainTopics.length === 0) return;

  await sendMessage(decryptToken(page), senderId, {
    attachment: {
      type: "template",
      payload: {
        template_type: "button",
        text: "Want to know more?",
        buttons: mainTopics.map((t) => ({
          type: "postback",
          title: t.question.slice(0, 20),
          payload: t.key,
        })),
      },
    },
  });
}

// Quick replies for every topic other than the one just answered, so a
// visitor can keep exploring without retyping. Capped at Messenger's limit.
async function sendMoreTopics(page, senderId, justAnsweredKey) {
  const rest = page.faq.topics.filter((t) => t.key !== justAnsweredKey).slice(0, 13);
  if (rest.length === 0) return;

  await sendMessage(decryptToken(page), senderId, {
    text: "Anything else?",
    quick_replies: rest.map((t) => ({
      content_type: "text",
      title: t.question.slice(0, 20),
      payload: t.key,
    })),
  });
}

function sendText(page, senderId, text) {
  return sendMessage(decryptToken(page), senderId, { text });
}

function decryptToken(page) {
  return decrypt(page.accessTokenEnc);
}

module.exports = { verifyWebhook, receiveWebhook };
