# MasTurbo Deploy

<p align="center">
  <img src="media/icon.png" alt="MasTurbo Deploy" width="128" />
</p>

<p align="center">
  <strong>Release. Merge. Tag. Deploy.</strong><br />
  Tutto il rituale git che di solito fai a mano… ma con un razzo in sidebar.
</p>

<p align="center">
  <a href="#italiano">Italiano</a> · <a href="#english">English</a>
</p>

---

# Italiano

## Slide 1 — Cos’è MasTurbo?

Ciao, sono **MasTurbo Deploy**.  
Estensione per **VS Code** e **Cursor**. Nome un po’ sfacciato, mestiere serissimo.

Tu scegli versione, branch e destinazioni.  
Io faccio fetch, checkout, bump, merge, tag, push.  
Tu resti a guardare il log come se fosse un film. Spoiler: a volte c’è un conflitto.

> Se il tuo venerdì pomeriggio è “creo `release/1.2.3`, mergio tre feature, bump del `package.json`, tag, merge su main, merge del tag su staging… e prego”, siamo fatti l’uno per l’altro.

## Slide 2 — Perché esisto

Perché copiare comandi git da uno Slack di tre mesi fa non è un processo.  
È un atto di fede.

MasTurbo è il wizard che:

1. apre i repo git del workspace
2. parte da un branch (di solito `develop`)
3. crea `release/x.y.z`
4. alza la versione
5. mergia le feature che gli indichi
6. porta tutto in produzione
7. crea il tag
8. distribuisce il tag sugli altri branch
9. se vuoi, pulisce i branch avanzati

Tutto da un pannello. Con log in diretta. Senza inventarti la checklist ogni volta.

## Slide 3 — Come mi apri

Due strade, stessa destinazione:

- icona in **Activity Bar** → lista dei repository → click
- Command Palette → **MasTurbo Deploy: Open wizard**

Compare il pannello. Brand, razzo, sette step. Niente panico: le tue scelte restano salvate.

Lingue a bordo: **Italiano, English, Español, Français, Deutsch**.  
Perché anche il merge merita un po’ di internazionale.

## Slide 4 — Il tour in 7 tappe

### 1. Opzioni (le ricordo io)

| Interruttore | Cosa fa, in umano |
| --- | --- |
| **Riusa release** | `release/x.y.z` esiste già? Non urlo, ci lavoro sopra. |
| **Dry-run** | Faccio finta. Mostro i comandi, non tocco il repo. Perfetto per “e se…?” |
| **Elimina branch mergiati** | Via i feature branch dopo il merge. `main`, `master`, `develop`, `dev`, `unstable`, `staging` e la release stessa? Intoccabili. |
| **Elimina branch release** | A lavoro finito, `release/x.y.z` può andare in pensione. |

### 2. Repository

Workspace con più git? Li elenco, tu scegli.  
Ti dico branch corrente, base, produzione e se il working tree è sporco.  
Se è sporco, mi fermo: prima commit o stash. Non sono un mago, sono educato.

### 3. Versione

A sinistra quella attuale (da `package.json` o dall’ultimo tag).  
A destra quella nuova.

Tu scrivi `1.4.0`. Io:

- creo `release/1.4.0`
- aggiorno `package.json`
- se c’è, aggiorno anche `package-lock.json` (yarn/pnpm lock? li lascio in pace)
- uso `1.4.0` come tag git
- committo `chore: bump version to 1.4.0`

### 4. Branch di partenza

Da dove nasce la release. Se c’è `develop`, lo preseleziono.  
Puoi cambiarlo. Io non giudico. Giudico solo i conflitti.

### 5. Merge sulla release

Oltre alla base, quali feature entrano?  
Albero di branch, ricerca, badge, comprimi/espandi.  
Merge `--no-ff`, così la storia resta leggibile e non un piatto di spaghetti.

### 6. Branch che ricevono il tag

Produzione ce l’ha già. Qui scegli gli altri: staging, unstable, quel branch che esiste da 2019 e nessuno sa più perché.

Per ciascuno: `pull` → `merge <tag> --no-ff` → `push`.

### 7. Log

Ogni passo, il comando, l’esito.  
Verde = ok. Giallo = “ehm”. Rosso = ci siamo fermati, e ti dico dove.

## Slide 5 — Cosa succede quando premi Avvia

