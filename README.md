# NEXI ONE — guide de déploiement (v2)

PWA gamifiée pour Nexi Academy (Nexi Studio). Frontend 100 % statique
(HTML/CSS/JS vanilla, aucun build), backend Supabase (Postgres + RPC
d'authentification + Storage). Pensée pour des **écoles de plusieurs
centaines d'élèves** : voir la section 9 pour ce qui a été optimisé.

---

## 1. Créer le projet Supabase (pas à pas)

1. Allez sur **https://supabase.com** → connectez-vous → **New project**.
2. Choisissez un nom (ex. `nexi-one`), une région proche de vos écoles
   (Europe si vous ciblez la RDC — meilleure latence que les régions US),
   et un mot de passe de base de données (à conserver de côté, il ne sert
   qu'à l'administration Supabase, pas à l'application).
3. Attendez ~2 minutes que le projet soit prêt (statut "Active").
4. Dans le menu de gauche, cliquez sur **SQL Editor** → **New query**.
5. Ouvrez le fichier `supabase/schema.sql` de ce projet, copiez **tout**
   son contenu, collez-le dans l'éditeur SQL, puis cliquez **Run**
   (ou `Ctrl/Cmd + Entrée`).
   - Cela crée toutes les tables, les règles de sécurité (RLS) et les
     fonctions. Vous devriez voir "Success. No rows returned".
   - Si une erreur apparaît, relisez le message : la cause la plus
     fréquente est un collage partiel (le fichier fait plus de 650
     lignes, assurez-vous de tout copier).
6. Un **compte administrateur** est créé automatiquement :
   - identifiant : `admin`
   - mot de passe : `NexiAdmin2026!`
   ⚠️ **Changez ce mot de passe dès votre première connexion** (panel
   Admin → onglet **Réglages**). Il donne un accès total.
7. Le bucket Storage `avatars` (photos de profil) est créé **automatiquement
   par `schema.sql`** à l'étape 5 — vous pouvez le vérifier dans **Storage**
   dans le menu de gauche : un bucket `avatars` marqué "Public" doit déjà
   apparaître. Aucune action manuelle n'est nécessaire ici.
8. Dans le menu de gauche, allez dans **Project Settings** (icône
   engrenage) → **API**. Vous y trouverez deux valeurs à copier :
   - **Project URL** (ressemble à `https://abcdefgh.supabase.co`)
   - **anon public** key (une longue chaîne commençant par `eyJ...`)

   Cette clé `anon` est **publique par conception** — elle sera visible
   dans le code source de votre site, comme sur n'importe quelle
   application Supabase/Firebase grand public. Ce n'est pas un problème :
   le fichier `schema.sql` désactive tout accès direct aux tables
   sensibles (élèves, mots de passe, bonnes réponses...) et n'autorise
   que des fonctions précises, vérifiées une par une (voir section 8).

## 2. Configurer le frontend

Ouvrez `js/config.js` dans VS Code et remplacez les deux premières lignes :
```js
SUPABASE_URL: "https://VOTRE-PROJET.supabase.co",
SUPABASE_ANON_KEY: "VOTRE_CLE_ANON_PUBLIQUE",
```
par les valeurs copiées à l'étape 1.8. Sauvegardez.

(Optionnel) Renseignez aussi `SITE_URL` avec le lien de votre site vitrine
Nexi Academy si vous voulez qu'il apparaisse dans le bouton "À propos" de
la page d'accueil (`index.html`, section 3 de l'écran empilé).

## 3. Tester en local avant de déployer

Aucune étape de build n'est nécessaire (pas de `npm install`, pas de
bundler). Depuis VS Code, deux options :
- **Extension "Live Server"** (clic droit sur `index.html` → *Open with
  Live Server*) ;
- ou en ligne de commande :
  ```bash
  npx serve .
  ```
  puis ouvrez l'URL affichée (ex. `http://localhost:3000`).

Suivez la checklist `test/checklist.md` pour vérifier que tout fonctionne
avant de déployer publiquement.

## 4. Déployer gratuitement

