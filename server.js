require("dotenv").config();
const path = require("path");
const express = require("express");
const auth = require("./src/auth");
const webhook = require("./src/webhook");
const pagesRouter = require("./src/routes/pages");
const postsRouter = require("./src/routes/posts");
const bookingsRouter = require("./src/routes/bookings");

const REQUIRED_ENV = [
  "VERIFY_TOKEN",
  "APP_SECRET",
  "ADMIN_PASSWORD",
  "SESSION_SECRET",
  "ENCRYPTION_KEY",
];
for (const name of REQUIRED_ENV) {
  if (!process.env[name]) {
    console.error(`Missing required env var ${name}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
}

const { PORT = 3100 } = process.env;
const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));

// Webhook needs the raw body for signature verification, and must stay
// reachable without the dashboard login -- mount it before the auth gate.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.get("/webhook", webhook.verifyWebhook);
app.post("/webhook", webhook.receiveWebhook);

app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  res.locals.query = req.query;
  next();
});

app.get("/login", (req, res) => res.render("login", { error: null }));
app.post("/login", auth.login);
app.post("/logout", auth.logout);

app.get("/", (req, res) => res.redirect("/pages"));
app.use(auth.requireAuth);
app.use(pagesRouter);
app.use(postsRouter);
app.use(bookingsRouter);

app.listen(PORT, () => {
  console.log(`Facebook Page Manager listening on port ${PORT}`);
});
