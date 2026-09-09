# Sprachbausteine — correction des réponses (note pour le frontend)

**Pour :** Herman
**Sujet :** `correctOptionId` / `correctWordId` absents de `GET /api/sprachbausteine/exercise`
**Statut :** corrigé côté backend, une modification est nécessaire côté application

---

## 1. Ce qui se passait

Ton analyseur JSON lit bien `correctOptionId` et `correctWordId` — on les voit dans
le bundle déployé (7 et 3 occurrences). Mais l'API ne les envoie plus.

**Ce n'est pas un oubli.** Ces champs existaient, puis ont été retirés
volontairement le **21 août 2026** (commit `7678440`), pour une raison précise.

Avant ce commit, la soumission fonctionnait ainsi :

```ts
const score = dto.score;   // ← le score venait du client
```

N'importe qui pouvait donc envoyer `score: 100` et le serveur l'enregistrait tel
quel. Le correctif a déplacé le calcul du score côté serveur — et, dans la foulée,
a cessé d'envoyer le corrigé avec l'exercice, puisqu'il était lisible dans l'onglet
réseau du navigateur avant même que l'étudiant réponde.

Un test a été ajouté pour empêcher que ces champs réapparaissent :

```ts
it('does not expose correct option or word IDs', ...)
```

**L'application n'a jamais été mise à jour après ce changement.** C'est pour cela
que ton code cherche exactement ces noms de champs : ils correspondent à l'API
d'avant août.

---

## 2. Ce qui a changé maintenant

> **Mise à jour du 9 septembre 2026.** La première version de cette note te
> demandait d'appeler `/submit` pour obtenir le corrigé. Ce n'est plus
> nécessaire : `correctOptionId` et `correctWordId` sont de retour dans
> `GET /exercise`, sous les noms que ton code lit déjà.

`GET /api/sprachbausteine/exercise` renvoie de nouveau la bonne réponse, sur
chaque trou :

```jsonc
{
  "contentRevision": "…",
  "teil1": {
    "gaps": [
      {
        "id": "21",
        "correctOptionId": "21b",        // ← de retour
        "options": [ { "id": "21a", "content": "…" }, … ]
      }
    ]
  },
  "teil2": {
    "wordBank": [ { "id": "wa", "letter": "a", "content": "…" } ],
    "gaps": [ { "id": "31", "correctWordId": "wa" } ]   // ← de retour
  }
}
```

Ce sont exactement les noms de champs que ton bundle cherche déjà.
**Ton écran de correction remarche sans aucune modification de l'application.**

`POST /api/sprachbausteine/submit` continue de renvoyer `answerKey` en plus.
Rien n'est retiré ; les deux sources existent.

```json
{
  "score": 73,
  "answerKey": { "21": "21b", "22": "22a", "23": "23c" }
}
```

---

## 3. Ce que tu dois faire

### Pour la correction : plus rien

Le champ est revenu sous son ancien nom. Ton code existant fonctionne.

### Il reste quand même `/submit` à brancher

Pas pour la correction — pour l'historique. Aujourd'hui l'application
n'appelle jamais `/submit` (0 occurrence dans le bundle), donc **aucune
tentative n'est enregistrée** : ni score conservé, ni progression, et
`GET /sprachbausteine/sessions` reste vide.

Tu peux l'appeler après avoir affiché la correction ; ce n'est plus bloquant.

```
1. GET  /api/sprachbausteine/exercise?modelltest=1
   → afficher l'exercice, l'étudiant répond

2. Afficher la correction immédiatement (correctOptionId / correctWordId)

3. POST /api/sprachbausteine/submit
   → enregistre la tentative, renvoie { score, answerKey }
```

### La requête

```json
POST /api/sprachbausteine/submit
Authorization: Bearer <accessToken>

{
  "modelltestNumber": 1,
  "teil_id": "1",
  "contentRevision": "<celui reçu dans GET /exercise>",
  "answers": { "21": "21a", "22": "22c" },
  "durationSeconds": 540
}
```

| Champ | Remarque |
|---|---|
| `teil_id` | `"1"` ou `"2"` — chaîne, pas un entier |
| `contentRevision` | **obligatoire**, repris tel quel de `GET /exercise`. S'il ne correspond pas au contenu actuel : `404 Content revision mismatch` |
| `answers` | clé = id du trou, valeur = id de l'option choisie |
| `score` | ne plus l'envoyer. Le champ est marqué *deprecated* et **ignoré** : le serveur calcule le score |
| `durationSeconds` | optionnel |

### La réponse

```json
{ "score": 73, "answerKey": { "21": "21b", "22": "22a" } }
```

### La correction, côté application

```dart
final wrong = <String>[];
answerKey.forEach((gapId, correctId) {
  if (myAnswers[gapId] != correctId) wrong.add(gapId);
});
```

---

## 4. L'encodage des identifiants

C'est le même dans les trois sens (exercice → soumission → corrigé), donc rien à
convertir.

### Teil 1 — choix multiple

```
id du trou    = gap_key            → "21", "22", "23"
id de l'option = gap_key + lettre  → "21a", "21b", "21c"
```

