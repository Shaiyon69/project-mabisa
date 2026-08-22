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
      // store machinery applies here — and a file holding a barangay's health
      // register travels in a bag all day. SQLCipher is on, keyed by a passphrase
      // generated on the device itself (see prepareEncryption in
      // src/services/localDatabase.ts) and held by this plugin's own secure store.
      // Never a hardcoded passphrase: one that ships in the APK protects nothing.
      androidIsEncryption: true,
    },
  },
};

export default config;
