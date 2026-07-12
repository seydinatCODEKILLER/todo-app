# Todo App — MediShop (TP DevOps)

## Structure

```
todo-app/
├── backend/     # API Express + PostgreSQL
├── frontend/    # UI Vite (JS vanilla)
└── docker-compose.yml
```

## Lancer en local avec Docker (le plus simple)

```bash
docker compose up --build
```

- Frontend : http://localhost:8080
- Backend : http://localhost:3000/api/todos
- Postgres : localhost:5432

## Lancer en local sans Docker

### Backend

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```
Nécessite un Postgres qui tourne en local avec les identifiants du `.env`.
Créez la table avec `init.sql` :
```bash
psql -U postgres -d todo_app -f init.sql
```

### Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```
Ouvrez http://localhost:5173

## API

| Méthode | Route             | Description   |
|---------|--------------------|--------------|
| GET     | /api/todos         | Liste des tâches |
| POST    | /api/todos         | Création (`{ title }`) |
| PUT     | /api/todos/:id     | Modification (`{ title?, done? }`) |
| DELETE  | /api/todos/:id     | Suppression |
