const { randomUUID } = require("crypto");
const db = require("./db");

// Times are naive "business-local" strings, computed against the server's
// own clock -- same tradeoff the rest of this app makes (e.g. in-memory
// lastSeen in webhook.js). Fine as long as the server and the business
// share a timezone; see README for the caveat if a client doesn't.

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function fromMinutes(mins) {
  const h = String(Math.floor(mins / 60)).padStart(2, "0");
  const m = String(mins % 60).padStart(2, "0");
  return `${h}:${m}`;
}

function findService(page, serviceKey) {
  return page.booking.services.find((s) => s.key === serviceKey);
}

// dateStr: "YYYY-MM-DD". Returns [{ startTime, endTime }] in that page's
// naive local time, already filtered for past times and capacity.
function getOpenSlots(page, serviceKey, dateStr) {
  const service = findService(page, serviceKey);
  if (!service) throw new Error(`Unknown service "${serviceKey}".`);

  const date = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date "${dateStr}".`);

  const dayHours = page.booking.hours[date.getDay()];
  if (!dayHours || dayHours.closed) return [];

  const slotMinutes = page.booking.slotMinutes || 30;
  const openMin = toMinutes(dayHours.open);
  const closeMin = toMinutes(dayHours.close);
  const now = new Date();
  const isToday = dateStr === now.toISOString().slice(0, 10);
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const existing = db
    .getBookings(page.id)
    .filter((b) => b.status === "confirmed" && b.serviceKey === serviceKey && b.startTime.startsWith(dateStr));

  const slots = [];
  for (let start = openMin; start + service.durationMinutes <= closeMin; start += slotMinutes) {
    if (isToday && start <= nowMin) continue;

    const overlapping = existing.filter((b) => {
      const bStart = toMinutes(b.startTime.slice(11, 16));
      const bEnd = toMinutes(b.endTime.slice(11, 16));
      return start < bEnd && start + service.durationMinutes > bStart;
    });
    if (overlapping.length >= (service.capacityPerSlot || 1)) continue;

    slots.push({
      startTime: `${dateStr} ${fromMinutes(start)}`,
      endTime: `${dateStr} ${fromMinutes(start + service.durationMinutes)}`,
    });
  }
  return slots;
}

function createBooking(page, { serviceKey, startTime, customerName, senderId }) {
  const service = findService(page, serviceKey);
  if (!service) throw new Error(`Unknown service "${serviceKey}".`);

  const dateStr = startTime.slice(0, 10);
  const stillOpen = getOpenSlots(page, serviceKey, dateStr).some((s) => s.startTime === startTime);
  if (!stillOpen) throw new Error("That slot just got taken or isn't available. Please pick another time.");

  const [, timeStr] = startTime.split(" ");
  const endTime = `${dateStr} ${fromMinutes(toMinutes(timeStr) + service.durationMinutes)}`;

  return db.addBooking({
    id: randomUUID(),
    pageId: page.id,
    senderId,
    serviceKey,
    serviceName: service.name,
    startTime,
    endTime,
    customerName: customerName || null,
    status: "confirmed",
    createdAt: new Date().toISOString(),
  });
}

function cancelBooking(bookingId, senderId) {
  const booking = db.getBooking(bookingId);
  if (!booking || booking.senderId !== senderId) throw new Error("Booking not found.");
  return db.updateBooking(bookingId, { status: "cancelled" });
}

module.exports = { getOpenSlots, createBooking, cancelBooking };
