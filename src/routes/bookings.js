const express = require("express");
const db = require("../db");

const router = express.Router();

router.post("/pages/:id/booking", (req, res) => {
  const page = db.getPage(req.params.id);
  if (!page) return res.sendStatus(404);

  const { enabled, slotMinutes, serviceKey, serviceName, serviceDuration, serviceCapacity } = req.body;

  const hours = [0, 1, 2, 3, 4, 5, 6].map((i) => ({
    closed: req.body[`closed${i}`] !== "on",
    open: req.body[`open${i}`] || "09:00",
    close: req.body[`close${i}`] || "18:00",
  }));

  const keys = [].concat(serviceKey || []);
  const names = [].concat(serviceName || []);
  const durations = [].concat(serviceDuration || []);
  const capacities = [].concat(serviceCapacity || []);

  const services = keys
    .map((k, i) => ({
      key: (k || "").trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_"),
      name: (names[i] || "").trim(),
      durationMinutes: Number(durations[i]) || 30,
      capacityPerSlot: Number(capacities[i]) || 1,
    }))
    .filter((s) => s.key && s.name);

  db.updatePage(page.id, {
    booking: {
      enabled: enabled === "on",
      slotMinutes: Number(slotMinutes) || 30,
      services,
      hours,
    },
  });

  res.redirect(`/pages/${page.id}?msg=${encodeURIComponent("Booking config saved.")}`);
});

router.post("/bookings/:id/cancel", (req, res) => {
  const booking = db.getBooking(req.params.id);
  if (!booking) return res.sendStatus(404);
  db.updateBooking(booking.id, { status: "cancelled" });
  res.redirect(req.get("referer") || `/pages/${booking.pageId}`);
});

module.exports = router;
