/**
 * NEXI ONE — Archivage mensuel des résultats de défis vers Google Sheets
 *
 * MISE EN PLACE (une seule fois, ~10 min) :
 *  1. Aller sur https://script.new (connecté à VOTRE compte Google), coller ce code.
 *  2. Paramètres du projet (roue crantée) > Propriétés du script > ajouter :
 *       SUPABASE_URL       = https://VOTRE-PROJET.supabase.co
 *       SUPABASE_ANON_KEY  = votre clé anon (celle déjà utilisée par l'application)
 *       EXPORT_SECRET      = le secret affiché par le patch SQL "export-sheets"
 *     (ne PAS ajouter AUTO_ALLEGER pour l'instant : voir plus bas)
 *  3. Exécuter  testerConnexion  (Google demande l'autorisation : acceptez).
 *  4. Exécuter  archiverPeriode('AAAA-MM')  sur un mois terminé, ex. '2026-09'.
 *     Ouvrez le classeur créé (lien dans le journal d'exécution) et contrôlez.
 *  5. Si tout est bon : exécuter  allegerPeriode('AAAA-MM').
 *  6. Exécuter  installerDeclencheurMensuel  (archive le mois précédent le 2 de
 *     chaque mois, vers 3 h).
 *  7. Quand vous avez confiance : ajouter la propriété AUTO_ALLEGER = oui pour
 *     que l'allègement suive automatiquement une archive vérifiée.
 *
 * SÉCURITÉ : on n'archive que des mois révolus ; rien n'est vidé tant que le
 * nombre de lignes et le total des scores écrits dans Sheets ne correspondent
 * pas exactement à ceux de la base. Aucune ligne n'est jamais supprimée.
 * Les exports contiennent l'identifiant et la classe (pas le nom complet) :
 * ne partagez pas ces classeurs (données d'élèves).
 */

const TYPE = 'defi_resultats';
const COLS = ['resultat_id', 'eleve_id', 'identifiant', 'classe', 'defi_id', 'defi_titre',
              'date_passage', 'score_total', 'score_par_categorie', 'reponses'];
const PAGE = 1000;

function cfg_() {
  const p = PropertiesService.getScriptProperties();
  const c = {
    url: (p.getProperty('SUPABASE_URL') || '').replace(/\/+$/, ''),
    key: p.getProperty('SUPABASE_ANON_KEY'),
    secret: p.getProperty('EXPORT_SECRET'),
    auto: p.getProperty('AUTO_ALLEGER') === 'oui'
  };
  if (!c.url || !c.key || !c.secret) {
    throw new Error('Propriétés manquantes : SUPABASE_URL, SUPABASE_ANON_KEY, EXPORT_SECRET');
  }
  return c;
}

