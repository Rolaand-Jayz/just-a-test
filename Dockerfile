FROM node:22.16.0-bookworm-slim
WORKDIR /app
ENV HOST=0.0.0.0 PORT=8080
COPY --chown=node:node . .
RUN mkdir -p /app/var /app/backups && chown -R node:node /app/var /app/backups
USER node
EXPOSE 8080
CMD ["node","app/server.mjs"]
