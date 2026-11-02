// api/review.js — cola de revisión y alta de proveedores (autocontenido)
import { createClient } from "@supabase/supabase-js";

const TABLE = "candidatos_revision";

function db() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

function autorizado(req) {
  const t = process.env.REVIEW_TOKEN;
  if (!t) return true;
  return req.headers["x-review-token"] === t;
}

export default async function handler(req, res) {
  if (!autorizado(req)) return res.status(401).json({ error: "No autorizado" });
  const sb = db();
  try {
    if (req.method === "GET") {
      let q = sb.from(TABLE).select("*").order("fecha_creacion", { ascending: false });
      if (req.query.estado) q = q.eq("estado", req.query.estado);
      const { data, error } = await q;
      if (error) throw error;
      return res.status(200).json({ candidatos: data });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      const c = body.candidato || body;
      if (!c.razon_social) return res.status(400).json({ error: "Falta razon_social" });
      const fila = {
        razon_social: String(c.razon_social).trim(),
        ruc_estimado: String(c.ruc_estimado || "").replace(/\D/g, ""),
        web: c.web || "",
        departamento: c.departamento || "",
        familia: c.familia || "00. PENDIENTE DE CLASIFICAR",
        categoria: c.categoria || "Pendiente de clasificar",
        capacidades: Array.isArray(c.capacidades) ? c.capacidades.join(" · ") : c.capacidades || "",
        por_que: c.por_que || "",
        necesidad: c.necesidad || "",
        origen: c.origen || "Sugerencia IA (no verificada)",
        proveedor_ia: c.proveedor_ia || "",
        estado: "pendiente",
      };
      const { data, error } = await sb.from(TABLE).insert(fila).select().single();
      if (error) throw error;
      return res.status(201).json({ candidato: data });
    }

    if (req.method === "PATCH") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      const { id, ...cambios } = body;
      if (!id) return res.status(400).json({ error: "Falta id" });
      const permitidos = ["estado", "ruc_estimado", "web", "familia", "categoria", "capacidades", "ruc_sunat_confirmado", "evidencia_web_confirmada", "validado_por"];
      const patch = {};
      for (const k of permitidos) if (k in cambios) patch[k] = cambios[k];
      if (cambios.estado === "validado" || cambios.estado === "rechazado") patch.fecha_validacion = new Date().toISOString();
      const { data, error } = await sb.from(TABLE).update(patch).eq("id", id).select().single();
      if (error) throw error;

      if (patch.estado === "validado" && data) {
        const prov = {
          ruc: data.ruc_estimado || null,
          razon_social: data.razon_social,
          web: data.web || "",
          departamento: data.departamento || "",
          familia: data.familia || "00. PENDIENTE DE CLASIFICAR",
          categoria: data.categoria || "Pendiente de clasificar",
          capacidades: data.capacidades || "",
          estado_evidencia: "Validado por experto",
          origen: "IA validada",
          validado_por: data.validado_por || cambios.validado_por || "",
        };
        const q = prov.ruc ? sb.from("proveedores").upsert(prov, { onConflict: "ruc" }) : sb.from("proveedores").insert(prov);
        const { error: e2 } = await q;
        if (e2) console.error("alta proveedor", e2);
        return res.status(200).json({ candidato: data, proveedor_alta: !e2 });
      }
      return res.status(200).json({ candidato: data });
    }

    if (req.method === "DELETE") {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: "Falta id" });
      const { error } = await sb.from(TABLE).delete().eq("id", id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return res.status(405).json({ error: "Método no permitido" });
  } catch (e) {
    console.error("review", e);
    return res.status(500).json({ error: "Error en la cola de revisión", detalle: String(e.message || e) });
  }
}
