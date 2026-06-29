# Commandes du bot

## Configuration

- `/setup role_staff categorie salon_logs salon_transcripts couleur langue`
  Configure le role staff, la categorie des tickets, les logs, les transcripts, la couleur des embeds et la langue.

- `/config`
  Affiche la configuration actuelle.

## Panneaux

- `/panel ticket salon categorie role_accepte titre description questions choix remplacer`
  Envoie un panneau pour ouvrir un ticket.

- `/panel candidature salon categorie role_accepte titre description questions choix remplacer`
  Envoie un panneau pour ouvrir une candidature.

`categorie` choisit ou les salons ouverts par ce panneau seront crees.
`role_accepte` choisit quel role peut voir les tickets ouverts par ce panneau.

Les questions se separent avec `|`.
Exemple: `Pseudo ? | Pourquoi tu nous contactes ? | Preuve ?`

`choix` cree un ou plusieurs menus deroulants. Chaque choix se separe avec `|`.
Format: `Texte / emoji`
Exemple: `FIVEM ACCOUNT / emoji | FORTNITE ACCOUNT / emoji`
Discord limite chaque menu a 25 choix; le bot cree automatiquement plusieurs menus si tu en mets plus.

- `/panel nettoyer salon`
  Supprime les anciens panneaux du bot dans un salon.

## Tickets

- `/ticket close raison`
  Ferme le ticket, cree un transcript et supprime le salon.

- `/ticket add membre`
  Ajoute un membre au ticket.

- `/ticket remove membre`
  Retire un membre du ticket.

- `/ticket rename nom`
  Renomme le salon du ticket.

- `/ticket claim`
  Prend en charge le ticket.

- `/ticket unclaim`
  Libere le ticket.

- `/ticket transcript`
  Cree un transcript sans fermer le ticket.

- `/ticket priority niveau`
  Change la priorite: basse, normal, haute, urgente.

- `/ticket lock`
  Verrouille le ticket pour l'utilisateur.

- `/ticket unlock`
  Deverrouille le ticket.

## Candidatures

- `/application accept note`
  Accepte une candidature dans son salon.

- `/application reject note`
  Refuse une candidature dans son salon.

## Reponses automatiques

- `/autoresponder add declencheur reponse`
  Ajoute une reponse automatique.

- `/autoresponder remove declencheur`
  Supprime une reponse automatique.

- `/autoresponder list`
  Liste les reponses automatiques.
