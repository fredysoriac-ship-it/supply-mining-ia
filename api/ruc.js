// api/ruc.js — verificación de RUC contra elruc.pe (padrón ligero).
// GET  /api/ruc?ruc=20100113610[&completo=1] -> { ok, ruc, razon_social, estado, condicion, domicilio, ciiu, ... }
// POST /api/ruc  { rucs: [...], familia: "07. ..." } -> { resultados: [...] }  (máx. 20 por llamada)
// Solo las familias 06 y 07 piden la ficha completa (CIIU); el resto usa el padrón ligero.
// El token vive solo en la variable ELRUC_TOKEN de Vercel. Nunca se expone al navegador.

const BASE_LIGERO = "https://elruc.pe/api/v1/padron";
const BASE_COMPLETO = "https://elruc.pe/api/v1/ruc"; // incluye CIIU y actividad
const FAMILIAS_COMPLETAS = ["06", "07"]; // maquinaria y alquiler: se consulta CIIU
const MAX_LOTE = 20;

function digitoVerificador(ruc) {
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((acc, p, i) => acc + p * Number(ruc[i]), 0);
  let r = 11 - (suma % 11);
  if (r >= 10) r -= 10;
  return r === Number(ruc[10]);
}

function rucValido(ruc) {
  return /^\d{11}$/.test(ruc) && digitoVerificador(ruc);
}

function normalizar(d) {
  return {
    ok: true,
    ruc: d.ruc,
    razon_social: d.razon_social || "",
    estado: d.estado || "",
    condicion: d.condicion || "",
    domicilio: d.domicilio?.direccion || "",
    ubigeo: d.domicilio?.ubigeo || "",
    distrito: d.domicilio?.distrito || "",
    provincia: d.domicilio?.provincia || "",
    departamento: d.domicilio?.departamento || "",
    ciiu: d.actividad?.principal?.ciiu || "",
    actividad: d.actividad?.principal?.descripcion || "",
    consultado_en: new Date().toISOString(),
  };
}

async function consultar(ruc, completo = false) {
  if (!rucValido(ruc)) return { ok: false, ruc, error: "RUC inválido (11 dígitos y dígito verificador)" };
  const token = process.env.ELRUC_TOKEN;
  if (!token) return { ok: false, ruc, error: "Falta ELRUC_TOKEN en el servidor" };
  const r = await fetch(`${completo ? BASE_COMPLETO : BASE_LIGERO}/${ruc}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (r.status === 404) return { ok: false, ruc, error: "RUC no encontrado en elruc.pe" };
  if (r.status === 401 || r.status === 403) return { ok: false, ruc, error: "Token rechazado por elruc.pe" };
  if (r.status === 429) return { ok: false, ruc, error: "Cupo mensual agotado o demasiadas consultas" };
  if (!r.ok) return { ok: false, ruc, error: `elruc.pe respondió ${r.status}` };
  return normalizar(await r.json());
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const ruc = String(req.query.ruc || "").trim();
      if (!ruc) return res.status(400).json({ error: "Falta el parámetro ruc" });
      const completo = req.query.completo === "1";
      const out = await consultar(ruc, completo);
      return res.status(out.ok ? 200 : 422).json(out);
    }
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      const rucs = Array.isArray(body.rucs) ? [...new Set(body.rucs.map((x) => String(x).trim()))] : [];
      // body.familia: si empieza con 06 o 07 se pide la ficha completa (CIIU)
      const completo = FAMILIAS_COMPLETAS.some((f) => String(body.familia || "").startsWith(f));
      if (!rucs.length) return res.status(400).json({ error: "Falta rucs[]" });
      if (rucs.length > MAX_LOTE) return res.status(400).json({ error: `Máximo ${MAX_LOTE} RUC por llamada` });
      const resultados = [];
      for (const ruc of rucs) resultados.push(await consultar(ruc, completo));
      return res.status(200).json({ resultados });
    }
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Método no permitido" });
  } catch (e) {
    console.error("ruc", e);
    return res.status(500).json({ error: "Error consultando RUC", detalle: String(e.message || e) });
  }
}
