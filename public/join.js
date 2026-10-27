(async () => {
  const $ = (s) => document.querySelector(s);
  const shopId = new URLSearchParams(location.search).get("shop") || "default";
  const referralCode = new URLSearchParams(location.search).get("ref") || "";
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
    $("nav a").textContent = shop.name;
    $("nav a").href = "/join.html" + shopQuery;
    $("#consent-shop").textContent = shop.name;
    document.documentElement.style.setProperty("--shop-color", shop.color || "#41291d");
    $("#terms").textContent =
      `One qualifying paid purchase earns one stamp. ${shop.stampGoal} stamps earn ${shop.rewardLabel || "one reward"}.`;
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
    if (/^[a-f0-9]{32}$/.test(referralCode)) {
      $("#referral-notice").hidden = false;
      if (session.member) $("#referral-notice").textContent = "You already have a membership here. Referral bonuses apply to new members only.";
      else {
        try {
          const response = await fetch("/api/referral" + shopQuery + "&ref=" + encodeURIComponent(referralCode));
          const offer = await response.json();
          $("#referral-notice").textContent = offer.valid ? "You’ve been invited! Create your own card. Your referrer earns a bonus after your first paid purchase at this shop." : "This referral offer is unavailable. You can still create your own card.";
        } catch { $("#referral-notice").textContent = "Your card is ready to create. Referral eligibility will be checked when you join."; }
      }
    }
    ready = true;
    button.disabled = false;
  } catch (e) {
    $("#message").dataset.tone = "error";
    $("#message").textContent = e.message;
  }
  $("#join").onsubmit = async (e) => {
    e.preventDefault();
    if (!ready) return;
    button.disabled = true;
    const label = button.textContent;
    button.textContent = "Preparing your card…";
    try {
      const r = await fetch("/api/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: $("#name").value,
          accept: $("#accept").checked,
          shopId,
          referralCode,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.error || "Could not create your membership");
      $("#existing").hidden = false;
      $("#existing").href = data.customerUrl;
      location.assign(data.customerUrl);
    } catch (e) {
      $("#message").dataset.tone = "error";
      $("#message").textContent =
        e.message +
        " You can retry; this browser will reuse the same membership.";
      button.disabled = false;
      button.textContent = label;
    }
  };
})();
