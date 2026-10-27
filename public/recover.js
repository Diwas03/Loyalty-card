const token = location.hash.slice(1);
history.replaceState(null, "", location.pathname);
document.querySelector("#restore").onclick = async () => {
  const button = document.querySelector("#restore"); button.disabled = true;
  try {
    const response = await fetch("/api/recover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }), cache: "no-store" });
    const data = await response.json();
    if (!response.ok) { const error=Error(data.error);error.terminal=[400,410].includes(response.status);throw error; }
    location.replace(data.customerUrl);
  } catch(error) {
    document.querySelector("#message").textContent = error.message;
    document.querySelector("#message").dataset.tone="error";
    button.disabled = Boolean(error.terminal);button.textContent=error.terminal?"Transfer link unavailable":"Retry restore";
    document.querySelector("#recovery-guidance").textContent=error.terminal?"Create a new transfer link from your original card, or use the private card link you saved. Your membership balance remains with the shop.":"Your request could not be confirmed. Check your connection and retry; if the link was already consumed, create a new transfer from your original card.";
  }
};
