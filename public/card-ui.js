(() => {
  const icons = { check: "✓", coffee: "☕", star: "★", heart: "♥" };
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  function theme(container, color) {
    color = /^#[a-f0-9]{6}$/i.test(color) ? color : "#193d32";
    const rgb = color.slice(1).match(/../g).map(part => parseInt(part, 16) / 255)
      .map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
    const light = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722 > .179;
    container.style.setProperty("--shop-color", color);
    container.style.setProperty("--card-ink", light ? "#000000" : "#ffffff");
  }
  function render(container, member, { compact = false, preview = false } = {}) {
    container.replaceChildren();
    container.className = "card" + (compact ? " wallet-card" : "") + (member.cardStyle === "minimal" ? " card-minimal" : "");
    theme(container, member.shopColor);
    const label = element("div", undefined, "card-label");
    const brand = element("span", undefined, "card-brand");
    if (/^data:image\/(png|jpeg|webp);base64,/.test(member.logoData || "")) {
      const logo = element("img"); logo.src = member.logoData; logo.alt = ""; logo.className = "card-logo"; brand.append(logo);
    }
    brand.append(element("span", member.shopName || "Coffee club"));
    label.append(brand, element("span", member.cardTitle || "Member card"));
    container.append(label);
    const name = element("h2", member.name, "member-name");
    const progress = element("h2", `${member.stamps} / ${member.stampGoal} stamps`, "member-progress");
    const rewards = element("p", `${member.rewards} × ${member.rewardLabel || "Free coffee"} available`, "member-rewards");
    if (!compact && !preview) { name.id = "card-name"; progress.id = "card-progress"; rewards.id = "card-rewards"; }
    container.append(name, progress, rewards);
    const stamps = element("div", undefined, "stamp-grid");
    if (!compact && !preview) stamps.id = "card-stamps";
    stamps.setAttribute("aria-hidden", "true");
    const goal = Math.max(2, Math.min(100, Number(member.stampGoal) || 8));
    stamps.style.setProperty("--stamp-columns", String(Math.min(goal, goal <= 12 ? 4 : 8)));
    for (let i = 0; i < (compact ? Math.min(goal, 8) : goal); i++) stamps.append(element("span", i < member.stamps ? (icons[member.stampIcon] || icons.check) : String(i + 1), "stamp" + (i < member.stamps ? " filled" : "")));
    container.append(stamps);
    if (!compact) {
      if (!preview) {
        const qr = element("img"); qr.src = `/api/members/${encodeURIComponent(member.id)}/qr`; qr.alt = "Membership QR for staff"; qr.width = 240; qr.className = "qr"; container.append(qr);
      } else container.append(element("div", "Customer QR appears here", "preview-qr"));
      container.append(element("small", member.tagline || "Show this QR at the counter", "card-tagline"));
    } else container.append(element("span", "Open card ↗", "wallet-card-open"));
  }
  function savedCards() {
    try {
      const cards = JSON.parse(localStorage.getItem("loyalty-cards") || "[]");
      if (!Array.isArray(cards)) return [];
      const unique = new Map();
      for (const card of cards) if (card && uuid.test(card.id) && !unique.has(card.id)) unique.set(card.id, { id: card.id, name: typeof card.name === "string" ? card.name.slice(0, 80) : "Saved card" });
      return [...unique.values()].slice(0, 100);
    } catch { return []; }
  }
  function saveCard(member) {
    try {
      const cards = savedCards().filter(card => card.id !== member.id);
      cards.unshift({ id: member.id, name: member.shopName || "Coffee card" });
      localStorage.setItem("loyalty-cards", JSON.stringify(cards.slice(0, 100)));
      return true;
    } catch { return false; }
  }
  window.CardUI = { render, theme, savedCards, saveCard, uuid };
})();
