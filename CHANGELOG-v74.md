# ZYRA PROTOCOL — v74
`@ By Brice Jct · Alpha OS · Groupe Alpha Nex Strasbourg` · 17/08/2026

## Pourquoi l'app était morte : 4 causes indépendantes

| # | Cause | Preuve mesurée | Correctif |
|---|---|---|---|
| 1 | Projet Google suspendu | `403 CONSUMER_SUSPENDED` sur `projects/673525672115` | nouveau projet `zyra-protocol` (`125153695506`) |
| 2 | Clé publique dans le bundle | extraite en 1 `grep` depuis l'extérieur | clé déplacée dans le secret Worker |
| 3 | Modèles 2.x supprimés | `404 no longer available to new users` | `gemini-3.6/3.7/3.5-flash` |
| 4 | Thinking tokens | `finishReason: MAX_TOKENS`, 406 pensée / 132 sortie | plancher `maxOutputTokens: 3000` |

Chacune seule suffisait à tout casser.

---

## Modifications — `index.html` (116 lignes, 18 zones)

**P1** · `GEMINI_API_KEY = ""` — clé purgée. Ajout `WORKER_IA_DEFAUT`, `baseIA()`, `enTetesIA()`.
**P2** · `TTS_MODELE` → `gemini-3.1-flash-tts-preview` (l'ancien renvoyait `400 INVALID_ARGUMENT`).
**P3** · `ttsGemini()` → `enTetesIA()`. Il utilisait la constante en dur et ignorait `APIConfig`.
**P4** · `streamEndpointFor()` → `baseIA()`.
**P5** · `geminiStream()` → `enTetesIA()`.
**P6** · `geminiFetch()` → `enTetesIA()` + plancher 3000 tokens + `err.statut` / `err.corps` propagés.
**P7** · `msgErreurIA()` — 401/403/404/429/5xx/timeout distincts. Remplace `ERR_ANALYSE` (1×) et `ERR_CHAT` (2×).
**P8** · Retrait « 1ʳᵉ app au monde » et « Créateur agréé Anthropic » (aucun appel Anthropic dans le code ; risque art. L121-2 Code conso).
**P9** · `APIConfig._DEFAULT` → `mode: "worker"`, `apiKey: ""`.

## Supabase `app_config.gemini_api`
```
AVANT : {"mode":"direct","apiKey":"AQ.Ab8RN6Li…","workerUrl":""}
APRÈS : {"mode":"worker","apiKey":"","workerUrl":"https://zyra-protocol-worker.yanisbghdata.workers.dev"}
```
Nécessaire : cette ligne écrase le localStorage de tous les clients sous 5 s. Sans elle, v74 serait repassé en mode direct sur une clé vide.

## Nouveau fichier — `gemini-proxy.js`
Worker Cloudflare déjà déployé sur `zyra-protocol-worker.yanisbghdata.workers.dev`.
Clé en `env.GEMINI_KEY` · CORS verrouillé · allowlist de modèles · 30 req/min/IP · codes HTTP Google préservés.

---

## Validation

```
node --check          2/2 blocs JS inline valides
balises HTML          identiques à v73 (aucune régression)
clé morte             0 occurrence
clé neuve             0 occurrence dans le bundle
```

**Tests end-to-end à travers le Worker (17/08/2026)**

| Test | Résultat |
|---|---|
| texte | 200 · « V74 PRET » |
| analyse corporelle `ba1-avant.jpg` | 200 · JSON complet, `finishReason: STOP` |
| streaming SSE | 200 · flux `data:` propre |
| TTS | 200 · PCM 24 kHz, 212 Ko |
| CORS origine pirate | **403 bloqué** |
| modèle hors allowlist | **refusé** |
| clé envoyée par le navigateur | **aucune** |

---

## Déploiement
Déposer les 9 fichiers à la racine du dépôt GitHub Pages. Vider le cache du Service Worker (`sw.js` sert l'ancien `index.html`) : recharge forcée ou désinstallation de la PWA.

## Reste à faire
- Régénérer la clé Gemini (celle-ci a transité par un chat) → remplacer le secret Cloudflare, **rien d'autre à redéployer**.
- Worker hébergé sur le compte Cloudflare de Yanis, pas le tien.
- Rate-limit en mémoire d'isolate : coupe les boucles, pas une attaque distribuée. KV ou Durable Objects si le trafic monte.
- RLS Supabase à revoir avant tout vrai client.
