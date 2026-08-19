# ⛽ Suivi Carburant — HelloPermis

Application web simple et efficace pour suivre le carburant des véhicules de l'auto-école.
Aucune installation, aucun serveur : tout fonctionne directement dans le navigateur.

## Fonctionnalités

### 🚗 Véhicules
- Ajout, modification et suppression des voitures : **immatriculation**, **marque**, **modèle**, **type de carburant** (Gazole, SP95-E10, SP95, SP98, E85, GPL)
- Détection des immatriculations en double
- Par véhicule : nombre de pleins, dernier kilométrage, **consommation moyenne (L/100 km)** et **coût carburant par km**
- Le carburant du véhicule sélectionné est **rappelé dans le formulaire de plein** (évite les erreurs à la pompe)

### 👤 Moniteurs
- Base de moniteurs gérée directement dans l'application (ajout, renommage, suppression)
- Les moniteurs apparaissent dans la liste déroulante du formulaire de plein
- Par moniteur : nombre de pleins effectués et total TTC
- La suppression d'un moniteur **conserve** ses pleins (ils deviennent « sans moniteur »)

### ⛽ Suivi des pleins
Pour chaque plein :
- **Date**
- **Véhicule** (référence de la voiture)
- **Moniteur** (choisi dans la base, facultatif)
- **Prix au litre** (€)
- **Nombre de litres**
- **Total HT** et **Total TTC** — calculés automatiquement (prix × litres, TVA déduite, taux réglable, 20 % par défaut) et modifiables à la main si besoin
- **Kilométrage total** de la voiture
- **Consommation (L/100 km)** calculée automatiquement depuis le plein précédent du véhicule

Avec en plus :
- ⚠️ **Alerte kilométrage** : avertissement si le kilométrage saisi est incohérent avec les autres relevés du véhicule (faute de frappe)
- 📊 **Graphique des dépenses par mois** (TTC, empilées par véhicule, 12 derniers mois)
- Filtres par véhicule, par moniteur et par mois — appliqués aux statistiques, au graphique, au tableau et aux exports
- Statistiques instantanées : nombre de pleins, litres, totaux HT et TTC
- Modification et suppression de chaque plein

### 📥 Exports
- **CSV** : séparateur `;` et décimales à virgule → s'ouvre parfaitement dans Excel français
- **Excel (`.xlsx`)** : vrai fichier Excel avec dates et nombres typés, généré localement sans dépendance externe
- Colonnes : date, immatriculation, marque, modèle, carburant, moniteur, prix au litre, litres, HT, TTC, kilométrage, consommation
- L'export reprend les lignes affichées : filtrez par véhicule, moniteur ou mois pour exporter seulement une partie du suivi

### 💾 Sauvegarde / restauration
- **Sauvegarder les données** (pied de page) : télécharge un fichier JSON complet (véhicules, moniteurs, pleins, réglages)
- **Restaurer une sauvegarde** : recharge ce fichier sur n'importe quel appareil — c'est aussi le moyen de transférer les données d'un ordinateur à un autre

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
index.html   — structure de l'application (3 onglets : Suivi des pleins / Véhicules / Moniteurs)
styles.css   — mise en forme (design simple, responsive mobile)
app.js       — logique : données, calculs HT/TTC et consommation, graphique, exports CSV/XLSX, sauvegarde
```
