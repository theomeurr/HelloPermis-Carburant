# ⛽ Suivi Carburant — HelloPermis

Application web simple et efficace pour suivre le carburant des véhicules de l'auto-école.
Aucune installation, aucun serveur : tout fonctionne directement dans le navigateur.

## Fonctionnalités

### 🚗 Véhicules
- Ajout, modification et suppression des voitures : **immatriculation**, **marque**, **modèle**
- Détection des immatriculations en double
- Aperçu du nombre de pleins et du dernier kilométrage connu par véhicule

### ⛽ Suivi des pleins
Pour chaque plein :
- **Date**
- **Véhicule** (référence de la voiture)
- **Prix au litre** (€)
- **Nombre de litres**
- **Total HT** et **Total TTC** — calculés automatiquement (prix × litres, TVA déduite, taux réglable, 20 % par défaut) et modifiables à la main si besoin
- **Kilométrage total** de la voiture

Avec en plus :
- Filtres par véhicule et par mois
- Statistiques instantanées : nombre de pleins, litres, totaux HT et TTC
- Modification et suppression de chaque plein

### 📥 Exports
- **CSV** : séparateur `;` et décimales à virgule → s'ouvre parfaitement dans Excel français
- **Excel (`.xlsx`)** : vrai fichier Excel avec dates et nombres typés, généré localement sans dépendance externe
- L'export reprend les lignes affichées : filtrez par véhicule ou par mois pour exporter seulement une partie du suivi

## Utilisation

Ouvrez simplement le fichier `index.html` dans votre navigateur (double-clic). C'est tout !

### Mettre l'application en ligne avec GitHub Pages (optionnel)

1. Sur GitHub, ouvrez **Settings → Pages**
2. Dans « Build and deployment », choisissez **Deploy from a branch**
3. Sélectionnez la branche principale et le dossier `/ (root)`, puis enregistrez
4. L'application sera accessible à l'adresse `https://<votre-compte>.github.io/HelloPermis-Carburant/`

## 💾 À savoir sur les données

- Les données sont enregistrées **automatiquement dans le navigateur** (localStorage) : elles restent disponibles d'une visite à l'autre sur le **même navigateur et le même appareil**.
- Elles ne sont **jamais envoyées sur internet**.
- Pensez à faire un **export CSV ou Excel régulièrement** pour garder une copie de sauvegarde.

## Structure du projet

```
index.html   — structure de l'application (2 onglets : Suivi des pleins / Véhicules)
styles.css   — mise en forme (design simple, responsive mobile)
app.js       — logique : données, calculs HT/TTC, exports CSV et XLSX
```
