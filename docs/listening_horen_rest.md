# API REST — Module Hören (Listening)

Spécification pour implémenter les endpoints consommés par l’app **telC** (`telC\_frontend`). Les chemins sont relatifs à la **base URL** du backend (ex. Azure App Service).

**Auth** : les requêtes passent par le client HTTP configuré avec JWT (interceptors existants). Prévoir les mêmes en-têtes que pour Schreiben / Sprechen (`Authorization: Bearer …`) sauf indication contraire.

\---

## 1\. Liste des Teile / types d’exercice

|||
|-|-|
|**Méthode**|`GET`|
|**Chemin**|`/api/listening/teils`|
|**Réponse**|`200` — tableau JSON d’objets **ExerciseType** (même contrat que `/api/writing/teils`)|

### Corps de réponse (tableau)

Chaque élément suit le modèle partagé `ExerciseType` — **clés JSON en camelCase** (comme le client Flutter) :

|Champ JSON|Type|Notes|
|-|-|-|
|`id`|string|Identifiant du Teil (ex. `"1"`, `"2"`, `"3"`)|
|`title`|string|Titre affiché (souvent en allemand, texte d’examen)|
|`subtitle`|string|Sous-titre|
|`prompt`|string|Consigne longue|
|`imagePath`|string|Chemin ou URL d’illustration|
|`progress`|number|0–100|
|`part`|number|Numéro de partie|
|`durationMinutes`|number|Durée indicative (minutes)|

**Référence code** : `telC\_frontend/lib/shared/models/exercise\_type.dart` (`fromJson`).

\---

## 2\. Historique des tentatives (sessions)

|||
|-|-|
|**Méthode**|`GET`|
|**Chemin**|`/api/listening/sessions`|
|**Query**|`teilNumber` (optionnel, **int**) — filtre par Teil, même idée que Schreiben|

### Corps de réponse (tableau)

Chaque élément suit `ExerciseAttempt` — **camelCase** :

|Champ JSON|Type|Notes|
|-|-|-|
|`id`|string|Id de la tentative|
|`date`|string|ISO 8601 (optionnel)|
|`dateLabel`|string|Libellé affiché (optionnel)|
|`score`|number|Note|
|`feedback`|string|Retour texte|
|`durationSeconds`|number|Durée en secondes (optionnel)|

**Référence code** : `telC\_frontend/lib/shared/models/exercise\_attempt.dart`.

\---

## 3\. Exercice complet (audio + questions)

|||
|-|-|
|**Méthode**|`GET`|
|**Chemin**|`/api/listening/exercise`|
|**Query**|`type` — **string**, id du Teil (ex. `1`)|

### Corps de réponse (objet JSON)

|Champ JSON|Type|Description|
|-|-|-|
|`content\_revision`|string|**Identifiant de version** du contenu ; s’il change, le client invalide le cache audio local et retélécharge les fichiers distants.|
|`issued\_at`|string|ISO 8601 (métadonnée, affichage / logique côté client possible).|
|`audio\_url`|string|URL HTTPS du fichier audio à télécharger et mettre en cache ; **vide** si l’audio est fourni ailleurs (ex. asset uniquement en dev).|
|`bundled\_audio\_asset`|string|Optionnel ; chemin relatif au dossier `assets/` du client (sans préfixe `assets/`), ex. `images/modules/Telc - A1.mp3` — uniquement si pas d’`audio\_url`.|
|`questions`|array|Liste de questions à choix unique|

#### Objet `questions\[]`

|Champ|Type|Description|
|-|-|-|
|`id`|string|Id stable de la question|
|`prompt`|string|Intitulé (souvent en allemand)|
|`options`|array|Liste d’options|

#### Objet `options\[]`

|Champ|Type|Description|
|-|-|-|
|`id`|string|Id de l’option (souvent `a`, `b`, `c`)|
|`label`|string|Texte affiché|

**Référence code** : `telC\_frontend/lib/features/listening/domain/entities/listening\_exercise\_payload.dart`.

\---

## 4\. Soumission des réponses et calcul de la note

|||
|-|-|
|**Méthode**|`POST`|
|**Chemin**|`/api/listening/submit`|
|**Content-Type**|`application/json`|

### Corps de la requête

|Champ JSON|Type|Description|
|-|-|-|
|`type`|string|Id du Teil (identique au `type` du GET exercise).|
|`timed`|boolean|`true` = mode chronométré (examen), `false` = entraînement.|
|`content\_revision`|string|Doit correspondre au `content\_revision` de l’exercice soumis (cohérence du contenu).|
|`answers`|object|**Map** : clé = `question.id`, valeur = `option.id` choisi.|

#### Exemple

```json
{
  "type": "1",
  "timed": true,
  "content\_revision": "mock-horen-teil-1-v1",
  "answers": {
    "q11": "a",
    "q12": "c"
  }
}
```

### Corps de la réponse (`200`)

|Champ JSON|Type|Description|
|-|-|-|
|`score`|number|**Note** renvoyée au client (0–100 recommandé).|

**Alias accepté par le parseur client** : `note` (si le backend préfère ce nom, le client mappe aussi sur la note affichée).

#### Exemple

```json
{ "score": 85 }
```

**Référence code** : `ListeningSubmitResult.fromJson` dans `listening\_submit\_result.dart`.

\---

## Comportement app lorsque le backend est indisponible

En environnement **development** (`ENVIRONMENT=development`), si la requête échoue (réseau, 404, 500, etc.), le client **retombe sur des données mock** locales pour `teils`, `sessions`, `exercise` et `submit` afin de continuer le développement UI sans API. En **production**, les erreurs sont remontées à l’utilisateur (snackbar / états d’erreur).

\---

*Ce document a été créé avec Cursor (IA).*

