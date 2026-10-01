-- =========================================================
-- NEXI ONE — schéma Supabase v2 (durci + optimisé grande échelle)
-- À exécuter dans Supabase > SQL Editor, dans cet ordre, sur un
-- projet neuf. Si vous migrez depuis la v1, voir supabase/MIGRATION.md.
-- =========================================================

create extension if not exists pgcrypto;

-- ---------- ÉTABLISSEMENTS ----------
create table ecoles (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  limite_eleves int not null default 300,
  created_at timestamptz not null default now()
);

-- ---------- SUPERVISEURS (préfets / tuteurs-parents) ----------
create table superviseurs (
  id uuid primary key default gen_random_uuid(),
  ecole_id uuid references ecoles(id) on delete set null,
  nom_complet text not null,
  identifiant text unique not null,
  password_hash text not null,
  actif boolean not null default true,
  session_token uuid,
  created_at timestamptz not null default now()
);

-- ---------- CLASSES (référence figée RDC) ----------
create table classes_ref (
  code text primary key,
  libelle text not null,
  ordre int not null
);
insert into classes_ref (code, libelle, ordre) values
 ('7EB','7ème Éducation de Base',1),
 ('8EB','8ème Éducation de Base',2),
 ('1erHP','1ère Humanités Pédagogique',3),
 ('1SC','1ère Scientifique',3),
 ('1Litt','1ère Littéraire',3),
 ('1TCC','1ère Technique Commerciale et de Gestion',3),
 ('1CG','1ère Coupe et Couture / Gestion',3),
 ('1MA','1ère Mécanique Auto',3),
 ('1MG','1ère Mécanique Générale',3),
 ('1ELEC','1ère Électricité',3),
 ('1AUTRE','1ère Autre section',3),
 ('2HP','2ème Humanités Pédagogique',4),
 ('2SC','2ème Scientifique',4),
 ('2Litt','2ème Littéraire',4),
 ('2AUTRE','2ème Autre section',4),
 ('3HP','3ème Humanités Pédagogique',5),
 ('3SC','3ème Scientifique',5),
 ('3Litt','3ème Littéraire',5),
 ('3AUTRE','3ème Autre section',5),
 ('4HP','4ème Humanités Pédagogique',6),
 ('4SC','4ème Scientifique',6),
 ('4Litt','4ème Littéraire',6),
 ('4AUTRE','4ème Autre section',6);

-- ---------- ENFANTS (élèves) ----------
create table eleves (
  id uuid primary key default gen_random_uuid(),
  ecole_id uuid references ecoles(id) on delete set null, -- null = domicile
  nom_complet text not null,
  identifiant text unique not null,       -- pseudo public (anonymat total en classement)
  password_hash text not null,
  sexe text check (sexe in ('M','F')),
  classe text references classes_ref(code),
  avatar_url text,
  abonnement_actif boolean not null default true,
  suggere_par uuid references superviseurs(id),
  valide boolean not null default true,   -- false = suggéré, en attente admin
  actif boolean not null default true,
  session_token uuid,
  created_at timestamptz not null default now()
);

-- L'identifiant sert à déterminer le rôle à la connexion (login_unified) :
-- il doit donc être unique À LA FOIS parmi les élèves ET les superviseurs,
-- pas seulement dans chaque table séparément.
create or replace function _identifiant_globalement_unique() returns trigger language plpgsql as $$
begin
  if TG_TABLE_NAME = 'eleves' and exists (select 1 from superviseurs where identifiant = NEW.identifiant) then
    raise exception 'identifiant déjà utilisé par un superviseur';
  elsif TG_TABLE_NAME = 'superviseurs' and exists (select 1 from eleves where identifiant = NEW.identifiant) then
    raise exception 'identifiant déjà utilisé par un élève';
  end if;
  return NEW;
end; $$;

create trigger trg_eleves_identifiant_unique before insert or update of identifiant on eleves
  for each row execute function _identifiant_globalement_unique();
create trigger trg_superviseurs_identifiant_unique before insert or update of identifiant on superviseurs
  for each row execute function _identifiant_globalement_unique();

-- ---------- CATÉGORIES ----------
create table categories (
  id uuid primary key default gen_random_uuid(),
  nom text unique not null   -- math, langue, svt, spc, ...
);
insert into categories (nom) values ('math'),('langue'),('svt'),('spc');

-- ---------- DÉFIS (quiz hebdomadaires) ----------
create table defis (
  id uuid primary key default gen_random_uuid(),
  titre text not null,
  classe text references classes_ref(code),
  publie boolean not null default false,
  date_publication timestamptz,
  auto_publish_at timestamptz,
  created_at timestamptz not null default now()
);

