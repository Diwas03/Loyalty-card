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
let currentShopName = "this shop", currentLocationName = "current location", selectedMember, savedGoal = 8, savedDesignSignature = "", displayTimezone = "Asia/Thimphu", lookupGeneration = 0;
const outcome = (value, error = false) => {
  $("#customer-outcome").textContent = value;
  $("#customer-outcome").dataset.tone = error ? "error" : "success";
};
const scanFeedback = (text, error = false) => {
  $("#scan-feedback").hidden = false;
  $("#scan-feedback").textContent = text;
  $("#scan-feedback").dataset.tone = error ? "error" : "success";
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
const sectionNames = { overview: "Overview", customers: "Customers", scan: "Scan and lookup", design: "Programs & cards", referrals: "Referrals", team: "Team & locations", reports: "Reports" };
const narrowNavigation = matchMedia("(max-width: 900px)");
  $("#preview-disclosure").open = !narrowNavigation.matches;
function configureNavigation() {
  const simple = availableTabs.size <= 2;
  $("#section-navigation").classList.toggle("simple-navigation", simple);
  $(".business-tabs").setAttribute("aria-orientation", narrowNavigation.matches && simple ? "horizontal" : "vertical");
  $("#section-navigation").open = !narrowNavigation.matches || simple;
}
narrowNavigation.addEventListener("change", configureNavigation);
function focusCustomer() {
  $("#panel-customers").classList.add("member-focused");
  $("#customer-name").focus({ preventScroll: false });
}
function showTab(key, focus = false) {
  if (!availableTabs.has(key)) key = role === "owner" && dashboardEnabled ? "overview" : "customers";
  if (currentTab === "scan" && key !== "scan") {
    ++scanGeneration; controls?.stop();
    $("#video").hidden = $("#stop").hidden = true; $("#scan").disabled = !role;
  }
  currentTab = key;
  $("#section-heading").textContent = sectionNames[key];
  $("#current-section").textContent = sectionNames[key];
  $(".quick-scan").hidden = key === "scan";
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
$(".business-tabs").addEventListener("click", event => {
  const button = event.target.closest("[data-tab]");
  if (!button) return;
  showTab(button.dataset.tab);
  if (narrowNavigation.matches && availableTabs.size > 2) {
    $("#section-navigation").open = false;
    $("#section-heading").focus();
  }
});
$(".business-tabs").addEventListener("keydown", event => {
    const button = event.target.closest("[data-tab]");
    if (!button) return;
    const vertical = $(".business-tabs").getAttribute("aria-orientation") === "vertical";
    const nextKey = vertical ? "ArrowDown" : "ArrowRight", previousKey = vertical ? "ArrowUp" : "ArrowLeft";
    if (![nextKey, previousKey, "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const tabs = [...document.querySelectorAll("[data-tab]")].filter(tab => !tab.hidden);
    const index = tabs.indexOf(button);
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === nextKey ? 1 : -1) + tabs.length) % tabs.length;
    showTab(tabs[next].dataset.tab, true);
});
$("#back-to-results").onclick = () => { $("#panel-customers").classList.remove("member-focused"); $("#query").focus(); };
$(".quick-scan").onclick = event => { event.preventDefault(); showTab("scan"); $("#scan").focus(); };
window.addEventListener("hashchange", () => showTab(location.hash.slice(1)));
const activityName = kind => ({purchase:"Qualifying paid visit",referral:"Referral bonus",redeem:"Reward redeemed",adjustment:"Progress corrected",expire:"Reward expired",refund:"Refund recorded",revoke:"Reward revoked",opening:"Opening balance"})[kind] || "Recorded account activity";
function recordedList(container, items, render, empty, maximum = 50) {
  if (!container.querySelector(".recorded-items")) {
    container._signature = undefined;
    const list = text("div", "", "recorded-items"), more = text("button", "Show more recorded activity", "secondary history-more"), scope = text("small", "", "history-scope");
    more.type = "button"; container.replaceChildren(list, more, scope);
    more.onclick = () => { container.dataset.expanded = container.dataset.expanded === "true" ? "false" : "true"; sync(); };
  }
  const list = container.querySelector(".recorded-items"), more = container.querySelector(".history-more"), scope = container.querySelector(".history-scope");
  if (container._signature !== JSON.stringify(items)) {
    list.replaceChildren(...items.map(render));
    if (!items.length) list.append(text("p", empty));
    container._signature = JSON.stringify(items);
  }
  function sync() {
    const expanded = container.dataset.expanded === "true";
    [...list.children].forEach((node,index) => { node.hidden = !expanded && index >= 5; });
    more.hidden = items.length <= 5; more.setAttribute("aria-expanded", String(expanded));
    more.textContent = expanded ? "Show fewer records" : "Show more recorded activity";
    scope.textContent = items.length ? `Showing ${expanded ? items.length : Math.min(5,items.length)} of ${items.length} loaded records${items.length >= maximum ? ` (API limit: ${maximum}; this is not pagination)` : ""}.` : "";
  }
  more.onclick = () => { container.dataset.expanded = container.dataset.expanded === "true" ? "false" : "true"; sync(); };
  sync();
}
let overviewLoading = false;
async function loadOverview() {
  if (!dashboardEnabled || overviewLoading) return;
  overviewLoading = true;
  $("#panel-overview").setAttribute("aria-busy", "true");
  $("#overview-updated").textContent = "Updating your shop activity…";
  try {
    const result = await api("/api/staff/overview");
    $("#shop-metrics").replaceChildren();
    $("#shop-metrics").className = "metric-groups";
    const metricGroups = {};
    for(const [key,label] of [["members","Memberships"],["visits-rewards","Visits & rewards"],["referrals","Referrals"]]) {
      const group=text("div","","metric-group");group.append(text("h3",label));
      const values=text("div","","metrics-grid");group.append(values);$("#shop-metrics").append(group);metricGroups[key]=values;
    }
    for (const [key, label, note] of [["customers", "Customers", "All memberships"], ["active_customers", "Active customers", "Paid visit in the last 30 days"], ["purchases_24h", "Paid visits", "Last 24 hours"], ["available_rewards", "Available rewards", "Earned and not yet redeemed"], ["referrals", "Referred signups", "All time"], ["credited_referrals", "Qualified referrals", "First paid visit completed"]]) {
      const metric = text("div", "", "metric"); metric.dataset.group = ["customers","active_customers"].includes(key) ? "members" : ["referrals","credited_referrals"].includes(key) ? "referrals" : "visits-rewards"; metric.append(text("span", label), text("strong", String(result.metrics[key] ?? "Not available")), text("small", note)); metricGroups[metric.dataset.group].append(metric);
    }
    $("#shop-regulars").replaceChildren();
    for (const customer of result.regulars) {
      const button = text("button", "", "customer-row"); button.append(text("span", customer.name, "customer-row-name"), text("span", `${customer.purchases} paid visits · ${customer.rewards} rewards`, "customer-row-meta"));
      button.onclick = () => { $("#member").value = customer.id; showTab("customers"); lookup().then(found => { if (found) focusCustomer(); }).catch(error => outcome(error.message,true)); };
      $("#shop-regulars").append(button);
    }
    if (!result.regulars.length) $("#shop-regulars").append(text("p", "Customers will appear here when they join."));
    recordedList($("#shop-activity"), result.recent, event => {
      const row = text("div", `${event.name} · ${activityName(event.kind)}`, "activity"); row.append(text("small", `${date(event.created_at)} · ${event.actor}`));
      return row;
    }, "Recorded visits, redemptions and referral bonuses will appear here.", 20);
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
  recordedList($("#referral-activity"), result.referrals, referral => {
    const row = text("div", `${referral.referrer} → ${referral.referred}`, "activity");
    row.append(text("span",referral.credited_at ? "Qualified" : "Pending first paid purchase","state-badge"), text("small", `${referral.reward_amount} ${referral.reward_kind === "stamps" ? "bonus stamp(s)" : "free reward(s)"} · ${referral.credited_at ? "Credited " + date(referral.credited_at) : "Promise preserved from signup"}`));
    return row;
  }, "No referred signups yet. Customers can share their public invitation link.");
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
  return ms ? new Date(Number(ms)).toLocaleString(undefined,{timeZone:displayTimezone}) : "Earlier record";
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
      lookup().then(found => { if (found) focusCustomer(); }).catch((e) => outcome(e.message,true));
    };
    $("#customers").append(b);
  }
  if (!rows.length) $("#customers").append(text("p", "No customers found."));
}
async function lookup() {
  if (busy) return false;
  const requested = $("#member").value.trim(), generation = ++lookupGeneration;
  if (pending && pending.id !== requested) throw Error("Resolve the pending transaction for the previous member before selecting another card.");
  if(selected !== requested) { outcome(""); message(""); $("#customer-secondary-actions").open=false; $("#correction")?.reset(); }
  $("#redeem").disabled = true;
  $("#purchase").disabled = true;
  selected = undefined;
  selectedMember = undefined;
  $("#customer-link").hidden = true;
  $("#customer-secondary-actions").hidden = true;
  $("#history").replaceChildren(text("p","Waiting for a verified membership…"));
  $("#delivery").replaceChildren();
  $("#customer-result").setAttribute("aria-busy", "true");
  $("#customer-name").textContent = "Checking membership…";
  $("#balance").textContent = "Waiting for the shop to confirm this membership and balance.";
  let m;
  try { m = await api("/api/staff/members/" + encodeURIComponent(requested)); }
  catch(error) { if(generation !== lookupGeneration) return false; $("#customer-name").textContent="Membership could not be verified"; $("#balance").textContent="Check the code or retry lookup. No purchase has been recorded."; throw error; }
  finally { if(generation === lookupGeneration) $("#customer-result").setAttribute("aria-busy", "false"); }
  if(generation !== lookupGeneration) return false;
  selected = m.id;
  selectedMember = m;
  $("#customer-secondary-actions").hidden = false;
  $("#purchase").disabled = false;
  $("#customer-name").textContent = m.name;
  $("#balance").textContent =
    `${m.stamps} / ${m.stampGoal} stamps · ${m.rewards} available rewards`;
  $("#customer-link").hidden = false;
  $("#customer-link").href = "/?member=" + encodeURIComponent(m.privateCardToken || m.id);
  $("#redeem").disabled = m.rewards < 1;
  $("#redeem").textContent = `Redeem one ${m.rewardLabel || "reward"}`;
  if ($("#correction")) $("#correction").hidden = !["owner","manager"].includes(role);
  recordedList($("#history"), m.history, h => {
    const row = text(
      "div",
      `${activityName(h.kind)} · ${h.result.stamps}/${h.result.stampGoal || 8} · ${h.result.rewards} rewards`,
      "activity",
    );
    row.append(text("small", `${date(h.created_at)} · ${h.actor}`));
    return row;
  }, "No recorded activity for this membership yet.");
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
  return true;
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
    const saved = await api("/api/staff/programme", {
      method: "POST",
      body: JSON.stringify({ stampGoal: Number($("#goal").value) }),
    });
    savedGoal = saved.stampGoal;
    $("#programme-status").textContent = `Reward rules saved: ${savedGoal} stamps per reward. Appearance changes are saved separately.`;
    $("#programme-status").dataset.tone = "success";
    updatePreview();
    await search();
    if (selected) await lookup();
  } catch (e) {
    $("#programme-status").textContent = e.message;
    $("#programme-status").dataset.tone = "error";
  }
};
$("#search").onsubmit = (e) => {
  e.preventDefault();
  search().catch((e) => message(e.message));
};
$("#lookup").onsubmit = (e) => {
  e.preventDefault();
  lookup().then(found => { if(found) { showTab("customers"); focusCustomer(); } }).catch((e) => scanFeedback(e.message,true));
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
  currentLocationName = workspaces.find(workspace => workspace.shop_id === me.shopId && workspace.location_id === me.locationId)?.location_name || "current location";
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
  section.innerHTML='<h2>Team members</h2><p>Owners manage settings and access. Managers operate the counter, correct progress and read reports. Cashiers record purchases and redeem rewards at assigned locations.</p><p id="team-status" role="status"></p><div id="team-list"></div><details id="locations-management"><summary>Manage locations</summary><ul id="location-list"></ul><form id="location-create"><label>New location name<input name="name" maxlength="80" required></label><button>Create location</button></form></details><details id="existing-account-invite"><summary>Invite an existing staff account</summary><form id="team-invite"><p>This private invitation works once within 48 hours and requires an existing signed-in staff account.</p><label>Role<select name="role"><option value="cashier">Cashier</option><option value="manager">Manager</option></select></label><div id="invite-locations"></div><button>Create invitation</button><label>Private invitation link<input name="link" readonly></label></form></details>';
  $("#panel-team").append(section);
  const newAccount=document.createElement("details");newAccount.id="new-staff-account";newAccount.append(text("summary","Create a new staff account"),$("#accounts-section"));section.append(newAccount);
  $("#location-create").onsubmit=async event=>{
    event.preventDefault();const form=event.target,button=form.querySelector("button");button.disabled=true;
    try{await api("/api/staff/locations",{method:"POST",body:JSON.stringify({name:form.elements.name.value})});form.reset();await loadTeam();await installWorkspacePicker(await api("/api/staff/me"));message("Location created.");}
    catch(error){message(error.message,true);}finally{button.disabled=false;}
  };
  $("#team-invite").onsubmit=async event=>{
    event.preventDefault();const form=event.target,button=form.querySelector("button");button.disabled=true;
    try{const data=await api("/api/staff/team-invites",{method:"POST",body:JSON.stringify({role:form.elements.role.value,locations:[...form.querySelectorAll('[name="locations"]:checked')].map(option=>option.value)})});form.elements.link.value=new URL(data.inviteUrl,location.origin).href;message("Invitation ready. Share only with the intended staff member.");}
    catch(error){message(error.message,true);}finally{button.disabled=false;}
  };
}
function locationChoices(locations, selected = []) {
  const fieldset=document.createElement("fieldset");fieldset.className="location-options";fieldset.append(text("legend","Assigned locations"));
  for(const loc of locations){const label=text("label",loc.name),input=document.createElement("input");input.type="checkbox";input.name="locations";input.value=loc.id;input.checked=selected.includes(loc.id);input.className="inline-check";label.prepend(input);fieldset.append(label);}
  return fieldset;
}
async function loadTeam(){
  const container=$("#team-list");container.textContent="Loading team…";
  container.setAttribute("aria-busy","true");
  try{
    const data=await api("/api/staff/team");container.replaceChildren();
    $("#invite-locations").replaceChildren(locationChoices(data.locations));
    $("#location-list").replaceChildren(...data.locations.map(loc=>text("li",loc.name+(loc.active ? "" : " · Inactive"))));
    for(const member of data.members){
      const entry=document.createElement("details");entry.className="team-entry";
      const summary=document.createElement("summary");summary.append(text("strong",member.full_name||member.username),text("span",member.role+" · "+(member.enabled?"Enabled":"Disabled"),"state-badge"),text("small",member.role==="owner"?"All business locations":data.locations.filter(loc=>member.locations.includes(loc.id)).map(loc=>loc.name).join(", ")||"No assigned locations"),text("span","Edit access","edit-hint"));entry.append(summary);
      entry.addEventListener("toggle",()=>{if(entry.open)for(const other of container.querySelectorAll("details.team-entry"))if(other!==entry)other.open=false;});
      const form=document.createElement("form");form.className="team-member";form.append(text("p",`Account: ${member.username}. Saving role/access changes revokes this person’s active sessions.`));
      const roleLabel=text("label","Business role"),roleSelect=document.createElement("select");roleSelect.name="role";
      for(const role of ["owner","manager","cashier"]){const option=text("option",role);option.value=role;option.selected=role===member.role;roleSelect.append(option);}roleLabel.append(roleSelect);form.append(roleLabel);
      const activeLabel=text("label","Enabled "),active=document.createElement("input");active.type="checkbox";active.className="inline-check";active.checked=member.enabled;activeLabel.append(active);form.append(activeLabel);
      const locations=locationChoices(data.locations,member.locations);form.append(locations);
      const button=text("button","Save role and access");form.append(button);
      form.onsubmit=async event=>{event.preventDefault();if(!confirm("Change access for "+member.username+" and revoke their current sessions?"))return;button.disabled=true;
        try{await api("/api/staff/team/"+encodeURIComponent(member.username),{method:"POST",body:JSON.stringify({role:roleSelect.value,enabled:active.checked,locations:[...locations.querySelectorAll('input:checked')].map(option=>option.value)})});message("Access updated; affected sessions revoked.");await loadTeam();}
        catch(error){message(error.message,true);}finally{button.disabled=false;}};
      entry.append(form);container.append(entry);
    }
  }catch(error){container.textContent=error.message;}
  finally{container.setAttribute("aria-busy","false");}
}
function installPilotTools() {
  const correction = document.createElement("form");
  correction.id = "correction"; correction.hidden = true;
  correction.innerHTML = '<h3>Correct stamp progress</h3><p>Owner or manager only. Corrections preserve rewards and cannot cross a reward threshold. This is not a sale refund.</p><label>Stamp change<input name="delta" type="number" min="-100" max="100" required></label><label>Reason<input name="reason" minlength="3" maxlength="240" required></label><button>Save correction</button>';
  $("#customer-secondary-actions").append(correction);
  const rotate = document.createElement("button"); rotate.type = "button"; rotate.className = "secondary"; rotate.textContent = "Replace private card link";
  correction.append(rotate);
  rotate.hidden = role !== "owner";
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
  region.id = "regional-settings";
  $("#settings-forms").append(region);
  const expiry=document.createElement("form");
  expiry.innerHTML='<h3>New reward validity</h3><p>Existing rewards keep their promised terms. Leave empty for no expiry.</p><label>Validity in days<input name="days" type="number" min="1" max="3650"></label><button>Save reward validity</button><p role="status"></p>';
  expiry.id = "reward-validity";
  $("#settings-forms").append(expiry);
  for (const field of expiry.elements) field.disabled=true;
  api("/api/staff/shop").then(shop=>{expiry.elements.days.value=shop.reward_expiry_days ?? "";for(const field of expiry.elements)field.disabled=false;}).catch(error=>{expiry.querySelector('[role="status"]').textContent="Could not load validity settings. Reload this workspace to retry. "+error.message;});
  expiry.onsubmit=async event=>{
    event.preventDefault();const button=expiry.querySelector("button");button.disabled=true;
    try { const result=await api("/api/staff/reward-expiry",{method:"POST",body:JSON.stringify({days:expiry.elements.days.value===""?null:Number(expiry.elements.days.value)})});expiry.querySelector('[role="status"]').textContent=result.appliesTo; }
    catch(error){expiry.querySelector('[role="status"]').textContent=error.message;}finally{button.disabled=false;}
  };
  for(const field of region.elements)field.disabled=true;
  api("/api/staff/shop").then(shop => { for(const field of ["currency","timezone","country"]) region.elements[field].value = shop[field];for(const field of region.elements)field.disabled=false; }).catch(error=>{region.querySelector('[role="status"]').textContent="Could not load regional settings. Reload this workspace to retry. "+error.message;});
  region.onsubmit = async event => {
    event.preventDefault(); const button = region.querySelector("button"); button.disabled = true;
    try {
      await api("/api/staff/region", { method:"POST", body:JSON.stringify(Object.fromEntries(new FormData(region))) });
      region.querySelector('[role="status"]').textContent = "Regional settings saved.";
    } catch(error) { region.querySelector('[role="status"]').textContent = error.message; } finally { button.disabled = false; }
  };
  for(const form of [region,expiry])form.addEventListener("input",()=>{const status=form.querySelector('[role="status"]');status.textContent="Unsaved changes. Use this section’s save button to publish them.";status.dataset.tone="";});
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
  $(".business-tabs").append(button); availableTabs.add("reports");
  const panel = document.createElement("section"); panel.id = "panel-reports"; panel.className = "dashboard-panel"; panel.hidden = true;
  panel.setAttribute("role", "tabpanel"); panel.setAttribute("aria-labelledby", "tab-reports");
  panel.innerHTML = '<h2>Recorded activity</h2><p id="report-status" role="status">Loading report…</p><div id="report-values"></div><details class="methodology"><summary>How these counts are defined</summary><p id="report-methodology"></p></details><div class="actions"><button id="report-refresh">Refresh report</button><button id="export-customers" class="secondary">Export customer CSV</button></div>';
  $("#workspace-content").append(panel); $("#report-refresh").onclick = loadReport;
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
  $("#panel-reports").setAttribute("aria-busy","true");
  try {
    const report = await api("/api/staff/reports"); $("#report-values").replaceChildren();
    for(const [heading,values] of [["Members & recorded visits",{members:"Members",qualifying_visits:"Confirmed paid visits",visiting_members:"Members with a paid visit"}],["Rewards",{rewards_issued:"Rewards issued",rewards_redeemed:"Rewards redeemed",outstanding_rewards:"Outstanding rewards"}],["Audit",{corrections:"Progress corrections"}]]) {
      const group=text("div","","report-group"), list=document.createElement("dl");group.append(text("h3",heading),list);
      for(const [key,label] of Object.entries(values))list.append(text("dt",label),text("dd",report[key] ?? "Not available"));
      $("#report-values").append(group);
    }
    $("#report-status").textContent = report.period + ". Sales: " + report.salesLabel + ".";
    $("#report-status").dataset.tone="";
    $("#report-methodology").textContent = report.definitions;
  } catch(error) { $("#report-status").textContent = error.message+". Previously loaded figures, if any, have not been refreshed."; $("#report-status").dataset.tone="error"; }
  finally { $("#panel-reports").setAttribute("aria-busy","false"); }
}

