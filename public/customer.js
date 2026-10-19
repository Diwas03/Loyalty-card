(async () => {
  const msg = document.querySelector("#message");
  try {
    const id = new URLSearchParams(location.search).get("member");
    const r = await fetch(
      id ? "/api/members/" + encodeURIComponent(id) : "/api/demo",
    );
    const m = await r.json();
    if (!r.ok) throw Error(m.error);
    if (!id) history.replaceState(null, "", "/?member=" + m.id);
    const card = document.querySelector("#card");
    card.className = "card";
    for (const text of [
      m.name,
      `${m.stamps} / 8 stamps`,
      `${m.rewards} free coffee rewards`,
    ]) {
      const h = document.createElement("h2");
      h.textContent = text;
      card.append(h);
    }
    const qr = document.createElement("img");
    qr.src = `/api/members/${m.id}/qr`;
    qr.alt = "Membership QR for staff";
    qr.width = 260;
    card.append(qr);
    const small = document.createElement("small");
    small.textContent = m.id;
    card.append(small);
    const config = await (await fetch("/api/config")).json();
    for (const p of ["google", "apple"]) {
      const b = document.querySelector("#" + p);
      b.disabled = !config[p].enabled;
      document.querySelector("#" + p + "-status").textContent = config[p]
        .enabled
        ? "Real integration configured; account and device verification still required."
        : "Real integration disabled. Missing: " + config[p].missing.join(", ");
      b.onclick = () => location.assign(`/wallet/${p}/${m.id}`);
    }
    msg.textContent = "Official backend balance · refresh to see changes";
  } catch (e) {
    msg.textContent = e.message;
  }
})();
