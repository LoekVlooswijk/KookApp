# Kookapp

Persoonlijke Nederlandse kook-app: **Expo + SQLite + AI**. Beheer je recepten, plan je week, genereer boodschappenlijsten en kook met een AI-assistent aan je zij. Alle data blijft lokaal op je apparaat.

_Aangemaakt als persoonlijke app, opengezet zodat anderen er mee kunnen bouwen._

## Functies

- **Recepten** — handmatig toevoegen of importeren via een URL of AI. Porties schalen, tags, dieetvoorkeuren en categorieën.
- **Kookweergave** — stap-voor-stap weergave met schermwakker-houden en een AI-kookassistent om vragen te stellen tijdens het koken.
- **Weekplanner** — plan je maaltijden per dag, met tekstlabels en AI-zoeken in recepten.
- **Boodschappenlijst** — automatisch samengesteld uit je weekplanner en recepten.
- **Kennisbank & technieken** — kooktechnieken en kennis opzoeken, met AI-aangedreven zoekresultaten.
- **Bio-score** — score recepten op voedingswaarde, met eigen drempels en uitzonderingen.
- **AI-chefs profiel** — houd je keuken, smaak en dieet bij zodat AI-suggesties aansluiten.
- **Backups** — exporteer/importeer je data als JSON, met expliciete versie (`export_version`).

### AI-providers

Bring your own key: de app vraagt jouw eigen API-key en bewaart die veilig in de Secure Store van het apparaat. Ondersteunde providers:

- Anthropic (Claude)
- OpenAI
- Google Gemini

Zonder key werken alle lokale functies gewoon — alleen AI-acties zijn dan uitgeschakeld.

## Tech stack

- [Expo SDK 58](https://expo.dev) / React Native 0.88
- [expo-router](https://docs.expo.dev/router/introduction/) voor navigatie
- [expo-sqlite](https://docs.expo.dev/versions/latest/sdk/sqlite/) als lokale database (`kook.db`), met incrementele migraties via `schema_version`
- [expo-secure-store](https://docs.expo.dev/versions/latest/sdk/securestore/) voor API-keys
- TypeScript, ESLint, Prettier en Jest

## Aan de slag

```bash
npm install
npm start          # Expo dev server op je LAN
```

Open de QR-code met **Expo Go** op je telefoon (zelfde netwerk; anders `npm run start:tunnel`).

### Scripts

| Commando             | Wat het doet                                            |
| -------------------- | ------------------------------------------------------- |
| `npm start`          | Expo dev server (LAN)                                   |
| `npm run start:tunnel` | Expo dev server via tunnel (andere netwerken)         |
| `npm run verify`     | Volledige poort: typecheck, lint, Prettier check, tests |
| `npm run typecheck`  | TypeScript-controle                                     |
| `npm run lint`       | ESLint (`lint:fix` voor auto-fixes)                    |
| `npm test`           | Jest-testsuite                                          |
| `npm run format`     | Prettier formatting toepassen                          |

## Projectstructuur

```
app/            Schermen (expo-router)
  (tabs)/       Hoofdtabbladen: recepten, planner, boodschappen, kennis, technieken, instellingen
  recipe/       Receptdetails, bewerken, kookweergave, AI-import
  settings/     AI-keys & modellen, data, dieeten, tags, bio-score, uiterlijk
components/     UI-componenten (kookweergave, formulieren, chatpanels, ...)
lib/            Datalaag & logica (db, migraties, repo's, AI-client, exports, prefs)
patches/         patch-package fixes voor dependencies
assets/         Iconen en afbeeldingen
```

De volledige product- en technisch-specificatie staat in `kookapp_plan_v2.html` (open in een browser).

## Data & privacy

- Alle recepten, planningen en voorkeuren staan in **SQLite op het apparaat** — er is geen backend en geen account nodig.
- **API-keys** worden alleen lokaal opgeslagen (Secure Store) en gaan uitsluitend rechtstreeks naar de gekozen AI-provider.
- AI-features sturen recepten- en profielcontext naar jouw provider naar keuze; zonder key verlaat niets je apparaat.

## Documentatie

- `kookapp_plan_v2.html` — volledig productplan (features, prompts, DB-schema, bouwvolgorde)
- `RELEASE.md` — release-checklist (verify, migraties, store/EAS)
- `AGENTS.md` — agent- & developer-runbook (commando's, DB-contract, compatibiliteitsregels)

## Bijdragen

Pull requests zijn welkom. Houd je aan `npm run verify` (moet groen zijn) en gebruik kleine, feature-scoped commits. Backwardscompatibiliteit van opgeslagen data en exports staat centraal — zie `AGENTS.md` voor het DB- en export-contract.
