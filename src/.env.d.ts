interface ImportMetaEnv {
  readonly DATABASE_URL: string;
  readonly GMAIL_USER: string;
  readonly GMAIL_APP_PASSWORD: string;
  readonly GMAIL_DESTINO: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}