Dietro le quinte, in ordine, senza improvvisare:

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
```

Se qualcosa va storto **mi fermo**. Non “provo lo stesso e poi piangiamo insieme”.

## Slide 6 — Conflitti: il plot twist

Un merge può litigare. Capita. I file hanno opinioni.

Io:

- interrompo la release
- ti mostro branch e file in conflitto
- ti lascio risolvere a mano, come si deve

Poi **Riprendi merge tag**: riparto dal tag, completo i merge rimasti, e se il merge era già risolto in working tree lo committo e pusho.

Niente “rifacciamo tutto da capo”. Solo la parte che mancava.

## Slide 7 — Storico

Seconda scheda: **Storico**.

Ogni deploy (vero o dry-run, riuscito o interrotto) resta salvato:

- tag
- branch di origine
- branch di destinazione
- data, esito, log completo

Per quando fra tre settimane qualcuno chiederà: “ma 1.3.2 l’abbiamo messa anche su staging?”  
Sì. C’è scritto. Con orario.

## Slide 8 — Cosa non sono

- Non sostituisco CI/CD. Sono il rituale git *prima* (e intorno) al deploy.
- Non risolvo i conflitti al posto tuo. Ti dico dove sono e ti aspetto.
- Non parto se hai file sporchi. È un gesto d’amore.
- Non cancello `main`. Anche se un venerdì sei tentato.

## Slide 9 — Come si usa, in 30 secondi

1. Apri il wizard
2. (Consigliato) accendi **Dry-run** la prima volta
3. Scegli repo e nuova versione
4. Conferma il branch di partenza
5. Spunta le feature da mergiare
6. Spunta i branch che devono prendere il tag
7. **Avvia release**
8. Guarda il log. Se va tutto verde, sei un campione. Se no, sistema i conflitti e **Riprendi merge tag**

## Slide 10 — Il pitch finale

MasTurbo Deploy è l’estensione per chi è stanco di fare il DJ dei branch a mano.

Tu decidi *cosa* esce.  
Io eseguo *come* esce.  
Il log racconta *cosa è successo*.  
Lo storico ricorda *che è successo davvero*.

Adesso vai. C’è una `1.0.something` che vuole uscire.

---

# English

## Slide 1 — What is MasTurbo?

Hi. I’m **MasTurbo Deploy**.  
A **VS Code** / **Cursor** extension. Cheeky name. Very serious job.

You pick a version, some branches, a few destinations.  
I fetch, checkout, bump, merge, tag, and push.  
You watch the live log like it’s cinema. Spoiler: sometimes there’s a conflict.

> If your Friday afternoon is “create `release/1.2.3`, merge three features, bump `package.json`, tag it, merge to main, merge the tag into staging… and pray”, we should talk.

## Slide 2 — Why I exist

Copying git commands from a three-month-old Slack thread is not a process.  
It’s a superstition.

MasTurbo is the wizard that:

1. finds git repos in the workspace
2. starts from a branch (usually `develop`)
3. creates `release/x.y.z`
4. bumps the version
5. merges the feature branches you pick
6. lands everything on production
7. creates the tag
8. merges that tag into the other branches
9. optionally tidies leftover branches

One panel. Live log. Same checklist every time, without you inventing it again.

## Slide 3 — How to open me

Two doors, same room:

- **Activity Bar** icon → repository list → click
- Command Palette → **MasTurbo Deploy: Open wizard**

The panel pops up. Brand, rocket, seven steps. Relax: I remember your last choices.

Languages on board: **English, Italiano, Español, Français, Deutsch**.  
Because merge conflicts are international.

## Slide 4 — The 7-stop tour

### 1. Options (I remember them)

| Switch | Human translation |
| --- | --- |
| **Reuse release** | `release/x.y.z` already exists? I won’t scream. I’ll keep working on it. |
| **Dry-run** | I pretend. Commands in the log, zero writes. Perfect for “what if…?” |
| **Delete merged branches** | Feature branches go away after merge. `main`, `master`, `develop`, `dev`, `unstable`, `staging` and the release itself stay untouchable. |
| **Delete release branch** | When we’re done, `release/x.y.z` can retire. |

### 2. Repository

Several git repos in the workspace? I list them, you pick.  
I show current branch, base, production, and whether the working tree is dirty.  
Dirty? I stop. Commit or stash first. I’m not a magician. I’m polite.

### 3. Version

Current version on the left (`package.json` or latest tag).  
New version on the right.

You type `1.4.0`. I:

- create `release/1.4.0`
- update `package.json`
- update `package-lock.json` if it exists (yarn/pnpm locks? I leave them alone)
- use `1.4.0` as the git tag
- commit `chore: bump version to 1.4.0`

### 4. Release start branch

Where the release is born. If `develop` exists, I preselect it.  
You can change it. I don’t judge. I only judge conflicts.

### 5. Merge into the release

On top of the base, which features come in?  
Branch tree, search, badges, collapse/expand.  
`--no-ff` merges, so history stays a story, not spaghetti.

### 6. Branches that receive the tag

Production already got it. Here you pick the others: staging, unstable, that branch from 2019 nobody can explain.

For each one: `pull` → `merge <tag> --no-ff` → `push`.

### 7. Log

Every step, the command, the result.  
Green = good. Yellow = “hmm”. Red = we stopped, and I’ll tell you where.

## Slide 5 — What happens when you hit Start

Behind the curtain, in order, no jazz improvisation:

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
```

If something breaks, **I stop**. I don’t “try anyway and we cry later”.

## Slide 6 — Conflicts: the plot twist

A merge can argue. It happens. Files have opinions.

I:

- stop the release
- show you the branch and the conflicted files
- let you fix them by hand, the right way

Then **Resume merge tag**: I pick up from the tag, finish the remaining merges, and if the merge is already resolved in the working tree I commit and push it.

No “start over from slide 1”. Just the missing part.

## Slide 7 — History

Second tab: **History**.

Every deploy (real or dry-run, success or stop) is saved:

- tag
- origin branches
- destination branches
- date, result, full log

For the day, three weeks from now, someone asks: “did 1.3.2 actually land on staging?”  
Yes. It’s written down. With a timestamp.

## Slide 8 — What I’m not

- Not a CI/CD replacement. I’m the git ritual *before* (and around) deploy.
- I don’t resolve conflicts for you. I point at them and wait.
- I won’t start on a dirty working tree. That’s love, not stubbornness.
- I won’t delete `main`. Even on a daring Friday.

## Slide 9 — How to use me in 30 seconds

1. Open the wizard
2. (Recommended) turn on **Dry-run** the first time
3. Pick the repo and the new version
4. Confirm the start branch
5. Tick the features to merge
6. Tick the branches that should get the tag
7. **Start release**
8. Watch the log. All green? Champion. If not, fix conflicts and **Resume merge tag**

## Slide 10 — Closing pitch

MasTurbo Deploy is for people tired of DJing branches by hand.

You decide *what* ships.  
I run *how* it ships.  
The log tells *what happened*.  
History remembers *that it really happened*.

Now go. There’s a `1.0.something` that wants out.
