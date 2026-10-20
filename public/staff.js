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
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  let j;
  try {
    j = await r.json();
  } catch {
    throw Error("Unexpected server response. Please refresh and try again.");
  }
  if (r.status === 401) {
    location.assign("/login.html");
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
function date(ms) {
  return ms ? new Date(ms).toLocaleString() : "Earlier record";
}
async function search() {
  const rows = await api(
    "/api/staff/members?q=" + encodeURIComponent($("#query").value),
  );
  $("#customers").replaceChildren();
  for (const m of rows) {
    const b = text(
      "button",
      `${m.name} · ${m.stamps}/${m.stampGoal || 8} · ${m.rewards} rewards`,
      "customer-row",
    );
    b.onclick = () => {
      if (busy) return;
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
      `${h.kind === "purchase" ? "Paid coffee +1 stamp" : "Reward redeemed"} · ${h.result.stamps}/${h.result.stampGoal || 8} · ${h.result.rewards} rewards`,
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
    $("#delivery").append(text("p", "No wallet updates queued yet."));
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
    message("Programme updated. Wallet updates queued.");
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
  lookup().catch((e) => message(e.message));
};
$("#refresh").onclick = () => lookup().catch((e) => message(e.message));
$("#enroll").onsubmit = async (e) => {
  e.preventDefault();
  const b = e.submitter;
  b.disabled = true;
  try {
    const m = await api("/api/staff/enroll", {
      method: "POST",
      body: JSON.stringify({ name: $("#name").value }),
    });
    $("#name").value = "";
    $("#member").value = m.id;
    await lookup();
    await search();
    message("Customer created. Share their private customer card link.");
  } catch (e) {
    message(e.message);
  } finally {
    b.disabled = false;
  }
};
$("#logout").onclick = async () => {
  try {
    await api("/api/logout", { method: "POST", body: "{}" });
    controls?.stop();
    location.assign("/login.html");
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
        : "Saved. Wallet update queued separately.");
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
        try {
          const id = result.getText().trim();
          if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))
            throw Error("This QR is not a customer membership card.");
          $("#member").value = id;
          await lookup();
          if (generation !== scanGeneration) return;
          if (scanStamping) await recordAction("purchase", true);
          else message("Membership found. Confirm an action below.");
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
      message("Camera unavailable: " + error.message + ". Use manual lookup.");
    }
  }
};
$("#stop").onclick = () => {
  ++scanGeneration;
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
$("#shop-branding").onsubmit = async (event) => {
  event.preventDefault();
  try {
    const shop = await api("/api/staff/shop", { method: "POST", body: JSON.stringify({ name: $("#shop-name").value, color: $("#shop-color").value }) });
    $("nav a").textContent = "☕ " + shop.name;
    message("Shop branding saved.");
  } catch (error) { message(error.message); }
};
window.addEventListener("pagehide", () => controls?.stop());
(async () => {
  try {
    const me = await api("/api/staff/me");
    role = me.role;
    scanStamping = me.scanStamping === true;
    if (me.shopId) {
      $("#shop-qr-link").href = "/shop.html?shop=" + encodeURIComponent(me.shopId);
      const shop = await api("/api/staff/shop");
      $("nav a").textContent = "☕ " + shop.name;
      $("#shop-name").value = shop.name;
      $("#shop-color").value = shop.color;
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
    }
    $("#identity").textContent = `${me.username} · ${me.role}`;
    await search();
  } catch (e) {
    message(e.message);
  }
})();
