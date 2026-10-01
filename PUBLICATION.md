# NEXI ONE — publier en une fois

Ce dossier est le projet **complet et à jour** : il remplace votre version actuelle.
Rien à réécrire, rien à fusionner. Suivez les étapes dans l'ordre.

---

## Étape 0 — Avant de publier (2 min)

1. **Mot de passe admin.** Le mot de passe d'origine (`NexiAdmin2026!`) est écrit dans
   le README et dans `schema.sql`. S'il n'a pas encore été changé : connectez-vous à
   l'admin → **Réglages** → changez-le.
2. `js/config.js` contient déjà l'URL et la clé de votre projet Supabase : **ne rien changer**.
   (Optionnel : renseignez `SITE_URL` avec le lien de votre site Nexi Academy ; tant qu'il
   est vide, le bouton « Visiter le site » reste caché au lieu de pointer vers une fausse adresse.)

## Étape 1 — Publier le site

- **Si le site est déjà hébergé** (Netlify, Vercel, GitHub Pages…) : republiez ce dossier
  **au même endroit** (même projet), en remplaçant les fichiers.
- **Sinon, le plus simple :** dézippez, puis glissez le dossier `nexi-one` sur
  https://app.netlify.com/drop (gratuit). Autres options : voir `README.md`, section 4.

## Étape 2 — Mettre à jour la base (SQL, une seule fois, APRÈS l'étape 1)

1. Supabase → **SQL Editor** → **New query**.
2. Copiez **tout** le contenu de `supabase/patch-FINAL-2026-10-01.sql` → **Run**.
3. Le dernier résultat affiché (`secret_export`) est votre **secret d'export** :
   copiez-le quelque part (il servira à l'étape 5).

⚠️ Ne relancez **pas** `schema.sql` : il sert de référence, vos tables existent déjà.
Le fichier FINAL, lui, peut être relancé sans risque (il ne casse rien et conserve le secret).
Il ne modifie ni vos tables, ni vos fonctions existantes, ni vos données.

## Étape 3 — Vérifier (5 min)

1. Ouvrez le site en **navigation privée** (évite tout ancien cache).
2. Admin (5 tapotements rapides sur le logo) → onglet **Diagnostic** :
   - la carte **« Espace de la base »** s'affiche avec un pourcentage ;
   - cliquez **Lancer le diagnostic** : tout doit être « OK ».
3. Admin → Défis → Questions : ajoutez une question, puis jouez-la côté élève : elle doit s'afficher.
4. Côté élève : changez la photo de profil, puis Supabase → **Storage → avatars** :
   le fichier `<identifiant>/avatar` doit faire **moins de 100 Ko**.

## Étape 4 — Anti-pause (10 min, gratuit)

L'offre gratuite met le projet en pause après ~7 jours sans activité (vacances scolaires !).
Sur https://cron-job.org (gratuit) créez une tâche **toutes les 3 jours** :

- URL : `https://ncolccsqhudlervrhwbm.supabase.co/rest/v1/rpc/rpc_ping`
- Méthode : **POST** — Corps : `{}`
- En-têtes : `apikey: <la clé de js/config.js>` et `Content-Type: application/json`

Vérifiez après une semaine que le projet est resté actif.

## Étape 5 — Archivage vers Google Sheets (optionnel, 15 min)

À mettre en place quand vous voulez, idéalement avant que la base atteigne ~150 Mo.
Mode d'emploi complet dans l'en-tête de `google-sheets/archivage-sheets.gs`.
Les 3 valeurs à renseigner : l'URL du projet et la clé (toutes deux dans `js/config.js`),
et le secret de l'étape 2. **Premier essai sur vos données de test, allègement manuel.**

---

## Ce qui a changé dans ce dossier

| Fichier | Changement |
|---|---|
| `js/admin.js` | Jauge d'espace dans Diagnostic ; options des questions envoyées en vrai tableau (cause de l'erreur « opts.map ») ; message de suppression d'un défi (supprimer efface aussi les résultats). |
| `js/eleve.js` | Sécurité : accepte aussi des options reçues en texte JSON. |
| `js/sync.js` | Photos de profil : recadrées, converties en WebP (≈ 100 Ko max), écrasent l'ancienne au lieu de s'accumuler. |
| `service-worker.js` | Version de cache `v4` (force le renouvellement chez les utilisateurs). |
| `index.html` | Le lien « Visiter le site » n'apparaît que si `SITE_URL` est renseigné. |
| `supabase/patch-FINAL-2026-10-01.sql` | Export Google Sheets, jauge d'espace, anti-pause, plafond de 200 Ko par photo. |

## Limites à connaître

- Les nouveaux fichiers ont été vérifiés (syntaxe, et tests simulés de la jauge et des options),
  mais **pas exécutés sur votre projet réel** : l'étape 3 sert à le confirmer.
- Le SQL n'a pas pu être testé sur une vraie base PostgreSQL de mon côté : il est écrit à partir
  de votre `schema.sql`. S'il affiche une erreur, copiez-la-moi telle quelle.
- Les anciennes photos de test restent dans Storage : supprimez-les depuis l'interface Supabase.
