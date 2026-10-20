export function cardDesign(row: any) {
  return {
    cardTitle: row.card_title || "Member card",
    tagline: row.tagline ?? "A little more rewarding.",
    rewardLabel: row.reward_label || "Free coffee",
    stampIcon: row.stamp_icon || "check",
    cardStyle: row.card_style || "classic",
    logoData: row.logo_data || "",
  };
}
export function validLogo(value: unknown): value is string {
  if (value === "") return true;
  if (typeof value !== "string" || value.length > 180000) return false;
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return false;
  const bytes = Buffer.from(match[2], "base64");
  return (match[1] === "png" && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) ||
    (match[1] === "jpeg" && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) ||
    (match[1] === "webp" && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP");
}
