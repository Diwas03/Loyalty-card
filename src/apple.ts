import { PKPass } from "passkit-generator";
import { readFileSync } from "node:fs";
import http2 from "node:http2";
import type { Member } from "./db.js";
import { baseUrl } from "./config.js";
export function applePass(m: Member) {
  const pass = new PKPass(
    {
      "icon.png": readFileSync("assets/icon.png"),
      "icon@2x.png": readFileSync("assets/icon@2x.png"),
      "icon@3x.png": readFileSync("assets/icon@3x.png"),
    },
    {
      wwdr: readFileSync(process.env.APPLE_WWDR_FILE!),
      signerCert: readFileSync(process.env.APPLE_CERT_FILE!),
      signerKey: readFileSync(process.env.APPLE_KEY_FILE!),
      signerKeyPassphrase: process.env.APPLE_KEY_PASSPHRASE || undefined,
    },
    {
      formatVersion: 1,
      passTypeIdentifier: process.env.APPLE_PASS_TYPE_ID!,
      teamIdentifier: process.env.APPLE_TEAM_ID!,
      serialNumber: m.id,
      organizationName: "Demo Coffee Shop",
      description: "Demo Coffee Shop Loyalty",
      logoText: "Demo Coffee Shop",
      foregroundColor: "rgb(255,255,255)",
      backgroundColor: "rgb(65,41,29)",
      labelColor: "rgb(238,216,179)",
      webServiceURL: baseUrl() + "/apple",
      authenticationToken: m.apple_token,
    },
  );
  pass.type = "storeCard";
  pass.primaryFields.push({
    key: "stamps",
    label: "COFFEE STAMPS",
    value: `${m.stamps} / 8`,
    changeMessage: "Coffee stamp progress is now %@",
  });
  pass.secondaryFields.push({
    key: "rewards",
    label: "FREE COFFEES AVAILABLE",
    value: m.rewards,
    changeMessage: "Available free coffees: %@",
  });
  pass.backFields.push({
    key: "terms",
    label: "Programme",
    value:
      "One paid coffee earns one stamp. Eight stamps issue a free coffee. Redeeming does not earn stamps.",
  });
  pass.setBarcodes({
    format: "PKBarcodeFormatQR",
    message: m.id,
    messageEncoding: "iso-8859-1",
  });
  return pass.getAsBuffer();
}
export async function pushApple(token: string) {
  const host = "https://api.push.apple.com";
  // Certificate-based APNs authentication uses the Pass Type ID certificate, never a website TLS certificate.
  return await new Promise<number>((resolve, reject) => {
    const client = http2.connect(host, {
      cert: Buffer.concat([
        readFileSync(process.env.APPLE_CERT_FILE!),
        Buffer.from("\n"),
        readFileSync(process.env.APPLE_WWDR_FILE!),
      ]),
      key: readFileSync(process.env.APPLE_KEY_FILE!),
      passphrase: process.env.APPLE_KEY_PASSPHRASE || undefined,
    });
    let statusCode = 0;
    const timer = setTimeout(() => {
      client.destroy();
      reject(new Error("APNs timeout"));
    }, 20000);
    const finish = (err?: Error) => {
      clearTimeout(timer);
      client.close();
      err ? reject(err) : resolve(statusCode);
    };
    client.on("error", finish);
    const req = client.request({
      ":method": "POST",
      ":path": `/3/device/${token}`,
      "apns-topic": process.env.APPLE_PASS_TYPE_ID!,
      "apns-push-type": "background",
      "apns-priority": "5",
    });
    let status = 0;
    req.on("response", (h) => {
      status = Number(h[":status"]);
      statusCode = status;
    });
    req.on("data", () => {});
    req.on("end", () =>
      finish(
        status === 200 || status === 410
          ? undefined
          : new Error(`APNs HTTP ${status}`),
      ),
    );
    req.on("error", finish);
    req.end("{}");
  });
}
