const express = require("express");
const db = require("../db");
const { encrypt, decrypt } = require("../crypto");
const facebook = require("../facebook");

const router = express.Router();

router.get("/pages", (req, res) => {
  res.render("pages/index", { pages: db.getPages() });
});

router.get("/pages/new", (req, res) => {
  res.render("pages/new", { error: null, accessToken: "" });
});

router.post("/pages/new", async (req, res) => {
  const { accessToken } = req.body;

  try {
    const info = await facebook.getPageInfo(accessToken.trim());

    if (db.getPage(info.id)) {
      return res.render("pages/new", {
        error: `"${info.name}" is already connected.`,
        accessToken,
      });
    }

    db.addPage({
      id: info.id,
      name: info.name,
      accessTokenEnc: encrypt(accessToken.trim()),
      enabled: true,
      setupPushedAt: null,
      createdAt: new Date().toISOString(),
      faq: {
        greeting: `Hi! Thanks for reaching out to ${info.name} 👋`,
        sessionGapMinutes: 30,
        topics: [],
      },
      booking: db.defaultBooking(),
    });

    res.redirect(`/pages/${info.id}?msg=${encodeURIComponent(`Connected "${info.name}".`)}`);
  } catch (err) {
    res.render("pages/new", { error: err.message, accessToken });
  }
});

router.get("/pages/:id", (req, res) => {
  const page = db.getPage(req.params.id);
  if (!page) return res.sendStatus(404);
  res.render("pages/show", { page, posts: db.getPosts(page.id), bookings: db.getBookings(page.id) });
});

router.post("/pages/:id/faq", (req, res) => {
  const page = db.getPage(req.params.id);
  if (!page) return res.sendStatus(404);

  const { greeting, sessionGapMinutes, key, question, keywords, answer } = req.body;
  const keys = [].concat(key || []);
  const questions = [].concat(question || []);
  const keywordsList = [].concat(keywords || []);
  const answers = [].concat(answer || []);

  const topics = keys
    .map((k, i) => ({
      key: (k || "").trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_"),
      question: (questions[i] || "").trim(),
      keywords: (keywordsList[i] || "")
        .split(",")
        .map((w) => w.trim())
        .filter(Boolean),
      answer: (answers[i] || "").trim(),
    }))
    .filter((t) => t.key && t.question && t.answer);

  db.updatePage(page.id, {
    faq: { greeting: greeting.trim(), sessionGapMinutes: Number(sessionGapMinutes) || 30, topics },
  });

  res.redirect(`/pages/${page.id}?msg=${encodeURIComponent("FAQ config saved.")}`);
});

router.post("/pages/:id/push-setup", async (req, res) => {
  const page = db.getPage(req.params.id);
  if (!page) return res.sendStatus(404);

  const accessToken = decrypt(page.accessTokenEnc);
  const mainTopics = page.faq.topics.slice(0, 3);
  const iceBreakerTopics = page.faq.topics.slice(0, 4);

  try {
    await facebook.setMessengerProfile(page.id, accessToken, {
      get_started: { payload: "GET_STARTED" },
      greeting: [{ locale: "default", text: page.faq.greeting }],
      ice_breakers: iceBreakerTopics.map((t) => ({ question: t.question, payload: t.key })),
      persistent_menu: [
        {
          locale: "default",
          composer_input_disabled: false,
          call_to_actions: mainTopics.map((t) => ({
            type: "postback",
            title: t.question.slice(0, 30),
            payload: t.key,
          })),
        },
      ],
    });

    db.updatePage(page.id, { setupPushedAt: new Date().toISOString() });
    res.redirect(`/pages/${page.id}?msg=${encodeURIComponent("Setup pushed to Facebook.")}`);
  } catch (err) {
    res.redirect(`/pages/${page.id}?msg=${encodeURIComponent(err.message)}&type=error`);
  }
});

router.post("/pages/:id/toggle", (req, res) => {
  const page = db.getPage(req.params.id);
  if (!page) return res.sendStatus(404);
  db.updatePage(page.id, { enabled: !page.enabled });
  res.redirect(`/pages/${page.id}`);
});

router.post("/pages/:id/delete", (req, res) => {
  db.deletePage(req.params.id);
  res.redirect(`/pages?msg=${encodeURIComponent("Page removed.")}`);
});

module.exports = router;
