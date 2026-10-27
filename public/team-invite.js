const token=location.hash.slice(1);history.replaceState(null,"",location.pathname);
document.querySelector("#accept-invite").onclick=async()=>{
  const button=document.querySelector("#accept-invite");button.disabled=true;
  try{
    const restored=await fetch("/api/staff/session",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}",cache:"no-store"});
    if(!restored.ok)throw Error("Sign in to your existing business workspace in another tab, then return here. Ask the owner for an account if you do not have one.");
    const {token:bearer}=await restored.json();
    const response=await fetch("/api/staff/team-invites/accept",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+bearer},body:JSON.stringify({token}),cache:"no-store"});
    const data=await response.json();if(!response.ok){const error=Error(data.error);error.terminal=[400,409].includes(response.status);throw error;}
    document.querySelector("#message").textContent="Invitation accepted. Open your workspace and choose the new business from its workspace selector.";
    document.querySelector("#message").dataset.tone="success";button.textContent="Invitation accepted";
  }catch(error){document.querySelector("#message").textContent=error.message;document.querySelector("#message").dataset.tone="error";button.disabled=Boolean(error.terminal);button.textContent=error.terminal?"Invitation unavailable":"Check sign-in and retry";}
};
