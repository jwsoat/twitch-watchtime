const $ = (id) => document.getElementById(id);

async function load() {
  const { apiUrl, apiKey, twitchUser, youtubeUser, clientId, hb_queue, yt_queue } =
    await chrome.storage.local.get([
      "apiUrl", "apiKey", "twitchUser", "youtubeUser",
      "clientId", "hb_queue", "yt_queue",
    ]);
  $("apiUrl").value = apiUrl || "";
  $("apiKey").value = apiKey || "";
  $("twitchUser").value = twitchUser || "";
  $("youtubeUser").value = youtubeUser || "";
  $("clientId").textContent = clientId || "(not yet assigned)";
  $("queueLen").textContent = hb_queue ? hb_queue.length : 0;
  $("ytQueueLen").textContent = yt_queue ? yt_queue.length : 0;
}

async function refreshQueue() {
  const { hb_queue, yt_queue } = await chrome.storage.local.get(["hb_queue", "yt_queue"]);
  $("queueLen").textContent = hb_queue ? hb_queue.length : 0;
  $("ytQueueLen").textContent = yt_queue ? yt_queue.length : 0;
}

$("save").addEventListener("click", async () => {
  await chrome.storage.local.set({
    apiUrl: $("apiUrl").value.trim().replace(/\/$/, ""),
    apiKey: $("apiKey").value.trim(),
    twitchUser: $("twitchUser").value.trim().toLowerCase(),
    youtubeUser: $("youtubeUser").value.trim().toLowerCase(),
  });
  const msg = $("statusMsg");
  msg.textContent = "Saved.";
  msg.className = "status-msg";
  setTimeout(() => { msg.textContent = ""; }, 2000);
});

load();
setInterval(refreshQueue, 10_000);
