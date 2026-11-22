import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Emuladores reproducibles, sin modificar el PATH del usuario ni iniciar sesión cloud.
const environment = { ...process.env };
const localRoot =
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'GrassGo', 'tools', 'jre21');
const portableJava =
  localRoot && existsSync(localRoot)
    ? readdirSync(localRoot)
        .map((name) => path.join(localRoot, name))
        .find((folder) => existsSync(path.join(folder, 'bin', 'java.exe')))
    : undefined;
const javaHome = process.env.JAVA_HOME || portableJava;
if (javaHome) environment.PATH = path.join(javaHome, 'bin') + path.delimiter + process.env.PATH;
const result = spawnSync(
  process.execPath,
  ['node_modules/firebase-tools/lib/bin/firebase.js', ...process.argv.slice(2)],
  { env: environment, stdio: 'inherit' },
);
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
