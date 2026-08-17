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

---

# v74.1 — Blindage anti-traduction

## Diagnostic
Trois « bugs » signalés — onglet « RAPPORT », titre « TERRAIN DE CHOISIS TON. », fond blanc dans le chat — **n'existaient pas dans le code**. Vérifié dans la source :

```html
<button ... id="tab-login">Connexion</button>     <!-- correct -->
<b>Choisis ton terrain.</b>                        <!-- correct -->
```

Cause réelle : **la traduction automatique de Chrome**. Elle prenait la page française pour de l'anglais.
- « Connexion » → lu comme le mot anglais *connexion* → rendu **« Rapport »**
- « Choisis ton terrain. » → non reconnu → **réordonné** en ordre anglais
- Réécriture des nœuds de texte → perte du thème sombre → **fond blanc dans le chat**

Signature : un traducteur ne réordonne jamais une phrase qu'il comprend.

## Correctifs
**P10a** · `<html lang="fr" translate="no" class="notranslate">`
**P10b** · `<meta name="google" content="notranslate">` + `<meta http-equiv="content-language" content="fr">`
**P11** · Onglet `Connexion` → `Se connecter` (choix de libellé, pas un bug)

`<b>Choisis ton terrain.</b>` **non modifié** — déjà correct, il sera simplement affiché tel quel.

## Validation
```
node --check    2/2 blocs JS valides
balises HTML    identiques à v73/v74
clés            0 occurrence
```

## Déploiement
Remplacer `index.html`. **Recharge forcée obligatoire** — le Service Worker sert l'ancienne version en cache.

---

# v74.2 — Résilience 429 / 503

## Diagnostic
Un utilisateur iPhone reçoit `Code 503 — panne côté service IA`. **Ce n'est ni l'iPhone ni le code.**

Le même 503 a été reproduit depuis un serveur Linux, hors iPhone, hors navigateur. Message brut de Google :
```json
{"code":503,"status":"UNAVAILABLE",
 "message":"This model is currently experiencing high demand.
            Spikes in demand are usually temporary."}
```

Mesures en direct (3 tirs par modèle) :
```
gemini-3.6-flash        200 429 429
gemini-3.7-flash        200 200 200
gemini-3.5-flash        200 503 200
gemini-3-flash-preview  200 200 200
gemini-flash-latest     200 200 200
```

Deux causes distinctes :
- **503** — surcharge temporaire du modèle chez Google
- **429** — quota du palier gratuit : `limit: 20` requêtes/minute

Sur une analyse photo (charge lourde), 3.7 et 3.5 ont renvoyé 503 simultanément → cascade épuisée → écran d'erreur.

## Correctifs
**P12** · Cascade élargie de 3 à 5 modèles (`+ gemini-3-flash-preview`, `+ gemini-flash-latest`) — tous déjà dans l'allowlist du Worker.
**P13a** · 3 essais par modèle au lieu de 2.
**P13b** · Backoff exponentiel + jitter : `600 × 2^n + random(400)` ms. Le jitter évite que deux clients frappés par le même pic réessaient en phase.

Surface totale : 3×2 = 6 tentatives → **5×3 = 15**.

## Simulation (200 000 tirages sur les taux d'échec mesurés)
```
v74    3 modèles × 2 essais   99.871 %
v74.2  5 modèles × 3 essais  100.000 %
```

## Limite non corrigeable par le code
Le palier gratuit plafonne à **20 requêtes/minute pour tout le projet**, tous utilisateurs confondus. Aucune cascade ne contourne ça. Avant toute mise en avant par Yanis BGH, activer la facturation sur le projet `zyra-protocol` — sinon les 429 seront systématiques dès quelques utilisateurs simultanés.

## Validation
```
node --check    2/2 blocs JS valides
allowlist       5/5 modèles autorisés par le Worker
```

---

# v74.3 — Le vrai plafond, et libération du cadre photo

## ⚠️ Découverte décisive : le quota est PAR JOUR, pas par minute

Détail brut renvoyé par Google :
```json
{"quotaId": "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
 "quotaValue": "20",
 "quotaDimensions": {"model": "gemini-3.6-flash"}}
```

**20 requêtes par JOUR, par modèle, pour tout le projet — tous utilisateurs confondus.**

Le v74.2 annonçait 20/minute. C'était faux : je l'ai corrigé après lecture du champ `quotaId`.

Plafond absolu du palier gratuit : **5 modèles × 20 = 100 analyses par jour**, réparties sur tous les utilisateurs. Aucun code ne franchit ça.

## Mesure — deux analyses photo consécutives
```
Analyse 1   3.6 → 429 | 3.7 → 503 | 3.5 → 200 ✅
Analyse 2   3.6 → 429 | 3.7 → 429 | 3.5 → 200 ✅
```
Le site en production tournait **encore en v74** (3 modèles, 2 essais) : `gemini-3.5-flash` répondait dans les deux cas, mais n'était pas atteint. **v74.2 n'avait pas été déployée.**

## Correctifs
**P14** · Sur 429, passage immédiat au modèle suivant. Réessayer le même modèle est inutile : un quota journalier ne se recharge pas en trois secondes. Le 503 (surcharge ponctuelle) reste réessayable avec backoff.
**P15** · Message 429 explicite : quota quotidien, 20/jour/modèle, activer la facturation.
**P16** · `libererCadrePhoto()` — le cadre revient à l'état « ajoute ta photo » après une analyse **réussie**. Compte rendu et exercices restent affichés. `file.value = ""` inclus, sinon rechoisir le même fichier ne déclenche pas l'événement `change`.
  → Sur **erreur**, la photo est conservée : sans elle, « Relancer l'analyse » n'aurait plus rien à renvoyer.

## Validation
```
node --check     2/2 blocs JS valides
balises HTML     identiques à v73
13/13 contrôles  ✅
```

## Ce qui reste hors du code
Activer la facturation sur le projet `zyra-protocol` (n° 125153695506). Sans cela, l'app est plafonnée à ~100 analyses/jour tous utilisateurs confondus, et les 429 sont inévitables — y compris pendant les démonstrations.
