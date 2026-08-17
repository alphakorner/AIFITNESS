/* =============================================================================
   gemini-proxy.js  —  Worker Cloudflare  ·  ZYRA PROTOCOL  v74
   @ By Brice Jct · Alpha OS · Groupe Alpha Nex Strasbourg
   -----------------------------------------------------------------------------
   ROLE
     Relais entre l'application (navigateur) et l'API Gemini de Google.
     La cle API ne quitte JAMAIS Cloudflare : elle vit dans env.GEMINI_KEY
     (secret chiffre), elle n'est jamais renvoyee au navigateur.

   CE QUE CA REGLE
     - La cle n'est plus lisible dans le bundle public (cause de la suspension
       du projet 673525672115).
     - Les prompts restent cote client pour l'instant ; etape suivante possible.

   ROUTES
     GET  /                                   -> health check JSON
     POST /{model}:generateContent            -> relais standard
     POST /{model}:streamGenerateContent      -> relais SSE (streaming)

     Le chemin est volontairement identique a celui de Google : cote client il
     suffit de remplacer la base d'URL, aucune autre modification.

   SECRET A POSER (une seule fois) :
     wrangler secret put GEMINI_KEY
     ...ou via le dashboard : Settings > Variables and Secrets > Add > Secret

   VARIABLE OPTIONNELLE (texte, pas secret) :
     ALLOWED_ORIGINS = "https://aifitness.alpha-korner.com,http://localhost:8080"
   ========================================================================== */

const GOOGLE = "https://generativelanguage.googleapis.com/v1beta/models";

/* Origines autorisees par defaut. Surchargeable par la variable ALLOWED_ORIGINS. */
const DEFAULT_ORIGINS = [
  "https://aifitness.alpha-korner.com",
  "https://alphakorner.github.io"
];

/* Allowlist de modeles : empeche qu'un tiers qui trouve l'URL du Worker
   consomme ton quota sur des modeles couteux (pro, deep-research, video...).
   Verifie le 17/08/2026 sur le projet 125153695506 : ces modeles repondent 200. */
const MODELES_AUTORISES = new Set([
  "gemini-3.6-flash",
  "gemini-3.7-flash",
  "gemini-3.5-flash",
  "gemini-3-flash-preview",
  "gemini-flash-latest",
  "gemini-3.1-flash-tts-preview"
]);

/* Rate-limit souple, par IP, en memoire d'isolate.
   NOTE HONNETE : Cloudflare fait tourner plusieurs isolates ; ce compteur n'est
   donc PAS un quota global exact. Il coupe les boucles folles et les scripts
   basiques, pas une attaque distribuee. Pour un vrai quota il faut KV ou
   Durable Objects — a faire plus tard si le trafic le justifie. */
const FENETRE_MS = 60_000;
const MAX_PAR_MINUTE = 30;
const compteur = new Map();

function limiteAtteinte(ip) {
  const now = Date.now();
  const e = compteur.get(ip);
  if (!e || now > e.reset) {
    compteur.set(ip, { n: 1, reset: now + FENETRE_MS });
    return false;
  }
  e.n++;
  if (compteur.size > 5000) compteur.clear(); // garde-fou memoire
  return e.n > MAX_PAR_MINUTE;
}

function origineOk(origin, env) {
  const liste = (env.ALLOWED_ORIGINS || "")
    .split(",").map(s => s.trim()).filter(Boolean);
  const autorisees = liste.length ? liste : DEFAULT_ORIGINS;
  return origin && autorisees.includes(origin);
}

function enTetesCors(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function json(obj, status, origin) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...enTetesCors(origin || "*") }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";

    /* ---- Preflight CORS ---- */
    if (request.method === "OPTIONS") {
      if (!origineOk(origin, env)) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: enTetesCors(origin) });
    }

    /* ---- Health check : permet de verifier que le Worker vit ---- */
    if (request.method === "GET" && url.pathname === "/") {
      return json({
        ok: true,
        service: "zyra-gemini-proxy",
        version: "v74",
        cleConfiguree: Boolean(env.GEMINI_KEY),   // true/false, jamais la valeur
        modeles: [...MODELES_AUTORISES]
      }, 200, "*");
    }

    if (request.method !== "POST") {
      return json({ error: "Methode non autorisee" }, 405, origin || "*");
    }

    /* ---- Verrou d'origine : seul ton site peut consommer le Worker ---- */
    if (!origineOk(origin, env)) {
      return json({ error: "Origine non autorisee", origin }, 403, "*");
    }

    /* ---- Secret present ? ---- */
    if (!env.GEMINI_KEY) {
      return json({
        error: "GEMINI_KEY absent du Worker",
        aide: "wrangler secret put GEMINI_KEY  (ou dashboard > Variables and Secrets)"
      }, 500, origin);
    }

    /* ---- Rate-limit ---- */
    const ip = request.headers.get("CF-Connecting-IP") || "0.0.0.0";
    if (limiteAtteinte(ip)) {
      return json({
        error: "Trop de requetes",
        detail: `Limite ${MAX_PAR_MINUTE}/min atteinte. Reessaie dans une minute.`
      }, 429, origin);
    }

    /* ---- Analyse du chemin : /{model}:{methode} ---- */
    const chemin = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    const sep = chemin.lastIndexOf(":");
    if (sep < 1) {
      return json({
        error: "Chemin invalide",
        attendu: "/{modele}:generateContent ou /{modele}:streamGenerateContent"
      }, 400, origin);
    }
    const modele = chemin.slice(0, sep).replace(/^models\//, "");
    const methode = chemin.slice(sep + 1);

    if (!MODELES_AUTORISES.has(modele)) {
      return json({
        error: "Modele non autorise",
        modele,
        autorises: [...MODELES_AUTORISES]
      }, 400, origin);
    }
    if (methode !== "generateContent" && methode !== "streamGenerateContent") {
      return json({ error: "Methode Gemini non autorisee", methode }, 400, origin);
    }

    /* ---- Relais vers Google ---- */
    const cible = `${GOOGLE}/${modele}:${methode}${url.search || ""}`;
    let amont;
    try {
      amont = await fetch(cible, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": env.GEMINI_KEY      // <-- la cle reste ici
        },
        body: request.body,
        // @ts-ignore — requis par Cloudflare pour streamer un corps de requete
        duplex: "half"
      });
    } catch (e) {
      return json({ error: "Google injoignable", detail: String(e) }, 502, origin);
    }

    /* Streaming SSE : on renvoie le flux tel quel, sans le bufferiser. */
    const ct = amont.headers.get("Content-Type") || "application/json";
    const h = new Headers(enTetesCors(origin));
    h.set("Content-Type", ct);
    if (methode === "streamGenerateContent") {
      h.set("Cache-Control", "no-cache");
      h.set("Connection", "keep-alive");
    }

    /* On preserve le code HTTP de Google (401 / 403 / 404 / 429 / 503).
       C'est ce qui permet a l'app d'afficher la VRAIE cause au lieu du
       message generique "trop de demandes" qui t'a coute deux semaines. */
    return new Response(amont.body, { status: amont.status, headers: h });
  }
};
