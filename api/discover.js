// api/discover.js — Vercel Serverless Function (autocontenido)
// POST { necesidad, conocidos?, proveedor? }  ->  { candidatos: [...] }
// La API key vive solo en el servidor (variables de entorno), nunca en el navegador.

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

const TAXONOMIA = `00. PENDIENTE DE CLASIFICAR: Pendiente de clasificar
01. LOGÍSTICA EXTERNA: Comercio exterior, Distribución externa, Izaje y maniobras externas, Transporte de carga, Transporte de personal, Transporte de producto
02. SERVICIOS DE OPERACIÓN MINERA: Mantenimiento tercerizado, Movimiento de tierras, Perforación y voladura, Servicios mineros
03. PROYECTOS, CONSTRUCCIÓN Y CAPEX: Comisionamiento, Construcción, EPC / EPCM, Ingeniería, Montaje, Obras civiles
04. MATERIALES E INSUMOS: Aceros y metales, Combustibles y gas, Consumibles generales, EPP, Explosivos y accesorios de voladura, Ferretería industrial, Instrumentación, Lubricantes y grasas, Mangueras y conexiones, Materiales eléctricos, Productos químicos, Rodamientos y transmisión, Tuberías, válvulas y mangueras
05. REPUESTOS Y MRO: Componentes de desgaste, Electricidad y electrónica, Filtración, Neumáticos, OEM / Aftermarket / Reman, Sistemas hidráulicos y transmisión
06. EQUIPOS Y MAQUINARIA: Bombeo, Equipos de minería subterránea, Equipos especializados, Generación, Maquinaria pesada, Ventilación
07. ALQUILER DE EQUIPOS: Equipos auxiliares, Maquinaria pesada, Vehículos livianos
08. TECNOLOGÍA Y SERVICIOS ESPECIALIZADOS: Asesoría legal, Automatización y control, Comunicaciones, Ensayos y laboratorio, Metrología, Software
09. SERVICIOS DE SOPORTE Y FINANCIEROS: Financieros y seguros, Recursos humanos, Servicios administrativos
10. EXPLORACIÓN Y GEOCIENCIAS: Geofísica, Geología, Geotecnia, Perforación diamantina, Topografía
11. ENERGÍA Y FLUIDOS: Agua, Energía eléctrica
12. SERVICIOS GENERALES Y SSOMA: Facilities, Servicios generales
13. CONCESIONARIOS Y REPRESENTACIONES: Vehículos y camiones (venta y representación)
14. SEGURIDAD, SALUD, AMBIENTE Y PERSONAL: Capacitación, Permisos y evaluación ambiental, Personal tercerizado y selección, Seguridad y salud, Seguros de salud y EPS, Servicios ambientales`;

function construirPrompt(necesidad, conocidos = []) {
  return (
    `Eres asistente de abastecimiento minero en Perú. Necesidad del comprador: "${necesidad}".\n` +
    `Propón hasta 6 empresas proveedoras REALES del mercado peruano que podrían atender esa necesidad para minería.\n` +
    `Para cada una indica: razon_social, ruc_estimado (11 dígitos solo si lo recuerdas con seguridad, de lo contrario ""), ` +
    `web (dominio propio solo si lo recuerdas, de lo contrario ""), departamento, capacidades (3 a 6 ítems), por_que (una frase), ` +
    `y clasifícala dentro de ESTA taxonomía: familia (una línea exacta de la lista, con su número) y categoria (una de las categorías de esa familia).\n` +
    `Taxonomía (familia: categorías):\n${TAXONOMIA}\n` +
    `Si no encaja con claridad, usa familia "00. PENDIENTE DE CLASIFICAR" y categoria "Pendiente de clasificar".\n` +
    `Son SUGERENCIAS para revisión humana: es preferible dejar ruc_estimado y web vacíos a inventarlos. NO inventes RUCs ni dominios.\n` +
    `No repitas empresas de esta lista ya conocida: ${conocidos.slice(0, 120).join("; ")}.\n` +
    `Responde SOLO un arreglo JSON de objetos con las claves {razon_social, ruc_estimado, web, departamento, familia, categoria, capacidades, por_que}.`
  );
}

function parsearCandidatos(texto) {
  if (!texto) return [];
  const intentos = [texto];
  const fence = texto.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) intentos.push(fence[1]);
  const i = texto.indexOf("["), j = texto.lastIndexOf("]");
  if (i !== -1 && j !== -1 && j > i) intentos.push(texto.slice(i, j + 1));
  const o1 = texto.indexOf("{"), o2 = texto.lastIndexOf("}");
  if (o1 !== -1 && o2 !== -1 && o2 > o1) intentos.push(texto.slice(o1, o2 + 1));
  for (const t of intentos) {
    try {
      const v = JSON.parse(t);
      if (Array.isArray(v)) return v;
      if (v && Array.isArray(v.candidatos)) return v.candidatos;
      if (v && Array.isArray(v.empresas)) return v.empresas;
    } catch (_) {}
  }
  return [];
}

async function llamarOpenAI(prompt) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: OPENAI_MODEL, messages: [{ role: "user", content: prompt }], response_format: { type: "json_object" }, temperature: 0.4 }),
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${await r.text()}`);
  return (await r.json()).choices?.[0]?.message?.content || "";
}

async function llamarAnthropic(prompt) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: 2000, messages: [{ role: "user", content: prompt }] }),
  });
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${await r.text()}`);
  return (await r.json()).content?.[0]?.text || "";
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Método no permitido" }); }
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const necesidad = String(body.necesidad || "").trim();
    if (!necesidad) return res.status(400).json({ error: "Falta 'necesidad'" });
    const prov = body.proveedor === "openai" || body.proveedor === "anthropic" ? body.proveedor : (process.env.AI_DEFAULT_PROVIDER || "anthropic");
    const conocidos = Array.isArray(body.conocidos) ? body.conocidos.map(String) : [];
    const prompt = construirPrompt(necesidad, conocidos);
    const texto = prov === "openai" ? await llamarOpenAI(prompt) : await llamarAnthropic(prompt);
    const candidatos = parsearCandidatos(texto).slice(0, 6).map((r) => ({
      razon_social: String(r.razon_social || "").trim(),
      ruc_estimado: String(r.ruc_estimado || "").replace(/\D/g, ""),
      web: String(r.web || "").trim(),
      departamento: String(r.departamento || "").trim(),
      familia: String(r.familia || "00. PENDIENTE DE CLASIFICAR").trim(),
      categoria: String(r.categoria || "Pendiente de clasificar").trim(),
      capacidades: Array.isArray(r.capacidades) ? r.capacidades.map(String) : r.capacidades ? [String(r.capacidades)] : [],
      por_que: String(r.por_que || "").trim(),
      origen: "Sugerencia IA (no verificada)",
      proveedor_ia: prov,
    }));
    return res.status(200).json({ candidatos, proveedor: prov });
  } catch (e) {
    console.error("discover", e);
    return res.status(500).json({ error: "No se pudo completar la búsqueda con IA", detalle: String(e.message || e) });
  }
}
