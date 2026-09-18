FROM node:24-alpine
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node package-lock.json ./
RUN npm ci --omit=dev
COPY --chown=node:node src ./src
USER node
ENV HOST=0.0.0.0 PORT=8787
EXPOSE 8787
CMD ["node", "src/server.js"]
