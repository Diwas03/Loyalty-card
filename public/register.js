document.querySelector("#register").onsubmit = async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.querySelector("#message");
  const button = form.querySelector("button");
  const data = Object.fromEntries(new FormData(form));
  if (data.password !== data.confirmPassword) {
    message.textContent = "The passwords do not match.";
    return;
  }
  button.disabled = true;
  try {
    const response = await fetch("/api/setup/owner", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fullName: data.fullName, username: data.username, password: data.password, setupPassword: data.setupPassword }),
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || "Could not create the account. Please try again.");
    form.reset();
    location.assign("/login.html?created=1&username=" + encodeURIComponent(result.username));
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
};
