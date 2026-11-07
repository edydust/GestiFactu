FROM node:20-alpine

WORKDIR /app

# Install app dependencies
COPY package*.json ./
RUN npm install --production

# Bundle app source
COPY . .

# Expose ERP web & API port
EXPOSE 8090

# Environmental configuration
ENV PORT=8090
ENV DATA_DIR=/app/data

# Run application
CMD ["node", "server.js"]
