---
title: Applications d'extension
description: Construisez des « applications d'extension » — un backend Bun + un frontend Vite dans une iframe + un @tau-mux/sdk typé qui pilote chaque surface de contrôle de τ-mux. Sauvegardées, ouvertes et éditées dans l'app.
sidebar:
  order: 14
---

Une **application d'extension** est un type de surface de première classe (aux côtés de terminal / browser / agent / telegram / editor) qui héberge une petite application que vous écrivez vous-même :

- un **backend Bun** — un véritable processus enfant qui peut faire `bun install` de ses propres dépendances et tout ce que Bun sait faire (fetch, système de fichiers, spawn, SQLite, …) ;
- un **frontend Vite** — rendu dans une `<iframe>`, avec rechargement à chaud des modules pendant que vous éditez et un bundle statique compilé une fois installé ;
- le **`@tau-mux/sdk`** — un wrapper typé au-dessus de la socket / RPC existante de τ-mux, pour que l'extension puisse piloter **chaque surface de contrôle** : créer des panneaux, ouvrir des surfaces navigateur, envoyer des notifications, définir le statut de la barre latérale, lister les espaces de travail, et plus encore.

Les extensions sont sauvegardées sur disque, restaurées avec votre disposition, et créées / éditées / supprimées depuis l'intérieur de l'app. Elles sont **entièrement de confiance** — il n'y a pas de bac à sable ; une extension s'exécute avec les mêmes privilèges que l'app (voir [Modèle de confiance](#modèle-de-confiance)).

## La forme d'une extension

```
<config>/extensions/<id>/
  manifest.json          # id, name, icon, points d'entrée backend + frontend
  src/
    index.ts             # le backend Bun (optionnel)
    main.ts              # le frontend Vite
  index.html             # entrée Vite
  dist/ (or static/)     # frontend compilé (mode installé)
  node_modules/          # incl. le @tau-mux/sdk vendoré
  state.json             # état persisté par extension (c'est vous qui l'écrivez)
```

`<config>` est le répertoire de config de l'app (`~/Library/Application Support/hyperterm-canvas` sur macOS ; à surcharger avec `HT_CONFIG_DIR`). Un `extensions-registry.json` à côté indexe ce qui est installé.

### `manifest.json`

```jsonc
{
  "id": "com.you.my-app",        // stable ; le nom du dossier + segment d'URL
  "name": "My App",
  "version": "0.1.0",
  "icon": "🧩",                  // emoji/glyphe affiché dans la barre du panneau
  "description": "What it does.",
  "backend": { "entry": "src/index.ts" },          // à omettre pour une app frontend-only
  "frontend": {
    "dev": "vite",               // commande du serveur de dev (HMR)
    "devPort": 5191,             // l'iframe pointe ici en mode dev
    "dist": "dist",              // dossier de sortie compilé (mode installé)
    "entry": "index.html"
  },
  "permissions": ["notification", "sidebar", "surface", "browser"]  // indicatif
}
```

## Dev vs installé

Une surface d'extension s'exécute dans l'un de deux modes, décidé à chaque lancement :

- **Dev (Vite HMR).** τ-mux exécute la commande `frontend.dev` du manifeste (un serveur de dev Vite) et pointe l'iframe du panneau vers `http://127.0.0.1:<devPort>`. Éditez `main.ts` dans un [panneau éditeur](/fr/features/file-explorer-and-editor/) adjacent et l'iframe se recharge à chaud. Le premier lancement exécute automatiquement `bun install` dans le répertoire de l'extension.
- **Installé (statique compilé).** Lorsqu'un frontend compilé existe (`dist/` / le `dist` du manifeste), τ-mux le sert depuis un minuscule hôte HTTP en boucle locale et y pointe l'iframe. Pas de serveur de dev, pas de recompilation.

Le backend (`src/index.ts`) est un simple processus enfant Bun dans les deux modes — **jamais un PTY**. Il est démarré à neuf pour chaque surface et arrêté (SIGTERM → SIGKILL) lorsque le panneau se ferme ou que l'app quitte.

## Le `@tau-mux/sdk`

Le SDK offre une seule surface typée depuis les deux moitiés d'une extension. Il est livré en tant que source TypeScript sous `packages/tau-mux-sdk` et est câblé dans le `node_modules` de chaque extension (une dépendance `file:` en dev).

