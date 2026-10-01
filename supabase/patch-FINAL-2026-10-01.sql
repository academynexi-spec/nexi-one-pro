-- =========================================================
-- NEXI ONE — PATCH FINAL UNIQUE (archivage + jauge + anti-pause + plafond avatars)
-- À EXÉCUTER APRÈS la mise en ligne du nouveau site (voir PUBLICATION.md).
-- 100 % additif : crée de nouvelles fonctions, 1 table (archives_index) et
-- 1 réglage secret. Ne modifie AUCUNE table, fonction ou donnée existante.
-- Aucune donnée n'est touchée tant que l'archivage n'est pas lancé depuis
-- Google (et seul le détail "reponses" d'un mois archivé ET vérifié est vidé).
-- Annulation complète : supprimer les fonctions admin_db_*, export_*,
-- _export_valider, _check_export, rpc_ping, la table archives_index et la ligne
-- reglages 'export_auth'.
--
-- Contenu :
--   0-6  Export vers Google Sheets (registre, secret, lecture, confirmation, allègement)
--   7-8  Jauge d'espace et taille par table (onglet Diagnostic du panel admin)
--   9    rpc_ping (anti-pause, appelé par un cron externe)
--   10   Plafond de 200 Ko par fichier dans le bucket "avatars"
-- À exécuter dans Supabase > SQL Editor. Le SECRET s'affiche en dernier résultat.
-- =========================================================

-- 0) Registre des archives (sans effet s'il existe déjà)
create table if not exists archives_index (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  periode text not null,
  portee text not null default 'tout',
  nb_lignes integer not null,
  checksum text not null,
  chemin text not null,
  statut text not null default 'prepare',
  cree_le timestamptz not null default now(),
  unique (type, periode, portee)
);
alter table archives_index add column if not exists total_controle numeric;
alter table archives_index enable row level security;

-- 1) Secret d'export (généré une seule fois ; lisible uniquement par vous)
insert into reglages (cle, valeur)
select 'export_auth', jsonb_build_object('secret', gen_random_uuid()::text)
where not exists (select 1 from reglages where cle = 'export_auth');
-- Pour changer le secret (s'il fuite) :
--   update reglages set valeur = jsonb_build_object('secret', gen_random_uuid()::text) where cle = 'export_auth';

create or replace function _check_export(p_secret text) returns boolean
language sql stable security definer as $$
  select exists (select 1 from reglages where cle = 'export_auth' and valeur->>'secret' = p_secret);
$$;

-- 2) Garde-fous communs : secret valide, type géré, mois au bon format ET terminé
create or replace function _export_valider(p_secret text, p_type text, p_periode text)
returns void language plpgsql security definer as $$
begin
  if not _check_export(p_secret) then raise exception 'non autorisé'; end if;
  if p_type <> 'defi_resultats' then raise exception 'type non pris en charge'; end if;
  if p_periode !~ '^[0-9]{4}-[0-9]{2}$' then raise exception 'période invalide (attendu AAAA-MM)'; end if;
  if p_periode >= to_char(now(), 'YYYY-MM') then raise exception 'période non terminée : on n''archive que des mois révolus'; end if;
end; $$;

-- 3) Combien de lignes restent à archiver pour ce mois, et où en est l'archive
create or replace function export_compter(p_secret text, p_type text, p_periode text)
returns jsonb language plpgsql security definer as $$
declare v_nb bigint; v_total numeric; v_stat text;
begin
  perform _export_valider(p_secret, p_type, p_periode);
  select count(*), coalesce(sum(r.score_total), 0) into v_nb, v_total
  from defi_resultats r
  where to_char(r.date_passage, 'YYYY-MM') = p_periode and r.reponses <> '[]'::jsonb;
  select a.statut into v_stat from archives_index a
  where a.type = p_type and a.periode = p_periode and a.portee = 'tout';
  return jsonb_build_object('nb', v_nb, 'total', v_total, 'statut', v_stat);
end; $$;

-- 4) Lecture paginée des lignes à archiver (pseudonymisé : identifiant + classe,
--    pas de nom complet)
create or replace function export_lire_periode(p_secret text, p_type text, p_periode text, p_limit int default 1000, p_offset int default 0)
returns jsonb language plpgsql security definer as $$
declare v_res jsonb;
begin
  perform _export_valider(p_secret, p_type, p_periode);
  select coalesce(jsonb_agg(t.obj), '[]'::jsonb) into v_res from (
    select jsonb_build_object(
      'resultat_id', r.id, 'eleve_id', r.eleve_id, 'identifiant', e.identifiant, 'classe', e.classe,
      'defi_id', r.defi_id, 'defi_titre', d.titre, 'date_passage', r.date_passage,
      'score_total', r.score_total, 'score_par_categorie', r.score_par_categorie, 'reponses', r.reponses
    ) as obj
    from defi_resultats r
    left join eleves e on e.id = r.eleve_id
    left join defis d on d.id = r.defi_id
    where to_char(r.date_passage, 'YYYY-MM') = p_periode and r.reponses <> '[]'::jsonb
    order by r.id
    limit least(greatest(p_limit, 1), 2000) offset greatest(p_offset, 0)
  ) t;
  return v_res;
end; $$;

