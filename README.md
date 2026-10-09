# MasTurbo Deploy

<p align="center">
  <img src="media/icon.png" alt="MasTurbo Deploy" width="128" />
</p>

<p align="center">
  <strong>Release. Merge. Tag. Deploy.</strong><br />
  Il rituale git del venerdì, ma con un razzo in sidebar.
</p>

<p align="center">
  <a href="#italiano">Italiano</a> · <a href="#english">English</a>
</p>

---

## Italiano

Estensione per **VS Code** e **Cursor**. Nome un po’ sfacciato, mestiere serissimo.

Tu scegli versione, branch e destinazioni. Io faccio fetch, checkout, bump, merge, tag e push. Tu guardi il log. Spoiler: a volte c’è un conflitto.

Se il tuo pomeriggio è “creo `release/1.2.3`, mergio tre feature, bump del `package.json`, tag, merge su main, merge del tag su staging… e prego”, siamo fatti l’uno per l’altro.

### Cosa fa

Apre i repo git del workspace, parte da un branch (di solito `develop`), crea `release/x.y.z`, alza la versione, mergia le feature, porta tutto in produzione, crea il tag, lo distribuisce sugli altri branch e, se vuoi, pulisce quelli avanzati.

Tutto da un pannello, con log in diretta. Senza copiare comandi da uno Slack di tre mesi fa.

### Come si apre

- icona in **Activity Bar** → lista dei repository → click
- Command Palette → **MasTurbo Deploy: Open wizard**

Le tue scelte restano salvate. Lingue: Italiano, English, Español, Français, Deutsch.

### Funzionalità

**Opzioni** (le ricordo io)

| Interruttore | Cosa fa |
| --- | --- |
| **Riusa release** | Se `release/x.y.z` esiste già, ci lavoro sopra. |
| **Dry-run** | Mostro i comandi, non tocco il repo. |
| **Elimina branch mergiati** | Via i feature branch dopo il merge. `main`, `master`, `develop`, `dev`, `unstable`, `staging` e la release restano intoccabili. |
| **Elimina branch release** | A lavoro finito, `release/x.y.z` va in pensione. |

**Repository** — workspace con più git? Li elenco, tu scegli. Ti dico branch corrente, base, produzione e se il working tree è sporco. Se è sporco mi fermo: prima commit o stash.

**Versione** — a sinistra quella attuale, a destra quella nuova. Tu scrivi `1.4.0`, io creo `release/1.4.0`, aggiorno `package.json` (e `package-lock.json` se c’è), uso `1.4.0` come tag e committo `chore: bump version to 1.4.0`.

**Branch di partenza** — da dove nasce la release. Se c’è `develop`, lo preseleziono.

**Merge sulla release** — quali feature entrano, oltre alla base. Albero, ricerca, badge. Merge `--no-ff`, storia leggibile.

**Branch che ricevono il tag** — produzione ce l’ha già. Qui scegli gli altri. Per ciascuno: `pull` → `merge <tag> --no-ff` → `push`.

**Release notes** — textarea. Dopo una run riuscita diventa il body della GitHub Release (login GitHub di VS Code/Cursor). In dry-run o se origin non è GitHub, non creo niente.

**Log** — ogni passo, il comando, l’esito. Verde ok, giallo ehm, rosso ci siamo fermati.

### Cosa succede quando premi Avvia

```text
fetch --all --prune
checkout + pull del branch di partenza
creo (o riuso) release/x.y.z
bump versione + commit
merge dei feature branch
push della release
checkout + pull della produzione
merge della release in produzione
push della produzione
tag + push dei tag
merge del tag sugli altri branch
checkout produzione
(opzionale) pulizia branch
creo la GitHub Release con le note
```

Se qualcosa va storto **mi fermo**. Non provo lo stesso e poi piangiamo insieme.

### Conflitti

Un merge può litigare. Io interrompo, ti mostro branch e file, tu risolvi a mano. Poi **Riprendi merge tag**: completo i merge rimasti. Niente da rifare tutto da capo.

### Storico

Lo storico è la lista delle **GitHub Release**. Se questa macchina ha fatto il deploy con MasTurbo, sulla stessa scheda trovi anche branch, esito e log. Se la Release arriva solo da GitHub, vedi solo tag, note, data e link.

