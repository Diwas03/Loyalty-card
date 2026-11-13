// Visibility is an explicit, local preference; passwords never leave the existing auth flow.
const visibility = document.querySelector("#show-password");
const passwordFields = [...document.querySelectorAll('input[type="password"]')];
visibility?.addEventListener("change", () => {
  for (const field of passwordFields)
    field.type = visibility.checked ? "text" : "password";
});
