# Come creare il VSIX di MasTurbo Deploy

Serve **Node 20 o 22**. Node 16 fa crashare `vsce` (`styleText is not a function`).

## 1. Entra nella cartella del progetto

```bash
cd /Users/g.belfiore/workspace/my-workspace/deploy
```

## 2. Usa Node 22

```bash
nvm use 22
node -v
```

Deve uscire qualcosa tipo `v22.x.x`.

## 3. Compila e genera il `.vsix`

```bash
npm run package
```

Il file finisce in `releasevsix/` (cartella gitignore):

```text
releasevsix/masturbodeploy-1.0.7.vsix
```

Il numero nel nome è la `version` di `package.json`. Se la alzi, il file si chiama di conseguenza.

## 4. Installalo in locale su VS Code

```bash
"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" --profile gb-ide-profile --install-extension ./releasevsix/masturbodeploy-1.0.7.vsix --force
```

Poi in VS Code: `Developer: Reload Window`.

## 5. (Opzionale) Pubblicalo sul Marketplace

Publisher ID: **MasTurboDeploy**  
Pagina: [https://marketplace.visualstudio.com/manage/publishers/MasTurboDeploy](https://marketplace.visualstudio.com/manage/publishers/MasTurboDeploy)

Token (PAT) da Azure DevOps, non dalla pagina del publisher:

1. [https://dev.azure.com/_usersSettings/tokens](https://dev.azure.com/_usersSettings/tokens)
2. New Token → Organization: **All accessible organizations**
3. Scopes → Marketplace → **Manage**
4. Copia il token

Poi:

```bash
nvm use 22
npx @vscode/vsce login MasTurboDeploy
npx @vscode/vsce publish
```

In alternativa: dalla pagina Manage → **New extension** e carica il `.vsix`.

## Note

- Non usare il `vsce` globale di Node 16 (`~/.nvm/versions/node/v16.20.2/...`).
- `npx @vscode/vsce login MasTurboDeploy` (senza typo sul nome).
- Icona marketplace: `media/icon.png` (almeno 128x128).
- Icona activity bar: `media/icon.svg`.
