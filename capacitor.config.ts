import type { CapacitorConfig } from '@capacitor/cli';

// This app is distributed as a sideloaded APK, not through Google Play, so appId is
// not locked to a store listing and can still be changed. It is still the identity
// Android uses to decide whether an install is an upgrade or a second app: change it
// after devices are in the field and the next APK installs alongside the old one,
// with its own separate SQLite database.
const config: CapacitorConfig = {
  appId: 'ph.mabisa.app',
  appName: 'MABISA',
  webDir: 'dist',
  plugins: {
    CapacitorSQLite: {
      // Native Android keeps the database on the filesystem, so none of the web
      // store machinery applies here. Encryption is left off deliberately: turning it
      // on requires a passphrase the app has nowhere to get, and a hardcoded one
      // protects nothing. Revisit alongside a real device-lock story.
      androidIsEncryption: false,
    },
  },
};

export default config;