### Cosa non sono

Non sostituisco CI/CD. Non risolvo i conflitti al posto tuo. Non parto con il working tree sporco. Non cancello `main`.

### In 30 secondi

1. Apri il wizard
2. La prima volta accendi **Dry-run**
3. Scegli repo e nuova versione
4. Conferma il branch di partenza
5. Spunta le feature da mergiare
6. Spunta i branch che devono prendere il tag
7. Scrivi le release notes
8. **Avvia release**
9. Log verde? Fatto. Altrimenti sistema i conflitti e **Riprendi merge tag**

Tu decidi cosa esce. Io eseguo come esce.

---

## English

A **VS Code** / **Cursor** extension. Cheeky name. Very serious job.

You pick a version, some branches, a few destinations. I fetch, checkout, bump, merge, tag, and push. You watch the log. Spoiler: sometimes there’s a conflict.

If your afternoon is “create `release/1.2.3`, merge three features, bump `package.json`, tag it, merge to main, merge the tag into staging… and pray”, we should talk.

### What it does

Finds git repos in the workspace, starts from a branch (usually `develop`), creates `release/x.y.z`, bumps the version, merges the features you pick, lands everything on production, creates the tag, merges it into the other branches, and optionally tidies leftovers.

One panel. Live log. No more copying commands from a three-month-old Slack thread.

### How to open it

- **Activity Bar** icon → repository list → click
- Command Palette → **MasTurbo Deploy: Open wizard**

Your last choices are remembered. Languages: English, Italiano, Español, Français, Deutsch.

### Features

**Options** (I remember them)

| Switch | What it does |
| --- | --- |
| **Reuse release** | If `release/x.y.z` already exists, I keep working on it. |
| **Dry-run** | Commands in the log, zero writes. |
| **Delete merged branches** | Feature branches go away after merge. `main`, `master`, `develop`, `dev`, `unstable`, `staging` and the release stay untouchable. |
| **Delete release branch** | When we’re done, `release/x.y.z` retires. |

**Repository** — several git repos? I list them, you pick. I show current branch, base, production, and whether the working tree is dirty. Dirty? I stop. Commit or stash first.

**Version** — current on the left, new on the right. You type `1.4.0`, I create `release/1.4.0`, update `package.json` (and `package-lock.json` if it exists), use `1.4.0` as the tag, and commit `chore: bump version to 1.4.0`.

**Start branch** — where the release is born. If `develop` exists, I preselect it.

**Merge into the release** — which features come in, on top of the base. Tree, search, badges. `--no-ff` merges, readable history.

**Branches that receive the tag** — production already got it. You pick the others. For each: `pull` → `merge <tag> --no-ff` → `push`.

**Release notes** — textarea. After a successful run it becomes the GitHub Release body (VS Code/Cursor GitHub login). Dry-run or a non-GitHub origin: I create nothing.

**Log** — every step, the command, the result. Green good, yellow hmm, red we stopped.

### What happens when you hit Start

```text
fetch --all --prune
checkout + pull the start branch
create (or reuse) release/x.y.z
bump version + commit
merge feature branches
push the release
checkout + pull production
merge the release into production
push production
tag + push tags
merge the tag into the other branches
checkout production
(optional) branch cleanup
create the GitHub Release with the notes
```

If something breaks, **I stop**. I don’t try anyway and cry later.

### Conflicts

A merge can argue. I stop, show you the branch and files, you fix them by hand. Then **Resume merge tag**: I finish the remaining merges. No starting over.

### History

History is the list of **GitHub Releases**. If this machine ran the deploy with MasTurbo, the same card also shows branches, result and log. If the Release only exists on GitHub, you get tag, notes, date and link — nothing else.

### What I’m not

Not a CI/CD replacement. I don’t resolve conflicts for you. I won’t start on a dirty working tree. I won’t delete `main`.

### In 30 seconds

1. Open the wizard
2. First time, turn on **Dry-run**
3. Pick the repo and the new version
4. Confirm the start branch
5. Tick the features to merge
6. Tick the branches that should get the tag
7. Write the release notes
8. **Start release**
9. Log green? Done. Otherwise fix conflicts and **Resume merge tag**

You decide what ships. I run how it ships.
