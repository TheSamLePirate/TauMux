# Tracking — Still-Broken Sweep

Plan: fermer tous les findings de `doc/improvement_analysis_2026-10.md`.
Démarré: 2026-10. Base: v0.23.1 (736249b4).

| Étape | Titre | État | Commit |
|---|---|---|---|
| P0-1 | Guard boot telegram.db | ✅ | a36c6c3d |
| P0-2 | Miroir: auth hors loopback | ✅ | a36c6c3d |
| P0-3 | Webview fault reporting | ✅ | a36c6c3d |
| P0-4 | Scroll-to-top | ✅ | a36c6c3d |
| P0-5 | Typing-mode sur blur | ✅ | a36c6c3d |
| P0-6 | Sécu: ignore-scripts + 0600 | ✅ | a36c6c3d |
| P1-7 | Auto-approve deny-list | ✅ | 7a159c8 |
| P1-8 | Sidebar render memo | ✅ | 7a159c8 |
| P1-9 | Bannière déconnexion miroir | ✅ | 7a159c8 |
| P1-10 | Ratchet CSS | ✅ | 7a159c8 |
| P1-11 | Toggle mort | ✅ | 7a159c8 |
| P2-12 | Onboarding + settings search | ✅ | 4070a10 |
| P2-13 | Timer partagé + GL lazy | ✅ | 4070a10 |
| P2-14 | Envelope nonPtySurfaceCreated | ✅ | b4d8a78 |
| P2-15 | visualViewport | ✅ | 9468db8 |
| P3-16 | Docs | ✅ | à committer |
| P3-17 | Release mechanics | 🔄 | — |

## Déviations

- **P0-4** : l'analyse proposait un clamp distance-from-bottom; implémenté
  avec une meilleure ancre (ligne absolue quand cols inchangés, delta
  total-lines quand cols changés) — corrige aussi la dérive sur output
  ajouté. Tests legacy xterm-resize-scroll mis à jour (stubs physiquement
  incohérents).
- **P2-14** : le ratchet module-size a forcé l'extraction du telegram pane
  view hors de web-client/main.ts (1513 → 1316 lignes) — amélioration
  structurelle au-delà du scope initial.
- **P1-8** : deux tests web-client-sidebar encodaient l'ancien
  comportement (sample CPU par render) — mis à jour pour avancer
  l'horloge, fidèle à la cadence 1 Hz réelle.
- **Idle-timer du typing-mode** (suggéré dans l'analyse) : volontairement
  omis — changement UX au-delà du bug rapporté. Deferred.

## Issues rencontrées

- Suite de tests au HEAD : 2 échecs pré-existants dans event-bus.test.ts
  en exécution isolée (ordre/partage du window happy-dom) — passent dans
  la suite complète. À investiguer séparément.
- Le ratchet module-size a mordu 4 fois pendant le sweep (index.ts ×2,
  main.ts, settings-panel.ts, client.css ×2) — chaque croissance a été
  extraite ou re-baselinée explicitement avec justification.

## Issues rencontrées

(aucune pour l'instant)
