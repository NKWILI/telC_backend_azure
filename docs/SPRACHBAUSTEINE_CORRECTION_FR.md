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

Le corrigé est désormais renvoyé **au moment de la soumission**, et non plus avec
l'exercice. C'est le même fonctionnement que Hören, qui marche déjà ainsi.

**`POST /api/sprachbausteine/submit`** renvoie maintenant :

```json
{
  "score": 73,
  "answerKey": { "21": "21b", "22": "22a", "23": "23c" }
}
```

`answerKey` contient **la bonne réponse par trou**, dans exactement le même
encodage que celui que tu envoies. La comparaison est donc directe.

`GET /api/sprachbausteine/exercise` reste inchangé : pas de corrigé dedans.

---

## 3. Ce que tu dois faire

### Le flux devient

```
1. GET  /api/sprachbausteine/exercise?modelltest=1
   → afficher l'exercice, l'étudiant répond

2. POST /api/sprachbausteine/submit
   → { score, answerKey }

3. Afficher la correction en comparant tes réponses à answerKey
```

Aujourd'hui l'application n'appelle jamais `/submit` (0 occurrence dans le
bundle). C'est le point à ajouter.

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

## 7. Reste à faire — Lesen

Le même problème existe sur Lesen, et il va se poser dès que tu attaqueras cet
écran. Le bundle montre que ton code lit `correctMatches`, et l'API ne l'envoie pas
non plus. `reading/submit` n'est jamais appelé.

**Deux questions pour pouvoir le corriger sans se tromper :**

1. **Quelle forme attends-tu pour `correctMatches` ?**
   `{ idDuTexte: idDuTitre }` ou l'inverse `{ idDuTitre: idDuTexte }` ?
2. **Lesen Teil 2** (choix multiple) — quel nom de champ ton code attend-il pour
   la bonne option ? On n'a trouvé ni `correctOptionId` ni autre chose côté Lesen
   dans le bundle.

Dès que tu réponds, on applique la même correction sur Lesen Teil 1, 2 et 3.

---

## 8. Référence rapide

| Module | Corrigé disponible | Où |
|---|---|---|
| Hören | ✅ | `POST /listening/submit` → `answerKey` |
| Sprachbausteine | ✅ (nouveau) | `POST /sprachbausteine/submit` → `answerKey` |
| Lesen | ❌ | en attente de tes deux réponses |
| Schreiben | ✅ | `corrections[]` |
| Sprechen | ✅ | `POST /speaking/evaluate` → `corrections[]` |

Documentation Swagger : `https://api.lerniqo.tech/api-docs`
