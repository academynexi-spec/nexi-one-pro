// Charge le SDK Supabase (CDN) et expose un client unique partagé.
window.getSupabase = (function () {
  let client = null;
  return function () {
    if (!client) {
      if (!window.supabase) {
        console.error("Le SDK Supabase (CDN) n'est pas chargé. Vérifiez la balise <script> dans le HTML.");
        return null;
      }
      client = window.supabase.createClient(
        window.NEXI_CONFIG.SUPABASE_URL,
        window.NEXI_CONFIG.SUPABASE_ANON_KEY
      );
    }
    return client;
  };
})();
