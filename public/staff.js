(() => {
let staffSession;
try {
  const handoff = JSON.parse(sessionStorage.getItem("loyalty-staff-handoff") || "null");
  sessionStorage.removeItem("loyalty-staff-handoff");
  if (handoff && Date.now() - handoff.createdAt < 15000 && /^[a-f0-9]{64}$/.test(handoff.token)) staffSession = handoff.token;
} catch {}
if (!staffSession) { location.replace("/business/login.html"); return; }
const endSession = () => { staffSession = undefined; location.replace("/business/login.html?expired=1"); };
let idleTimer;
const touchSession = () => { clearTimeout(idleTimer); idleTimer = setTimeout(endSession, 15 * 60000); };
for (const event of ["pointerdown", "keydown"]) document.addEventListener(event, touchSession, { passive: true });
touchSession();
setTimeout(endSession, 30 * 60000);
window.addEventListener("pageshow", (event) => { if (event.persisted) endSession(); });
const $ = (s) => document.querySelector(s);
const message = (t) => ($("#message").textContent = t);
let selected,
  controls,
  role,
  scanStamping = false,
  scanGeneration = 0,
  busy = false,
  pending;
try {
  pending = JSON.parse(sessionStorage.getItem("coffeePending") || "null");
} catch {
  pending = null;
}
async function api(url, options = {}) {
  const r = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + staffSession, ...options.headers },
    cache: "no-store",
    credentials: "omit",
  });
  let j;
  try {
    j = await r.json();
  } catch {
    throw Error("Unexpected server response. Please refresh and try again.");
  }
  if (r.status === 401) {
    location.assign("/business/login.html");
    throw Error("Sign in again");
  }
  if (!r.ok) {
    const error = Error(j.error || "Request failed");
    error.status = r.status;
    throw error;
  }
  return j;
}
function text(tag, value, className) {
  const n = document.createElement(tag);
  n.textContent = value;
  if (className) n.className = className;
  return n;
}
let currentTab, dashboardEnabled = false;
const availableTabs = new Set(["customers", "scan"]);
function showTab(key, focus = false) {
  if (!availableTabs.has(key)) key = role === "owner" && dashboardEnabled ? "overview" : "customers";
  if (currentTab === "scan" && key !== "scan") {
    ++scanGeneration; controls?.stop();
    $("#video").hidden = $("#stop").hidden = true; $("#scan").disabled = !role;
  }
  currentTab = key;
  for (const button of document.querySelectorAll("[data-tab]")) {
    const active = button.dataset.tab === key;
    button.setAttribute("aria-selected", String(active)); button.tabIndex = active ? 0 : -1;
    $("#panel-" + button.dataset.tab).hidden = !active;
    if (active && focus) button.focus();
  }
  history.replaceState(null, "", "#" + key);
  if (key === "overview") loadOverview().catch(error => message(error.message));
  if (key === "referrals") loadReferrals().catch(error => message(error.message));
}
for (const button of document.querySelectorAll("[data-tab]")) {
  button.onclick = () => showTab(button.dataset.tab);
  button.onkeydown = event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const tabs = [...document.querySelectorAll("[data-tab]")].filter(tab => !tab.hidden);
    const index = tabs.indexOf(button);
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    showTab(tabs[next].dataset.tab, true);
  };
}
$(".quick-scan").onclick = event => { event.preventDefault(); showTab("scan"); $("#scan").focus(); };
window.addEventListener("hashchange", () => showTab(location.hash.slice(1)));
const activityName = kind => kind === "purchase" ? "Paid visit · +1 stamp" : kind === "referral" ? "Referral bonus earned" : "Reward redeemed";
let overviewLoading = false;
async function loadOverview() {
  if (!dashboardEnabled || overviewLoading) return;
  overviewLoading = true;
  $("#panel-overview").setAttribute("aria-busy", "true");
  $("#overview-updated").textContent = "Updating your shop activity…";
  try {
    const result = await api("/api/staff/overview");
    $("#shop-metrics").replaceChildren();
    for (const [key, label, note] of [["customers", "Customers", "All memberships"], ["active_customers", "Active customers", "Paid visit in the last 30 days"], ["purchases_24h", "Paid visits", "Last 24 hours"], ["available_rewards", "Available rewards", "Earned and not yet redeemed"], ["referrals", "Referred signups", "All time"], ["credited_referrals", "Qualified referrals", "First paid visit completed"]]) {
      const metric = text("div", "", "metric"); metric.append(text("small", label), text("strong", String(result.metrics[key] ?? 0)), text("small", note)); $("#shop-metrics").append(metric);
    }
    $("#shop-regulars").replaceChildren();
    for (const customer of result.regulars) {
      const button = text("button", "", "customer-row"); button.append(text("span", customer.name, "customer-row-name"), text("span", `${customer.purchases} paid visits · ${customer.rewards} rewards`, "customer-row-meta"));
      button.onclick = () => { $("#member").value = customer.id; showTab("customers"); lookup().catch(error => message(error.message)); };
      $("#shop-regulars").append(button);
    }
    if (!result.regulars.length) $("#shop-regulars").append(text("p", "Customers will appear here when they join."));
    $("#shop-activity").replaceChildren();
    for (const event of result.recent) {
      const row = text("div", `${event.name} · ${activityName(event.kind)}`, "activity"); row.append(text("small", `${date(event.created_at)} · ${event.actor}`)); $("#shop-activity").append(row);
    }
    if (!result.recent.length) $("#shop-activity").append(text("p", "Your shop’s paid visits, redemptions and referral bonuses will appear here."));
    $("#overview-updated").textContent = "Updated " + new Date(result.updatedAt).toLocaleTimeString() + " · refreshes every 30 seconds while open";
  } finally { overviewLoading = false; $("#panel-overview").setAttribute("aria-busy", "false"); }
}
$("#refresh-overview").onclick = () => loadOverview().catch(error => message(error.message));
setInterval(() => { if (!document.hidden && currentTab === "overview") loadOverview().catch(error => message(error.message)); }, 30000);
async function loadReferrals() {
  $("#referral-settings").inert = true;
  try {
  const result = await api("/api/staff/referrals");
  $("#referrals-enabled").checked = result.settings.referrals_enabled;
  $("#referral-kind").value = result.settings.referral_reward_kind;
  $("#referral-amount").value = result.settings.referral_reward_amount;
  $("#referral-activity").replaceChildren();
  for (const referral of result.referrals) {
    const row = text("div", `${referral.referrer} → ${referral.referred}`, "activity");
    row.append(text("small", `${referral.reward_amount} ${referral.reward_kind === "stamps" ? "bonus stamp(s)" : "free reward(s)"} · ${referral.credited_at ? "Credited " + date(referral.credited_at) : "Awaiting first paid purchase"}`));
    $("#referral-activity").append(row);
  }
  if (!result.referrals.length) $("#referral-activity").append(text("p", "No referred signups yet. Customers can share their referral link from their card."));
  } finally { $("#referral-settings").inert = false; }
}
$("#referral-settings").onsubmit = async event => {
  event.preventDefault(); const button = event.currentTarget.querySelector("button"); button.disabled = true;
  try {
    await api("/api/staff/referrals", { method: "POST", body: JSON.stringify({ enabled: $("#referrals-enabled").checked, rewardKind: $("#referral-kind").value, rewardAmount: Number($("#referral-amount").value) }) });
    $("#referral-settings-message").textContent = "Saved. New referred signups will use these settings.";
  } catch (error) { $("#referral-settings-message").textContent = error.message; }
  finally { button.disabled = false; }
};

