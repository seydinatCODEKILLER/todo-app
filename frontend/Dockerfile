# --- Stage 1 : build des assets statiques ---
FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Injecté au build : l'URL de l'API n'est jamais en dur dans le code
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build

# --- Stage 2 : servir les fichiers statiques ---
# Ce nginx-là est interne au conteneur (sert le build Vite statique).
# Le Nginx "reverse proxy" de l'instance Front (installé par Ansible,
# cf. TP DevOps section 3.5) proxifie vers ce conteneur.
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
