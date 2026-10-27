const token = location.hash.slice(1);
history.replaceState(null, "", location.pathname);
document.querySelector("#restore").onclick = async () => {
  const button = document.querySelector("#restore"); button.disabled = true;
  try {
    const response = await fetch("/api/recover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }), cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw Error(data.error);
    location.replace(data.customerUrl);
  } catch(error) { document.querySelector("#message").textContent = error.message; button.disabled = false; }
};