### Option A — Vercel (recommandé)
```bash
npm i -g vercel
vercel login
vercel --prod
```
Vercel détecte automatiquement un site statique : aucune configuration
serveur n'est nécessaire, le navigateur du visiteur parle directement à
Supabase.

### Option B — Netlify
Glissez-déposez le dossier `nexi-one/` sur **https://app.netlify.com/drop**.

### Option C — GitHub Pages
Poussez le dossier sur un dépôt GitHub, puis activez **Settings → Pages**
sur la branche `main`.

Dans les trois cas, une fois en ligne, **testez l'installation PWA** sur
un téléphone Android (Chrome affichera automatiquement la bannière
"Installer NEXI ONE" définie dans `js/sync.js`).

## 5. Accès administrateur secret

Sur la page d'accueil (`index.html`), **5 tapotements rapides sur le
logo** (moins de 2 secondes) ouvrent le panel admin (`admin.html`) —
aucun lien visible ne le révèle, et le formulaire de connexion public ne
mentionne jamais "élève" ni "superviseur" : le rôle est déterminé
automatiquement côté serveur au moment de la connexion
(`login_unified` dans `schema.sql`).

## 6. Structure du projet

```
nexi-one/
├── index.html            → accueil en "pages empilées" (clic = révèle, jamais de glissement)
│                            + connexion unique (aucune mention élève/superviseur)
├── eleve.html             → panel enfant (profil, défis, affinités, cartes, classement)
├── superviseur.html       → panel superviseur (élèves, statistiques, suggestion)
├── admin.html             → panel admin (accès secret, gestion complète + onglet Diagnostic)
├── manifest.json          → manifeste PWA
├── service-worker.js      → cache app-shell (installable, partiellement hors-ligne)
├── css/style.css          → design system (néon bleu / circuit) + NexiBot 3D + écran empilé
├── js/
│   ├── config.js           → clés Supabase + constantes (classes RDC, libellés RIASEC)
│   ├── supabaseClient.js    → instancie le client Supabase une seule fois
│   ├── auth.js                → connexion unifiée, session locale, trigger admin secret
│   ├── sync.js                  → installation PWA + upload de photo de profil
│   ├── nexibot.js                → mascotte en vraie 3D CSS (perspective + preserve-3d)
│   ├── gamify.js                  → confettis (canvas) + sons (Web Audio, sans fichier)
│   ├── eleve.js, superviseur.js, admin.js → logique de chaque panel (100 % via RPC)
├── supabase/
│   ├── schema.sql                          → schéma complet : tables, RLS, triggers, 30+ fonctions RPC
│   └── patch-2026-09-29-storage-et-droits.sql → correctif à exécuter si votre projet tourne déjà (voir section 10)
├── icons/                   → icônes PWA (générées depuis logo.png)
├── img/hero-bg.jpg           → visuel de la page d'accueil
└── test/checklist.md          → check-list de test de bout en bout
```

## 7. Format d'import en masse

**Défis (questions)** — dans le panel Admin → Défis → *Questions* d'un
défi → zone "Import en masse", une ligne par question :
```
Énoncé:option1;option2;option3;option4:1:catégorie:temps_secondes:explication
Combien font 2+2 ?:3;4;5;6:2:math:20:Deux plus deux égale quatre.
```
- Les options sont séparées par `;`.
- L'index des bonnes réponses est **en base 1** (`1` = la 1ère option),
  séparé par une virgule s'il y en a plusieurs (ex. `1,3`).
- Les champs "temps" et "explication" sont optionnels (30s par défaut).

**Affinités (RIASEC)** — panel Admin → Affinités :
```
Texte de la question:Dimension
J'aime réparer des objets mécaniques:R
```
Dimensions valides : `R` `I` `A` `S` `E` `C`.

**Cartes de révision** — panel Admin → Cartes :
```
Recto:Réponse:Explication:Classe:Catégorie
Capitale de la RDC ?:Kinshasa:Kinshasa est la capitale depuis 1966.:7EB:svt
```

Pour un import volumineux (centaines de lignes), préparez le texte dans
un tableur puis collez-le : chaque ligne devient une question/carte, sans
limite pratique de nombre de lignes.

## 8. Ce qui a été durci pour un usage réel, à grande échelle

