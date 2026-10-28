(async () => {
  const $ = selector => document.querySelector(selector);
  const id = new URLSearchParams(location.search).get("member");
  const node = (tag,value,className) => { const element=document.createElement(tag); if(value!==undefined)element.textContent=value; if(className)element.className=className;return element; };
  let initial=true,loading=false,previous,previousRewards,expandedHistory=false,lastMember,displayTimezone;
  const status=(value,error=false,announce=true)=>{const box=$("#message");box.textContent=value;box.dataset.tone=error?"error":"success";box.setAttribute("aria-live",announce?"polite":"off");};
  const date=value=>new Date(Number(value)).toLocaleString(undefined,displayTimezone?{timeZone:displayTimezone}:undefined);
  const eventName=kind=>({purchase:"Qualifying paid visit",redeem:"Reward redeemed",referral:"Referral bonus",adjustment:"Progress corrected",expire:"Reward expired",revoke:"Reward revoked",refund:"Refund recorded",opening:"Opening balance"})[kind]||"Recorded account activity";
  $("#save").hidden=false;
  $("#wallet-back").hidden=!id;
  if(id){
    document.body.classList.add("has-member");$("#wallet-toolbar").hidden=true;$("#member-tools").hidden=false;
    const transfer=node("button","Transfer card to another device","secondary");transfer.id="transfer-card";transfer.hidden=true;
    const transferLink=document.createElement("input");transferLink.readOnly=true;transferLink.hidden=true;transferLink.setAttribute("aria-label","Private single-use transfer link, valid for ten minutes");
    $("#member-tools").append(transfer,transferLink);
    transfer.onclick=async()=>{
      transfer.disabled=true;
      try{const response=await fetch("/api/members/"+encodeURIComponent(id)+"/transfer",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}",cache:"no-store"});const data=await response.json();if(!response.ok)throw Error(data.error||"Transfer is unavailable on this server.");transferLink.value=new URL(data.transferUrl,location.origin).href;transferLink.hidden=false;transferLink.focus();transferLink.select();status("Private transfer link ready. Copy it to your other device; it works once within ten minutes. Creating another link replaces this one.");}
      catch(error){status(error.message,true);}finally{transfer.disabled=false;}
    };
    $("#share-card").onclick=async()=>{
      try{if(navigator.share)await navigator.share({title:"My loyalty card",url:location.href});else{await navigator.clipboard.writeText(location.href);status("Private card link copied. Keep it somewhere safe.");}}
      catch(error){if(error.name!=="AbortError")status("Copy the private card link from your browser’s address bar.",true);}
    };
  }else{
    document.body.classList.add("wallet-view");$("#card-layout")?.removeAttribute("aria-busy");
    $("main").append($("#installation-help"));
    $("#card").classList.add("wallet-empty");
  }
  async function readMember(memberId){const response=await fetch("/api/members/"+encodeURIComponent(memberId),{cache:"no-store",credentials:"omit"});if(!response.ok)throw Error("Could not load this card.");return response.json();}
  function renderRewardHistory(member){
    const root=$("#reward-history");
    if(!root.querySelector("#available-rewards")){
      root.innerHTML='<section class="available-rewards-panel"><h2>Available rewards</h2><div id="available-rewards"></div><small>Show your card to staff to redeem. A screenshot or balance display does not authorize redemption.</small></section><details id="past-rewards"><summary>Past rewards</summary><div id="past-rewards-list"></div><small id="voucher-scope"></small></details><details id="customer-history"><summary>Recent activity</summary><div id="customer-activity-list"></div><button id="customer-history-more" class="secondary" type="button" hidden>Show more recorded activity</button><small id="customer-history-scope"></small></details>';
      $("#customer-history-more").onclick=()=>{expandedHistory=!expandedHistory;renderEvents(lastMember.history||[]);};
    }
    const vouchers=member.vouchers||[],available=vouchers.filter(reward=>reward.status==="available"),past=vouchers.filter(reward=>reward.status!=="available");
    const rewardRow=reward=>{const row=node("article",undefined,"voucher-row"),state={available:"Available",redeemed:"Redeemed",expired:"Expired",revoked:"Revoked"}[reward.status]||"Status unavailable";row.append(node("strong",reward.label),node("span",state,"state-badge"),node("small",reward.expires_at?"Valid until "+date(reward.expires_at):"No expiry"));return row;};
    $("#available-rewards").replaceChildren(...available.map(rewardRow));
    if(!available.length)$("#available-rewards").append(node("p",member.rewards?`${member.rewards} ${member.rewardLabel||"rewards"} available. Staff confirm the current eligibility.`:"No rewards available yet. Your progress is on your card."));
    $("#past-rewards-list").replaceChildren(...past.map(rewardRow));
    if(!past.length)$("#past-rewards-list").append(node("p","No past rewards recorded."));
    $("#voucher-scope").textContent=vouchers.length>=100?"Latest 100 issued reward records loaded. This is not the entire history.":"Recorded reward states from the shop.";
    renderEvents(member.history||[]);
  }
  function renderEvents(events){
    const list=$("#customer-activity-list");list.replaceChildren();
    for(const event of events.slice(0,expandedHistory?events.length:5)){const row=node("div",undefined,"activity");row.append(node("strong",eventName(event.kind)),node("small",date(event.created_at)+(event.reason?" · "+event.reason:"")));list.append(row);}
    if(!events.length)list.append(node("p","No recorded activity yet."));
    $("#customer-history-more").hidden=events.length<=5;$("#customer-history-more").setAttribute("aria-expanded",String(expandedHistory));$("#customer-history-more").textContent=expandedHistory?"Show fewer records":"Show more recorded activity";
    $("#customer-history-scope").textContent=`${Math.min(events.length,expandedHistory?events.length:5)} of ${events.length} loaded records${events.length>=30?" (latest 30; not pagination)":""}. Times: ${displayTimezone||"your device timezone"}.`;
  }
  function initialCardError(){
    $("#member-details").hidden=true;$("#referral-section").hidden=true;$("#card-tools").hidden=true;
    $("#card").className="card-unavailable";
    if(!$("#retry-card")){
      const title=node("h2","Card unavailable"),description=node("p","We could not verify this card. This does not mean your membership or balance was deleted."),retry=node("button","Retry loading card");retry.id="retry-card";
      const wallet=node("a","Open my wallet","button secondary");wallet.href="/";
      const actions=node("div",undefined,"actions");actions.append(retry,wallet);$("#card").replaceChildren(title,description,actions);
      retry.onclick=async()=>{retry.disabled=true;retry.textContent="Checking card…";await refresh(true);if(retry.isConnected){retry.disabled=false;retry.textContent="Retry loading card";}};
    }
  }
  async function refresh(explicit=false){
    if(loading)return;loading=true;
    try{
      if(id){
        if(!CardUI.uuid.test(id))throw Error("Invalid membership link.");
        const member=await readMember(id);lastMember=member;displayTimezone=member.timezone;
        $("#member-details").hidden=false;$("#card-tools").hidden=false;$("#transfer-card").hidden=member.transferEnabled!==true;
        const cardSignature=JSON.stringify([member.id,member.name,member.stamps,member.rewards,member.stampGoal,member.shopName,member.shopColor,member.cardTitle,member.tagline,member.rewardLabel,member.stampIcon,member.cardStyle,member.logoData]);
        if(cardSignature!==previous){CardUI.render($("#card"),member);previous=cardSignature;}
        const rewardSignature=JSON.stringify([member.vouchers,member.history,member.rewards,member.rewardLabel,displayTimezone]);
        if(rewardSignature!==previousRewards){renderRewardHistory(member);previousRewards=rewardSignature;}
        document.title=(member.shopName||"Loyalty")+" · My card";$("nav a").textContent=member.shopName||"Loyalty";
        $("#terms").textContent=`One qualifying paid purchase earns one stamp. ${member.stampGoal} stamps earn ${member.rewardLabel||"a reward"}. Staff confirm purchases and redemption.`;
        const referral=member.referral;
        if(referral&&/^[a-f0-9]{32}$/.test(referral.code)){
          $("#referral-section").hidden=false;$("#referral-sharing").hidden=!referral.enabled;
          const bonus=referral.rewardKind==="rewards"?`${referral.rewardAmount} × ${member.rewardLabel||"reward"}`:`${referral.rewardAmount} bonus ${referral.rewardAmount===1?"stamp":"stamps"}`;
          $("#referral-offer").textContent=referral.enabled?`Earn ${bonus} when a new friend joins this shop through your public invitation and makes their first qualifying paid purchase. The bonus goes to you; your friend gets their own membership.`:"New invitations are paused. Existing qualifying invitations keep their promised reward.";
          $("#referral-progress").textContent=`${referral.invited} joined · ${referral.credited} qualified · ${Math.max(0,referral.invited-referral.credited)} awaiting a first purchase`;
          const link=new URL("/join.html",location.origin);link.searchParams.set("shop",member.shopId||"default");link.searchParams.set("ref",referral.code);
          if(document.activeElement!==$("#referral-link")&&$("#referral-link").value!==link.href)$("#referral-link").value=link.href;
        }else $("#referral-section").hidden=true;
        const shortcutSaved=CardUI.saveCard(member);
        status("Live balance · checked "+new Date().toLocaleTimeString()+(shortcutSaved?"":" · Shortcut could not be saved. Keep your private link."),!shortcutSaved,initial||explicit||!shortcutSaved);
        if(explicit)$("#card-name")?.focus({preventScroll:true});
      }else{
        const saved=CardUI.savedCards();
        if(!saved.length){if(previous){$("#card").className="wallet-empty";$("#card").replaceChildren(node("h2","No cards yet"),node("p","Add a shop or private card link to restore your shortcut."));previous=undefined;}status("Add your first card using the button above.",false,initial);initial=false;return;}
        const results=await Promise.allSettled(saved.map(card=>readMember(card.id))),signature=JSON.stringify(results);
        if(signature!==previous){
          const active=document.activeElement,focusInside=$("#card").contains(active),focusId=active?.dataset.walletId,focusAction=active?.dataset.walletAction;
          $("#card").className="wallet-grid";$("#card").replaceChildren();
          results.forEach((result,index)=>{
            const savedCard=saved[index],wrapper=node("article",undefined,"wallet-item"),link=node("a");link.href="/?member="+encodeURIComponent(savedCard.id);link.dataset.walletId=savedCard.id;link.dataset.walletAction="open";
            if(result.status==="fulfilled"){
              const member=result.value;link.setAttribute("aria-label",`${member.shopName}, ${member.cardTitle||"Member card"}, ${member.name}, ${member.stamps} of ${member.stampGoal} stamps, ${member.rewards} rewards`);CardUI.render(link,member,{compact:true});
            }else{link.className="unavailable-card";link.textContent=`${savedCard.name} · Could not refresh. Open to retry.`;link.setAttribute("aria-label",`${savedCard.name}: balance unavailable, open to retry`);}
            const remove=node("button","Remove shortcut","remove-card secondary");remove.dataset.walletId=savedCard.id;remove.dataset.walletAction="remove";remove.setAttribute("aria-label","Remove "+savedCard.name+" shortcut from this device only");
            remove.onclick=()=>{if(!confirm("Remove this device’s shortcut? Your membership and balance stay with the shop. Keep the private link to restore it."))return;try{localStorage.setItem("loyalty-cards",JSON.stringify(CardUI.savedCards().filter(card=>card.id!==savedCard.id)));location.reload();}catch{status("Could not remove this shortcut. Check browser storage settings.",true);}};
            wrapper.append(link,remove);$("#card").append(wrapper);
          });
          previous=signature;
          if(focusInside&&document.activeElement===document.body){const target=[...$("#card").querySelectorAll('[data-wallet-id]')].find(element=>element.dataset.walletId===focusId&&element.dataset.walletAction===focusAction);target?.focus({preventScroll:true});}
        }
        const failures=results.filter(result=>result.status==="rejected").length;
        status(`${saved.length} saved ${saved.length===1?"card":"cards"}`+(failures?` · ${failures} could not refresh. Open a card to retry.`:" · balances checked"),failures>0,initial||explicit);
      }
      initial=false;
    }catch{
      if(id&&!previous)initialCardError();
      status(previous?"Could not refresh. The last loaded balance may be outdated; reconnect and retry.":"Could not load your card. Check your connection or reopen the private link.",true,initial||explicit);
      initial=false;
    }finally{loading=false;}
  }
  setInterval(()=>{if(!document.hidden)refresh();},id?5000:30000);
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)refresh();});window.addEventListener("online",()=>refresh());
  window.addEventListener("storage",event=>{if(!id&&event.key==="loyalty-cards")refresh();});
  async function shareReferral(copyOnly){const url=$("#referral-link").value;if(!url)return;try{if(!copyOnly&&navigator.share)await navigator.share({title:"Join me at this shop",text:"Create your own loyalty card. Your first qualifying paid visit helps me earn a referral bonus.",url});else{await navigator.clipboard.writeText(url);$("#referral-message").textContent="Public invitation copied. Send it to a friend.";}}catch(error){if(error.name!=="AbortError"){$("#referral-link").focus();$("#referral-link").select();$("#referral-message").textContent="Select and copy your public invitation link above.";}}}
  $("#share-referral").onclick=()=>shareReferral(false);$("#copy-referral").onclick=()=>shareReferral(true);
  const dialog=$("#add-card-dialog");let camera,cameraGeneration=0,invoker;
  const stopCamera=()=>{++cameraGeneration;camera?.stop();camera=undefined;$("#join-camera").hidden=true;$("#scan-shop").disabled=false;};
  const openLink=value=>{const input=value.trim(),url=new URL(CardUI.uuid.test(input)?"/?member="+encodeURIComponent(input):input,location.origin);if(url.origin!==location.origin)throw Error("Use a card or shop link from this loyalty app.");const validCard=["/","/index.html"].includes(url.pathname)&&CardUI.uuid.test(url.searchParams.get("member")),validShop=url.pathname==="/join.html";if(!validCard&&!validShop)throw Error("Enter a private card link or the shop’s signup link.");stopCamera();location.assign(url.href);};
  $("#add-card").onclick=()=>{invoker=document.activeElement;dialog.showModal();$("#add-card-title").focus();};
  $("#close-add-card").onclick=()=>dialog.close();dialog.addEventListener("close",()=>{stopCamera();if(invoker?.isConnected)invoker.focus({preventScroll:true});});
  $("#card-url").addEventListener("input",()=>$("#card-url").removeAttribute("aria-invalid"));
  $("#add-card-form").onsubmit=event=>{event.preventDefault();try{openLink($("#card-url").value);}catch(error){$("#card-url").setAttribute("aria-invalid","true");$("#add-card-message").textContent=error.message;}};
  $("#scan-shop").onclick=async()=>{
    $("#scan-shop").disabled=true;$("#join-camera").hidden=false;$("#add-card-message").textContent="Point your camera at the shop’s signup QR code.";const generation=++cameraGeneration;
    try{const controls=await new ZXingBrowser.BrowserQRCodeReader().decodeFromVideoDevice(undefined,"join-camera",(result,_error,scanner)=>{if(!result||generation!==cameraGeneration||!dialog.open)return;try{openLink(result.getText());scanner.stop();}catch(error){$("#add-card-message").textContent=error.message;}});if(generation!==cameraGeneration||!dialog.open)controls.stop();else camera=controls;}
    catch{if(generation===cameraGeneration){stopCamera();$("#add-card-message").textContent="Camera unavailable. Paste a shop or private card link, or use your phone camera.";}}
  };
  window.addEventListener("pagehide",stopCamera);
  await refresh();
})();
