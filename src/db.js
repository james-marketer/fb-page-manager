const fs = require("fs");
const path = require("path");

// DATA_DIR lets a host point this at a persistent volume; without one, the
// data file is wiped on every redeploy.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, "db.json");

function defaultBooking() {
  return {
    enabled: false,
    slotMinutes: 30,
    services: [],
    hours: Array.from({ length: 7 }, () => ({ closed: true, open: "09:00", close: "18:00" })),
  };
}

function load() {
  if (!fs.existsSync(DB_PATH)) {
    return { pages: [], posts: [], bookings: [] };
  }
  const data = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  data.bookings = data.bookings || [];
  // Pages saved before the booking feature existed don't have this key yet.
  for (const page of data.pages) {
    page.booking = page.booking || defaultBooking();
  }
  return data;
}

let state = load();

// Small file, single-process, low write frequency (dashboard actions only)
// -- writing the whole file back out each time is simpler and safer than a
// real DB here, and avoids a native dependency on Windows.
function save() {
  fs.writeFileSync(DB_PATH, JSON.stringify(state, null, 2));
}

function getPages() {
  return state.pages;
}

function getPage(id) {
  return state.pages.find((p) => p.id === id);
}

function addPage(page) {
  state.pages.push(page);
  save();
  return page;
}

function updatePage(id, patch) {
  const page = getPage(id);
  if (!page) return null;
  Object.assign(page, patch);
  save();
  return page;
}

function deletePage(id) {
  state.pages = state.pages.filter((p) => p.id !== id);
  state.posts = state.posts.filter((p) => p.pageId !== id);
  save();
}

function getPosts(pageId) {
  const posts = pageId ? state.posts.filter((p) => p.pageId === pageId) : state.posts;
  return [...posts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function getPost(id) {
  return state.posts.find((p) => p.id === id);
}

function addPost(post) {
  state.posts.push(post);
  save();
  return post;
}

function updatePost(id, patch) {
  const post = getPost(id);
  if (!post) return null;
  Object.assign(post, patch);
  save();
  return post;
}

function deletePost(id) {
  state.posts = state.posts.filter((p) => p.id !== id);
  save();
}

function getBookings(pageId) {
  const bookings = pageId ? state.bookings.filter((b) => b.pageId === pageId) : state.bookings;
  return [...bookings].sort((a, b) => a.startTime.localeCompare(b.startTime));
}

function getBooking(id) {
  return state.bookings.find((b) => b.id === id);
}

function addBooking(booking) {
  state.bookings.push(booking);
  save();
  return booking;
}

function updateBooking(id, patch) {
  const booking = getBooking(id);
  if (!booking) return null;
  Object.assign(booking, patch);
  save();
  return booking;
}

module.exports = {
  defaultBooking,
  getPages,
  getPage,
  addPage,
  updatePage,
  deletePage,
  getPosts,
  getPost,
  addPost,
  updatePost,
  deletePost,
  getBookings,
  getBooking,
  addBooking,
  updateBooking,
};