create table defi_questions (
  id uuid primary key default gen_random_uuid(),
  defi_id uuid references defis(id) on delete cascade,
  categorie_id uuid references categories(id),
  ordre int not null default 1,
  enonce text not null,
  options jsonb not null,           -- ["opt1","opt2","opt3","opt4"]
  bonnes_reponses int[] not null,   -- ex: {0} ou {0,2} — jamais envoyé au client avant correction
  explication text,                 -- corrigé détaillé — révélé seulement après soumission
  temps_secondes int not null default 30
);

create table defi_resultats (
  id uuid primary key default gen_random_uuid(),
  eleve_id uuid references eleves(id) on delete cascade,
  defi_id uuid references defis(id) on delete cascade,
  score_par_categorie jsonb not null default '{}',
  score_total numeric not null default 0,
  reponses jsonb not null default '[]',
  date_passage timestamptz not null default now(),
  unique (eleve_id, defi_id)
);

-- ---------- AFFINITÉS (RIASEC) ----------
create table affinites_questions (
  id uuid primary key default gen_random_uuid(),
  texte text not null,
  dimension text not null check (dimension in ('R','I','A','S','E','C')),
  actif boolean not null default true
);

create table affinites_reponses (
  id uuid primary key default gen_random_uuid(),
  eleve_id uuid references eleves(id) on delete cascade,
  scores jsonb not null,
  profil_dominant text,
  date_passage date not null default current_date,
  unique (eleve_id, date_passage)
);

