(async () => {
  try {
    const query = "?shop=" + encodeURIComponent(new URLSearchParams(location.search).get("shop") || "default");
    const r = await fetch("/api/shop" + query);
    if (!r.ok) throw Error("Could not load shop settings");
    const shop = await r.json();
    if (!shop.joinUrl)
      throw Error("Set the real PUBLIC_BASE_URL before printing this QR.");
    document.title = shop.name + " · Join our loyalty programme";
    document.querySelector("#shop-name").textContent = shop.name;
    document.querySelector("#qr").src = "/shop-qr.png" + query;
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
