const Anthropic = require("@anthropic-ai/sdk");
const db = require("./db");
const { decrypt } = require("./crypto");
const { sendMessage } = require("./facebook");
const availability = require("./availability");

const { ANTHROPIC_API_KEY, ANTHROPIC_MODEL } = process.env;
const MODEL = ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";
const MAX_TOOL_ITERATIONS = 6;
const MAX_HISTORY_MESSAGES = 12;

const client = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;

// Per (page, sender) turn history, in-memory only -- same tradeoff as the
// lastSeen map in webhook.js. Resets on restart.
const conversations = new Map();

const TOOLS = [
  {
    name: "check_availability",
    description: "List open booking slots for one of this business's services on a given date.",
    input_schema: {
      type: "object",
      properties: {
        serviceKey: { type: "string", description: "The service's key, exactly as listed in the services you were given." },
        date: { type: "string", description: "Date to check, as YYYY-MM-DD." },
      },
      required: ["serviceKey", "date"],
    },
  },
  {
    name: "create_booking",
    description: "Reserve a specific open slot for the customer. Only call this after the customer has confirmed a specific date and time.",
    input_schema: {
      type: "object",
      properties: {
        serviceKey: { type: "string" },
        startTime: { type: "string", description: "Exact slot start time as returned by check_availability, e.g. '2026-09-28 14:00'." },
        customerName: { type: "string", description: "Name to put the booking under, if the customer gave one." },
      },
      required: ["serviceKey", "startTime"],
    },
  },
  {
    name: "list_my_bookings",
    description: "List this customer's own upcoming confirmed bookings on this page. Use this before cancel_booking if you don't already have the booking id from earlier in the conversation.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "cancel_booking",
    description: "Cancel a booking this same customer previously made. Confirm with the customer which booking before calling this.",
    input_schema: {
      type: "object",
      properties: {
        bookingId: { type: "string", description: "The booking's id, from a prior create_booking or list_my_bookings result." },
      },
      required: ["bookingId"],
    },
  },
];

function buildSystemPrompt(page) {
  const services = page.booking.services
    .map((s) => `- ${s.key}: ${s.name} (${s.durationMinutes} min, capacity ${s.capacityPerSlot || 1} per slot)`)
    .join("\n") || "(no services configured yet)";

  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const hours = page.booking.hours
    .map((h, i) => (h.closed ? `- ${dayNames[i]}: closed` : `- ${dayNames[i]}: ${h.open}-${h.close}`))
    .join("\n");

  const faq = page.faq.topics.map((t) => `Q: ${t.question}\nA: ${t.answer}`).join("\n\n") || "(none)";

  return `You are the Messenger assistant for "${page.name}". Today's date is ${new Date().toISOString().slice(0, 10)}.

Answer questions using this business's own information below. Keep replies short -- this is a chat bubble, not an email.

Services you can book:
${services}

Weekly hours:
${hours}

Frequently asked questions:
${faq}

Rules:
- Never invent a service, price, or time slot that isn't given to you above or by a tool result.
- To book something, first call check_availability to find a real open slot, confirm the exact time with the customer, then call create_booking. Don't call create_booking on a guessed time.
- If nothing is open, say so plainly and suggest the customer try another date.
- If the customer asks for something you have no information about, say you're not sure and that a human will follow up -- don't guess.`;
}

function historyFor(key) {
  if (!conversations.has(key)) conversations.set(key, []);
  return conversations.get(key);
}

function pushHistory(key, entry) {
  const history = historyFor(key);
  history.push(entry);
  while (history.length > MAX_HISTORY_MESSAGES) history.shift();
}

async function runTool(page, senderId, name, input) {
  try {
    if (name === "check_availability") {
      const slots = availability.getOpenSlots(page, input.serviceKey, input.date);
      return slots.length
        ? { slots: slots.map((s) => s.startTime) }
        : { slots: [], note: "No open slots for that service on that date." };
    }
    if (name === "create_booking") {
      const booking = availability.createBooking(page, {
        serviceKey: input.serviceKey,
        startTime: input.startTime,
        customerName: input.customerName,
        senderId,
      });
      return {
        confirmed: true,
        bookingId: booking.id,
        startTime: booking.startTime,
        endTime: booking.endTime,
        serviceName: booking.serviceName,
      };
    }
    if (name === "list_my_bookings") {
      const mine = db
        .getBookings(page.id)
        .filter((b) => b.senderId === senderId && b.status === "confirmed");
      return { bookings: mine.map((b) => ({ bookingId: b.id, serviceName: b.serviceName, startTime: b.startTime })) };
    }
    if (name === "cancel_booking") {
      const cancelled = availability.cancelBooking(input.bookingId, senderId);
      return { cancelled: true, startTime: cancelled.startTime, serviceName: cancelled.serviceName };
    }
    return { error: `Unknown tool ${name}` };
  } catch (err) {
    return { error: err.message };
  }
}

async function handleMessage(page, senderId, text) {
  if (!client) {
    console.error("ANTHROPIC_API_KEY is not set -- can't run the booking assistant.");
    return sendText(page, senderId, "Booking is temporarily unavailable -- please try again later.");
  }

  const key = `${page.id}:${senderId}`;
  pushHistory(key, { role: "user", content: text });

  try {
    let messages = [...historyFor(key)];
    let finalText = null;

    for (let i = 0; i < MAX_TOOL_ITERATIONS && finalText === null; i++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 512,
        system: buildSystemPrompt(page),
        tools: TOOLS,
        messages,
      });

      const toolUses = response.content.filter((b) => b.type === "tool_use");
      if (toolUses.length === 0) {
        finalText = response.content
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
        break;
      }

      messages.push({ role: "assistant", content: response.content });
      const toolResults = [];
      for (const use of toolUses) {
        const result = await runTool(page, senderId, use.name, use.input);
        toolResults.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(result) });
      }
      messages.push({ role: "user", content: toolResults });
    }

    if (!finalText) {
      finalText = "Sorry, that's taking longer than expected -- could you try rephrasing?";
    }

    pushHistory(key, { role: "assistant", content: finalText });
    await sendText(page, senderId, finalText);
  } catch (err) {
    console.error(`AI booking error for page ${page.id}:`, err.message);
    await sendText(page, senderId, "Sorry, having trouble right now -- please try again in a bit.");
  }
}

function sendText(page, senderId, text) {
  return sendMessage(decrypt(page.accessTokenEnc), senderId, { text });
}

module.exports = { handleMessage };
