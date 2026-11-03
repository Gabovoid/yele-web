interface ImportMetaEnv {
  readonly DATABASE_URL: string;
  readonly GMAIL_USER: string;
  readonly GMAIL_APP_PASSWORD: string;
  readonly GMAIL_DESTINO: string;
  readonly PUBLIC_SUPABASE_URL: string;
  readonly PUBLIC_SUPABASE_ANON_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
