# Supply Mining · Descubrimiento de proveedores con IA

Backend en **Vercel** + **Supabase** que permite a la plataforma consultar a **ChatGPT o Claude** (intercambiables) **sin estar dentro de esas plataformas**. La IA propone candidatos de proveedores mineros; nada entra al Maestro hasta que tú lo valides.

```
Navegador  →  /api/discover  →  OpenAI o Anthropic   (la API key vive en el servidor)
    ↑               │
    └── candidatos ─┘
Navegador  →  /api/review   →  Supabase (cola de revisión persistente)
```

## Estructura
- `api/discover.js` — recibe la necesidad, llama al proveedor de IA elegido, devuelve candidatos (no escribe en la base).
- `api/review.js` — cola de revisión en Supabase: listar, agregar, validar/rechazar, quitar.
- `lib/ai.js` — proveedor intercambiable (OpenAI / Anthropic) y parseo tolerante del JSON.
- `lib/supabase.js` — cliente de Supabase solo para el servidor (service role).
- `public/index.html` — interfaz mínima de prueba (búsqueda + cola de revisión).
- `supabase/schema.sql` — tabla `candidatos_revision` con RLS.

## Puesta en marcha (paso a paso)

### 1. Supabase
1. Entra a https://supabase.com → **New project**. Anota la contraseña de la base.
2. Menú **SQL Editor** → **New query** → pega el contenido de `supabase/schema.sql` → **Run**.
3. Menú **Project Settings → API**: copia `Project URL` y la clave **`service_role`** (la secreta, no la `anon`).

### 2. GitHub
```bash
git init && git add . && git commit -m "Supply Mining IA: scaffold inicial"
# crea el repo en github.com y luego:
git remote add origin https://github.com/<tu-usuario>/supply-mining-ia.git
git push -u origin main
```

### 3. Vercel
1. https://vercel.com → **Add New → Project** → importa el repo de GitHub.
2. **Environment Variables**: copia las de `.env.example` con tus valores reales:
   - `AI_DEFAULT_PROVIDER` = `anthropic` o `openai`
   - `ANTHROPIC_API_KEY` y/o `OPENAI_API_KEY`
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
   - `REVIEW_TOKEN` (déjalo vacío mientras solo valides tú y la app no sea pública)
3. **Deploy**. Vercel detecta `/api/*` como funciones y sirve `public/` como el sitio.

### 4. Probar
Abre tu URL de Vercel, escribe una necesidad (ej. *alquiler de camionetas 4x4 para minería*), elige Claude o ChatGPT, y pulsa **Buscar**. Envía candidatos a la cola y valídalos desde la pestaña **Cola de revisión**.

## Reglas de negocio (no cambian)
- Todo candidato de IA nace como **"Sugerencia IA (no verificada)"**.
- La IA tiene instrucción de **no inventar RUC ni dominios**.
- La IA clasifica cada candidato con la **taxonomía real del Maestro** (14 familias y sus categorías, en `lib/ai.js`).
- El flujo es: candidato → cola de revisión → validar RUC en SUNAT + evidencia en web propia → **al validar, pasa a la tabla `proveedores`** (upsert por RUC).

## Tablas
- `candidatos_revision` — cola de sugerencias de IA pendientes de validar.
- `proveedores` — maestro oficial; se llena al validar un candidato.

## Siguientes pasos sugeridos
- Sincronizar `proveedores` con el Maestro Excel (import/export) o usarla como fuente única.
- Cambiar el token simple por **Supabase Auth** cuando haya más de un validador.
- Mantener la taxonomía de `lib/ai.js` alineada con la del Maestro cuando cambie.
