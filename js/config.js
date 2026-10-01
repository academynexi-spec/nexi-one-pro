// =========================================================
// NEXI ONE — configuration
// Remplacez ces deux valeurs par celles de votre projet Supabase
// (Project Settings > API). La clé "anon" est publique par design :
// la sécurité réelle vient des policies RLS + fonctions RPC de schema.sql
// (aucune table sensible n'est lisible/écrivable directement par le client).
// =========================================================
window.NEXI_CONFIG = {
  SUPABASE_URL: "https://hhbwshtujxeuyysqdbip.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_bkHYp89LEap3MA1E8BnCtg_hl7remUy",
  APP_NAME: "NEXI ONE",
  SITE_URL: "",
  CLASSES: [
    { code: "7EB", libelle: "7ème Éducation de Base" },
    { code: "8EB", libelle: "8ème Éducation de Base" },
    { code: "1erHP", libelle: "1ère Humanités Pédagogique" },
    { code: "1SC", libelle: "1ère Scientifique" },
    { code: "1Litt", libelle: "1ère Littéraire" },
    { code: "1TCC", libelle: "1ère Technique Commerciale et de Gestion" },
    { code: "1CG", libelle: "1ère Coupe et Couture / Gestion" },
    { code: "1MA", libelle: "1ère Mécanique Auto" },
    { code: "1MG", libelle: "1ère Mécanique Générale" },
    { code: "1ELEC", libelle: "1ère Électricité" },
    { code: "1AUTRE", libelle: "1ère Autre section" },
    { code: "2HP", libelle: "2ème Humanités Pédagogique" },
    { code: "2SC", libelle: "2ème Scientifique" },
    { code: "2Litt", libelle: "2ème Littéraire" },
    { code: "2AUTRE", libelle: "2ème Autre section" },
    { code: "3HP", libelle: "3ème Humanités Pédagogique" },
    { code: "3SC", libelle: "3ème Scientifique" },
    { code: "3Litt", libelle: "3ème Littéraire" },
    { code: "3AUTRE", libelle: "3ème Autre section" },
    { code: "4HP", libelle: "4ème Humanités Pédagogique" },
    { code: "4SC", libelle: "4ème Scientifique" },
    { code: "4Litt", libelle: "4ème Littéraire" },
    { code: "4AUTRE", libelle: "4ème Autre section" }
  ],
  RIASEC_LABELS: { R: "Réaliste", I: "Investigateur", A: "Artistique", S: "Social", E: "Entreprenant", C: "Conventionnel" }
};
