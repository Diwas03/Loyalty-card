(async () => {
let staffSession;
try {
  const handoff = JSON.parse(sessionStorage.getItem("loyalty-staff-handoff") || "null");
  sessionStorage.removeItem("loyalty-staff-handoff");
  if (handoff && Date.now() - handoff.createdAt < 15000 && /^[a-f0-9]{64}$/.test(handoff.token)) staffSession = handoff.token;
} catch {}
if (!staffSession) {
  try {
    const restored = await fetch("/api/staff/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", cache: "no-store" });
    if (restored.ok) staffSession = (await restored.json()).token;
  } catch {}
}
if (!staffSession) { location.replace("/business/login.html"); return; }
const endSession = async () => {
  try { await api("/api/logout", { method: "POST", body: "{}" }); } catch {}
  await fetch("/api/staff/session", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
  staffSession = undefined; location.replace("/business/login.html?expired=1");
};
let idleTimer;
const touchSession = () => { clearTimeout(idleTimer); idleTimer = setTimeout(endSession, 15 * 60000); };
for (const event of ["pointerdown", "keydown"]) document.addEventListener(event, touchSession, { passive: true });
touchSession();
setTimeout(endSession, 30 * 60000);
window.addEventListener("pageshow", (event) => { if (event.persisted) location.reload(); });
const $ = (s) => document.querySelector(s);
const message = (t, error = false) => {
  $("#message").textContent = t;
  $("#message").dataset.tone = error ? "error" : "success";
};
let currentShopName = "this shop";
const scanFeedback = (text, error = false) => {
  $("#scan-feedback").hidden = false;
  $("#scan-feedback").textContent = text;
  $("#scan-feedback").dataset.tone = error ? "error" : "success";
  message(text, error);
};
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
  if (key === "reports") loadReport();
  if (key === "team" && $("#team-management")) loadTeam();
}
window.addEventListener("resize", () => document.querySelector('[data-tab][aria-selected="true"]')?.scrollIntoView({block:"nearest",inline:"nearest"}));
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
  const fields=[...$("#referral-settings").elements];
  for(const field of fields) field.disabled=true;
  $("#referral-settings").setAttribute("aria-busy","true");
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
  } finally { $("#referral-settings").inert = false; for(const field of fields) field.disabled=false; $("#referral-settings").setAttribute("aria-busy","false"); }
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
  $("#redeem").disabled = true;
    $("#purchase").disabled = true;
  selected = undefined;
  const m = await api(
    "/api/staff/members/" + encodeURIComponent($("#member").value.trim()),
  );
  selected = m.id;
  $("#purchase").disabled = false;
  $("#customer-name").textContent = m.name;
  $("#balance").textContent =
    `${m.stamps} / ${m.stampGoal} stamps · ${m.rewards} available rewards`;
  $("#customer-link").hidden = false;
  $("#customer-link").href = "/?member=" + encodeURIComponent(m.privateCardToken || m.id);
  $("#redeem").disabled = m.rewards < 1;
  if ($("#correction")) $("#correction").hidden = !["owner","manager"].includes(role);
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
    await fetch("/api/staff/session", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: "{}" });
    controls?.stop();
    staffSession = undefined;
    location.replace("/business/login.html");
  } catch (e) {
    message(e.message);
  }
};
async function installWorkspacePicker(me) {
  const workspaces=await api("/api/staff/workspaces");
  $("#workspace-label")?.remove();
  const label=text("label","Business and location");const select=document.createElement("select");select.id="workspace-picker";
  label.id="workspace-label";
  for(const workspace of workspaces){const option=text("option",workspace.location_name+" · "+workspace.name+" · "+workspace.role);option.value=JSON.stringify([workspace.shop_id,workspace.location_id]);option.selected=workspace.shop_id===me.shopId&&workspace.location_id===me.locationId;select.append(option);}
  label.append(select);$("#identity").after(label);
  select.onchange=async()=>{
    if(busy||pending){message("Resolve your pending transaction before changing workspace.",true);select.value=JSON.stringify([me.shopId,me.locationId]);return;}
    select.disabled=true;
    try{const [shopId,locationId]=JSON.parse(select.value);await api("/api/staff/workspace",{method:"POST",body:JSON.stringify({shopId,locationId})});location.reload();}
    catch(error){message(error.message,true);select.disabled=false;select.value=JSON.stringify([me.shopId,me.locationId]);}
  };
}
function installTeamTools(){
  const section=document.createElement("section");section.id="team-management";
  section.innerHTML='<h2>Team and locations</h2><p>Owners manage settings and access. Managers can operate the counter, correct progress and read reports. Cashiers can record purchases and redeem rewards at assigned locations. Access changes revoke the affected user’s sessions.</p><form id="location-create"><label>New location name<input name="name" maxlength="80" required></label><button>Create location</button></form><div id="team-list" role="status"></div><form id="team-invite"><h3>Invite an existing staff account</h3><p>Share this private one-use link yourself. It expires in 48 hours. Accepting requires a signed-in account.</p><label>Role<select name="role"><option value="cashier">Cashier</option><option value="manager">Manager</option></select></label><label>Locations<select name="locations" multiple required></select></label><button>Create invitation</button><label>Private invitation link<input name="link" readonly></label></form>';
  $("#panel-team").append(section);
  $("#location-create").onsubmit=async event=>{
    event.preventDefault();const form=event.target,button=form.querySelector("button");button.disabled=true;
    try{await api("/api/staff/locations",{method:"POST",body:JSON.stringify({name:form.elements.name.value})});form.reset();await loadTeam();await installWorkspacePicker(await api("/api/staff/me"));message("Location created.");}
    catch(error){message(error.message,true);}finally{button.disabled=false;}
  };
  $("#team-invite").onsubmit=async event=>{
    event.preventDefault();const form=event.target,button=form.querySelector("button");button.disabled=true;
    try{const data=await api("/api/staff/team-invites",{method:"POST",body:JSON.stringify({role:form.elements.role.value,locations:[...form.elements.locations.selectedOptions].map(option=>option.value)})});form.elements.link.value=new URL(data.inviteUrl,location.origin).href;message("Invitation ready. Share only with the intended staff member.");}
    catch(error){message(error.message,true);}finally{button.disabled=false;}
  };
}
async function loadTeam(){
  const container=$("#team-list");container.textContent="Loading team…";
  try{
    const data=await api("/api/staff/team");container.replaceChildren();
    const inviteLocations=$("#team-invite select[name=locations]");inviteLocations.replaceChildren();
    for(const loc of data.locations){const option=text("option",loc.name);option.value=loc.id;inviteLocations.append(option);}
    for(const member of data.members){
      const form=document.createElement("form");form.className="team-member";form.append(text("h3",(member.full_name||member.username)+" · "+member.username));
      const roleLabel=text("label","Business role"),roleSelect=document.createElement("select");roleSelect.name="role";
      for(const role of ["owner","manager","cashier"]){const option=text("option",role);option.value=role;option.selected=role===member.role;roleSelect.append(option);}roleLabel.append(roleSelect);form.append(roleLabel);
      const activeLabel=text("label","Enabled "),active=document.createElement("input");active.type="checkbox";active.className="inline-check";active.checked=member.enabled;activeLabel.append(active);form.append(activeLabel);
      const locLabel=text("label","Assigned locations (owners can access all)"),locations=document.createElement("select");locations.multiple=true;
      for(const loc of data.locations){const option=text("option",loc.name);option.value=loc.id;option.selected=member.locations.includes(loc.id);locations.append(option);}locLabel.append(locations);form.append(locLabel);
      const button=text("button","Save role and access");form.append(button);
      form.onsubmit=async event=>{event.preventDefault();if(!confirm("Change access for "+member.username+" and revoke their current sessions?"))return;button.disabled=true;
        try{await api("/api/staff/team/"+encodeURIComponent(member.username),{method:"POST",body:JSON.stringify({role:roleSelect.value,enabled:active.checked,locations:[...locations.selectedOptions].map(option=>option.value)})});message("Access updated; affected sessions revoked.");await loadTeam();}
        catch(error){message(error.message,true);}finally{button.disabled=false;}};
      container.append(form);
    }
  }catch(error){container.textContent=error.message;}
}
function installPilotTools() {
  const correction = document.createElement("form");
  correction.id = "correction"; correction.hidden = true;
  correction.innerHTML = '<h3>Correct stamp progress</h3><p>Owner or manager only. Corrections preserve rewards and cannot cross a reward threshold. This is not a sale refund.</p><label>Stamp change<input name="delta" type="number" min="-100" max="100" required></label><label>Reason<input name="reason" minlength="3" maxlength="240" required></label><button>Save correction</button>';
  $(".actions").after(correction);
  const rotate = document.createElement("button"); rotate.type = "button"; rotate.className = "secondary"; rotate.textContent = "Replace private card link";
  correction.append(rotate);
  rotate.onclick = async () => {
    if (!selected || !confirm("Invalidate the previous private link? Existing shortcuts will need the replacement. The balance and scanned membership ID stay the same.")) return;
    rotate.disabled = true;
    try {
      const result = await api("/api/staff/members/" + selected + "/rotate-link", { method:"POST", body:JSON.stringify({confirm:true}) });
      $("#customer-link").href = result.customerUrl;
      message("Private link replaced. Open the customer card link and share it securely.");
    } catch(error) { message(error.message,true); } finally { rotate.disabled = false; }
  };
  const region = document.createElement("form");
  region.innerHTML = '<h3>Regional settings</h3><p>Bhutan defaults: Nu. (BTN), Asia/Thimphu, BT (+975). No phone number is required for membership.</p><label>Currency code<input name="currency" value="BTN" required pattern="[A-Z]{3}"></label><label>Timezone<input name="timezone" value="Asia/Thimphu" required></label><label>Country code<input name="country" value="BT" required pattern="[A-Z]{2}"></label><button>Save regional settings</button><p role="status"></p>';
  $("#programme-section").append(region);
  const expiry=document.createElement("form");
  expiry.innerHTML='<h3>New reward validity</h3><p>Existing rewards keep their promised terms. Leave empty for no expiry.</p><label>Validity in days<input name="days" type="number" min="1" max="3650"></label><button>Save reward validity</button><p role="status"></p>';
  $("#programme-section").append(expiry);
  api("/api/staff/shop").then(shop=>{expiry.elements.days.value=shop.reward_expiry_days ?? "";}).catch(error=>message(error.message,true));
  expiry.onsubmit=async event=>{
    event.preventDefault();const button=expiry.querySelector("button");button.disabled=true;
    try { const result=await api("/api/staff/reward-expiry",{method:"POST",body:JSON.stringify({days:expiry.elements.days.value===""?null:Number(expiry.elements.days.value)})});expiry.querySelector('[role="status"]').textContent=result.appliesTo; }
    catch(error){expiry.querySelector('[role="status"]').textContent=error.message;}finally{button.disabled=false;}
  };
  api("/api/staff/shop").then(shop => { for(const field of ["currency","timezone","country"]) region.elements[field].value = shop[field]; }).catch(error=>message(error.message,true));
  region.onsubmit = async event => {
    event.preventDefault(); const button = region.querySelector("button"); button.disabled = true;
    try {
      await api("/api/staff/region", { method:"POST", body:JSON.stringify(Object.fromEntries(new FormData(region))) });
      region.querySelector('[role="status"]').textContent = "Regional settings saved.";
    } catch(error) { region.querySelector('[role="status"]').textContent = error.message; } finally { button.disabled = false; }
  };
  let correctionPending;
  correction.onsubmit = async event => {
    event.preventDefault();
    if (!selected || busy || !confirm("Save this audited progress correction?")) return;
    const values = { delta: Number(correction.elements.delta.value), reason: correction.elements.reason.value.trim(), confirm: true };
    const signature = JSON.stringify([selected, values]);
    if (!correctionPending || correctionPending.signature !== signature) correctionPending = { signature, key: crypto.randomUUID() };
    const button = correction.querySelector("button"); button.disabled = true;
    try {
      await api("/api/staff/members/" + selected + "/adjustment", { method: "POST", headers: { "Idempotency-Key": correctionPending.key }, body: JSON.stringify(values) });
      correctionPending = undefined; correction.reset(); await lookup(); message("Correction saved with your name and reason.");
    } catch (error) { message(error.message, true); } finally { button.disabled = false; }
  };
  const button = document.createElement("button"); button.id = "tab-reports"; button.type = "button"; button.dataset.tab = "reports"; button.textContent = "Reports";
  button.setAttribute("role", "tab"); button.setAttribute("aria-controls", "panel-reports"); button.setAttribute("aria-selected", "false");
  button.onclick = () => showTab("reports");
  button.onkeydown = event => {
    if (!["ArrowLeft","ArrowRight","Home","End"].includes(event.key)) return;
    event.preventDefault();
    const tabs=[...document.querySelectorAll("[data-tab]")].filter(tab=>!tab.hidden);
    const index=tabs.indexOf(button), next=event.key==="Home"?0:event.key==="End"?tabs.length-1:(index+(event.key==="ArrowRight"?1:-1)+tabs.length)%tabs.length;
    showTab(tabs[next].dataset.tab,true);
  };
  $(".business-tabs").append(button); availableTabs.add("reports");
  const panel = document.createElement("section"); panel.id = "panel-reports"; panel.className = "dashboard-panel"; panel.hidden = true;
  panel.setAttribute("role", "tabpanel"); panel.setAttribute("aria-labelledby", "tab-reports");
  panel.innerHTML = '<h2>Recorded activity</h2><p id="report-status" role="status">Loading report…</p><dl id="report-values"></dl><button id="report-refresh">Refresh report</button> <button id="export-customers" class="secondary">Export customer CSV</button>';
  $("main").append(panel); $("#report-refresh").onclick = loadReport;
  $("#export-customers").onclick = async () => {
    try {
      const response = await fetch("/api/staff/customers.csv", { headers: { Authorization: "Bearer " + staffSession }, cache: "no-store", credentials: "omit" });
      if (!response.ok) throw Error("Export failed; check your session and retry.");
      const url = URL.createObjectURL(await response.blob()); const link = document.createElement("a"); link.href = url; link.download = "customers.csv"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch(error) { message(error.message, true); }
  };
}
async function loadReport() {
  $("#report-status").textContent = "Loading recorded activity…";
  try {
    const report = await api("/api/staff/reports"); $("#report-values").replaceChildren();
    for (const [key,label] of Object.entries({members:"Members",qualifying_visits:"Confirmed paid visits",visiting_members:"Members with a paid visit",rewards_issued:"Rewards issued",rewards_redeemed:"Rewards redeemed",outstanding_rewards:"Outstanding rewards",corrections:"Progress corrections"})) {
      $("#report-values").append(text("dt",label),text("dd",report[key]));
    }
    $("#report-status").textContent = report.period + ". Sales: " + report.salesLabel + ". " + report.definitions;
  } catch(error) { $("#report-status").textContent = error.message; }
}

async function recordAction(action, automatic = false) {
    if (!selected || busy) return;
    const id = selected;
    if (pending && (pending.id !== id || pending.action !== action)) {
      message(
        "Resolve the previous request first: rescan that customer’s card for a pending stamp, or retry its reward redemption.",
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
      pending = { id, action, key: crypto.randomUUID(), source: automatic ? "scan" : "manual" };
      sessionStorage.setItem("coffeePending", JSON.stringify(pending));
    }
    busy = true;
    let saved = false;
    $("#purchase").disabled = true;
    $("#redeem").disabled = true;
    try {
      const scanned = action === "purchase";
      const result = await api(`/api/staff/members/${id}/${scanned ? "scan" : action}`, {
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
      message(scanned
        ? (result.awarded ? "One stamp added. Scan the next paid coffee when ready." : "This card was just scanned. No extra stamp was added. Wait at least 5 seconds before scanning for another paid purchase.")
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
      $("#redeem").disabled = !selected;
      $("#purchase").disabled = !selected;
    }
  };
$("#purchase").onclick = () => recordAction("purchase");
$("#redeem").onclick = () => recordAction("redeem");
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
    scanFeedback("Point the camera at the customer’s membership QR for " + currentShopName + ". Scanning identifies the card. Confirm the paid purchase after checking it.");
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
            throw Object.assign(Error("Invalid membership QR"), { invalidQR: true });
          $("#member").value = id;
          await lookup();
          if (generation !== scanGeneration) return;
          message("Card identified. Check the customer and confirm a qualifying purchase.");
          showTab("customers");
        } catch (error) {
          scanFeedback(error.invalidQR || error.status === 404 ? "Invalid QR code. Please show a valid customer membership QR for " + currentShopName + "." : error.message, true);
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
      scanFeedback("Camera unavailable. Allow camera access and try again. Looking up a customer will not add a stamp.", true);
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
    if($("#team-management")) await loadTeam();
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
      currentShopName = shop.name;
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
    if (me.pilotLedger) {
      await installWorkspacePicker(me);
      if (["owner","manager"].includes(role)) installPilotTools();
      if (role==="owner") installTeamTools();
    }
    if (scanStamping) {
      $("#scan").textContent = "Start QR scanner";
      $("#scan-help").textContent = "Scan a card or use manual lookup. Verify the paid purchase, then choose Record qualifying purchase. Repeat requests are protected against duplicate credit.";
    }
    if (role === "owner") {
      if (me.accountsEnabled) $("#accounts-section").hidden = false;
      $("#programme-section").hidden = false;
      const p = await api("/api/staff/programme");
      $("#goal").value = p.stampGoal;
      updatePreview();
    }
    $("#identity").textContent = `${me.username} · ${me.businessRole || me.role}`;
    await search();
    showTab(location.hash.slice(1));
  } catch (e) {
    message(e.message);
  }
})();

})();