function rpc_(name, body) {
  const c = cfg_();
  const headers = { apikey: c.key };
  if (c.key.indexOf('eyJ') === 0) headers.Authorization = 'Bearer ' + c.key; // clé anon au format JWT
  const res = UrlFetchApp.fetch(c.url + '/rest/v1/rpc/' + name, {
    method: 'post',
    contentType: 'application/json',
    headers: headers,
    payload: JSON.stringify(Object.assign({ p_secret: c.secret }, body)),
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error(name + ' : HTTP ' + code + ' — ' + res.getContentText());
  }
  return JSON.parse(res.getContentText());
}

function getClasseur_(annee) {
  const props = PropertiesService.getScriptProperties();
  const cle = 'SS_' + annee;
  const id = props.getProperty(cle);
  if (id) return SpreadsheetApp.openById(id);   // si inaccessible : erreur volontaire (pas de classeur "fantôme")
  const ss = SpreadsheetApp.create('NEXI ONE — Archives ' + annee);
  props.setProperty(cle, ss.getId());
  return ss;
}

// Ne détruit jamais un onglet existant : crée "nom", puis "nom #2", etc.
function nouvelOnglet_(ss, base) {
  let nom = base, n = 1;
  while (ss.getSheetByName(nom)) { n++; nom = base + ' #' + n; }
  const feuilles = ss.getSheets();
  if (feuilles.length === 1 && feuilles[0].getLastRow() === 0 && nom === base) {
    feuilles[0].setName(nom);
    return feuilles[0];
  }
  return ss.insertSheet(nom);
}

function testerConnexion() {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  const periode = Utilities.formatDate(d, 'UTC', 'yyyy-MM');
  const info = rpc_('export_compter', { p_type: TYPE, p_periode: periode });
  Logger.log('Connexion OK. Mois ' + periode + ' : ' + JSON.stringify(info));
}

// Déclenché automatiquement chaque mois (voir installerDeclencheurMensuel)
function archiverMoisPrecedent() {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  archiverPeriode(Utilities.formatDate(d, 'UTC', 'yyyy-MM'));
}

function archiverPeriode(periode) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const c = cfg_();
    const info = rpc_('export_compter', { p_type: TYPE, p_periode: periode });
    if (!info.nb) {
      Logger.log(periode + ' : rien à archiver.');
      return;
    }
    if (info.statut === 'verifie') {
      Logger.log(periode + ' : déjà exporté et vérifié, en attente d\'allègement.');
      if (c.auto) allegerPeriode(periode);
      return;
    }

    // 1) Lecture paginée depuis la base
    const lignes = [];
    for (let off = 0; ; off += PAGE) {
      const page = rpc_('export_lire_periode', { p_type: TYPE, p_periode: periode, p_limit: PAGE, p_offset: off });
      page.forEach(function (r) {
        lignes.push(COLS.map(function (col) {
          const v = r[col];
          return (v !== null && typeof v === 'object') ? JSON.stringify(v) : v;
        }));
      });
      if (page.length < PAGE) break;
    }

    // 2) Écriture dans le classeur de l'année (un onglet par mois)
    const ss = getClasseur_(periode.substring(0, 4));
    const feuille = nouvelOnglet_(ss, TYPE + ' ' + periode);
    feuille.getRange(1, 1, 1, COLS.length).setValues([COLS]).setFontWeight('bold');
    const CHUNK = 5000;
    for (let i = 0; i < lignes.length; i += CHUNK) {
      const bloc = lignes.slice(i, i + CHUNK);
      feuille.getRange(2 + i, 1, bloc.length, COLS.length).setValues(bloc);
    }
    feuille.setFrozenRows(1);
    SpreadsheetApp.flush();

    // 3) Relecture de ce qui est RÉELLEMENT dans la feuille
    const n = feuille.getLastRow() - 1;
    const colScore = COLS.indexOf('score_total') + 1;
    const somme = feuille.getRange(2, colScore, n, 1).getValues()
      .reduce(function (s, r) { return s + Number(r[0]); }, 0);
    const total = Math.round(somme * 1000) / 1000;

    // 4) La base compare avec ses propres chiffres (exception si écart)
    const chemin = ss.getUrl() + '#gid=' + feuille.getSheetId();
    rpc_('export_confirmer', { p_type: TYPE, p_periode: periode, p_nb: n, p_total: total, p_chemin: chemin });
    Logger.log(periode + ' : ' + n + ' lignes archivées et vérifiées → ' + chemin);

    // 5) Allègement seulement si activé
    if (c.auto) {
      allegerPeriode(periode);
    } else {
      Logger.log('Allègement non lancé (AUTO_ALLEGER absent). Après contrôle : allegerPeriode(\'' + periode + '\')');
    }
  } finally {
    lock.releaseLock();
  }
}

function allegerPeriode(periode) {
  const res = rpc_('export_alleger', { p_type: TYPE, p_periode: periode });
  Logger.log('Allègement ' + periode + ' : ' + res.lignes_allegees + ' ligne(s) allégée(s).');
}

function installerDeclencheurMensuel() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'archiverMoisPrecedent'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('archiverMoisPrecedent').timeBased().onMonthDay(2).atHour(3).create();
  Logger.log('Déclencheur mensuel installé (le 2 de chaque mois, vers 3 h).');
}