-- ---------- CARTES DE RÉVISION ----------
create table cartes_revision (
  id uuid primary key default gen_random_uuid(),
  classe text references classes_ref(code),
  categorie_id uuid references categories(id),
  recto text not null,
  verso_reponse text not null,
  verso_explication text,
  masque boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- RÉGLAGES GLOBAUX ----------
create table reglages (
  cle text primary key,
  valeur jsonb not null
);
insert into reglages (cle, valeur) values
 ('defi_frequence', '"hebdomadaire"'),
 ('affinite_frequence', '"quotidienne"');

-- =========================================================
-- INDEXES — pensés pour des écoles de plusieurs centaines d'élèves :
-- toutes les jointures/filtres utilisés par les fonctions RPC ci-dessous
-- passent par un index, aucune agrégation ne fait de full-scan inutile.
-- =========================================================
create index idx_eleves_ecole_classe on eleves (ecole_id, classe);
create index idx_eleves_pending on eleves (valide) where valide = false;
create index idx_eleves_classe on eleves (classe);
create index idx_defi_resultats_eleve on defi_resultats (eleve_id);
create index idx_defi_resultats_defi on defi_resultats (defi_id);
create index idx_defi_questions_defi on defi_questions (defi_id, ordre);
create index idx_cartes_classe on cartes_revision (classe) where masque = false;
create index idx_affinites_rep_eleve_date on affinites_reponses (eleve_id, date_passage);

-- =========================================================
-- RLS — activé partout. Aucune policy "using(true)" sur une colonne
-- sensible (noms d'élèves, clés de bonnes réponses, mots de passe) :
-- ces données ne transitent que par des fonctions RPC security definer
-- qui vérifient explicitement un jeton de session ou le statut admin.
-- =========================================================
alter table ecoles enable row level security;
alter table superviseurs enable row level security;
alter table eleves enable row level security;
alter table classes_ref enable row level security;
alter table categories enable row level security;
alter table defis enable row level security;
alter table defi_questions enable row level security;
alter table defi_resultats enable row level security;
alter table affinites_questions enable row level security;
alter table affinites_reponses enable row level security;
alter table cartes_revision enable row level security;
alter table reglages enable row level security;

-- Lecture publique strictement limitée au contenu non sensible :
create policy "lecture classes_ref" on classes_ref for select using (true);
create policy "lecture categories" on categories for select using (true);
create policy "lecture defis publies" on defis for select using (publie = true);
create policy "lecture cartes visibles" on cartes_revision for select using (masque = false);
create policy "lecture affinites actives" on affinites_questions for select using (actif = true);
-- Aucune policy select sur : eleves (noms), superviseurs, ecoles, defi_questions
-- (contient bonnes_reponses), defi_resultats, affinites_reponses, reglages.
-- => tout accès à ces données passe par une fonction RPC ci-dessous.
-- Aucune policy insert/update/delete nulle part : toutes les écritures
-- passent aussi par les fonctions RPC (security definer).

-- =========================================================
-- AUTHENTIFICATION
-- =========================================================

-- Connexion unifiée : l'interface ne demande qu'un identifiant + mot de
-- passe, sans jamais afficher "élève" ou "superviseur" — le rôle est
-- déduit côté serveur et renvoyé au client.
create or replace function login_unified(p_identifiant text, p_password text)
returns table(role text, id uuid, nom_complet text, identifiant text, classe text, ecole_id uuid, avatar_url text, token uuid)
language plpgsql security definer as $$
declare v_token uuid := gen_random_uuid(); v_id uuid;
begin
  update eleves set session_token = v_token
    where eleves.identifiant = p_identifiant
      and password_hash = crypt(p_password, password_hash)
      and actif = true and valide = true
    returning eleves.id into v_id;
  if v_id is not null then
    return query select 'eleve'::text, e.id, e.nom_complet, e.identifiant, e.classe, e.ecole_id, e.avatar_url, v_token
      from eleves e where e.id = v_id;
    return;
  end if;

  update superviseurs set session_token = v_token
    where superviseurs.identifiant = p_identifiant
      and password_hash = crypt(p_password, password_hash)
      and actif = true
    returning superviseurs.id into v_id;
  if v_id is not null then
    return query select 'superviseur'::text, s.id, s.nom_complet, s.identifiant, null::text, s.ecole_id, null::text, v_token
      from superviseurs s where s.id = v_id;
    return;
  end if;

  return; -- aucune ligne = identifiants invalides, message générique côté client
end; $$;

-- Admin : compte unique stocké dans reglages, jeton renouvelé à chaque login
create or replace function login_admin(p_identifiant text, p_password text)
returns uuid language plpgsql security definer as $$
declare v_hash text; v_token uuid;
begin
  select valeur->>'hash' into v_hash from reglages where cle = 'admin_auth' and valeur->>'identifiant' = p_identifiant;
  if v_hash is null or v_hash <> crypt(p_password, v_hash) then return null; end if;
  v_token := gen_random_uuid();
  update reglages set valeur = valeur || jsonb_build_object('token', v_token) where cle = 'admin_auth';
  return v_token;
end; $$;

create or replace function _check_admin(p_token uuid) returns boolean language sql stable as $$
  select exists (select 1 from reglages where cle = 'admin_auth' and (valeur->>'token')::uuid = p_token);
$$;

create or replace function admin_change_password(p_token uuid, p_new_password text) returns boolean language plpgsql security definer as $$
begin
  if not _check_admin(p_token) then raise exception 'non autorisé'; end if;
  update reglages set valeur = valeur || jsonb_build_object('hash', crypt(p_new_password, gen_salt('bf'))) where cle = 'admin_auth';
  return true;
end; $$;

-- =========================================================
-- ÉLÈVE — lecture (agrégée côté serveur, jamais de full-table côté client)
-- =========================================================

-- Liste des questions d'un défi SANS la clé de bonnes réponses ni l'explication
-- (empêche toute triche via inspection réseau avant soumission).
create or replace function rpc_questions_defi(p_defi_id uuid)
returns table(id uuid, categorie_nom text, ordre int, enonce text, options jsonb, temps_secondes int)
language plpgsql security definer as $$
begin
  if not exists (select 1 from defis where defis.id = p_defi_id and publie = true) then return; end if;
  return query select q.id, c.nom, q.ordre, q.enonce, q.options, q.temps_secondes
    from defi_questions q left join categories c on c.id = q.categorie_id
    where q.defi_id = p_defi_id order by q.ordre;
end; $$;

-- Défis de la classe de l'élève + statut "déjà fait", en une seule requête.
create or replace function rpc_mes_defis(p_eleve_id uuid, p_token uuid)
returns table(id uuid, titre text, classe text, fait boolean, score_total numeric)
language plpgsql security definer as $$
declare v_classe text;
begin
  select eleves.classe into v_classe from eleves where eleves.id = p_eleve_id and session_token = p_token;
  if v_classe is null then raise exception 'non autorisé'; end if;
  return query
    select d.id, d.titre, d.classe, (r.id is not null), r.score_total
    from defis d left join defi_resultats r on r.defi_id = d.id and r.eleve_id = p_eleve_id
    where d.classe = v_classe and d.publie = true
    order by d.date_publication desc nulls last;
end; $$;

-- Soumission d'un défi : la CORRECTION se fait ici, côté serveur — le
-- client n'a jamais reçu bonnes_reponses, donc il ne peut pas tricher.
-- p_reponses : [{ "question_id": "...", "choix": [0,2] }, ...]
create or replace function soumettre_defi(p_eleve_id uuid, p_token uuid, p_defi_id uuid, p_reponses jsonb)
returns table(score_total numeric, score_par_categorie jsonb, corrections jsonb)
language plpgsql security definer as $$
declare
  v_q record;
  v_choix int[];
  v_submitted jsonb;
  v_correct boolean;
  v_cat text;
  v_points_par_q numeric;
  v_score numeric := 0;
  v_scorecat jsonb := '{}'::jsonb;
  v_corrections jsonb := '[]'::jsonb;
begin
  if not exists (select 1 from eleves where id = p_eleve_id and session_token = p_token) then
    raise exception 'non autorisé';
  end if;
  if exists (select 1 from defi_resultats where eleve_id = p_eleve_id and defi_id = p_defi_id) then
    raise exception 'défi déjà soumis';
  end if;

  for v_q in
    select q.*, c.nom as cat_nom,
      (select count(*) from defi_questions q2 where q2.defi_id = q.defi_id and q2.categorie_id is not distinct from q.categorie_id) as cat_count
    from defi_questions q left join categories c on c.id = q.categorie_id
    where q.defi_id = p_defi_id
  loop
    select elem->'choix' into v_submitted from jsonb_array_elements(p_reponses) elem
      where (elem->>'question_id')::uuid = v_q.id limit 1;
    select coalesce(array_agg(x::int order by x::int), '{}') into v_choix
      from jsonb_array_elements_text(coalesce(v_submitted, '[]'::jsonb)) x;
    v_correct := (v_choix = (select coalesce(array_agg(y order by y), '{}') from unnest(v_q.bonnes_reponses) y));
    v_cat := coalesce(v_q.cat_nom, 'général');
    v_points_par_q := round(100.0 / greatest(v_q.cat_count, 1));
    v_scorecat := jsonb_set(v_scorecat, array[v_cat], to_jsonb(coalesce((v_scorecat->>v_cat)::numeric, 0) + case when v_correct then v_points_par_q else 0 end));
    if v_correct then v_score := v_score + v_points_par_q; end if;
    v_corrections := v_corrections || jsonb_build_object('question_id', v_q.id, 'correct', v_correct, 'bonnes_reponses', v_q.bonnes_reponses, 'explication', v_q.explication);
  end loop;

  insert into defi_resultats (eleve_id, defi_id, score_par_categorie, score_total, reponses)
  values (p_eleve_id, p_defi_id, v_scorecat, v_score, p_reponses);

  return query select v_score, v_scorecat, v_corrections;
end; $$;

-- Profil agrégé (points totaux, par catégorie, nb défis, dernier profil RIASEC) — 1 appel, 0 fetch brut côté client.
create or replace function rpc_mon_profil(p_eleve_id uuid, p_token uuid)
returns table(score_par_categorie jsonb, score_total numeric, defis_faits bigint, profil_dominant text)
language plpgsql security definer as $$
declare v_cat jsonb; v_total numeric; v_count bigint; v_dom text;
begin
  if not exists (select 1 from eleves where id = p_eleve_id and session_token = p_token) then raise exception 'non autorisé'; end if;
  select coalesce(jsonb_object_agg(k, total), '{}'::jsonb) into v_cat from (
    select je.key as k, sum(je.value::numeric) as total
    from defi_resultats r, jsonb_each_text(r.score_par_categorie) je
    where r.eleve_id = p_eleve_id group by je.key
  ) s;
  select coalesce(sum(dr.score_total), 0), count(*) into v_total, v_count from defi_resultats dr where dr.eleve_id = p_eleve_id;
  select ar.profil_dominant into v_dom from affinites_reponses ar where ar.eleve_id = p_eleve_id order by ar.date_passage desc limit 1;
  return query select v_cat, v_total, v_count, v_dom;
end; $$;

create or replace function rpc_affinite_today(p_eleve_id uuid, p_token uuid)
returns table(profil_dominant text, scores jsonb) language plpgsql security definer as $$
begin
  if not exists (select 1 from eleves where id = p_eleve_id and session_token = p_token) then raise exception 'non autorisé'; end if;
  return query select a.profil_dominant, a.scores from affinites_reponses a
    where a.eleve_id = p_eleve_id and a.date_passage = current_date;
end; $$;

create or replace function soumettre_affinites(p_eleve_id uuid, p_token uuid, p_scores jsonb, p_profil_dominant text)
returns boolean language plpgsql security definer as $$
begin
  if not exists (select 1 from eleves where id = p_eleve_id and session_token = p_token) then return false; end if;
  insert into affinites_reponses (eleve_id, scores, profil_dominant) values (p_eleve_id, p_scores, p_profil_dominant)
    on conflict (eleve_id, date_passage) do nothing;
  return true;
end; $$;

create or replace function rpc_update_avatar(p_eleve_id uuid, p_token uuid, p_url text) returns boolean language plpgsql security definer as $$
begin
  if not exists (select 1 from eleves where id = p_eleve_id and session_token = p_token) then raise exception 'non autorisé'; end if;
  update eleves set avatar_url = p_url where id = p_eleve_id;
  return true;
end; $$;

-- Classement partagé (élève/superviseur/admin) — ne renvoie JAMAIS de nom,
-- seulement identifiant + points, paginé pour rester rapide à toute échelle.
create or replace function rpc_classement(p_scope text, p_ecole_id uuid, p_classe text, p_limit int default 50, p_offset int default 0)
returns table(eleve_id uuid, identifiant text, classe text, points_total numeric, defis_faits bigint)
language plpgsql security definer as $$
begin
  return query
    select e.id, e.identifiant, e.classe, coalesce(sum(r.score_total), 0), count(r.id)
    from eleves e left join defi_resultats r on r.eleve_id = e.id
    where e.valide = true and e.actif = true
      and (p_scope <> 'ecole' or e.ecole_id is not distinct from p_ecole_id)
      and (p_scope <> 'classe' or (e.classe = p_classe and e.ecole_id is not distinct from p_ecole_id))
    group by e.id, e.identifiant, e.classe
    order by coalesce(sum(r.score_total), 0) desc
    limit p_limit offset p_offset;
end; $$;

-- =========================================================
-- SUPERVISEUR
-- =========================================================
create or replace function superviseur_suggerer_eleve(p_superviseur_id uuid, p_token uuid, p_nom_complet text, p_identifiant text, p_password text, p_sexe text, p_classe text)
returns uuid language plpgsql security definer as $$
declare v_id uuid; v_ecole uuid;
begin
  select ecole_id into v_ecole from superviseurs where id = p_superviseur_id and session_token = p_token;
  if v_ecole is null then raise exception 'non autorisé'; end if;
  insert into eleves (nom_complet, identifiant, password_hash, sexe, classe, ecole_id, suggere_par, valide)
  values (p_nom_complet, p_identifiant, crypt(p_password, gen_salt('bf')), p_sexe, p_classe, v_ecole, p_superviseur_id, false)
  returning id into v_id;
  return v_id;
end; $$;

-- Élèves de l'école du superviseur (avec nom — visible seulement ici et côté admin)
create or replace function rpc_superviseur_eleves(p_superviseur_id uuid, p_token uuid)
returns table(id uuid, nom_complet text, identifiant text, classe text, valide boolean)
language plpgsql security definer as $$
declare v_ecole uuid;
begin
  select ecole_id into v_ecole from superviseurs where superviseurs.id = p_superviseur_id and session_token = p_token;
  if v_ecole is null then raise exception 'non autorisé'; end if;
  return query select e.id, e.nom_complet, e.identifiant, e.classe, e.valide from eleves e where e.ecole_id = v_ecole order by e.classe, e.nom_complet;
end; $$;

-- Statistiques par classe, agrégées en SQL (aucune boucle côté client, même avec 500+ élèves)
create or replace function rpc_superviseur_stats(p_superviseur_id uuid, p_token uuid)
returns table(classe text, nb_eleves bigint, moyenne_points numeric)
language plpgsql security definer as $$
declare v_ecole uuid;
begin
  select ecole_id into v_ecole from superviseurs where id = p_superviseur_id and session_token = p_token;
  if v_ecole is null then raise exception 'non autorisé'; end if;
  return query
    select e.classe, count(distinct e.id), coalesce(round(avg(sub.total), 1), 0)
    from eleves e
    left join (select eleve_id, sum(score_total) as total from defi_resultats group by eleve_id) sub on sub.eleve_id = e.id
    where e.ecole_id = v_ecole and e.valide = true
    group by e.classe order by e.classe;
end; $$;

create or replace function rpc_superviseur_classement(p_superviseur_id uuid, p_token uuid, p_classe text, p_categorie text default null)
returns table(eleve_id uuid, identifiant text, points numeric)
language plpgsql security definer as $$
declare v_ecole uuid;
begin
  select ecole_id into v_ecole from superviseurs where id = p_superviseur_id and session_token = p_token;
  if v_ecole is null then raise exception 'non autorisé'; end if;
  return query
    select e.id, e.identifiant,
      coalesce(sum(case when p_categorie is null then r.score_total else (r.score_par_categorie->>p_categorie)::numeric end), 0)
    from eleves e left join defi_resultats r on r.eleve_id = e.id
    where e.ecole_id = v_ecole and e.classe = p_classe and e.valide = true
    group by e.id, e.identifiant order by 3 desc;
end; $$;

-- =========================================================
-- ADMIN — toutes les écritures + les lectures qui contournent
-- les policies RLS restrictives (noms, cartes masquées, questions inactives…)
-- =========================================================
create or replace function admin_list_ecoles(p_token uuid) returns setof ecoles language plpgsql security definer as $$
begin if not _check_admin(p_token) then raise exception 'non autorisé'; end if; return query select * from ecoles order by nom; end; $$;

create or replace function admin_upsert_ecole(p_token uuid, p_id uuid, p_nom text, p_limite int)
returns uuid language plpgsql security definer as $$
declare v_id uuid;
begin
  if not _check_admin(p_token) then raise exception 'non autorisé'; end if;
  if p_id is null then insert into ecoles (nom, limite_eleves) values (p_nom, p_limite) returning id into v_id;
  else update ecoles set nom = p_nom, limite_eleves = p_limite where id = p_id returning id into v_id; end if;
  return v_id;
end; $$;

create or replace function admin_list_superviseurs(p_token uuid) returns setof superviseurs language plpgsql security definer as $$
begin if not _check_admin(p_token) then raise exception 'non autorisé'; end if; return query select * from superviseurs order by created_at desc; end; $$;

create or replace function admin_upsert_superviseur(p_token uuid, p_id uuid, p_nom_complet text, p_identifiant text, p_password text, p_ecole_id uuid, p_actif boolean)
returns uuid language plpgsql security definer as $$
declare v_id uuid;
begin
  if not _check_admin(p_token) then raise exception 'non autorisé'; end if;
  if p_id is null then
    insert into superviseurs (nom_complet, identifiant, password_hash, ecole_id, actif)
    values (p_nom_complet, p_identifiant, crypt(p_password, gen_salt('bf')), p_ecole_id, p_actif) returning id into v_id;
  else
    update superviseurs set nom_complet = p_nom_complet, identifiant = p_identifiant,
      password_hash = case when p_password is not null and p_password <> '' then crypt(p_password, gen_salt('bf')) else password_hash end,
      ecole_id = p_ecole_id, actif = p_actif where id = p_id returning id into v_id;
  end if;
  return v_id;
end; $$;

-- Liste des élèves PAGINÉE + filtrable (recherche, classe, statut) — indispensable dès
-- que l'école dépasse quelques dizaines d'élèves.
create or replace function admin_list_eleves(p_token uuid, p_search text default null, p_classe text default null, p_valide boolean default null, p_limit int default 50, p_offset int default 0)
returns setof eleves language plpgsql security definer as $$
begin
  if not _check_admin(p_token) then raise exception 'non autorisé'; end if;
  return query select * from eleves
    where (p_search is null or p_search = '' or nom_complet ilike '%'||p_search||'%' or identifiant ilike '%'||p_search||'%')
      and (p_classe is null or p_classe = '' or classe = p_classe)
      and (p_valide is null or valide = p_valide)
    order by created_at desc limit p_limit offset p_offset;
end; $$;

create or replace function admin_count_eleves(p_token uuid, p_search text default null, p_classe text default null, p_valide boolean default null)
returns bigint language plpgsql security definer as $$
declare v_count bigint;
begin
  if not _check_admin(p_token) then raise exception 'non autorisé'; end if;
  select count(*) into v_count from eleves
    where (p_search is null or p_search = '' or nom_complet ilike '%'||p_search||'%' or identifiant ilike '%'||p_search||'%')
      and (p_classe is null or p_classe = '' or classe = p_classe)
      and (p_valide is null or valide = p_valide);
  return v_count;
end; $$;

create or replace function admin_upsert_eleve(p_token uuid, p_id uuid, p_nom_complet text, p_identifiant text, p_password text, p_sexe text, p_classe text, p_ecole_id uuid, p_actif boolean, p_abonnement_actif boolean)
returns uuid language plpgsql security definer as $$
declare v_id uuid;
begin
  if not _check_admin(p_token) then raise exception 'non autorisé'; end if;
  if p_id is null then
    insert into eleves (nom_complet, identifiant, password_hash, sexe, classe, ecole_id, actif, abonnement_actif, valide)
    values (p_nom_complet, p_identifiant, crypt(coalesce(p_password, ''), gen_salt('bf')), p_sexe, p_classe, p_ecole_id, p_actif, p_abonnement_actif, true)
    returning id into v_id;
  else
    update eleves set nom_complet = p_nom_complet, identifiant = p_identifiant,
      password_hash = case when p_password is not null and p_password <> '' then crypt(p_password, gen_salt('bf')) else password_hash end,
      sexe = p_sexe, classe = p_classe, ecole_id = p_ecole_id, actif = p_actif, abonnement_actif = p_abonnement_actif
    where id = p_id returning id into v_id;
  end if;
  return v_id;
end; $$;

create or replace function admin_valider_eleve(p_token uuid, p_eleve_id uuid) returns boolean language plpgsql security definer as $$
begin if not _check_admin(p_token) then raise exception 'non autorisé'; end if; update eleves set valide = true where id = p_eleve_id; return true; end; $$;

create or replace function admin_list_defis(p_token uuid) returns setof defis language plpgsql security definer as $$
begin if not _check_admin(p_token) then raise exception 'non autorisé'; end if; return query select * from defis order by created_at desc; end; $$;

create or replace function admin_upsert_defi(p_token uuid, p_id uuid, p_titre text, p_classe text, p_publie boolean, p_auto_publish_at timestamptz)
returns uuid language plpgsql security definer as $$
declare v_id uuid;
begin
  if not _check_admin(p_token) then raise exception 'non autorisé'; end if;
  if p_id is null then
    insert into defis (titre, classe, publie, date_publication, auto_publish_at)
    values (p_titre, p_classe, p_publie, case when p_publie then now() else null end, p_auto_publish_at) returning id into v_id;
  else
    update defis set titre = p_titre, classe = p_classe, publie = p_publie,
      date_publication = case when p_publie and date_publication is null then now() else date_publication end,
      auto_publish_at = p_auto_publish_at where id = p_id returning id into v_id;
  end if;
  return v_id;
end; $$;

create or replace function admin_delete_defi(p_token uuid, p_id uuid) returns boolean language plpgsql security definer as $$
begin if not _check_admin(p_token) then raise exception 'non autorisé'; end if; delete from defis where id = p_id; return true; end; $$;

create or replace function admin_list_questions(p_token uuid, p_defi_id uuid)
returns table(id uuid, defi_id uuid, categorie_id uuid, categorie_nom text, ordre int, enonce text, options jsonb, bonnes_reponses int[], explication text, temps_secondes int)
language plpgsql security definer as $$
begin
  if not _check_admin(p_token) then raise exception 'non autorisé'; end if;
  return query select q.id, q.defi_id, q.categorie_id, c.nom, q.ordre, q.enonce, q.options, q.bonnes_reponses, q.explication, q.temps_secondes
    from defi_questions q left join categories c on c.id = q.categorie_id where q.defi_id = p_defi_id order by q.ordre;
end; $$;

create or replace function admin_upsert_question(p_token uuid, p_id uuid, p_defi_id uuid, p_categorie_nom text, p_ordre int, p_enonce text, p_options jsonb, p_bonnes int[], p_explication text, p_temps int)
returns uuid language plpgsql security definer as $$
declare v_id uuid; v_cat uuid;
begin
  if not _check_admin(p_token) then raise exception 'non autorisé'; end if;
  select id into v_cat from categories where nom = p_categorie_nom;
  if v_cat is null then insert into categories (nom) values (p_categorie_nom) returning id into v_cat; end if;
  if p_id is null then
    insert into defi_questions (defi_id, categorie_id, ordre, enonce, options, bonnes_reponses, explication, temps_secondes)
    values (p_defi_id, v_cat, p_ordre, p_enonce, p_options, p_bonnes, p_explication, p_temps) returning id into v_id;
  else
    update defi_questions set categorie_id = v_cat, ordre = p_ordre, enonce = p_enonce, options = p_options,
      bonnes_reponses = p_bonnes, explication = p_explication, temps_secondes = p_temps where id = p_id returning id into v_id;
  end if;
  return v_id;
end; $$;

create or replace function admin_delete_question(p_token uuid, p_id uuid) returns boolean language plpgsql security definer as $$
begin if not _check_admin(p_token) then raise exception 'non autorisé'; end if; delete from defi_questions where id = p_id; return true; end; $$;

create or replace function admin_list_affinites(p_token uuid) returns setof affinites_questions language plpgsql security definer as $$
begin if not _check_admin(p_token) then raise exception 'non autorisé'; end if; return query select * from affinites_questions order by dimension; end; $$;

create or replace function admin_upsert_affinite_question(p_token uuid, p_id uuid, p_texte text, p_dimension text, p_actif boolean)
returns uuid language plpgsql security definer as $$
declare v_id uuid;
begin
  if not _check_admin(p_token) then raise exception 'non autorisé'; end if;
  if p_id is null then insert into affinites_questions (texte, dimension, actif) values (p_texte, p_dimension, p_actif) returning id into v_id;
  else update affinites_questions set texte = p_texte, dimension = p_dimension, actif = p_actif where id = p_id returning id into v_id; end if;
  return v_id;
end; $$;

create or replace function admin_delete_affinite_question(p_token uuid, p_id uuid) returns boolean language plpgsql security definer as $$
begin if not _check_admin(p_token) then raise exception 'non autorisé'; end if; delete from affinites_questions where id = p_id; return true; end; $$;

create or replace function admin_list_cartes(p_token uuid) returns table(id uuid, classe text, categorie_id uuid, categorie_nom text, recto text, verso_reponse text, verso_explication text, masque boolean)
language plpgsql security definer as $$
begin
  if not _check_admin(p_token) then raise exception 'non autorisé'; end if;
  return query select c.id, c.classe, c.categorie_id, cat.nom, c.recto, c.verso_reponse, c.verso_explication, c.masque
    from cartes_revision c left join categories cat on cat.id = c.categorie_id order by c.classe;
end; $$;

create or replace function admin_upsert_carte(p_token uuid, p_id uuid, p_classe text, p_categorie_nom text, p_recto text, p_verso_reponse text, p_verso_explication text, p_masque boolean)
returns uuid language plpgsql security definer as $$
declare v_id uuid; v_cat uuid;
begin
  if not _check_admin(p_token) then raise exception 'non autorisé'; end if;
  select id into v_cat from categories where nom = p_categorie_nom;
  if v_cat is null then insert into categories (nom) values (p_categorie_nom) returning id into v_cat; end if;
  if p_id is null then
    insert into cartes_revision (classe, categorie_id, recto, verso_reponse, verso_explication, masque)
    values (p_classe, v_cat, p_recto, p_verso_reponse, p_verso_explication, p_masque) returning id into v_id;
  else
    update cartes_revision set classe = p_classe, categorie_id = v_cat, recto = p_recto,
      verso_reponse = p_verso_reponse, verso_explication = p_verso_explication, masque = p_masque where id = p_id returning id into v_id;
  end if;
  return v_id;
end; $$;

create or replace function admin_delete_carte(p_token uuid, p_id uuid) returns boolean language plpgsql security definer as $$
begin if not _check_admin(p_token) then raise exception 'non autorisé'; end if; delete from cartes_revision where id = p_id; return true; end; $$;

-- =========================================================
-- COMPTE ADMIN PAR DÉFAUT — CHANGEZ CE MOT DE PASSE DÈS LA PREMIÈRE CONNEXION
-- identifiant: admin  /  mot de passe: NexiAdmin2026!
-- =========================================================
insert into reglages (cle, valeur) values (
  'admin_auth', jsonb_build_object('identifiant', 'admin', 'hash', crypt('NexiAdmin2026!', gen_salt('bf')))
);

-- =========================================================
-- DROITS D'EXÉCUTION — FILET DE SÉCURITÉ
-- Sur certains projets Supabase, les privilèges par défaut sur les
-- fonctions ne sont pas hérités automatiquement par anon/authenticated.
-- On les accorde ici explicitement (sans danger : chaque fonction reste
-- protégée par sa propre vérification de jeton ou de statut admin).
-- =========================================================
grant usage on schema public to anon, authenticated;
grant execute on all functions in schema public to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;

-- =========================================================
-- STORAGE — bucket "avatars"
-- Ce script crée le bucket lui-même (inutile de le créer à la main dans
-- l'interface Supabase). IMPORTANT : "public = true" ne rend que la
-- LECTURE publique. Sans les policies ci-dessous, tout upload depuis le
-- navigateur échoue avec "new row violates row-level security policy"
-- — c'est la cause de l'échec d'envoi des photos de profil.
-- =========================================================
insert into storage.buckets (id, name, public)
  values ('avatars', 'avatars', true)
  on conflict (id) do update set public = true;

create policy "avatars - lecture publique"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "avatars - upload public"
  on storage.objects for insert
  with check (bucket_id = 'avatars');

create policy "avatars - remplacement public"
  on storage.objects for update
  using (bucket_id = 'avatars');

-- =========================================================
-- Force PostgREST à recharger immédiatement son cache de schéma.
-- Sans cela, des fonctions tout juste créées peuvent renvoyer
-- "Could not find the function in the schema cache" pendant quelques
-- minutes après l'exécution de ce script.
-- =========================================================
NOTIFY pgrst, 'reload schema';