async function recordAction(action, automatic = false) {
    if (!selected || busy || selectedMember?.id !== selected) return;
    const id = selected;
    const actionMember = selectedMember;
    if (pending && (pending.id !== id || pending.action !== action)) {
      outcome(
        "Resolve the previous request first: rescan that customer’s card for a pending stamp, or retry its reward redemption.",
      );
      return;
    }
    if (
      !confirm(
        action === "purchase"
          ? `Record one qualifying paid purchase for ${selectedMember.name}?\n${currentShopName} · ${currentLocationName}\nCurrent balance: ${selectedMember.stamps}/${selectedMember.stampGoal} stamps, ${selectedMember.rewards} rewards.`
          : `Redeem one ${selectedMember.rewardLabel || "reward"} for ${selectedMember.name}?\n${currentShopName} · ${currentLocationName}\nThis consumes one available reward and earns no stamp.`,
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
      outcome(scanned
        ? (result.awarded ? `One stamp added for ${actionMember.name}. Confirmed balance: ${result.stamps}/${result.stampGoal} stamps · ${result.rewards} rewards.` : "This card was just recorded. No extra stamp was added. Wait at least 5 seconds before recording another paid purchase.")
        : `Reward redeemed for ${actionMember.name}. Confirmed balance: ${result.stamps}/${result.stampGoal} stamps · ${result.rewards} rewards.`);
    } catch (e) {
      busy = false;
      if (saved) {
        outcome(
          "Action saved. Refresh the customer display before recording another purchase.",
        );
        return;
      }
      if ([400, 403, 404, 409].includes(e.status)) {
        pending = null;
        sessionStorage.removeItem("coffeePending");
        outcome("Request rejected: " + e.message, true);
      } else
        outcome(
          e.message +
            " Your request key is retained; retry the same action if the response was lost.",
        );
      $("#redeem").disabled = !selected || !selectedMember?.rewards;
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
          const found = await lookup();
          if(!found) return;
          if (generation !== scanGeneration) return;
          message("Card identified. Check the customer and confirm a qualifying purchase.");
          showTab("customers");
          focusCustomer();
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
  CardUI.render($("#card-preview"), { ...design, shopName: design.name || "Your shop", shopColor: design.color, name: "Sample member", stamps: Math.min(3,savedGoal-1), rewards: 0, stampGoal: savedGoal }, { preview: true });
  $("#preview-scope").textContent = `Sample web card · Saved reward target: ${savedGoal} stamps. ${JSON.stringify(design) === savedDesignSignature ? "Appearance matches the last saved version." : "Appearance changes are not published yet."} Reward rules have their own save below.`;
}
for (const input of $("#shop-branding").querySelectorAll("input:not([type=file]),select")) input.addEventListener("input", updatePreview);
$("#goal").addEventListener("input", () => { $("#programme-status").textContent = Number($("#goal").value) === savedGoal ? "Reward target matches the saved rule." : `Unsaved reward-rule change. The appearance preview still uses the saved ${savedGoal}-stamp target.`; $("#programme-status").dataset.tone = ""; });
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
    const submitted = designPayload();
    const shop = await api("/api/staff/shop", { method: "POST", body: JSON.stringify(submitted) });
    savedDesignSignature = JSON.stringify(submitted);
    currentShopName = shop.name;
    $("nav a").textContent = shop.name;
    $("#design-message").textContent = "Published appearance. Reward rules and regional settings were not changed.";
    $("#design-message").dataset.tone = "success";
    updatePreview();
  } catch (error) { $("#design-message").textContent = error.message; $("#design-message").dataset.tone = "error"; }
  finally { button.disabled = false; button.textContent = "Publish appearance"; }
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
      displayTimezone = shop.timezone || "Asia/Thimphu";
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
      savedGoal = p.stampGoal;
      $("#goal").value = p.stampGoal;
      savedDesignSignature = JSON.stringify(designPayload());
      updatePreview();
    }
    $("#identity").textContent = `${me.username} · ${me.businessRole || me.role}`;
    await search();
    for(const button of document.querySelectorAll("[data-tab]")) button.textContent = sectionNames[button.dataset.tab];
    configureNavigation();
    showTab(location.hash.slice(1));
  } catch (e) {
    message(e.message);
  }
})();

})();