**Backend** (`src/index.ts`) — dialogue avec τ-mux via la socket unix ; échange des messages applicatifs avec le frontend via stdin/stdout :

```ts
import { createBackendSdk } from "@tau-mux/sdk/backend";

const sdk = createBackendSdk();
await sdk.sidebar.setStatus({ key: "demo", value: "running" });
await sdk.notification.create({ title: "My App", body: "Backend up" });

sdk.onMessage((data) => {           // un message depuis le frontend
  sdk.send({ pong: data });          // … répondre au frontend
});
```

**Frontend** (`main.ts`, dans l'iframe) — dialogue avec τ-mux via un pont `postMessage` (l'hôte route via la même RPC qu'utilise la CLI), et avec son propre backend :

```ts
import { createFrontendSdk } from "@tau-mux/sdk/frontend";

const sdk = createFrontendSdk();
await sdk.notification.create({ title: "Hello", body: "from the iframe" });
const surfaces = await sdk.surface.list();

sdk.sendToBackend({ type: "ping" });          // → le backend Bun
sdk.onBackendMessage((data) => console.log(data));
sdk.onResize(({ width, height }) => relayout(width, height));
```

Les deux moitiés exposent les mêmes espaces de noms — `notification`, `sidebar`, `surface`, `workspace`, `browser`, `system` — plus une trappe de sortie brute `call(method, params)` qui peut atteindre **n'importe quelle** méthode de l'[API JSON-RPC](/fr/api/overview/). Voir l'[API `extension.*`](/fr/api/extensions/) pour la surface côté hôte.

## Créer, éditer et supprimer

Tout est accessible depuis la **palette de commandes** (`⌘⇧P`, sous « Extensions ») et la CLI [`ht extension`](/fr/cli/extensions/) :

- **Open** — exécuter une extension dans un nouveau panneau (`ht extension open <id>`).
- **Edit** — ouvrir la source backend de l'extension (ou `manifest.json`) dans la [surface éditeur](/fr/features/file-explorer-and-editor/) CodeMirror ; appariée au panneau en cours d'exécution en mode dev, c'est la boucle live édition → HMR.
- **New Extension…** — échafauder à partir d'un template embarqué (`ht extension new <id> --template <name>`).
- **Remove** — désinstaller et supprimer le dossier (`ht extension remove <id>`).

## Persistance & restauration

Un panneau d'extension est sauvegardé avec la disposition de son espace de travail (par id d'extension). Au redémarrage, la surface et un **backend neuf** sont restaurés — l'extension recharge son propre `state.json`. Si l'extension a depuis été désinstallée, l'emplacement se dégrade en un substitut terminal au lieu d'être perdu.

## Exemples embarqués

Trois extensions d'exemple sont livrées dans `examples/extensions/` (elles servent aussi de templates d'échafaudage) :

| Exemple | Démontre |
|---|---|
| `hello` | App statique sans dépendance. Pas de `bun install`, pas de Vite — servie directement depuis un `static/` commité. La façon la plus rapide de voir le pont frontend ⇄ hôte. |
| `three-demo` | Une scène WebGL Vite + [three.js](https://threejs.org) avec HMR ; le backend pilote la barre latérale + les notifications. Prouve le `bun install` d'une vraie dépendance. |
| `http-client` | Un constructeur de requêtes HTTP à la Postman. Le frontend construit la requête ; le **backend** exécute `fetch` (pas de CORS) et persiste l'historique dans `state.json`. |

## Modèle de confiance

Les extensions sont **entièrement de confiance** — il n'y a pas de bac à sable. L'iframe s'exécute avec scripts + same-origin pour que le pont du SDK fonctionne, et le backend dispose de tous les privilèges Bun. La liste `permissions` du manifeste est **indicative** (affichée dans l'UI), non appliquée. Le jeton de la socket RPC s'applique toujours, donc un processus non-extension ne peut pas se faire passer pour une extension. N'installez que des extensions de confiance, exactement comme vous le feriez pour un script shell.

## Voir aussi

- [CLI `ht extension`](/fr/cli/extensions/)
- [API JSON-RPC `extension.*`](/fr/api/extensions/)
- [Explorateur de fichiers & éditeur](/fr/features/file-explorer-and-editor/) — où vous éditez la source des extensions
- [Palette de commandes](/fr/features/command-palette/)
