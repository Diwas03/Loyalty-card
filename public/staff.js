const $ = (s) => document.querySelector(s);
const message = (t) => ($("#message").textContent = t);
let selected,
  controls,
  role,
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
for (const action of ["purchase", "redeem"])
  $("#" + action).onclick = async () => {
    if (!selected || busy) return;
    const id = selected;
    if (pending && (pending.id !== id || pending.action !== action)) {
      message(
        "Resolve the previous unconfirmed request first: look up that membership and retry the same action.",
      );
      return;
    }
    if (
      !confirm(
        action === "purchase"
          ? "Confirm one paid qualifying coffee?"
          : "Confirm one free coffee reward redemption?",
      )
    )
      return;
    if (!pending) {
      pending = { id, action, key: crypto.randomUUID() };
      sessionStorage.setItem("coffeePending", JSON.stringify(pending));
    }
    busy = true;
    let saved = false;
    $("#purchase").disabled = $("#redeem").disabled = true;
    try {
      await api(`/api/staff/members/${id}/${action}`, {
        method: "POST",
        headers: { "Idempotency-Key": pending.key },
        body: JSON.stringify({ confirm: true }),
      });
      saved = true;
      pending = null;
      sessionStorage.removeItem("coffeePending");
      busy = false;
      await lookup();
      await search();
      message("Saved. Wallet update queued separately.");
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
$("#scan").onclick = async () => {
  try {
    controls?.stop();
    controls =
      await new ZXingBrowser.BrowserQRCodeReader().decodeFromVideoDevice(
        undefined,
        "video",
        async (result, _err, scanner) => {
          if (result) {
            scanner.stop();
            $("#member").value = result.getText();
            try {
              await lookup();
              message("Membership found. Confirm an action below.");
            } catch (e) {
              message(e.message);
            }
          }
        },
      );
  } catch (e) {
    message("Camera unavailable: " + e.message + ". Use manual lookup.");
  }
};
$("#stop").onclick = () => controls?.stop();
window.addEventListener("pagehide", () => controls?.stop());
(async () => {
  try {
    const me = await api("/api/staff/me");
    role = me.role;
    if (role === "owner") {
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