Cette v2 corrige les points qu'une v1 "de démonstration" laisserait
ouverts si elle servait vraiment plusieurs centaines d'élèves :

- **Aucune table sensible n'est lisible directement.** `eleves`,
  `superviseurs`, `defi_questions` (qui contient les bonnes réponses),
  `defi_resultats`, `affinites_reponses` et `reglages` n'ont **aucune**
  règle RLS de lecture publique. Tout passe par des fonctions RPC
  `security definer` qui vérifient explicitement un jeton de session
  (`session_token`) ou le statut admin avant de renvoyer quoi que ce
  soit. Un élève ne peut donc pas ouvrir les outils réseau du navigateur
  et lire les bonnes réponses d'un défi avant de le jouer, ni voir le nom
  complet d'un autre élève dans le classement.
- **La correction des défis se fait entièrement côté serveur.**
  Le client envoie les choix de l'élève (`soumettre_defi`), jamais un
  score : la fonction SQL recalcule tout à partir des vraies bonnes
  réponses et renvoie le score ET le corrigé détaillé en une seule
  réponse. Impossible de falsifier un score depuis le navigateur.
- **Connexion unifiée.** Un seul formulaire identifiant + mot de passe ;
  `login_unified()` détermine le rôle côté base de données. L'interface
  publique ne révèle jamais qu'il existe un rôle "superviseur" distinct
  d'un élève. Un trigger empêche qu'un identifiant élève et un
  identifiant superviseur soient identiques (sinon la détection de rôle
  serait ambiguë).
- **Pagination partout où le volume peut grandir.** La liste des enfants
  côté admin (`admin_list_eleves`/`admin_count_eleves`) est paginée,
  filtrable par classe et par recherche texte — elle ne renverra jamais
  d'un coup les 3000 élèves de 10 écoles. Les classements
  (`rpc_classement`, `rpc_superviseur_classement`) sont calculés et
  triés **en SQL**, jamais en bouclant côté navigateur sur toutes les
  lignes de `defi_resultats`.
- **Index dédiés** sur `eleves(ecole_id, classe)`, `eleves(valide)`
  (partiel, pour retrouver vite les suggestions en attente),
  `defi_resultats(eleve_id)` et `(defi_id)`, `defi_questions(defi_id,
  ordre)`, `cartes_revision(classe)` (partiel sur les cartes visibles) et
  `affinites_reponses(eleve_id, date_passage)` — chaque requête des
  fonctions RPC ci-dessus s'appuie sur l'un de ces index, donc le temps
  de réponse reste stable même avec des milliers d'élèves au total.
- **NexiBot en vraie 3D CSS** (`perspective` + `transform-style:
  preserve-3d` + `translateZ` par face), pas une image plate ni une
  librairie 3D lourde (Three.js) : le rendu reste fluide sur les
  téléphones d'entrée de gamme utilisés dans les écoles pilotes, sans
  téléchargement supplémentaire.

## 9. Limites connues (V2), à surveiller si le projet grossit encore

- L'authentification reste un système **RPC custom** (pas Supabase Auth
  natif), nécessaire pour des identifiants non-email. Le jeton de
  session (`session_token`) n'expire pas automatiquement aujourd'hui —
  si vous voulez une expiration (ex. 24h), ajoutez une colonne
  `session_expires_at` et vérifiez-la dans chaque fonction `_check_*`.
- Les statistiques superviseur (`rpc_superviseur_stats`) recalculent une
  moyenne à la volée : très bien jusqu'à quelques milliers de résultats
  par école, au-delà envisagez une vue matérialisée rafraîchie chaque
  nuit (`refresh materialized view`).
- Les sons sont générés en direct (Web Audio API, aucun fichier) —
  volontairement discrets ; remplaçables par de vrais effets dans
  `js/gamify.js` si vous préférez.
