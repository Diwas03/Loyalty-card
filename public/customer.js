(async () => {
  const $ = selector => document.querySelector(selector);
  const id = new URLSearchParams(location.search).get("member");
  const status = (text, error = false) => {
    $("#message").textContent = text;
    $("#message").dataset.tone = error ? "error" : "success";
    $("#message").setAttribute("aria-live", error ? "polite" : "off");
  };
  $("#save").hidden = false;
  let initial = true, loading = false, previous;
  if (id) {
    document.body.classList.add("has-member");
    $("#wallet-toolbar").hidden = true;
    $("#member-tools").hidden = false;
    $("#share-card").onclick = async () => {
      try {
        if (navigator.share) await navigator.share({ title: "My loyalty card", url: location.href });
        else { await navigator.clipboard.writeText(location.href); status("Private card link copied. Keep it somewhere safe."); }
      } catch (error) { if (error.name !== "AbortError") status("Copy the private card link from your browser’s address bar.", true); }
    };
  } else {
    document.body.classList.add("wallet-view");
    document.querySelector("header h1").textContent = "Your favourites. All together.";
    $("#terms").textContent = "One place for every shop you love. Collect stamps, keep your cards, and enjoy your rewards.";
  }
  async function readMember(memberId) {
    const response = await fetch("/api/members/" + encodeURIComponent(memberId), { cache: "no-store", credentials: "omit" });
    if (!response.ok) throw Error("Could not load this card.");
    return response.json();
  }
  async function refresh() {
    if (loading) return;
    loading = true;
    try {
      if (id) {
        if (!CardUI.uuid.test(id)) throw Error("Invalid membership link.");
        const member = await readMember(id);
        const signature = JSON.stringify(member);
        if (signature !== previous) { CardUI.render($("#card"), member); previous = signature; }
        document.title = (member.shopName || "Loyalty") + " · My card";
        $("nav a").textContent = member.shopName || "Loyalty";
        $("#terms").textContent = `One paid coffee earns one stamp. ${member.stampGoal} stamps earn ${member.rewardLabel || "a free coffee"}.`;
        const shortcutSaved = CardUI.saveCard(member);
        $("#home-guide").hidden = true;
        status("● Live balance · updated " + new Date().toLocaleTimeString() + (shortcutSaved ? "" : " · Could not save the shortcut. Keep your private link."), !shortcutSaved);
      } else {
        const saved = CardUI.savedCards();
        if (!saved.length) {
          status("YOUR CARD COLLECTION");
          $("#home-guide").hidden = false;
          return;
        }
        $("#home-guide").hidden = true;
        const results = await Promise.allSettled(saved.map(card => readMember(card.id)));
        const signature = JSON.stringify(results);
        if (signature !== previous) {
        $("#card").className = "wallet-grid";
        $("#card").replaceChildren();
        results.forEach((result, index) => {
          const savedCard = saved[index];
          const wrapper = document.createElement("article"); wrapper.className = "wallet-item";
          const link = document.createElement("a"); link.href = "/?member=" + encodeURIComponent(savedCard.id);
          link.setAttribute("aria-label", result.status === "fulfilled" ? result.value.shopName : savedCard.name);
          if (result.status === "fulfilled") CardUI.render(link, result.value, { compact: true });
          else { link.className = "unavailable-card"; link.textContent = `${savedCard.name} · Could not refresh. Open to retry.`; }
          const remove = document.createElement("button"); remove.className = "remove-card secondary"; remove.textContent = "Remove shortcut";
          remove.setAttribute("aria-label", "Remove " + savedCard.name + " from this device");
          remove.onclick = () => {
            if (!confirm("Remove this card from this device? Your membership and stamps stay in the shop’s database. Keep your private link to restore it.")) return;
            try { localStorage.setItem("loyalty-cards", JSON.stringify(CardUI.savedCards().filter(card => card.id !== savedCard.id))); location.reload(); }
            catch { status("Could not remove this shortcut. Check your browser storage settings.", true); }
          };
          wrapper.append(link, remove); $("#card").append(wrapper);
        });
        previous = signature;
        }
        const failures = results.filter(result => result.status === "rejected").length;
        status(`${saved.length} saved ${saved.length === 1 ? "card" : "cards"}` + (failures ? ` · ${failures} could not refresh. Reconnect and try again.` : " · balances updated"), failures > 0);
      }
      initial = false;
    } catch {
      status(initial ? "Could not load your card. Check your connection and open your private membership link again." : "Could not refresh. Displayed balances may be outdated. Reconnect and try again.", true);
    } finally { loading = false; }
  }
  await refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, id ? 5000 : 30000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  window.addEventListener("online", refresh);
  window.addEventListener("storage", event => { if (!id && event.key === "loyalty-cards") location.reload(); });
  const dialog = $("#add-card-dialog");
  let camera;
  const stopCamera = () => { camera?.stop(); camera = undefined; $("#join-camera").hidden = true; $("#scan-shop").disabled = false; };
  const openLink = value => {
    const input = value.trim();
    const url = new URL(CardUI.uuid.test(input) ? "/?member=" + encodeURIComponent(input) : input, location.origin);
    if (url.origin !== location.origin) throw Error("Use a card or shop link from this loyalty app.");
    const validCard = ["/", "/index.html"].includes(url.pathname) && CardUI.uuid.test(url.searchParams.get("member"));
    const validShop = url.pathname === "/join.html";
    if (!validCard && !validShop) throw Error("Enter a private card link or the shop’s signup link.");
    stopCamera(); location.assign(url.href);
  };
  $("#add-card").onclick = () => dialog.showModal();
  $("#close-add-card").onclick = () => dialog.close();
  dialog.addEventListener("close", stopCamera);
  $("#add-card-form").onsubmit = event => {
    event.preventDefault();
    try { openLink($("#card-url").value); } catch (error) { $("#add-card-message").textContent = error.message; }
  };
  $("#scan-shop").onclick = async () => {
    $("#scan-shop").disabled = true;
    $("#join-camera").hidden = false;
    $("#add-card-message").textContent = "Point your camera at the shop’s signup QR code.";
    let closed = false;
    const cancel = () => { closed = true; };
    dialog.addEventListener("close", cancel, { once: true });
    try {
      const controls = await new ZXingBrowser.BrowserQRCodeReader().decodeFromVideoDevice(undefined, "join-camera", (result, _error, scanner) => {
        if (!result || closed) return;
        try { openLink(result.getText()); closed = true; scanner.stop(); }
        catch (error) { $("#add-card-message").textContent = error.message; }
      });
      if (closed || !dialog.open) controls.stop(); else camera = controls;
    } catch { stopCamera(); $("#add-card-message").textContent = "Camera unavailable. Paste the shop’s link, or scan its QR using your phone camera."; }
  };
  window.addEventListener("pagehide", stopCamera);
})();
