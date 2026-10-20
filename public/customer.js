(async () => {
  const $ = (s) => document.querySelector(s);
  let id = new URLSearchParams(location.search).get("member");
  if (id) document.body.classList.add("has-member");
  if (!id) {
    let cards = [];
    try { cards = JSON.parse(localStorage.getItem("loyalty-cards") || "[]"); } catch {}
    if (Array.isArray(cards) && cards.length) {
      $("#card").replaceChildren();
      document.querySelector("header h1").textContent = "Your favourites. All together.";
      for (const card of cards) {
        if (!/^[a-f0-9-]{36}$/i.test(card.id)) continue;
        const link = document.createElement("a");
        link.href = "/?member=" + encodeURIComponent(card.id);
        link.textContent = card.name;
        link.setAttribute("aria-label", card.name);
        const row = document.createElement("p");
        row.append(link);
        $("#card").append(row);
      }
      $("#message").textContent = "Your saved memberships · choose a card to get started";
      return;
    }
    $("#message").textContent = "YOUR CARD COLLECTION";
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
        $("nav a").textContent = m.shopName;
        $("nav a").href = "/join.html?shop=" + encodeURIComponent(m.shopId);
        for (const link of document.querySelectorAll('a[href="/join.html"]'))
          link.href = "/join.html?shop=" + encodeURIComponent(m.shopId);
        const color = /^#[0-9a-f]{6}$/i.test(m.shopColor) ? m.shopColor : "#193d32";
        document.documentElement.style.setProperty("--shop-color", color);
        const rgb = color.slice(1).match(/../g).map((part) => parseInt(part, 16) / 255)
          .map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
        const light = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722 > .179;
        document.documentElement.style.setProperty("--card-ink", light ? "#000000" : "#ffffff");
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
        const label = document.createElement("div");
        label.className = "card-label";
        const title = document.createElement("span");
        title.textContent = m.shopName || "Coffee club";
        const mark = document.createElement("span");
        mark.textContent = "MEMBER CARD ✦";
        label.append(title, mark);
        $("#card").append(label);
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
      $("#card-stamps").style.setProperty("--stamp-columns", String(Math.min(m.stampGoal, m.stampGoal <= 12 ? 4 : 8)));
      for (let i = 0; i < m.stampGoal; i++) {
        const n = document.createElement("span");
        n.className = "stamp" + (i < m.stamps ? " filled" : "");
        n.textContent = i < m.stamps ? "✓" : String(i + 1);
        $("#card-stamps").append(n);
      }
      $("#message").setAttribute("aria-live", "off");
      $("#message").dataset.tone = "success";
      $("#message").textContent =
        "● Live balance · updated " + new Date().toLocaleTimeString();
    } catch (e) {
      $("#message").setAttribute("aria-live", "polite");
      $("#message").dataset.tone = "error";
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
