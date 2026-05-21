// Runs inside player.twitch.tv iframes (multistream sites, custom embeds).
// Cross-origin from parent, so we can't read parent DOM. Channel comes from
// the iframe's own ?channel= query param.

const HEARTBEAT_MS = 10 * 1000;

function getChannelFromQuery() {
  const ch = new URLSearchParams(location.search).get("channel");
  return ch ? ch.toLowerCase() : null;
}

function getVideoState() {
  const videos = [...document.querySelectorAll("video")]
    .filter(v => v.readyState > 0);
  if (videos.length === 0) return { present: false };
  const main = videos.sort(
    (a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight
  )[0];
  return {
    present: true,
    paused: main.paused,
    muted: main.muted,
    width: main.clientWidth,
  };
}

let twitchUserFallback = null;
chrome.storage.local.get("twitchUser", ({ twitchUser: u }) => { twitchUserFallback = u || null; });

let tickInterval = null;
let firstTick = null;

function stopTicking() {
  if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }
  if (firstTick) { clearTimeout(firstTick); firstTick = null; }
}

function tick() {
  if (!chrome.runtime?.id) {
    stopTicking();
    return;
  }

  const channel = getChannelFromQuery();
  if (!channel) return;

  const video = getVideoState();
  if (!video.present || video.paused) return;

  // Iframe can't see parent visibility cross-origin. Use audio as the
  // active-vs-passive signal: unmuted = active, muted = passive (background
  // tile in a multistream layout).
  const state = video.muted ? "passive" : "active";

  const heartbeat = {
    ts: Math.floor(Date.now() / 1000),
    channel,
    category: null,
    title: null,
    state,
    tab_visible: true,
    twitch_user: twitchUserFallback,
  };

  try {
    chrome.runtime.sendMessage({ type: "heartbeat", payload: heartbeat });
  } catch (e) {
    stopTicking();
  }
}

tickInterval = setInterval(tick, HEARTBEAT_MS);
firstTick = setTimeout(tick, 5000);
