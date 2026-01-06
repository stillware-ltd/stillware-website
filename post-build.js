import { copyFileSync, existsSync } from 'fs';
import { resolve } from 'path';

console.log('Running post-build script...');

const distDir = resolve('dist');
const rootRedirectSrc = resolve('root_redirect.html');
const rootRedirectDest = resolve(distDir, 'index.html');
const redirectsSrc = resolve('public', '_redirects');
const redirectsDest = resolve(distDir, '_redirects');

if (!existsSync(distDir)) {
    console.error('Error: dist directory does not exist!');
    process.exit(1);
}

// Copy root_redirect.html to dist/index.html
if (existsSync(rootRedirectSrc)) {
    console.log(`Copying ${rootRedirectSrc} to ${rootRedirectDest}`);
    copyFileSync(rootRedirectSrc, rootRedirectDest);
} else {
    console.error(`Error: ${rootRedirectSrc} not found!`);
    process.exit(1);
}

// Copy _redirects to dist/_redirects
// Note: Vite copies public/* to dist/zeroed/* (because of outDir), so we need to copy it to dist root explicitly
if (existsSync(redirectsSrc)) {
    console.log(`Copying ${redirectsSrc} to ${redirectsDest}`);
    copyFileSync(redirectsSrc, redirectsDest);
} else {
    console.warn(`Warning: ${redirectsSrc} not found. Netlify redirects might not work.`);
}

console.log('Post-build script completed successfully.');