-- 5) Confirmation : Google renvoie ce qu'il a réellement écrit ; la base compare
--    avec ce qu'elle contient. Si ça ne colle pas : erreur, rien n'est marqué.
create or replace function export_confirmer(p_secret text, p_type text, p_periode text, p_nb bigint, p_total numeric, p_chemin text)
returns jsonb language plpgsql security definer as $$
declare v_nb bigint; v_total numeric;
begin
  perform _export_valider(p_secret, p_type, p_periode);
  select count(*), coalesce(sum(r.score_total), 0) into v_nb, v_total
  from defi_resultats r
  where to_char(r.date_passage, 'YYYY-MM') = p_periode and r.reponses <> '[]'::jsonb;
  if v_nb <> p_nb or abs(v_total - p_total) > 0.001 then
    raise exception 'contrôle échoué : base = % lignes / % points, archive = % lignes / % points', v_nb, v_total, p_nb, p_total;
  end if;
  insert into archives_index (type, periode, portee, nb_lignes, checksum, chemin, statut, total_controle)
  values (p_type, p_periode, 'tout', p_nb::integer, 'nb=' || p_nb || ';total=' || p_total, p_chemin, 'verifie', p_total)
  on conflict (type, periode, portee) do update set
    nb_lignes = archives_index.nb_lignes + excluded.nb_lignes,
    total_controle = coalesce(archives_index.total_controle, 0) + excluded.total_controle,
    chemin = archives_index.chemin || E'\n' || excluded.chemin,
    checksum = excluded.checksum,
    statut = 'verifie',
    cree_le = now();
  return jsonb_build_object('ok', true, 'nb', v_nb);
end; $$;

-- 6) Allègement : refuse tant qu'il n'existe pas d'archive VÉRIFIÉE pour le mois.
--    Ne vide que "reponses" ; aucune ligne n'est supprimée.
create or replace function export_alleger(p_secret text, p_type text, p_periode text)
returns jsonb language plpgsql security definer as $$
declare v_stat text; v_n bigint;
begin
  perform _export_valider(p_secret, p_type, p_periode);
  select a.statut into v_stat from archives_index a
  where a.type = p_type and a.periode = p_periode and a.portee = 'tout';
  if v_stat is distinct from 'verifie' then
    raise exception 'aucune archive vérifiée pour %', p_periode;
  end if;
  update defi_resultats r set reponses = '[]'::jsonb
  where to_char(r.date_passage, 'YYYY-MM') = p_periode and r.reponses <> '[]'::jsonb;
  get diagnostics v_n = row_count;
  update archives_index a set statut = 'allege'
  where a.type = p_type and a.periode = p_periode and a.portee = 'tout';
  return jsonb_build_object('ok', true, 'lignes_allegees', v_n);
end; $$;

-- 7) Jauge d'espace (limite gratuite : 500 Mo = 524 288 000 octets)
--    Si Supabase change la limite, modifiez v_limite ci-dessous.
create or replace function admin_db_usage(p_token uuid)
returns table(taille_octets bigint, taille_lisible text, limite_octets bigint, pourcentage numeric, niveau text)
language plpgsql security definer as $$
declare
  v_taille bigint;
  v_limite constant bigint := 524288000;
  v_pct numeric;
begin
  if not _check_admin(p_token) then raise exception 'non autorisé'; end if;
  v_taille := pg_database_size(current_database());
  v_pct := round(v_taille * 100.0 / v_limite, 1);
  return query select v_taille, pg_size_pretty(v_taille), v_limite, v_pct,
    case when v_pct >= 85 then 'critique' when v_pct >= 70 then 'attention' else 'ok' end;
end; $$;

-- 8) Taille par table (schéma public)
create or replace function admin_db_tables(p_token uuid)
returns table(nom_table text, taille text, lignes bigint)
language plpgsql security definer as $$
begin
  if not _check_admin(p_token) then raise exception 'non autorisé'; end if;
  return query
    select s.relname::text, pg_size_pretty(pg_total_relation_size(s.relid)), s.n_live_tup
    from pg_stat_user_tables s
    where s.schemaname = 'public'
    order by pg_total_relation_size(s.relid) desc;
end; $$;

-- 9) Anti-pause : appel minimal, sans donnée sensible.
--    Un cron externe gratuit (ex. cron-job.org) l'appelle toutes les 3 jours :
--      POST https://VOTRE-PROJET.supabase.co/rest/v1/rpc/rpc_ping
--      En-têtes : apikey: <clé anon>   Content-Type: application/json
--      Corps    : {}
create or replace function rpc_ping() returns timestamptz
language sql as $$ select now(); $$;

-- 10) Plafond de taille des photos (200 Ko). Le nouveau site compresse à ~100 Ko ;
--     ce plafond protège votre quota de stockage contre les envois volumineux.
--     Ne touche à aucune photo existante. Annuler : update storage.buckets set file_size_limit = null where id = 'avatars';
update storage.buckets set file_size_limit = 204800 where id = 'avatars';

NOTIFY pgrst, 'reload schema';

-- DERNIER RÉSULTAT AFFICHÉ : votre secret d'export (à copier dans Google)
select valeur->>'secret' as secret_export from reglages where cle = 'export_auth';
