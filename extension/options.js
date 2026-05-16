const $ = (id) => document.getElementById(id);

async function load() {
  const { apiUrl, apiKey, twitchUser, clientId, hb_queue } =
    await chrome.storage.local.get(["apiUrl", "apiKey", "twitchUser", "clientId", "hb_queue"]);
  $("apiUrl").value = apiUrl || "";
  $("apiKey").value = apiKey || "";
  $("twitchUser").value = twitchUser || "";
  $("clientId").textContent = clientId || "(not yet assigned)";
  $("queueLen").textContent = hb_queue ? hb_queue.length : 0;
}

async function refreshQueue() {
  const { hb_queue } = await chrome.storage.local.get("hb_queue");
  $("queueLen").textContent = hb_queue ? hb_queue.length : 0;
}

$("save").addEventListener("click", async () => {
  await chrome.storage.local.set({
    apiUrl: $("apiUrl").value.trim().replace(/\/$/, ""),
    apiKey: $("apiKey").value.trim(),
    twitchUser: $("twitchUser").value.trim().toLowerCase(),
  });
  const msg = $("statusMsg");
  msg.textContent = "Saved.";
  msg.className = "status-msg";
  setTimeout(() => { msg.textContent = ""; }, 2000);
});

load();
setInterval(refreshQueue, 10_000);
