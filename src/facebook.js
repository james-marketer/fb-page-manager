const GRAPH_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

async function graphRequest(pathSegment, { method = "GET", accessToken, body } = {}) {
  const url = new URL(`${GRAPH_BASE}/${pathSegment}`);
  url.searchParams.set("access_token", accessToken);
  const init = { method, headers: {} };

  if (body) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  const res = await fetch(url, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = json.error && json.error.message ? json.error.message : res.statusText;
    throw new Error(`Graph API ${method} ${pathSegment} failed: ${message}`);
  }
  return json;
}

// Confirms a token is a real page token and returns { id, name }. Used both
// when adding a page (to validate + auto-fill the name) and by the Mina
// import script.
function getPageInfo(accessToken) {
  return graphRequest("me?fields=id,name", { accessToken });
}

function setMessengerProfile(pageId, accessToken, profile) {
  return graphRequest("me/messenger_profile", {
    method: "POST",
    accessToken,
    body: profile,
  });
}

function sendMessage(accessToken, recipientId, message) {
  return graphRequest("me/messages", {
    method: "POST",
    accessToken,
    body: { recipient: { id: recipientId }, message },
  });
}

// scheduledFor: Date or null. Facebook requires 10 minutes-75 days out.
function publishPost(pageId, accessToken, { message, imageUrl, scheduledFor }) {
  const body = { message };

  if (scheduledFor) {
    body.published = false;
    body.scheduled_publish_time = Math.floor(scheduledFor.getTime() / 1000);
  }

  if (imageUrl) {
    return graphRequest(`${pageId}/photos`, {
      method: "POST",
      accessToken,
      body: { ...body, url: imageUrl },
    });
  }

  return graphRequest(`${pageId}/feed`, { method: "POST", accessToken, body });
}

function deletePost(postId, accessToken) {
  return graphRequest(postId, { method: "DELETE", accessToken });
}

function getPostStatus(postId, accessToken) {
  return graphRequest(`${postId}?fields=is_published`, { accessToken });
}

module.exports = {
  getPageInfo,
  setMessengerProfile,
  sendMessage,
  publishPost,
  deletePost,
  getPostStatus,
};
