try { sessionStorage.removeItem("loyalty-staff-handoff"); } catch {}
const parameters = new URLSearchParams(location.search);
if (parameters.get("created") === "1") {
  document.querySelector("#username").value = parameters.get("username") || "";
  document.querySelector("#message").textContent = "Account created. Sign in with your new username and password.";
}
if (parameters.get("expired") === "1") document.querySelector("#message").textContent = "Your staff session ended. Sign in to continue.";
document.querySelector("#login").onsubmit = async (e) => {
  e.preventDefault();
  const button = document.querySelector("#login button");
  if (button.disabled) return;
  button.disabled = true;
  button.textContent = "Signing in…";
  try {
    const r = await fetch("/api/login", {
      cache: "no-store",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: document.querySelector("#username").value.trim() || "legacy",
        password: document.querySelector("#password").value,
      }),
    });
    const j = await r.json();
    if (!r.ok) throw Error(j.error);
    sessionStorage.setItem("loyalty-staff-handoff", JSON.stringify({ token: j.token, createdAt: Date.now() }));
    document.querySelector("#password").value = "";
    location.assign("/business/dashboard.html");
  } catch (e) {
    document.querySelector("#message").dataset.tone = "error";
    document.querySelector("#message").textContent = e.message;
  } finally {
    button.disabled = false;
    button.textContent = "Sign in →";
  }
};
