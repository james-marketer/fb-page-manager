const crypto = require("crypto");

const { ADMIN_PASSWORD, SESSION_SECRET } = process.env;
const COOKIE_NAME = "fbpm_session";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function sign(value) {
  const hmac = crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
  return `${value}.${hmac}`;
}

function verify(signed) {
  if (!signed) return null;
  const dot = signed.lastIndexOf(".");
  if (dot === -1) return null;
  const value = signed.slice(0, dot);
  const hmac = signed.slice(dot + 1);
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex");

  const a = Buffer.from(hmac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return value;
}

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  return Object.fromEntries(
    header.split(";").map((pair) => {
      const [k, ...rest] = pair.trim().split("=");
      return [k, decodeURIComponent(rest.join("="))];
    })
  );
}

function login(req, res) {
  const { password } = req.body;
  const a = Buffer.from(password || "");
  const b = Buffer.from(ADMIN_PASSWORD);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!ok) {
    return res.render("login", { error: "Wrong password." });
  }

  const expires = Date.now() + MAX_AGE_MS;
  const token = sign(`ok:${expires}`);
  res.cookie(COOKIE_NAME, token, { httpOnly: true, sameSite: "lax", maxAge: MAX_AGE_MS });
  res.redirect("/pages");
}

function logout(req, res) {
  res.clearCookie(COOKIE_NAME);
  res.redirect("/login");
}

function requireAuth(req, res, next) {
  const cookies = parseCookies(req);
  const value = verify(cookies[COOKIE_NAME]);
  const expires = value && Number(value.split(":")[1]);

  if (value && expires > Date.now()) {
    return next();
  }
  res.redirect("/login");
}

module.exports = { login, logout, requireAuth };
