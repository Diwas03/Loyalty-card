(async () => {
  const $ = (s) => document.querySelector(s);
  let id = new URLSearchParams(location.search).get("member");
  if (!id) {
    let cards = [];
    try { cards = JSON.parse(localStorage.getItem("loyalty-cards") || "[]"); } catch {}
    if (Array.isArray(cards) && cards.length) {
      $("#card").replaceChildren();
      for (const card of cards) {
        if (!/^[a-f0-9-]{36}$/i.test(card.id)) continue;
        const link = document.createElement("a");
        link.href = "/?member=" + encodeURIComponent(card.id);
        link.textContent = card.name;
        const row = document.createElement("p");
        row.append(link);
        $("#card").append(row);
      }
      $("#message").textContent = "Choose your saved card.";
      return;
    }
    $("#message").textContent = "Scan your shop’s QR code to create a card, or open your private card link.";
    return;
  }
  let initial = true;
  let loading = false;
  async function refresh() {
    if (loading) return;
    loading = true;
    try {
      const r = await fetch(
        id ? "/api/members/" + encodeURIComponent(id) : "/api/demo",
      );
      const m = await r.json();
      if (!r.ok) throw Error(m.error);
      if (m.shopName) {
        document.title = m.shopName + " loyalty card";
        $("nav a").textContent = "☕ " + m.shopName;
        $("nav a").href = "/join.html?shop=" + encodeURIComponent(m.shopId);
        for (const link of document.querySelectorAll('a[href="/join.html"]'))
          link.href = "/join.html?shop=" + encodeURIComponent(m.shopId);
        document.documentElement.style.setProperty("--shop-color", m.shopColor);
      }
      if (!id) {
        id = m.id;
        history.replaceState(null, "", "/?member=" + encodeURIComponent(id));
      }
      $("#terms").textContent =
        `One paid coffee earns one stamp. ${m.stampGoal} stamps earn a free coffee.`;
      if (initial) {
        $("#card").replaceChildren();
        $("#card").className = "card";
        for (const [tag, key] of [
          ["h2", "name"],
          ["h2", "progress"],
          ["p", "rewards"],
          ["div", "stamps"],
        ]) {
          const n = document.createElement(tag);
          n.id = "card-" + key;
          if (key === "stamps") n.className = "stamp-grid";
          $("#card").append(n);
        }
        const qr = document.createElement("img");
        qr.src = `/api/members/${id}/qr`;
        qr.alt = "Membership QR for staff";
        qr.width = 240;
        qr.className = "qr";
        $("#card").append(qr);
        const note = document.createElement("small");
        note.textContent = "Show this QR to your barista";
        $("#card").append(note);
        $("#save").hidden = false;
        try {
          const cards = JSON.parse(localStorage.getItem("loyalty-cards") || "[]");
          const saved = cards.filter((card) => card.id !== id);
          saved.unshift({ id, name: m.shopName || "Coffee card" });
          localStorage.setItem("loyalty-cards", JSON.stringify(saved.slice(0, 100)));
        } catch { /* The private link still works if storage is unavailable. */ }
        initial = false;
      }
      $("#card-name").textContent = m.name;
      $("#card-progress").textContent = `${m.stamps} / ${m.stampGoal} stamps`;
      $("#card-rewards").textContent =
        `${m.rewards} free coffee ${m.rewards === 1 ? "reward" : "rewards"} available`;
      $("#card-stamps").replaceChildren();
      for (let i = 0; i < m.stampGoal; i++) {
        const n = document.createElement("span");
        n.className = "stamp" + (i < m.stamps ? " filled" : "");
        n.textContent = i < m.stamps ? "✓" : String(i + 1);
        $("#card-stamps").append(n);
      }
      $("#message").textContent =
        "Official balance · updated " + new Date().toLocaleTimeString();
    } catch (e) {
      $("#message").textContent = initial
        ? "Open your private membership link, or ask your barista for a card."
        : `Could not refresh. Last displayed balance may be outdated. ${e.message}`;
    } finally {
      loading = false;
    }
  }
  await refresh();
  setInterval(() => {
    if (!document.hidden && id) refresh();
  }, 5000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && id) refresh();
  });
})();
