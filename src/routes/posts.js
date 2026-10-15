const { randomUUID } = require("crypto");
const express = require("express");
const db = require("../db");
const { decrypt } = require("../crypto");
const facebook = require("../facebook");

const router = express.Router();

const MIN_SCHEDULE_MS = 10 * 60 * 1000;
const MAX_SCHEDULE_MS = 75 * 24 * 60 * 60 * 1000;

router.get("/posts", (req, res) => {
  const posts = db.getPosts();
  const pagesById = Object.fromEntries(db.getPages().map((p) => [p.id, p]));
  res.render("posts/index", { posts, pagesById });
});

router.get("/pages/:id/posts/new", (req, res) => {
  const page = db.getPage(req.params.id);
  if (!page) return res.sendStatus(404);
  res.render("posts/new", { page, error: null, form: {} });
});

router.post("/pages/:id/posts", async (req, res) => {
  const page = db.getPage(req.params.id);
  if (!page) return res.sendStatus(404);

  const { message, imageUrl, scheduleAt } = req.body;
  let scheduledFor = null;

  if (scheduleAt) {
    scheduledFor = new Date(scheduleAt);
    const delta = scheduledFor.getTime() - Date.now();
    if (Number.isNaN(scheduledFor.getTime()) || delta < MIN_SCHEDULE_MS || delta > MAX_SCHEDULE_MS) {
      return res.render("posts/new", {
        page,
        error: "Scheduled time must be between 10 minutes and 75 days from now.",
        form: req.body,
      });
    }
  }

  const post = {
    id: randomUUID(),
    pageId: page.id,
    message: message.trim(),
    imageUrl: imageUrl ? imageUrl.trim() : null,
    scheduledFor: scheduledFor ? scheduledFor.toISOString() : null,
    status: "pending",
    fbPostId: null,
    error: null,
    createdAt: new Date().toISOString(),
  };

  try {
    const accessToken = decrypt(page.accessTokenEnc);
    const result = await facebook.publishPost(page.id, accessToken, {
      message: post.message,
      imageUrl: post.imageUrl,
      scheduledFor,
    });

    post.fbPostId = result.post_id || result.id;
    post.status = scheduledFor ? "scheduled" : "published";
  } catch (err) {
    post.status = "failed";
    post.error = err.message;
  }

  db.addPost(post);
  res.redirect(`/pages/${page.id}?msg=${encodeURIComponent(`Post ${post.status}.`)}`);
});

// Cancels a still-scheduled post on Facebook, or just drops it from our own
// list if it already went live -- never deletes an already-published post
// out from under the page.
router.post("/posts/:id/delete", async (req, res) => {
  const post = db.getPost(req.params.id);
  if (!post) return res.sendStatus(404);
  const page = db.getPage(post.pageId);

  if (post.status === "scheduled" && post.fbPostId && page) {
    try {
      await facebook.deletePost(post.fbPostId, decrypt(page.accessTokenEnc));
    } catch (err) {
      console.error("Failed to cancel scheduled post on Facebook:", err.message);
    }
  }

  db.deletePost(post.id);
  res.redirect(req.get("referer") || "/posts");
});

router.post("/posts/:id/sync", async (req, res) => {
  const post = db.getPost(req.params.id);
  if (!post) return res.sendStatus(404);
  const page = db.getPage(post.pageId);

  if (post.status === "scheduled" && post.fbPostId && page) {
    try {
      const info = await facebook.getPostStatus(post.fbPostId, decrypt(page.accessTokenEnc));
      if (info.is_published) {
        db.updatePost(post.id, { status: "published" });
      }
    } catch (err) {
      db.updatePost(post.id, { error: err.message });
    }
  }

  res.redirect(req.get("referer") || "/posts");
});

module.exports = router;
