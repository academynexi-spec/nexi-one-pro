-- =========================================================
-- PATCH — corrige "TypeError: opts.map is not a function" au clic sur "Jouer"
-- Cause : la colonne defi_questions.options (jsonb) contient du texte JSON
-- ("[\"A\",\"B\"]") au lieu d'un vrai tableau (["A","B"]). L'application
-- appelle .map() dessus et plante.
--
-- Sans danger : ne supprime ni table ni ligne. Il normalise seulement le
-- format des options et remplace 2 fonctions.
-- À exécuter dans Supabase > SQL Editor.
--
-- (Optionnel, AVANT le patch, pour confirmer le diagnostic :)
--   select id, jsonb_typeof(options) as type_options, options from defi_questions;
--   -> si type_options = 'string', l'hypothèse est confirmée.
-- =========================================================

-- 0) Fonction utilitaire : renvoie toujours un tableau JSON valide
create or replace function _options_norm(o jsonb) returns jsonb
language plpgsql immutable as $$
declare v jsonb;
begin
  if o is null then return '[]'::jsonb; end if;
  if jsonb_typeof(o) = 'array' then return o; end if;
  if jsonb_typeof(o) = 'string' then
    begin
      v := (o #>> '{}')::jsonb;
      if jsonb_typeof(v) = 'array' then return v; end if;
      return jsonb_build_array(o #>> '{}');
    exception when others then
      return jsonb_build_array(o #>> '{}');
    end;
  end if;
  return '[]'::jsonb;
end; $$;

-- 1) Répare les questions déjà enregistrées
update defi_questions set options = _options_norm(options)
where jsonb_typeof(options) is distinct from 'array';

-- 2) Le panel admin enregistrera désormais toujours un vrai tableau
create or replace function admin_upsert_question(p_token uuid, p_id uuid, p_defi_id uuid, p_categorie_nom text, p_ordre int, p_enonce text, p_options jsonb, p_bonnes int[], p_explication text, p_temps int)
returns uuid language plpgsql security definer as $$
declare v_id uuid; v_cat uuid;
begin
  if not _check_admin(p_token) then raise exception 'non autorisé'; end if;
  select id into v_cat from categories where nom = p_categorie_nom;
  if v_cat is null then insert into categories (nom) values (p_categorie_nom) returning id into v_cat; end if;
  if p_id is null then
    insert into defi_questions (defi_id, categorie_id, ordre, enonce, options, bonnes_reponses, explication, temps_secondes)
    values (p_defi_id, v_cat, p_ordre, p_enonce, _options_norm(p_options), p_bonnes, p_explication, p_temps) returning id into v_id;
  else
    update defi_questions set categorie_id = v_cat, ordre = p_ordre, enonce = p_enonce, options = _options_norm(p_options),
      bonnes_reponses = p_bonnes, explication = p_explication, temps_secondes = p_temps where id = p_id returning id into v_id;
  end if;
  return v_id;
end; $$;

-- 3) Filet de sécurité côté élève : les options sortent toujours en tableau
create or replace function rpc_questions_defi(p_defi_id uuid)
returns table(id uuid, categorie_nom text, ordre int, enonce text, options jsonb, temps_secondes int)
language plpgsql security definer as $$
begin
  if not exists (select 1 from defis where defis.id = p_defi_id and publie = true) then return; end if;
  return query select q.id, c.nom, q.ordre, q.enonce, _options_norm(q.options), q.temps_secondes
    from defi_questions q left join categories c on c.id = q.categorie_id
    where q.defi_id = p_defi_id order by q.ordre;
end; $$;

NOTIFY pgrst, 'reload schema';
