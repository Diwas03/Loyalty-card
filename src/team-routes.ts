import type { Express, RequestHandler } from "express";
import { randomBytes } from "node:crypto";
import { digest, type HostedDB } from "./hosted-db.js";
import { staffToken } from "./staff-session.js";

export function teamRoutes(app: Express,db: HostedDB,staff: RequestHandler) {
  app.get("/api/staff/workspaces",staff,async(_req,res)=>{
    const rows=(await db.query(`SELECT b.shop_id,s.name,b.role,l.id AS location_id,l.name AS location_name FROM coffee.business_memberships b JOIN coffee.shops s ON s.id=b.shop_id JOIN coffee.locations l ON l.shop_id=b.shop_id AND l.active
      WHERE b.username=$1 AND b.enabled AND (b.role='owner' OR EXISTS(SELECT 1 FROM coffee.location_grants g WHERE g.username=b.username AND g.shop_id=b.shop_id AND g.location_id=l.id)) ORDER BY s.name,l.name`,[res.locals.actor])).rows;
    res.json(rows);
  });
  app.post("/api/staff/workspace",staff,async(req,res)=>{
    const row=(await db.query(`INSERT INTO coffee.workspace_context(token_hash,shop_id,location_id)
      SELECT $1,b.shop_id,l.id FROM coffee.business_memberships b JOIN coffee.locations l ON l.shop_id=b.shop_id AND l.active
      WHERE b.username=$2 AND b.shop_id=$3 AND b.enabled AND l.id=$4
      AND (b.role='owner' OR EXISTS(SELECT 1 FROM coffee.location_grants g WHERE g.username=b.username AND g.shop_id=b.shop_id AND g.location_id=l.id))
      ON CONFLICT(token_hash) DO UPDATE SET shop_id=excluded.shop_id,location_id=excluded.location_id RETURNING shop_id,location_id`,[digest(staffToken(req)),res.locals.actor,String(req.body.shopId||""),String(req.body.locationId||"")])).rows[0];
    if(!row){res.status(403).json({error:"Workspace access denied"});return;}res.json(row);
  });
  app.get("/api/staff/team",staff,async(_req,res)=>{
    if(res.locals.role!=="owner"){res.status(403).json({error:"Owner access required"});return;}
    const members=(await db.query(`SELECT b.username,b.role,b.enabled,p.full_name,coalesce(array_agg(g.location_id) FILTER(WHERE g.location_id IS NOT NULL),'{}') AS locations FROM coffee.business_memberships b LEFT JOIN coffee.staff_profiles p USING(username) LEFT JOIN coffee.location_grants g ON g.username=b.username AND g.shop_id=b.shop_id WHERE b.shop_id=$1 GROUP BY b.username,b.role,b.enabled,p.full_name ORDER BY b.username`,[res.locals.shopId])).rows;
    const locations=(await db.query("SELECT id,name,active FROM coffee.locations WHERE shop_id=$1 ORDER BY name",[res.locals.shopId])).rows;
    res.json({members,locations});
  });
  app.post("/api/staff/locations",staff,async(req,res)=>{
    if(res.locals.role!=="owner"){res.status(403).json({error:"Owner access required"});return;}
    if(typeof req.body.name!=="string" || !req.body.name.trim() || req.body.name.trim().length>80){res.status(400).json({error:"Enter a location name of 1–80 characters"});return;}
    const row=(await db.query("INSERT INTO coffee.locations(shop_id,name) VALUES($1,$2) RETURNING id,name",[res.locals.shopId,req.body.name.trim()])).rows[0];res.status(201).json(row);
  });
  app.post("/api/staff/team/:username",staff,async(req,res)=>{
    if(res.locals.role!=="owner"){res.status(403).json({error:"Owner access required"});return;}
    const {role,enabled,locations}=req.body;
    if(!["owner","manager","cashier"].includes(role) || typeof enabled!=="boolean" || !Array.isArray(locations)||locations.length>100||locations.some(id=>typeof id!=="string")){res.status(400).json({error:"Choose a valid role, enabled state and location assignments"});return;}
    try{await db.query("SELECT coffee.change_team_member($1,$2,$3,$4,$5,$6)",[res.locals.actor,res.locals.shopId,String(req.params.username),role,enabled,locations]);res.json({ok:true});}
    catch{res.status(409).json({error:"Change rejected: keep an enabled owner and assign valid locations. Membership must already exist."});}
  });
  app.post("/api/staff/team-invites",staff,async(req,res)=>{
    if(res.locals.role!=="owner"){res.status(403).json({error:"Owner access required"});return;}
    const role=req.body.role,locations=req.body.locations;
    if(!["manager","cashier"].includes(role)||!Array.isArray(locations)||!locations.length||locations.length>100||locations.some(id=>typeof id!=="string")){res.status(400).json({error:"Choose manager/cashier and at least one location"});return;}
    const found=(await db.query("SELECT id FROM coffee.locations WHERE shop_id=$1 AND active AND id=ANY($2::text[])",[res.locals.shopId,locations])).rows;
    if(found.length!==new Set(locations).size){res.status(400).json({error:"Invalid location assignment"});return;}
    const token=randomBytes(32).toString("hex");
    await db.query("INSERT INTO coffee.team_invites(token_hash,shop_id,role,locations,expires,created_by) VALUES($1,$2,$3,$4,$5,$6)",[digest(token),res.locals.shopId,role,locations,Date.now()+48*3600000,res.locals.actor]);
    res.status(201).json({inviteUrl:"/business/team-invite.html#"+token,expiresIn:48*3600});
  });
  app.post("/api/staff/team-invites/accept",staff,async(req,res)=>{
    if(typeof req.body.token!=="string"||!/^[a-f0-9]{64}$/.test(req.body.token)){res.status(400).json({error:"Invalid invitation"});return;}
    try{const shop=(await db.query("SELECT coffee.accept_team_invite($1,$2) AS shop",[digest(req.body.token),res.locals.actor])).rows[0].shop;res.json({shopId:shop});}
    catch{res.status(409).json({error:"Invitation is expired, used, unavailable, or you already belong to this business"});}
  });
}