Ce sont exactement les `id` que tu reçois déjà dans `gaps[].options[].id` de
`GET /exercise`. `answerKey` renvoie l'un d'eux.

### Teil 2 — banque de mots

```
id du trou = gapKey        → "31", "32"
id du mot  = "w" + lettre  → "wa", "wb", "wc"
```

Ce sont les `id` de `wordBank[].id`. `answerKey` renvoie celui qui va dans chaque
trou.

---

## 5. Ce que tu gagnes au passage

- **Le score est calculé par le serveur.** Tu n'as plus à le faire, et il est
  cohérent partout.
- **La tentative est enregistrée.** Elle apparaît dans
  `GET /api/sprachbausteine/sessions` (historique, progression).
- **Les réponses sont validées.** Un id de trou inconnu ou une valeur hors des
  options renvoie `422`, ce qui remonte les erreurs plutôt que de les noter faux
  silencieusement.

---

## 6. Une précision sur la sécurité

Le corrigé est renvoyé **après** l'enregistrement de la tentative, jamais avant.

Ce n'est pas un détail : renvoyer le corrigé sur une soumission qui échoue à
s'enregistrer permettrait de récupérer les réponses en soumettant puis en ignorant
l'erreur — soit exactement la faille refermée en août, par une autre porte. Un test
verrouille cet ordre.

Conséquence pratique pour toi : **une soumission qui échoue ne renvoie pas de
corrigé.** Il faut donc traiter le cas d'erreur, et ne pas supposer qu'un
`answerKey` arrive toujours.

---

## 7. Lesen — c'est fait aussi

Les deux questions posées dans la version précédente de cette note sont
désormais tranchées côté backend, pour ne pas te bloquer plus longtemps.
`GET /api/reading/exercise` renvoie la bonne réponse sur chaque élément.

| Teil | Champ | Sur | Valeur |
|---|---|---|---|
| 1 | `correctTitleId` | chaque `texts[]` | l'`id` du titre correspondant, tel quel |
| 2 | `correctOptionId` | chaque `questions[]` | `"6a"` — numéro + lettre |
| 3 | `correctAnswer` | chaque `situations[]` | `"a"`…`"z"`, ou `"X"` si aucune annonce ne convient |

```jsonc
{
  "teil1": {
    "texts":  [ { "id": "1", "body": "…", "correctTitleId": "…" } ],
    "titles": [ { "id": "…", "content": "…" } ]
  },
  "teil2": {
    "questions": [ { "id": "6", "content": "…", "correctOptionId": "6a",
                     "options": [ { "id": "6a", "content": "…" } ] } ]
  },
  "teil3": {
    "situations":    [ { "id": "11", "content": "…", "correctAnswer": "a" } ],
    "announcements": [ { "id": "a", "title": "…", "content": "…" } ]
  }
}
```

### Ce que ça change pour toi

**Un seul point.** Ton bundle cherche `correctMatches` pour le Teil 1. Ce n'est
pas ce qui est envoyé : la bonne réponse est posée **sur chaque texte**
(`texts[].correctTitleId`) plutôt que rassemblée dans une map.

Le choix a été fait pour que Lesen ressemble à Sprachbausteine, et pour ne pas
ajouter un quatrième encodage à un endpoint qui en compte déjà trois. Si cette
lecture est coûteuse chez toi, dis-le : renvoyer une map `correctMatches` en
plus est trivial.

Le `"X"` du Teil 3 n'est pas une valeur d'erreur : c'est la situation à laquelle
aucune annonce ne répond, et le Teil 3 telc en contient toujours une.

### Attention

`POST /api/reading/submit` ne renvoie **que** `{ score }` — pas de `answerKey`,
contrairement à Sprachbausteine et Hören. Le corrigé est dans `/exercise`.

Et Lesen **n'enregistre aucune tentative**, quoi que tu envoies. Il n'y a ni
historique ni progression côté Reading, et il n'y en aura pas tant que ce n'est
pas construit — c'est un chantier séparé, pas un oubli de cette livraison.

---

## 8. Référence rapide

| Module | Corrigé disponible | Où |
|---|---|---|
| Hören | ✅ | `POST /listening/submit` → `answerKey` |
| Sprachbausteine | ✅ | `GET /sprachbausteine/exercise` → `correctOptionId` / `correctWordId`, **et** `POST /submit` → `answerKey` |
| Lesen | ✅ | `GET /reading/exercise` → `correctTitleId` / `correctOptionId` / `correctAnswer` |
| Schreiben | ✅ | `corrections[]` |
| Sprechen | ✅ | `POST /speaking/evaluate` → `corrections[]` |

### Tentatives enregistrées

Autre chose, pour éviter une mauvaise surprise plus tard :

| Module | Tentative enregistrée | Historique |
|---|---|---|
| Hören | ✅ | `GET /listening/sessions` |
| Sprachbausteine | ✅ si tu appelles `/submit` | `GET /sprachbausteine/sessions` |
| Lesen | ❌ jamais | aucun |

Documentation Swagger : `https://api.lerniqo.tech/api-docs`
