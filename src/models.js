import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Models are bundled as base64 data URLs (vite assetsInlineLimit) so the build is one JS file.
const urls = import.meta.glob('./assets/*.glb', { query: '?url', import: 'default', eager: true });
const loader = new GLTFLoader();

async function load(url) {
  const buf = url.startsWith('data:')
    ? Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0)).buffer
    : await (await fetch(url)).arrayBuffer();
  const g = await loader.parseAsync(buf, '');
  g.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g.scene;
}

export async function loadModels() {
  const entries = await Promise.all(Object.entries(urls).map(async ([path, url]) =>
    [path.match(/([\w-]+)\.glb$/)[1], await load(url)]));
  return Object.fromEntries(entries);
}
