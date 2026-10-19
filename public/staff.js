let selected, controls;
let pending;
try {
  pending = JSON.parse(sessionStorage.getItem("coffeePending") || "null");
} catch {
  pending = null;
}
const $ = (s) => document.querySelector(s);
const message = (t) => ($("#message").textContent = t);
async function api(url, options = {}) {
  const r = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const j = await r.json();
  if (!r.ok) throw Error(j.error || "Request failed");
  return j;
}
async function lookup() {
  selected = undefined;
  $("#purchase").disabled = $("#redeem").disabled = true;
  const m = await api(
    "/api/staff/members/" + encodeURIComponent($("#member").value.trim()),
  );
  selected = m.id;
  $("#balance").textContent =
    `${m.name}\n${m.stamps} / 8 stamps\n${m.rewards} available rewards\nMembership: ${m.id}`;
  $("#delivery").textContent = JSON.stringify(m.deliveries, null, 2);
  $("#purchase").disabled = false;
  $("#redeem").disabled = m.rewards < 1;
}
$("#login").onsubmit = async (e) => {
  e.preventDefault();
  try {
    await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ password: $("#password").value }),
    });
    $("#password").value = "";
    message("Signed in.");
  } catch (e) {
    message(e.message);
  }
};
$("#logout").onclick = async () => {
  try {
    await api("/api/logout", { method: "POST", body: "{}" });
    selected = undefined;
    $("#purchase").disabled = $("#redeem").disabled = true;
    message("Signed out.");
  } catch (e) {
    message(e.message);
  }
};
$("#lookup").onsubmit = async (e) => {
  e.preventDefault();
  try {
    await lookup();
    message("Membership loaded.");
  } catch (e) {
    message(e.message);
  }
};
for (const action of ["purchase", "redeem"])
  $("#" + action).onclick = async () => {
    if (!selected) return;
    const id = selected;
    if (
      !confirm(
        action === "purchase"
          ? "Confirm one paid qualifying coffee?"
          : "Confirm redemption of one free coffee? No stamp will be earned.",
      )
    )
      return;
    if (!pending || pending.id !== id || pending.action !== action) {
      pending = { id, action, key: crypto.randomUUID() };
      sessionStorage.setItem("coffeePending", JSON.stringify(pending));
    }
    $("#purchase").disabled = $("#redeem").disabled = true;
    try {
      await api(`/api/staff/members/${id}/${action}`, {
        method: "POST",
        headers: { "Idempotency-Key": pending.key },
        body: JSON.stringify({ confirm: true }),
      });
      pending = undefined;
      sessionStorage.removeItem("coffeePending");
      try {
        await lookup();
        message("Success. Backend saved; wallet updates queued separately.");
      } catch {
        message(
          "Action saved successfully. Look up the membership again to refresh the display.",
        );
      }
    } catch (e) {
      message(
        e.message +
          " If the response was lost, retry this same action: its request key is retained.",
      );
      $("#purchase").disabled = $("#redeem").disabled = false;
    }
  };
$("#scan").onclick = async () => {
  try {
    controls?.stop();
    const reader = new ZXingBrowser.BrowserQRCodeReader();
    controls = await reader.decodeFromVideoDevice(
      undefined,
      "video",
      async (result) => {
        if (result) {
          controls?.stop();
          $("#member").value = result.getText();
          try {
            await lookup();
            message("QR identified membership. Confirm a staff action below.");
          } catch (e) {
            message(e.message);
          }
        }
      },
    );
  } catch (e) {
    message("Camera unavailable: " + e.message + " Use manual lookup.");
  }
};
$("#stop").onclick = () => controls?.stop();
