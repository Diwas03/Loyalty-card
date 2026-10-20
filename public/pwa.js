(() => {
  // Business sign-in opens separately so the installed app stays a customer wallet.
  if (matchMedia("(display-mode: standalone)").matches || navigator.standalone) {
    for (const link of document.querySelectorAll('a[href^="/business/"]')) {
      link.target = "_blank";
      link.rel = "noopener";
    }
  }
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
  let installPrompt;
  window.addEventListener("beforeinstallprompt", (event) => {
    const button = document.querySelector("#install-app");
    if (!button) return;
    event.preventDefault();
    installPrompt = event;
    button.hidden = false;
    button.onclick = async () => {
      if (!installPrompt) return;
      button.disabled = true;
      try {
        await installPrompt.prompt();
        await installPrompt.userChoice;
      } finally {
        installPrompt = null;
        button.hidden = true;
        button.disabled = false;
      }
    };
  });
  window.addEventListener("appinstalled", () => {
    const button = document.querySelector("#install-app");
    if (button) button.hidden = true;
    const help = document.querySelector("#install-help");
    if (help) help.textContent = "Installed. Open My Cards from your home screen.";
  });
})();
