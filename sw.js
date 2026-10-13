/*
 * Service worker da PWA dl_magg.
 *
 * Estratégia:
 * - `install`: pré-cache do app shell (HTML, manifest, ícones).
 * - `activate`: remove caches antigos.
 * - `fetch`: runtime cache dos assets do build (stale-while-revalidate).
 *   Chamadas `/api/` NUNCA são cacheadas pelo SW: edições e estado de job
 *   passam pelo IndexedDB, que é a fonte de verdade do offline.
 */

// O escopo acompanha a instalação: raiz local ou /dl_magg/ no GitHub Pages.
const BASE = new URL(self.registration.scope);
const PREFIXO_CACHE = `dlmagg:${BASE.pathname}:`;
const CACHE_SHELL = `${PREFIXO_CACHE}shell-v2`;
const CACHE_ASSETS = `${PREFIXO_CACHE}assets-v2`;
const INDEX = new URL("index.html", BASE).href;

const SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "icone-192.png",
  "icone-512.png",
].map((caminho) => new URL(caminho, BASE).href);

self.addEventListener("install", (evento) => {
  evento.waitUntil(
    caches
      .open(CACHE_SHELL)
      // addAll é atômico: se um item falhar, o install inteiro falha. Preferimos
      // tolerância a um shell incompleto — por isso, adiciona item a item.
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => undefined))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((chaves) =>
        Promise.all(
          chaves
            .filter((chave) =>
              chave.startsWith(PREFIXO_CACHE) && chave !== CACHE_SHELL && chave !== CACHE_ASSETS,
            )
            .map((chave) => caches.delete(chave)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (evento) => {
  const requisicao = evento.request;
  if (requisicao.method !== "GET") return;

  const url = new URL(requisicao.url);
  if (url.origin !== BASE.origin || !url.pathname.startsWith(BASE.pathname)) return;
  // API fora do cache do SW (fonte de verdade: IndexedDB).
  if (url.pathname.startsWith("/api/")) return;

  if (requisicao.mode === "navigate") {
    evento.respondWith(
      fetch(requisicao).catch(() =>
        caches.open(CACHE_SHELL).then((cache) => cache.match(INDEX)).then((r) => r ?? Response.error()),
      ),
    );
    return;
  }

  evento.respondWith(
    caches.open(CACHE_ASSETS).then(async (cache) => {
      const emCache = await cache.match(requisicao);
      const rede = fetch(requisicao)
        .then((resposta) => {
          if (resposta.ok) void cache.put(requisicao, resposta.clone());
          return resposta;
        })
        .catch(() => undefined);
      return emCache ?? (await rede) ?? Response.error();
    }),
  );
});