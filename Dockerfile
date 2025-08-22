FROM node:20-alpine

WORKDIR /app

# Copier les fichiers de dépendances
COPY package*.json ./

# Installer les dépendances
RUN npm ci --omit=dev

# Copier le code source
COPY . .

# Créer le dossier uploads s'il n'existe pas
RUN mkdir -p uploads

# Exposer le port
EXPOSE 4002

# Commande de démarrage
CMD ["npm", "start"]