function date(ms) {
  return ms ? new Date(ms).toLocaleString() : "Earlier record";
}
async function search() {
  const rows = await api(
    "/api/staff/members?q=" + encodeURIComponent($("#query").value),
  );
  $("#customers").replaceChildren();
  for (const m of rows) {
    const b = text("button", "", "customer-row");
    b.append(text("span", m.name, "customer-row-name"));
    b.append(text("span", `${m.stamps}/${m.stampGoal || 8} stamps · ${m.rewards} rewards`, "customer-row-meta"));
    b.classList.toggle("is-selected", selected === m.id);
    b.onclick = () => {
      if (busy) return;
      document.querySelectorAll(".customer-row").forEach((row) => row.classList.remove("is-selected"));
      b.classList.add("is-selected");
      $("#member").value = m.id;
      lookup().catch((e) => message(e.message));
    };
    $("#customers").append(b);
  }
  if (!rows.length) $("#customers").append(text("p", "No customers found."));
}
async function lookup() {
  if (busy) return;
  $("#purchase").disabled = $("#redeem").disabled = true;
  selected = undefined;
  const m = await api(
    "/api/staff/members/" + encodeURIComponent($("#member").value.trim()),
  );
  selected = m.id;
  $("#customer-name").textContent = m.name;
  $("#balance").textContent =
    `${m.stamps} / ${m.stampGoal} stamps · ${m.rewards} available rewards`;
  $("#customer-link").hidden = false;
  $("#customer-link").href = "/?member=" + encodeURIComponent(m.id);
  $("#purchase").disabled = false;
  $("#redeem").disabled = m.rewards < 1;
  $("#history").replaceChildren();
  for (const h of m.history) {
    const row = text(
      "div",
      `${activityName(h.kind)} · ${h.result.stamps}/${h.result.stampGoal || 8} · ${h.result.rewards} rewards`,
      "activity",
    );
    row.append(text("small", `${date(h.created_at)} · ${h.actor}`));
    $("#history").append(row);
  }
  if (!m.history.length)
    $("#history").append(text("p", "A fresh start. No coffees recorded yet."));
  $("#delivery").replaceChildren();
  for (const j of m.deliveries) {
    const row = text(
      "div",
      `${j.provider} · ${j.status} · revision ${j.version}`,
      "activity",
    );
    if (j.error) row.append(text("small", j.error));
    if (j.status === "retry")
      row.append(
        text("small", `Attempt ${j.attempts} · next retry ${date(j.next_at)}`),
      );
    if (
      role === "owner" &&
      ["retry", "blocked", "waiting-save", "failed"].includes(j.status)
    ) {
      const b = text("button", "Retry now", "secondary");
      b.onclick = async () => {
        try {
          await api(`/api/staff/jobs/${j.id}/retry`, {
            method: "POST",
            body: "{}",
          });
          await lookup();
          message("Delivery queued. The backend balance is unchanged.");
        } catch (e) {
          message(e.message);
        }
      };
      row.append(b);
    }
    $("#delivery").append(row);
  }
  if (!m.deliveries.length)
    $("#delivery").append(text("p", "No delivery tasks queued."));
}
$("#programme").onsubmit = async (e) => {
  e.preventDefault();
  if (
    !confirm(
      "Change the goal for every customer? Existing stamps and rewards will remain.",
    )
  )
    return;
  try {
    await api("/api/staff/programme", {
      method: "POST",
      body: JSON.stringify({ stampGoal: Number($("#goal").value) }),
    });
    message("Programme updated. Customer cards show the new balance when online.");
    await search();
    if (selected) await lookup();
  } catch (e) {
    message(e.message);
  }
};
$("#search").onsubmit = (e) => {
  e.preventDefault();
  search().catch((e) => message(e.message));
};
$("#lookup").onsubmit = (e) => {
  e.preventDefault();
  lookup().then(() => showTab("customers")).catch((e) => message(e.message));
};
$("#refresh").onclick = () => lookup().catch((e) => message(e.message));
$("#logout").onclick = async () => {
  try {
    await api("/api/logout", { method: "POST", body: "{}" });
    controls?.stop();
    staffSession = undefined;
    location.replace("/business/login.html");
  } catch (e) {
    message(e.message);
  }
};
async function recordAction(action, automatic = false) {
    if (!selected || busy) return;
    const id = selected;
    if (pending && (pending.id !== id || pending.action !== action)) {
      message(
        "Resolve the previous unconfirmed request first: look up that membership and retry the same action.",
      );
      return;
    }
    if (
      !automatic && !confirm(
        action === "purchase"
          ? "Confirm one paid qualifying coffee?"
          : "Confirm one free coffee reward redemption?",
      )
    )
      return;
    if (!pending) {
      pending = { id, action, key: crypto.randomUUID(), source: automatic ? "scan" : "manual" };
      sessionStorage.setItem("coffeePending", JSON.stringify(pending));
    }
    busy = true;
    let saved = false;
    $("#purchase").disabled = $("#redeem").disabled = true;
    try {
      const scanned = pending.source === "scan";
      const result = await api(`/api/staff/members/${id}/${scanned ? "scan" : action}`, {
        method: "POST",
        headers: { "Idempotency-Key": pending.key },
        body: JSON.stringify(scanned ? {} : { confirm: true }),
      });
      saved = true;
      pending = null;
      sessionStorage.removeItem("coffeePending");
      busy = false;
      await lookup();
      await search();
      message(scanned
        ? (result.awarded ? "One stamp added. Scan the next paid coffee when ready." : "This card was just scanned. No extra stamp was added. Use Record one paid coffee for another purchase.")
        : "Saved. The customer’s web card refreshes automatically when open.");
    } catch (e) {
      busy = false;
      if (saved) {
        message(
          "Action saved. Refresh the customer display before recording another coffee.",
        );
        return;
      }
      if ([400, 403, 404, 409].includes(e.status)) {
        pending = null;
        sessionStorage.removeItem("coffeePending");
        message("Request rejected: " + e.message);
      } else
        message(
          e.message +
            " Your request key is retained; retry the same action if the response was lost.",
        );
      $("#purchase").disabled = $("#redeem").disabled = false;
    }
  };
