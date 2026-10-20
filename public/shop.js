(async () => {
  try {
    const r = await fetch("/api/shop");
    if (!r.ok) throw Error("Could not load shop settings");
    const shop = await r.json();
    if (!shop.joinUrl)
      throw Error("Set the real PUBLIC_BASE_URL before printing this QR.");
    document.querySelector("#qr").src = "/shop-qr.png";
    document.querySelector("#qr").hidden = false;
    const link = document.querySelector("#join-link");
    link.href = shop.joinUrl;
    link.textContent = shop.joinUrl;
    link.hidden = false;
  } catch (e) {
    document.querySelector("#message").textContent = e.message;
  }
})();
document.querySelector("#print").onclick = () => window.print();
