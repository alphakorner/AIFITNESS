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

---

# v74.4 — Délai borné + réponse plus rapide à qualité égale

## Mesure : la réflexion coûtait le double pour rien

Même photo, même prompt, `gemini-3-flash-preview` :

| | défaut | `thinkingLevel: "low"` |
|---|---|---|
| Latence | 9,2 s | **4,3 s** |
| Réflexion | 799 tokens | **0** |
| Sortie | 760 tokens | 765 |
| **Total** | 2 708 | **1 914** |
| Longueur réponse | 2 484 car. | **2 530 car.** |

**2× plus rapide, 29 % de tokens en moins, réponse légèrement plus longue.**

Contrôle qualité sur le format réel de l'app : 4 exercices, 4 steps et 4 tips chacun, `zone`, `summary`, `tips` globaux — **structure complète, 6,4 s**.

À savoir : sur les modèles 3.x, `thinkingBudget` renvoie un **400**. Seul `thinkingLevel` est accepté.

## Le problème de délai

`5 modèles × 3 essais × 20 s` = jusqu'à **5 minutes** de voile qui tourne, et `ANALYSE_MAX_S` était à **150 s**.

## Correctifs
**P17** · `normaliserReflexion(body, model)` — sur 3.x, force `thinkingLevel: "low"`. Les 2.5 restent intacts. Ne modifie jamais l'objet d'origine.
**P18** · Budget global de **35 s** sur toute la cascade. Délai par essai plafonné à **14 s** (mesure : 4 à 9 s), borné par le temps restant. Sortie anticipée dès qu'il reste moins de 2,5 s. Backoff plafonné à 1,8 s.
**P19** · `ANALYSE_MAX_S` : 150 → **40 s**.
**P20** · Même réflexion courte sur le streaming (chat, appel) — gain sur le premier mot affiché.

## Simulation du pire cas (logique réelle extraite du fichier)
```
cas nominal            4,3 s ✅
tout en 503           32,6 s
tout en 429            2,5 s
tout en timeout       35,0 s  ← plafond garanti
AVANT v74.4        jusqu'à 300 s
```

## Effet secondaire sur le quota
29 % de tokens en moins par analyse = 29 % de coût en moins une fois la facturation activée. Le nombre de **requêtes** reste identique : le plafond de 20/jour/modèle du palier gratuit n'est pas affecté.

## Validation
```
node --check    2/2 blocs JS valides
qualité         4 exercices · 4 steps · 4 tips · structure complète
```

---

# v74.5 — Menu de la landing + barres jaunes

## Le bug du menu : deux correctifs justes qui s'annulaient

**Cause exacte** — deux blocs corrects pris séparément :

1. Étape 0 du script landing : `#zl-menu` est **déplacé vers `<body>`**, parce que `.zl-landing` porte des `transform` (skew, scale) et qu'un ancêtre transformé casse `position: fixed`.
2. Étape 7 : `root.addEventListener("click", …)` avec `root = document.querySelector(".zl-landing")`.

**Le menu n'étant plus dans `root`, aucun clic ne remontait jusqu'à l'écouteur.** Ni défilement, ni fermeture — exactement le symptôme.

## Correctifs
**P21** · Écoute déplacée sur `document`, qui contient les deux arbres. Idem pour le `keydown`. Garde `if (!dest) return` conservé. Défilement décalé de 60 ms : `body.zl-lock` pose `overflow: hidden` et `window.scrollTo` reste sans effet tant que la classe n'est pas retirée.
**P22** · Trois barres obliques jaunes devant chaque onglet, même geste que le logo et `.zl-slash-band`. **Aucune balise ajoutée** : les trois `<i class="zl-deb">` existaient déjà (« poussières » de 3 px à 28 % d'opacité, invisibles) — elles sont repeintes. `::before` et `::after` de `.zl-vtab` étaient déjà pris par le voile et le balayage conique. Dégradé 100 / 62 / 34 %, allumage complet au survol.

## Vérifications
```
node --check          2/2 blocs JS valides
accolades CSS         2798/2798 · 22/22
ancres data-scroll    8/8 existent
contrôle global       13/13 ✅
```

## Sur le 503 à 32 secondes
Ce n'est pas une régression : **c'est le budget v74.4 qui a fonctionné**. La simulation annonçait 32,6 s pour « tout en 503 » — la mesure a donné 32 s.

État réel des modèles à ce moment-là :
```
gemini-3.6-flash        429 RESOURCE_EXHAUSTED
gemini-3.7-flash        429 RESOURCE_EXHAUSTED
gemini-3.5-flash        429 puis 503 (34,7 s)
gemini-3-flash-preview  200 OK (3,5 s / 2,3 s)
gemini-flash-latest     429 RESOURCE_EXHAUSTED
```

**4 modèles sur 5 avaient épuisé leur quota journalier de 20 requêtes.** Le code a fait son travail : il a cherché, il a abandonné à temps, il a affiché la vraie cause. Le quota reste le mur.