for (const action of ["purchase", "redeem"])
  $("#" + action).onclick = () => recordAction(action);
$("#scan").onclick = async () => {
  if (busy || !role || $("#scan").disabled) return;
  if (pending && pending.action !== "purchase") {
    message("Resolve your previous request before scanning another purchase.");
    return;
  }
  $("#video").hidden = $("#stop").hidden = false;
  const generation = ++scanGeneration;
  let handled = false;
  $("#scan").disabled = true;
  try {
    controls?.stop();
    message(scanStamping ? "Point the camera at the customer's QR. A scan records one paid coffee." : "Point the camera at the customer's QR.");
    const scannerControls = await new ZXingBrowser.BrowserQRCodeReader().decodeFromVideoDevice(
      undefined,
      "video",
      async (result, _err, scanner) => {
        if (!result || handled || generation !== scanGeneration) return;
        handled = true;
        scanner.stop();
        $("#video").hidden = $("#stop").hidden = true;
        try {
          const id = result.getText().trim();
          if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))
            throw Error("This QR is not a customer membership card.");
          $("#member").value = id;
          await lookup();
          if (generation !== scanGeneration) return;
          if (scanStamping) await recordAction("purchase", true);
          else message("Membership found. Confirm an action below.");
          showTab("customers");
        } catch (error) {
          message(error.message);
        } finally {
          if (generation === scanGeneration) $("#scan").disabled = false;
        }
      },
    );
    if (generation !== scanGeneration || handled) scannerControls.stop();
    else controls = scannerControls;
  } catch (error) {
    if (generation === scanGeneration) {
      $("#scan").disabled = false;
      $("#video").hidden = $("#stop").hidden = true;
      message("Camera unavailable: " + error.message + ". Use manual lookup.");
    }
  }
};
$("#stop").onclick = () => {
  ++scanGeneration;
  $("#video").hidden = $("#stop").hidden = true;
  controls?.stop();
  $("#scan").disabled = !role;
};
$("#staff-account").onsubmit = async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    const account = await api("/api/staff/accounts", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    form.reset();
    $("#account-message").textContent = `Account created for ${account.fullName}. They can now sign in as ${account.username}.`;
  } catch (error) {
    $("#account-message").textContent = error.message;
  } finally {
    button.disabled = false;
  }
};
let logoData = "";
function designPayload() {
  return {
    name: $("#shop-name").value.trim(), color: $("#shop-color").value,
    cardTitle: $("#card-title").value.trim(), tagline: $("#card-tagline").value,
    rewardLabel: $("#reward-label").value.trim(), stampIcon: $("#stamp-icon").value,
    cardStyle: $("#card-style").value, logoData,
  };
}
function updatePreview() {
  const design = designPayload();
  CardUI.render($("#card-preview"), { ...design, shopName: design.name || "Your shop", shopColor: design.color, name: "Customer name", stamps: 3, rewards: 0, stampGoal: Number($("#goal").value) || 8 }, { preview: true });
}
for (const input of $("#shop-branding").querySelectorAll("input:not([type=file]),select")) input.addEventListener("input", updatePreview);
$("#goal").addEventListener("input", updatePreview);
$("#remove-logo").onclick = () => { logoData = ""; $("#shop-logo").value = ""; updatePreview(); };
$("#shop-logo").onchange = async () => {
  const file = $("#shop-logo").files[0];
  if (!file) return;
  $("#save-design").disabled = true;
  let bitmap;
  try {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) throw Error("Choose a PNG, JPEG or WebP under 5 MB.");
    bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    const scale = Math.min(384 / bitmap.width, 384 / bitmap.height, 1);
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const encoded = canvas.toDataURL("image/webp", .85);
    if (encoded.length > 180000) throw Error("This logo is too detailed. Try a smaller image.");
    logoData = encoded; updatePreview(); $("#design-message").textContent = "Logo ready. Publish your design to save it.";
  } catch (error) { $("#design-message").textContent = error.message; $("#shop-logo").value = ""; }
  finally { bitmap?.close(); $("#save-design").disabled = false; }
};
$("#shop-branding").onsubmit = async event => {
  event.preventDefault();
  const button = $("#save-design"); button.disabled = true; button.textContent = "Publishing…";
  try {
    const shop = await api("/api/staff/shop", { method: "POST", body: JSON.stringify(designPayload()) });
    $("nav a").textContent = shop.name;
    $("#design-message").textContent = "Published. Customers’ open cards update automatically.";
    message("Card design published.");
  } catch (error) { $("#design-message").textContent = error.message; }
  finally { button.disabled = false; button.textContent = "Publish card design"; }
};
window.addEventListener("pagehide", () => { controls?.stop(); staffSession = undefined; });
(async () => {
  try {
    const me = await api("/api/staff/me");
    role = me.role;
    scanStamping = me.scanStamping === true;
    dashboardEnabled = me.businessDashboard === true;
    if (role === "owner") {
      availableTabs.add("design"); $("#tab-design").hidden = false;
      if (me.accountsEnabled) { availableTabs.add("team"); $("#tab-team").hidden = false; }
      if (dashboardEnabled) for (const key of ["overview", "referrals"]) { availableTabs.add(key); $("#tab-" + key).hidden = false; }
    }
    if (me.shopId) {
      $("#customer-join-link").href = "/join.html?shop=" + encodeURIComponent(me.shopId);
      $("#shop-qr-link").href = "/shop.html?shop=" + encodeURIComponent(me.shopId);
      const shop = await api("/api/staff/shop");
      $("nav a").textContent = shop.name;
      $("#shop-name").value = shop.name;
      $("#shop-color").value = shop.color;
      $("#card-title").value = shop.card_title || "Member card";
      $("#card-tagline").value = shop.tagline ?? "A little more rewarding.";
      $("#reward-label").value = shop.reward_label || "Free coffee";
      $("#stamp-icon").value = shop.stamp_icon || "check";
      $("#card-style").value = shop.card_style || "classic";
      logoData = shop.logo_data || "";
      if (role === "owner") $("#shop-branding").hidden = false;
    }
    $("#scan").disabled = false;
    if (scanStamping) {
      $("#scan").textContent = "Scan & award 1 stamp";
      $("#scan-help").textContent = "Each scan records one paid coffee automatically. The camera stops after a card is read. Repeat scans within 5 seconds add no extra stamp. Redemption stays manual.";
    }
    if (role === "owner") {
      if (me.accountsEnabled) $("#accounts-section").hidden = false;
      $("#programme-section").hidden = false;
      const p = await api("/api/staff/programme");
      $("#goal").value = p.stampGoal;
      updatePreview();
    }
    $("#identity").textContent = `${me.username} · ${me.role}`;
    await search();
    showTab(location.hash.slice(1));
  } catch (e) {
    message(e.message);
  }
})();

})();
