(async () => {
  const $ = (s) => document.querySelector(s);
  const shopId = new URLSearchParams(location.search).get("shop") || "default";
  const shopQuery = "?shop=" + encodeURIComponent(shopId);
  let ready = false;
  const button = $("#submit");
  button.disabled = true;
  try {
    const [shopResponse, sessionResponse] = await Promise.all([
      fetch("/api/shop" + shopQuery),
      fetch("/api/customer-session" + shopQuery),
    ]);
    if (!shopResponse.ok || !sessionResponse.ok)
      throw Error("Could not connect. Please reload and try again.");
    const shop = await shopResponse.json(),
      session = await sessionResponse.json();
    document.title = "Join " + shop.name;
    $("nav a").textContent = "☕ " + shop.name;
    $("nav a").href = "/join.html" + shopQuery;
    $("#consent-shop").textContent = shop.name;
    document.documentElement.style.setProperty("--shop-color", shop.color || "#41291d");
    $("#terms").textContent =
      `One paid coffee earns one stamp. ${shop.stampGoal} stamps earn a free coffee.`;
    button.textContent = "Create my card";
    if (session.member) {
      $("#heading").textContent = "Welcome back, " + session.member.name + ".";
      $("#intro").textContent =
        "Your existing membership is ready. Your stamps and rewards will stay with you.";
      $("#name").value = session.member.name;
      $("#name").hidden = true;
      $("#name-label").hidden = true;
      $("#accept").checked = true;
      button.textContent = "Open my card";
      $("#existing").hidden = false;
      $("#existing").href = "/?member=" + encodeURIComponent(session.member.id);
    }
    ready = true;
    button.disabled = false;
  } catch (e) {
    $("#message").textContent = e.message;
  }
  $("#join").onsubmit = async (e) => {
    e.preventDefault();
    if (!ready) return;
    button.disabled = true;
    try {
      const r = await fetch("/api/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: $("#name").value,
          accept: $("#accept").checked,
          shopId,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.error || "Could not create your membership");
      $("#existing").hidden = false;
      $("#existing").href = data.customerUrl;
      location.assign(data.customerUrl);
    } catch (e) {
      $("#message").textContent =
        e.message +
        " You can retry; this browser will reuse the same membership.";
      button.disabled = false;
    }
  };
})();
