// Optional pilot invitation stays in the URL fragment, never in access-log URLs.
const invitation = new URLSearchParams(location.hash.slice(1)).get("invite") || "";
if (invitation) history.replaceState(null,"",location.pathname+location.search);
document.querySelector("#register").onsubmit = async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.querySelector("#message");
  const button = form.querySelector("button");
  const data = Object.fromEntries(new FormData(form));
  if (data.password !== data.confirmPassword) {
    message.dataset.tone = "error";
    message.textContent = "The passwords do not match.";
    return;
  }
  button.disabled = true;
  button.textContent = "Creating your shop…";
  try {
    const response = await fetch("/api/setup/owner", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fullName: data.fullName, username: data.username, password: data.password, shopName: data.shopName, ...(/^[a-f0-9]{64}$/.test(invitation) ? {inviteToken: invitation} : {}) }),
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || "Could not create the account. Please try again.");
    form.reset();
    location.assign("/business/login.html?created=1&username=" + encodeURIComponent(result.username));
  } catch (error) {
    message.dataset.tone = "error";
    message.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = "Create account";
  }
};
