# AnabolicOS

PWA de suivi musculation : entraînement, diet, protocole, poids — avec espace administrateur et messagerie.

- **Production** : https://anabolic-adc6a.web.app
- **Stack** : HTML/CSS/JS natifs (modules ES, sans build) · Firebase Auth (Google) · Cloud Firestore · Firebase Hosting
- **Plan** : Spark (gratuit)

## Structure

```
firebase.json          Config Hosting (cache, en-têtes de sécurité) + Firestore
.firebaserc            Projet Firebase lié (anabolic-adc6a)
firestore.rules        Règles de sécurité — TOUJOURS déployées avec le site
public/                Tout ce qui est en ligne
  index.html           App utilisateur
  sw.js                Service worker (cache + hors ligne)
  css/tokens.css       Identité visuelle (couleurs, typo, espacements)
  js/firebase.js       Init Firebase (seul point d'accès au SDK)
  js/auth.js           Session, profil users/{uid}, rôle admin, statut
  js/lib/dom.js        Création d'éléments SANS innerHTML (anti-XSS)
  js/lib/dates.js      Dates locales
  js/views/            Écrans
docs/ARCHITECTURE.md   Audit, architecture cible, plan
docs/DEPLOIEMENT.md    Tutoriel complet GitHub + Firebase
```

## Workflow

```powershell
firebase emulators:start --only hosting   # test local → http://localhost:5000
git add .
git commit -m "Description de la modification"
git push origin main
firebase deploy
```

## Règles de code

1. **Jamais de `innerHTML`** avec des données : utiliser `h()` de `js/lib/dom.js`.
2. **Jamais de `toISOString()` pour une date du jour** : utiliser `localISODate()`.
3. Seuls les modules de données parlent à Firestore ; les vues n'importent pas le SDK directement (exception : l'écran socle de phase 1).
4. Ajouter tout nouveau fichier de `public/` à la liste `APP_SHELL` de `sw.js` et incrémenter `VERSION`.
5. Aucun secret dans le dépôt.
