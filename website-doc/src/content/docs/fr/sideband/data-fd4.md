---
title: Données binaires (fd 4)
description: Comment fd 4 transporte des octets bruts référencés depuis les métadonnées de fd 3, avec des canaux nommés pour les flux.
sidebar:
  order: 3
---

fd 4 transporte des charges utiles binaires brutes auxquelles les lignes de métadonnées de fd 3 font référence via `byteLength`. Il n'y a aucun framing sur fd 4 lui-même — le côté métadonnées indique au parseur exactement combien d'octets lire.

## Ordre de lecture

Si fd 3 émet ces lignes dans cet ordre :

```jsonl
{"id":"a","type":"image","format":"png","byteLength":4096}
{"id":"b","type":"image","format":"jpeg","byteLength":12000}
```

…le parseur lit exactement 4 096 octets sur fd 4, les associe à `id: "a"`, puis lit 12 000 octets pour `id: "b"`. Les deux flux sont séquencés.

## Canaux de données nommés

La plupart des cas d'usage utilisent le canal par défaut (`fd 4`, alias `"data"`). Pour des flux plus élaborés, vous pouvez déclarer des canaux nommés supplémentaires dans `HYPERTERM_CHANNELS` et les référencer depuis les métadonnées :

```jsonl
{"id":"raw-vid","type":"canvas2d","dataChannel":"video","byteLength":65536}
```

Le canal par défaut est `"data"` (fd 4). Les canaux personnalisés ne sont pas exposés par les bibliothèques client par défaut — ils sont destinés aux intégrations avancées qui souhaitent multiplexer des flux de données distincts (par exemple des trames vidéo et des charges utiles de contrôle).

## Contre-pression

Les écritures sont bloquantes. Si τ-mux est occupé à rendre, la prochaine écriture du script sur fd 4 sera bloquée jusqu'à ce que le pipe de lecture se vide. C'est intentionnel — une E/S non bloquante risquerait une perte silencieuse de trames.

## Mémoire

La charge utile binaire de chaque panneau devient un `ArrayBuffer` dans le moteur de rendu. Pour les images, le buffer est encapsulé dans une URL blob et affecté à un élément `<img>` — lorsque le panneau est effacé, l'URL est révoquée et le buffer est libéré.

## Limites

Il n'y a pas de plafond strict, mais des limites pratiques :

- **Charge utile par panneau** — quelques MiB conviennent. Des images de plusieurs centaines de MiB épuiseront la mémoire de la webview.
- **Débit en rafale** — la contre-pression vous protège, mais émettre des trames plus vite que le moteur de rendu ne peut consommer signifie simplement que votre script bloque en attendant le moteur de rendu.

## Pour aller plus loin

- [Métadonnées (fd 3)](/fr/sideband/metadata-fd3/)
- [Vue d'ensemble du sideband](/fr/sideband/overview/)
