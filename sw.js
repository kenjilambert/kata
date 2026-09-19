// Service worker do Kata — offline + cache agressivo do que é imutável.
//
// Sem bibliotecas. Só 3 comportamentos, e tudo o que não cai neles passa
// reto pro navegador (não interceptamos POST, nem outra origem, nem URLs
// sem versão):
//   1. URLs com `?v=` (todo /src, ver tools/build-assets.py) e /fonts/*:
//      CACHE-FIRST. O conteúdo dessas URLs nunca muda (mudou o arquivo,
//      muda o hash, muda a URL), então nem vale consultar a rede.
//   2. Navegação (abrir o site): NETWORK-FIRST, cai pro cache se estiver
//      offline. O index.html é o único arquivo que "aponta" pras versões
//      certas de tudo, então ele precisa vir fresco sempre que der.
//   3. Pré-cache na instalação: a casca mínima pra abrir offline (/, o
//      style.css versionado, as fontes, o manifest). O JS NÃO entra no
//      pré-cache: ele cai no cache pelo comportamento 1 na primeira visita
//      normal, sem baixar duas vezes.
//
// ASSET_VERSION é injetado por tools/build-assets.py (hash agregado de tudo
// sob /src + fontes + manifest). Qualquer asset mudou -> sw.js muda byte a
// byte -> o navegador instala esta versão nova -> `activate` apaga os caches
// de versões anteriores. Um cache só por versão (pré-cache e runtime juntos):
// simples de limpar, e o custo é só rebaixar de novo os arquivos que não
// mudaram na próxima visita depois de um deploy.

const ASSET_VERSION = '5454530f29e0';
const CACHE_NAME = `kata-${ASSET_VERSION}`;

const PRECACHE = [
  // assets:precache:start
  '/',
  '/manifest.json',
  '/fonts/space-grotesk-latin.woff2',
  '/fonts/space-grotesk-latin-ext.woff2',
  '/src/style.css?v=829fcfda',
  // assets:precache:end
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      // cache: 'reload' pula o cache HTTP do navegador — garante que o
      // pré-cache da versão nova não seja preenchido com resposta velha que o
      // navegador ainda tinha guardada.
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' }))))
      // não espera as abas antigas fecharem pra assumir — as URLs versionadas
      // que a página aberta ainda usa continuam existindo no servidor, então
      // trocar o SW debaixo dela não quebra nada.
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isImmutable(url) {
  return url.searchParams.has('v') || url.pathname.startsWith('/fonts/');
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  // só guarda resposta boa e de verdade — um 404 ou erro de rede guardado
  // viraria "imutável" pra sempre.
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    // resposta redirecionada não pode ser reaproveitada pra navegação (o
    // navegador recusa por segurança), então só guardamos a final e direta.
    if (response.ok && !response.redirected) cache.put(request, response.clone());
    return response;
  } catch (err) {
    // offline: qualquer rota do site é a mesma página (single page) — serve
    // a que temos, tentando primeiro a URL pedida e depois a raiz.
    const cached = (await cache.match(request)) || (await cache.match('/'));
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isImmutable(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
  }
  // qualquer outra coisa (manifest, sw.js, ícones, .js sem ?v= num navegador
  // sem import map) segue direto pro navegador/rede, sem SW no meio.
});
