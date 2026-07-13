# MediShop Todo App — TP DevOps

Déploiement complet d'une application de gestion de tâches sur AWS, avec une
chaîne DevOps automatisée de bout en bout : **Terraform** (infrastructure),
**Ansible** (configuration), **Docker** (conteneurisation) et **GitHub
Actions** (CI/CD).

## Sommaire

- [Vue d'ensemble](#vue-densemble)
- [Architecture](#architecture)
- [Stack technique](#stack-technique)
- [Structure du repository](#structure-du-repository)
- [Choix techniques et justifications](#choix-techniques-et-justifications)
- [Reproduire l'infrastructure depuis zéro](#reproduire-linfrastructure-depuis-zéro)
- [Utilisation en local](#utilisation-en-local)
- [Règles de sécurité réseau](#règles-de-sécurité-réseau)
- [Pipeline CI/CD](#pipeline-cicd)
- [Dépannage](#dépannage)
- [Gestion des coûts](#gestion-des-coûts)
- [Démonstration pour la soutenance](#démonstration-pour-la-soutenance)

## Vue d'ensemble

MediShop souhaite une Todo App interne, déployée sur AWS de façon reproductible
et automatisée. L'application a 3 endpoints CRUD (création, modification,
suppression, plus une liste), un frontend simple, et tourne entièrement dans
des conteneurs Docker sur 3 instances EC2 séparées (Front / Back / DB).

## Architecture

```
                              Internet
                                 |
                                 v
   +---------------------------------------------------------+
   | VPC 10.0.0.0/16                                          |
   |  +------------------------------------------------------+
   |  | Sous-reseau public (10.0.1.0/24)                      |
   |  |  +------------------+      +------------------+       |
   |  |  |  Front (EC2)      |      |  NAT Gateway      |       |
   |  |  | Nginx + HTTPS      |      | Egress Internet   |       |
   |  |  | reverse proxy      |      | pour le prive      |       |
   |  |  +--------+----------+      +---------^--------+       |
   |  +-----------|----------------------------|---------------+
   |              |                            |
   |  +-----------|----------------------------|---------------+
   |  | Sous-reseau prive (10.0.2.0/24)         |               |
   |  |  +--------v----------+      +-----------+------+        |
   |  |  |  Back (EC2)        |----->|  DB (EC2)         |        |
   |  |  | Node/Express :3000 |      | PostgreSQL :5432  |        |
   |  |  +--------------------+      +--------------------+       |
   |  +-------------------------------------------------------+
   +-----------------------------------------------------------+
```

**Flux applicatif :** le navigateur charge la page en HTTPS depuis le Front.
Le JS front appelle `/api/...` en relatif (même origine) — Nginx sur le Front
proxifie ces appels vers le Back sur son IP privée. Le Back parle à la DB sur
son IP privée. Ni le Back ni la DB n'ont d'IP publique ni ne sont joignables
depuis Internet.

**Flux de déploiement (CI/CD) :** un `push` sur `main` déclenche GitHub
Actions, qui build les images modifiées, les pousse sur Docker Hub, puis se
connecte en SSH (directement au Front, ou via rebond par le Front pour
atteindre le Back) pour déployer le nouveau conteneur avec rollback
automatique en cas d'échec.

## Stack technique

| Composant | Choix | Pourquoi |
|---|---|---|
| Frontend | Vite (JS vanilla) | Léger, pas de framework superflu pour une todo list |
| Backend | Node.js + Express | Simple, standard, 3 endpoints CRUD |
| Base de données | PostgreSQL (image officielle) | Prépare la vraie couche DB EC2 du TP |
| IaC | Terraform | Standard de l'industrie, déclaratif, idempotent |
| Config management | Ansible | Idempotent, agentless (SSH uniquement) |
| Conteneurisation | Docker | Chaque appli isolée, portable |
| Registre d'images | Docker Hub | Gratuit, simple à intégrer en CI |
| CI/CD | GitHub Actions | Intégré au repo, gratuit pour ce volume |
| Reverse proxy / TLS | Nginx + Certbot (Let's Encrypt) | Standard, gratuit, renouvellement automatique |

## Structure du repository

```
todo-app/
├── frontend/                  # Application Vite (JS vanilla)
│   ├── src/
│   ├── Dockerfile
│   └── .env.example
├── backend/                   # API Express + PostgreSQL
│   ├── src/
│   ├── init.sql               # Création de la table todos
│   ├── Dockerfile
│   └── .env.example
├── terraform/                 # Infrastructure AWS
│   ├── main.tf                # Provider
│   ├── variables.tf           # Toutes les valeurs externalisées
│   ├── vpc.tf                 # VPC, subnets, IGW, NAT Gateway
│   ├── security_groups.tf     # 3 SG stricts par couche
│   ├── ec2.tf                 # 3 instances EC2
│   ├── outputs.tf             # IP front/back/db, SG id
│   └── terraform.tfvars.example
├── ansible/                   # Configuration des serveurs
│   ├── generate_inventory.py  # Génère l'inventaire depuis les outputs Terraform
│   ├── site.yml                # Playbook principal
│   ├── group_vars/            # domaine, ports, email Certbot
│   └── roles/
│       ├── docker/            # Installe Docker + Compose (3 machines)
│       └── nginx_front/       # Nginx + reverse proxy + Certbot (Front uniquement)
├── scripts/
│   └── remote_deploy.sh       # Script de déploiement avec rollback
├── .github/workflows/
│   └── deploy.yml             # Pipeline CI/CD
└── docker-compose.yml         # Environnement de dev local complet
```

## Choix techniques et justifications

Ces points sont ceux susceptibles d'être posés en soutenance — les réponses
sont préparées à l'avance.

**Pourquoi une NAT Gateway ?**
Back et DB sont dans un sous-réseau privé (aucune IP publique, conforme à la
règle "Internet ne doit jamais atteindre directement le Back ou la DB").
Mais Ansible doit y installer Docker, ce qui nécessite un accès Internet
sortant. La NAT Gateway permet cet accès sortant sans exposer les instances
en entrée. Coût : ~0,045 $/h, à détruire entre les sessions de travail (voir
[Gestion des coûts](#gestion-des-coûts)).

**Pourquoi un rebond SSH (bastion) via le Front ?**
Back et DB n'ayant pas d'IP publique, on ne peut pas s'y connecter
directement depuis l'extérieur. Le Front, seul à avoir une IP publique, sert
de bastion : Ansible et le pipeline CI/CD s'y connectent d'abord, puis
rebondissent (`ProxyJump`) vers Back/DB. Les Security Groups n'autorisent le
SSH vers Back/DB que depuis le Security Group du Front, jamais depuis
Internet.

**Pourquoi whitelister dynamiquement l'IP du runner GitHub dans le SG ?**
Le Security Group du Front n'autorise le SSH que depuis l'IP de
l'administrateur (règle stricte du TP). Mais GitHub Actions utilise des
runners avec des IP différentes à chaque exécution. Plutôt que d'ouvrir le
SSH à tout Internet (ce qui violerait la règle de sécurité), le pipeline
récupère l'IP du runner, l'autorise temporairement via l'API AWS
(`ec2:AuthorizeSecurityGroupIngress`) juste avant le déploiement, puis la
révoque immédiatement après (`if: always()`, donc même en cas d'échec). Le
SSH reste fermé au public en permanence, sauf le temps exact du déploiement.

**Pourquoi un script de rollback dans le déploiement ?**
Avant de remplacer un conteneur, le script sauvegarde le tag de l'image
actuellement en service. Si le nouveau conteneur ne démarre pas (santé
vérifiée après 5s), l'ancien conteneur est automatiquement relancé. Le
premier déploiement (aucun conteneur existant) est aussi géré sans échouer.

**Pourquoi nip.io au lieu d'un vrai nom de domaine ?**
Let's Encrypt exige un nom de domaine réel pour valider le contrôle du
domaine (HTTP-01 challenge) — une IP nue ne suffit pas. `nip.io` est un
service DNS public gratuit qui transforme automatiquement `IP.nip.io` en un
nom résolvant vers cette IP, ce qui satisfait Let's Encrypt sans achat de
domaine. Le playbook Ansible fonctionne à l'identique avec un vrai domaine
payant : il suffit de changer `domain_name` dans `group_vars/front.yml`.

**Pourquoi un monorepo (tout dans un seul dépôt Git) ?**
Le code applicatif, l'infra et la CI/CD sont fortement couplés : le pipeline
a besoin de connaître à la fois le code (pour builder) et l'infra (IP des
instances) pour déployer. Un seul dépôt évite toute désynchronisation entre
ces parties, et correspond à la demande du TP ("Code Terraform versionné sur
un dépôt Git").

## Reproduire l'infrastructure depuis zéro

### Prérequis

- Compte AWS avec l'AWS CLI configuré (`aws configure`)
- Terraform ≥ 1.5
- Ansible
- Docker (pour les tests locaux)
- Un compte Docker Hub

### 1. Générer une clé SSH

```bash
ssh-keygen -t ed25519 -f ~/.ssh/medishop-todo -C "medishop-todo"
```

### 2. Provisionner l'infrastructure (Terraform)

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
# Éditez terraform.tfvars : admin_ip = "VOTRE_IP/32" (curl -4 ifconfig.me)
terraform init
terraform plan
terraform apply
```

Notez les outputs affichés (`front_public_ip`, `back_private_ip`,
`db_private_ip`, `front_security_group_id`).

### 3. Configurer les serveurs (Ansible)

```bash
cd ../ansible
python3 generate_inventory.py   # lit les outputs Terraform automatiquement
ansible-playbook site.yml
```

Installe Docker sur les 3 machines, Nginx + Certbot sur le Front.

### 4. Démarrer PostgreSQL sur la DB (une seule fois, manuel)

```bash
scp -o "ProxyJump=ubuntu@<FRONT_IP>" -i ~/.ssh/medishop-todo backend/init.sql ubuntu@<DB_IP>:~/init.sql
ssh -J ubuntu@<FRONT_IP> -i ~/.ssh/medishop-todo ubuntu@<DB_IP>

docker run -d --name todo-db --restart unless-stopped -p 5432:5432 \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=<mot_de_passe> \
  -e POSTGRES_DB=todo_app \
  -v pgdata:/var/lib/postgresql/data \
  -v ~/init.sql:/docker-entrypoint-initdb.d/init.sql \
  postgres:16-alpine
```

### 5. Configurer les GitHub Secrets

| Secret | Valeur |
|---|---|
| `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` | Identifiants Docker Hub (token, pas le mot de passe) |
| `SSH_PRIVATE_KEY` | Contenu de `~/.ssh/medishop-todo` (clé privée) |
| `FRONT_HOST` / `BACK_HOST` / `DB_HOST` | IP publique Front, IP privée Back, IP privée DB |
| `PG_USER` / `PG_PASSWORD` / `PG_DATABASE` | Identifiants Postgres (mêmes que l'étape 4) |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Clé IAM dédiée (permissions minimales, voir ci-dessous) |
| `AWS_REGION` | Ex: `eu-west-3` |
| `FRONT_SG_ID` | `front_security_group_id` (output Terraform) |

La clé IAM utilisée par le pipeline n'a besoin que de ces deux permissions,
restreintes au strict nécessaire :
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": [
      "ec2:AuthorizeSecurityGroupIngress",
      "ec2:RevokeSecurityGroupIngress"
    ],
    "Resource": "*"
  }]
}
```

### 6. Déclencher le premier déploiement

```bash
git push origin main
```

Le pipeline build et déploie automatiquement ce qui a changé (`frontend/`
et/ou `backend/`).

## Utilisation en local

Pour développer/tester sans toucher à AWS :

```bash
docker compose up --build
```

- Frontend : http://localhost:8080
- Backend : http://localhost:3000/api/todos
- Postgres : localhost:5433 (mappé sur le port interne 5432, pour éviter un
  conflit avec un Postgres déjà installé en local)

Les healthchecks garantissent l'ordre de démarrage (`db` → `backend` →
`frontend`), pas besoin de relancer la commande en cas de démarrage à froid.

## Règles de sécurité réseau

| Règle | Implémentation |
|---|---|
| Internet → Front uniquement | SG Front : ingress 80/443 depuis `0.0.0.0/0` |
| Admin SSH → Front uniquement, depuis son IP | SG Front : ingress 22 depuis `admin_ip/32` |
| Front → Back | SG Back : ingress 3000 depuis le SG Front |
| Back → DB | SG DB : ingress 5432 depuis le SG Back |
| Aucune autre communication | Pas d'autre règle d'ingress sur aucun SG |
| SSH Front → Back/DB (bastion, pour Ansible/CI) | SG Back/DB : ingress 22 depuis le SG Front uniquement |

## Pipeline CI/CD

Déclenché sur chaque `push` vers `main` :

1. **`changes`** — détecte si `frontend/` et/ou `backend/` ont changé
   (`dorny/paths-filter`)
2. **`build-frontend` / `build-backend`** — build l'image Docker concernée
   uniquement, push sur Docker Hub avec deux tags (`latest` et le SHA du
   commit)
3. **`deploy-frontend` / `deploy-backend`** — whitelist temporaire de l'IP du
   runner sur le SG Front → connexion SSH (directe pour le Front, via
   `ProxyJump` pour le Back) → exécution de `remote_deploy.sh` (pull, arrêt
   de l'ancien conteneur, lancement du nouveau, vérification de santé,
   rollback automatique si échec) → révocation de la whitelist SSH

## Dépannage

**`Failed to fetch` côté frontend** — vérifier que `VITE_API_URL` est bien
géré comme "vide = chemin relatif" côté build (`!== undefined`, pas `||`,
qui traite `""` comme falsy en JS).

**`502 Bad Gateway`** — le backend n'est probablement pas déployé ou est
arrêté. Vérifier avec `docker ps -a` sur l'instance Back (via le bastion
Front).

**Erreur CORS** — vérifier que `CORS_ORIGIN` côté backend inclut bien
l'origine réellement utilisée par le navigateur.

**`ssh-keyscan`/SSH échoue depuis GitHub Actions** — vérifier que les 4
secrets AWS (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`,
`FRONT_SG_ID`) sont bien configurés : c'est la whitelist dynamique qui
autorise le runner.

**Port déjà utilisé en local (`5432` par ex.)** — un Postgres local tourne
probablement déjà sur la machine ; le `docker-compose.yml` utilise `5433`
côté hôte pour éviter ce conflit.

## Gestion des coûts

Seule la **NAT Gateway** engendre un coût garanti (~0,045 $/h + trafic). Les
instances EC2 `t3.micro` restent gratuites tant que le compte est éligible
au tier gratuit AWS.

Entre deux sessions de travail :
```bash
cd terraform
terraform destroy
```

Pour tout recréer à l'identique :
```bash
terraform apply
cd ../ansible && python3 generate_inventory.py && ansible-playbook site.yml
# + redémarrer le conteneur Postgres sur la DB (étape 4 ci-dessus)
```

## Démonstration pour la soutenance

1. Montrer l'application fonctionnelle en HTTPS (`https://<domaine>`)
2. Modifier un détail visible du frontend, `git push`
3. Suivre le pipeline en direct sur l'onglet GitHub Actions
4. Rafraîchir le site : le changement est visible sans aucune action manuelle
5. (Optionnel) Montrer le rollback : déployer une image volontairement
   cassée et observer le script relancer automatiquement l'ancienne version