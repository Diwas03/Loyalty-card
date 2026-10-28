(async () => {
  const print=document.querySelector("#print"),qr=document.querySelector("#qr"),message=document.querySelector("#message");
  print.disabled=true;
  message.textContent="Checking the shop’s signup poster…";
  try {
    const query = "?shop=" + encodeURIComponent(new URLSearchParams(location.search).get("shop") || "default");
    const r = await fetch("/api/shop" + query);
    if (!r.ok) throw Error("Could not load shop settings");
    const shop = await r.json();
    let join;
    try { join=new URL(shop.joinUrl);if(join.protocol!=="https:"||join.username||join.password)throw Error(); }
    catch { throw Error("Printing is not ready. The owner must configure the shop’s public HTTPS website address, then reload this page."); }
    document.title = shop.name + " · Join our loyalty programme";
    document.querySelector("#shop-name").textContent = shop.name;
    qr.onload=()=>{qr.hidden=false;print.disabled=false;message.textContent="Ready to print. This public QR opens customer signup, not a private membership.";message.dataset.tone="success";};
    qr.onerror=()=>{print.disabled=true;qr.hidden=true;message.textContent="The signup QR could not load. Check the website setup and reload before printing.";message.dataset.tone="error";};
    qr.src = "/shop-qr.png" + query;
    const link = document.querySelector("#join-link");
    link.href = join.href;
    link.textContent = "Open customer signup";
    link.hidden = false;
  } catch (e) {
    message.textContent = e.message;message.dataset.tone="error";
  }
})();
document.querySelector("#print").onclick = () => { if(!document.querySelector("#print").disabled)window.print(); };