- Import en masse : chaque ligne déclenche un appel réseau séquentiel.
  Pour des imports de plusieurs centaines de questions d'un coup,
  comptez quelques dizaines de secondes (pas de risque de blocage, juste
  un temps d'attente affiché par le bouton).

## 10. Dépannage — "j'ai tout connecté mais rien ne s'affiche"

Si vous avez déjà exécuté `schema.sql` et créé des élèves/défis/cartes,
**ne relancez pas `schema.sql` en entier** : les `create table` échoueraient
car les tables existent déjà, et le script s'arrêterait net sans corriger
quoi que ce soit derrière (c'est d'ailleurs une cause classique d'échecs en
cascade si ça vous est déjà arrivé).

À la place, dans **SQL Editor → New query**, copiez-collez le contenu de
`supabase/patch-2026-09-29-storage-et-droits.sql` et exécutez-le. Il ne
touche à aucune donnée existante et corrige trois choses précises :

1. **Photos de profil qui échouent toujours** ("Échec de l'envoi de la
   photo" malgré un bucket créé) : cocher **Public bucket** dans l'interface
   Supabase rend seulement la **lecture** publique — jamais l'écriture. Sans
   policy RLS explicite sur `storage.objects`, **tout upload est refusé par
   défaut**, bucket public ou non. Le patch ajoute les trois policies
   (lecture, upload, remplacement) qui manquaient.
2. **"Erreur de chargement" sur le profil ou les défis** : sur certains
   projets Supabase, les fonctions tout juste créées ne sont pas
   immédiatement exécutables par le rôle public, ou le cache de PostgREST
   n'a pas encore intégré les nouvelles fonctions. Le patch accorde
   explicitement les droits d'exécution et force `NOTIFY pgrst, 'reload
   schema'` pour un rechargement immédiat.
3. Une requête de vérification qui confirme que le bucket `avatars` existe
   bel et bien côté serveur.

**Ensuite, dans le panel Admin → onglet "Diagnostic"**, cliquez sur
*Lancer le diagnostic*. Il teste en direct, sur votre projet réel, chaque
lecture publique, chaque fonction RPC et l'upload Storage, et affiche le
message d'erreur exact renvoyé par Supabase pour tout ce qui échoue — bien
plus précis qu'un écran "Erreur de chargement" générique. Il vérifie aussi,
pour chaque classe qui a des élèves, qu'il existe au moins un défi publié
et une carte visible pour **cette classe précise** — la cause la plus
fréquente d'un "défi publié qui n'arrive jamais à l'enfant" est un code de
classe qui ne correspond pas au caractère près (ex. `4SC` importé en masse
avec un espace ou une casse différente ne matchera jamais `4SC`).

**Pendant les tests, videz le cache du navigateur après chaque mise à jour
de fichiers.** Le service worker sert désormais le réseau en priorité (v3),
mais un ancien service worker déjà installé depuis un test précédent peut
continuer à servir d'anciens fichiers : sur Chrome, ouvrez les outils de
développement → **Application → Service Workers → Unregister**, puis
rechargez la page.

Depuis cette mise à jour, chaque écran (profil, défis, cartes, classement,
envoi de photo) affiche désormais le **message d'erreur réel** renvoyé par
Supabase au lieu d'un texte générique — gardez la console du navigateur
ouverte (F12) pendant vos tests, chaque échec y est aussi journalisé en
détail.

## 11. Tests de bout en bout avant mise en production

Voir `test/checklist.md` pour la liste complète. Résumé :

- [ ] Connexion élève et superviseur via le **même** formulaire (aucun
      rôle affiché), redirection automatique vers le bon panel.
- [ ] Accès admin par les 5 tapotements sur le logo, changement du mot
      de passe par défaut.
- [ ] Import en masse d'un défi, passation par un élève, score et
      corrigé détaillé corrects, score visible dans son profil et le
      classement.
- [ ] Une seule passation d'affinités par jour ; message "déjà fait"
      le jour même.
- [ ] Suggestion d'élève par un superviseur → visible "en attente" côté
      admin → validation → l'élève peut se connecter.
- [ ] Pagination/recherche de la liste des enfants côté admin avec
      quelques dizaines d'entrées de test.
- [ ] Installation PWA sur mobile, ouverture en plein écran.
- [ ] Connexion avec le même identifiant sur **deux appareils
      différents** : mêmes données des deux côtés (aucune dépendance
      locale au téléphone).
