const parameters = new URLSearchParams(location.search);
if (parameters.get("created") === "1") {
  document.querySelector("#username").value = parameters.get("username") || "";
  document.querySelector("#message").textContent = "Account created. Sign in with your new username and password.";
}
document.querySelector("#login").onsubmit = async (e) => {
  e.preventDefault();
  try {
    const r = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: document.querySelector("#username").value.trim() || "legacy",
        password: document.querySelector("#password").value,
      }),
    });
    const j = await r.json();
    if (!r.ok) throw Error(j.error);
    document.querySelector("#password").value = "";
    location.assign("/staff.html");
  } catch (e) {
    document.querySelector("#message").textContent = e.message;
  }
};
